import {
  EXPLAIN_PORT,
  M2_4989_CHANNEL,
  M2_4989_SUPPORTED_VERSIONS,
  isM24989PageRequest,
  type ExplainPortClientMessage,
  type ExplainPortServerMessage,
  type ExplainResult,
  type M24989ProtocolVersion,
  type M2TargetCheckRequest,
  type M24989RuntimeMineRequest,
  type M24989RuntimeStatus,
  type MineResponse,
  type TargetCheckResponse,
} from '../lib/messages';

const MATCHES = [
  'https://4989.c-ehrlich.dev/*',
  'http://127.0.0.1:4989/*',
  'http://localhost:4989/*',
];

type Reply =
  | { type: 'ready' }
  | { type: 'status'; requestId: string; phase: M24989RuntimeStatus['phase'] }
  | { type: 'result'; requestId: string; result: MineResponse | TargetCheckResponse | ExplainResult }
  | { type: 'explain-delta'; requestId: string; text: string };

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_idle',
  main() {
    // Replies go out in the protocol version the page spoke, so v3 pages keep
    // working. Status pushes carry no version, so remember it per request.
    const requestVersions = new Map<string, M24989ProtocolVersion>();
    const explainPorts = new Map<string, Browser.runtime.Port>();

    const post = (version: M24989ProtocolVersion, reply: Reply): void =>
      window.postMessage(
        { channel: M2_4989_CHANNEL, version, source: 'freegaku', ...reply },
        location.origin,
      );
    const readyAll = (): void => {
      for (const version of M2_4989_SUPPORTED_VERSIONS) post(version, { type: 'ready' });
    };
    const relayResult = (
      version: M24989ProtocolVersion,
      requestId: string,
      runtimeMessage: M24989RuntimeMineRequest | M2TargetCheckRequest,
    ): void => {
      void browser.runtime
        .sendMessage(runtimeMessage)
        .then((result: MineResponse | TargetCheckResponse) => {
          post(version, { type: 'result', requestId, result });
        })
        .catch((error: unknown) => {
          post(version, {
            type: 'result',
            requestId,
            result: { ok: false, error: error instanceof Error ? error.message : String(error) },
          });
        })
        .finally(() => requestVersions.delete(requestId));
    };

    const startExplain = (requestId: string, request: ExplainPortClientMessage['request']): void => {
      explainPorts.get(requestId)?.disconnect();
      const port = browser.runtime.connect({ name: EXPLAIN_PORT });
      explainPorts.set(requestId, port);
      let done = false;
      port.onMessage.addListener((message: unknown) => {
        const msg = message as ExplainPortServerMessage;
        if (msg.type === 'delta') post(4, { type: 'explain-delta', requestId, text: msg.text });
        else if (msg.type === 'done') {
          done = true;
          explainPorts.delete(requestId);
          post(4, { type: 'result', requestId, result: msg.result });
        }
      });
      port.onDisconnect.addListener(() => {
        explainPorts.delete(requestId);
        if (!done) {
          post(4, {
            type: 'result',
            requestId,
            result: { ok: false, error: 'The explanation was interrupted. Try again.' },
          });
        }
      });
      port.postMessage({ type: 'start', request } satisfies ExplainPortClientMessage);
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      const status = message as Partial<M24989RuntimeStatus>;
      if (
        status.type !== 'm2-4989-status' ||
        typeof status.requestId !== 'string' ||
        (status.phase !== 'checking-anki' &&
          status.phase !== 'capturing' &&
          status.phase !== 'updating-anki')
      ) {
        return undefined;
      }
      post(requestVersions.get(status.requestId) ?? 3, {
        type: 'status',
        requestId: status.requestId,
        phase: status.phase,
      });
      return undefined;
    });

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!isM24989PageRequest(data)) return;

      switch (data.type) {
        case 'probe':
          post(data.version, { type: 'ready' });
          return;
        case 'open-settings':
          void browser.runtime.sendMessage({ type: 'm2-open-settings' });
          return;
        case 'explain':
          startExplain(data.requestId, data.request);
          return;
        case 'explain-cancel':
          // Disconnecting aborts the OpenRouter request; the page has already
          // dropped this id, so no result is posted.
          explainPorts.get(data.requestId)?.disconnect();
          explainPorts.delete(data.requestId);
          return;
        case 'target-check':
        case 'mine': {
          const { requestId, version } = data;
          requestVersions.set(requestId, version);
          post(version, { type: 'status', requestId, phase: 'checking-anki' });
          if (data.type === 'target-check') {
            relayResult(version, requestId, {
              type: 'm2-target-check',
              mode: 'update',
              lines: data.lines,
            });
          } else {
            relayResult(version, requestId, {
              type: 'm2-4989-mine',
              requestId,
              payload: data.payload,
            });
          }
          return;
        }
      }
    });

    readyAll();
  },
});
