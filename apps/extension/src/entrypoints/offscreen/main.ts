import { blobToBase64 } from '../../lib/blob';

// Offscreen document: the only extension context allowed to call getUserMedia
// in MV3. Records tab audio from a tabCapture stream ID. Works on DRM sites —
// tabCapture taps the tab's decoded audio output, downstream of the CDM.

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let loopback: AudioContext | null = null;
let chunks: BlobPart[] = [];

chrome.runtime.onMessage.addListener(
  (
    msg: { target?: string; type?: string; streamId?: string },
    _sender,
    sendResponse: (res: { ok: boolean; error?: string; audioBase64?: string }) => void,
  ) => {
    if (msg?.target !== 'm2-offscreen') return;
    if (msg.type === 'start') {
      start(msg.streamId!)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg.type === 'stop') {
      stop()
        .then((audioBase64) => sendResponse({ ok: true, audioBase64 }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
  },
);

async function start(streamId: string): Promise<void> {
  if (recorder) await stop().catch(() => {});
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    },
  } as unknown as MediaStreamConstraints);
  // tabCapture mutes the captured tab for the user — loop the stream back to
  // the speakers so playback stays audible while recording.
  loopback = new AudioContext();
  loopback.createMediaStreamSource(stream).connect(loopback.destination);
  chunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
}

async function stop(): Promise<string> {
  const rec = recorder;
  if (!rec) throw new Error('Not recording');
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  if (rec.state !== 'inactive') rec.stop();
  await stopped;
  stream?.getTracks().forEach((t) => t.stop());
  await loopback?.close().catch(() => {});
  const blob = new Blob(chunks, { type: 'audio/webm' });
  recorder = null;
  stream = null;
  loopback = null;
  chunks = [];
  if (blob.size === 0) throw new Error('Recording produced no audio');
  return await blobToBase64(blob);
}
