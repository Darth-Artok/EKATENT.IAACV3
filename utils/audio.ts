// --- Audio Encoding & Decoding Utilities ---

/**
 * Encodes raw audio bytes into a base64 string.
 * @param {Uint8Array} bytes The raw audio data.
 * @returns {string} The base64 encoded audio string.
 */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string into raw audio bytes.
 * @param {string} base64 The base64 encoded audio string.
 * @returns {Uint8Array} The decoded raw audio data.
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM audio data into an AudioBuffer that can be played.
 * The Gemini Live API sends a stream of raw PCM audio data, not a standard file format.
 * @param {Uint8Array} data The raw PCM audio data.
 * @param {AudioContext} ctx The AudioContext to use for creating the buffer.
 * @param {number} sampleRate The sample rate of the audio (e.g., 24000 for Gemini TTS/Live).
 * @param {number} numChannels The number of audio channels (typically 1).
 * @returns {Promise<AudioBuffer>} A promise that resolves to an AudioBuffer.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
