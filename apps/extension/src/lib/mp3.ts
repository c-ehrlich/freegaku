import { Mp3Encoder } from '@breezystack/lamejs';

export async function webmOpusToMp3(webm: Blob, opts?: { kbps?: number }): Promise<Blob> {
  const audioContext = new AudioContext();

  try {
    const arrayBuffer = await webm.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const mono = downmixToMono(audioBuffer);
    const samples = floatToInt16(mono);
    const encoder = new Mp3Encoder(1, audioBuffer.sampleRate, opts?.kbps ?? 128);
    const chunks: Array<Uint8Array<ArrayBuffer>> = [];

    for (let offset = 0; offset < samples.length; offset += 1152) {
      const encoded = encoder.encodeBuffer(samples.subarray(offset, offset + 1152));
      if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
    }

    const flushed = encoder.flush();
    if (flushed.length > 0) chunks.push(new Uint8Array(flushed));

    return new Blob(chunks, { type: 'audio/mpeg' });
  } finally {
    await audioContext.close();
  }
}

function downmixToMono(audioBuffer: AudioBuffer): Float32Array {
  const frameCount = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;
  const mono = new Float32Array(frameCount);

  for (let channel = 0; channel < channelCount; channel++) {
    const input = audioBuffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      mono[i] = (mono[i] ?? 0) + (input[i] ?? 0) / channelCount;
    }
  }

  return mono;
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }

  return output;
}
