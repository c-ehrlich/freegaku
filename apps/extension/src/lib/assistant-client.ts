import { ASSISTANT_PORT } from './messages';
import type {
  AssistantPortClientMessage,
  AssistantPortServerMessage,
  AssistantResult,
} from './messages';

export interface AssistantStream {
  result: Promise<AssistantResult>;
  /** Stops generation; result resolves with { ok: false, error: 'Cancelled' }. */
  cancel(): void;
}

/** Content-script side of the assistant port (see ASSISTANT_PORT). */
export function streamAssistant(
  start: AssistantPortClientMessage,
  onDelta: (text: string) => void,
): AssistantStream {
  const port = browser.runtime.connect({ name: ASSISTANT_PORT });
  let settle!: (result: AssistantResult) => void;
  let settled = false;
  const result = new Promise<AssistantResult>((resolve) => (settle = resolve));
  const finish = (r: AssistantResult): void => {
    if (settled) return;
    settled = true;
    settle(r);
  };
  port.onMessage.addListener((message: unknown) => {
    const msg = message as AssistantPortServerMessage;
    if (msg.type === 'delta' && !settled) onDelta(msg.text);
    else if (msg.type === 'done') finish(msg.result);
  });
  port.onDisconnect.addListener(() =>
    finish({ ok: false, error: 'The answer was interrupted. Try again.' }),
  );
  port.postMessage(start);
  return {
    result,
    cancel() {
      if (settled) return;
      port.disconnect();
      finish({ ok: false, error: 'Cancelled' });
    },
  };
}
