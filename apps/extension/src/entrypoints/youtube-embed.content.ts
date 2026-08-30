import { blobToBase64 } from '../lib/blob';
import { captureSpan } from '../lib/capture';
import type { M2EmbedCaptureRequest, M2EmbedCaptureResponse } from '../lib/messages';
import { webmOpusToMp3 } from '../lib/mp3';

const VIDEO_WAIT_MS = 10_000;

export default defineContentScript({
  matches: ['https://www.youtube.com/embed/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender,
        sendResponse: (response: M2EmbedCaptureResponse) => void,
      ) => {
        if (!isCaptureRequest(message)) return undefined;
        void capture(message)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      },
    );
  },
});

async function capture(message: M2EmbedCaptureRequest): Promise<M2EmbedCaptureResponse> {
  const video = await waitForVideo();
  const { startMs, endMs, imageMs } = message.capture;
  const { audioWebm, imageJpeg } = await captureSpan(video, startMs, endMs, {
    padStartMs: 0,
    padEndMs: 0,
    imageTimeMs: imageMs,
  });
  const audioMp3 = await webmOpusToMp3(audioWebm);
  return {
    ok: true,
    audioBase64: await blobToBase64(audioMp3),
    imageBase64: imageJpeg ? await blobToBase64(imageJpeg) : null,
  };
}

function waitForVideo(): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + VIDEO_WAIT_MS;
    const poll = (): void => {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (video?.readyState) {
        resolve(video);
      } else if (performance.now() >= deadline) {
        reject(new Error('The embedded YouTube player did not expose a ready video element.'));
      } else {
        window.setTimeout(poll, 100);
      }
    };
    poll();
  });
}

function isCaptureRequest(value: unknown): value is M2EmbedCaptureRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<M2EmbedCaptureRequest>;
  if (request.type !== 'm2-embed-capture' || !request.capture) return false;
  const { startMs, endMs, imageMs } = request.capture;
  return (
    [startMs, endMs, imageMs].every((time) => Number.isFinite(time)) &&
    startMs >= 0 &&
    endMs > startMs &&
    endMs - startMs <= 30_000 &&
    imageMs >= startMs &&
    imageMs <= endMs
  );
}
