// Audio chunk conversion for Whisper: webm/opus (MediaRecorder output) →
// 16 kHz mono 16-bit WAV, the cheapest thing Whisper accepts (it resamples
// to 16 kHz internally anyway, so nothing is lost).

export interface WavChunk {
  blob: Blob;
  durationSec: number;
}

export async function webmToWav16kMono(webm: Blob): Promise<WavChunk> {
  const raw = await webm.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(raw);
  } finally {
    await decodeCtx.close().catch(() => {});
  }
  const frames = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { blob: encodeWav(rendered.getChannelData(0), 16000), durationSec: rendered.duration };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
