import { EXPLAIN_PORT } from './messages';
import type {
  ExplainPortClientMessage,
  ExplainPortServerMessage,
  ExplainRequest,
  ExplainResult,
} from './messages';

export interface ExplainStream {
  result: Promise<ExplainResult>;
  /** Stops generation; result resolves with { ok: false, error: 'Cancelled' }. */
  cancel(): void;
}

/** Content-script side of the explain port (see EXPLAIN_PORT). */
export function streamExplanation(
  request: ExplainRequest,
  onDelta: (text: string) => void,
): ExplainStream {
  const port = browser.runtime.connect({ name: EXPLAIN_PORT });
  let settle!: (result: ExplainResult) => void;
  let settled = false;
  const result = new Promise<ExplainResult>((resolve) => (settle = resolve));
  const finish = (r: ExplainResult): void => {
    if (settled) return;
    settled = true;
    settle(r);
  };
  port.onMessage.addListener((message: unknown) => {
    const msg = message as ExplainPortServerMessage;
    if (msg.type === 'delta' && !settled) onDelta(msg.text);
    else if (msg.type === 'done') finish(msg.result);
  });
  port.onDisconnect.addListener(() =>
    finish({ ok: false, error: 'The explanation was interrupted. Try again.' }),
  );
  port.postMessage({ type: 'start', request } satisfies ExplainPortClientMessage);
  return {
    result,
    cancel() {
      if (settled) return;
      port.disconnect();
      finish({ ok: false, error: 'Cancelled' });
    },
  };
}
