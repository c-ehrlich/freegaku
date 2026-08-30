import {
  M2_4989_CHANNEL,
  M2_4989_PROTOCOL_VERSION,
  isM24989PageRequest,
  type M24989PageResponse,
  type M24989RuntimeMineRequest,
  type M24989RuntimeStatus,
  type MineResponse,
} from '../lib/messages';

const MATCHES = [
  'https://4989.c-ehrlich.dev/*',
  'http://127.0.0.1:4989/*',
  'http://localhost:4989/*',
];

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_idle',
  main() {
    const post = (message: M24989PageResponse): void => window.postMessage(message, location.origin);
    const ready = (): void =>
      post({
        channel: M2_4989_CHANNEL,
        version: M2_4989_PROTOCOL_VERSION,
        source: 'freegaku',
        type: 'ready',
      });

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
      post({
        channel: M2_4989_CHANNEL,
        version: M2_4989_PROTOCOL_VERSION,
        source: 'freegaku',
        type: 'status',
        requestId: status.requestId,
        phase: status.phase,
      });
      return undefined;
    });

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (!isM24989PageRequest(event.data)) return;

      if (event.data.type === 'probe') {
        ready();
        return;
      }

      const { payload, requestId } = event.data;
      post({
        channel: M2_4989_CHANNEL,
        version: M2_4989_PROTOCOL_VERSION,
        source: 'freegaku',
        type: 'status',
        requestId,
        phase: 'checking-anki',
      });

      const runtimeMessage: M24989RuntimeMineRequest = {
        type: 'm2-4989-mine',
        requestId,
        payload,
      };
      void browser.runtime
        .sendMessage(runtimeMessage)
        .then((result: MineResponse) => {
          post({
            channel: M2_4989_CHANNEL,
            version: M2_4989_PROTOCOL_VERSION,
            source: 'freegaku',
            type: 'result',
            requestId,
            result,
          });
        })
        .catch((error: unknown) => {
          post({
            channel: M2_4989_CHANNEL,
            version: M2_4989_PROTOCOL_VERSION,
            source: 'freegaku',
            type: 'result',
            requestId,
            result: {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });
    });

    ready();
  },
});
