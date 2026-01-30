/**
 * Audio utility functions for processing audio data
 */

/**
 * Calculates RMS (Root Mean Square) level from audio buffer
 * @param buffer Audio buffer (Float32Array)
 * @returns RMS level (0..1)
 */
export function calculateRMS(buffer: Float32Array): number {
  if (!buffer || buffer.length === 0) {
    throw new Error('calculateRMS: Invalid buffer (null or empty)');
  }
  
  if (!(buffer instanceof Float32Array)) {
    throw new Error(`calculateRMS: Expected Float32Array, got ${typeof buffer}`);
  }
  
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const value = buffer[i];
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error(`calculateRMS: Invalid value at index ${i}: ${value}`);
    }
    sum += value * value;
  }
  
  if (buffer.length === 0) {
    return 0;
  }
  
  const mean = sum / buffer.length;
  const rms = Math.sqrt(mean);
  
  // Validate result
  if (!isFinite(rms)) {
    throw new Error(`calculateRMS: Invalid RMS result: ${rms} (mean: ${mean}, sum: ${sum})`);
  }
  
  return rms;
}

/**
 * Downsamples audio buffer from source sample rate to target sample rate
 * @param sourceBuffer Source audio buffer
 * @param sourceSampleRate Original sample rate (Hz)
 * @param targetSampleRate Target sample rate (Hz)
 * @returns Downsampled audio buffer
 */
export function downsample(
  sourceBuffer: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (!sourceBuffer || sourceBuffer.length === 0) {
    throw new Error('downsample: Invalid source buffer (null or empty)');
  }
  
  if (!(sourceBuffer instanceof Float32Array)) {
    throw new Error(`downsample: Expected Float32Array, got ${typeof sourceBuffer}`);
  }
  
  if (!isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error(`downsample: Invalid sourceSampleRate: ${sourceSampleRate}`);
  }
  
  if (!isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new Error(`downsample: Invalid targetSampleRate: ${targetSampleRate}`);
  }
  
  if (sourceSampleRate === targetSampleRate) {
    return sourceBuffer;
  }

  const sampleRateRatio = sourceSampleRate / targetSampleRate;
  if (!isFinite(sampleRateRatio) || sampleRateRatio <= 0) {
    throw new Error(`downsample: Invalid sampleRateRatio: ${sampleRateRatio}`);
  }
  
  const newLength = Math.round(sourceBuffer.length / sampleRateRatio);
  if (newLength <= 0 || !isFinite(newLength)) {
    throw new Error(`downsample: Invalid newLength: ${newLength} (sourceLength: ${sourceBuffer.length}, ratio: ${sampleRateRatio})`);
  }
  
  const result = new Float32Array(newLength);
  
  let offsetResult = 0;
  let offsetSource = 0;
  
  while (offsetResult < result.length) {
    const nextOffsetSource = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    
    for (let i = offsetSource; i < nextOffsetSource && i < sourceBuffer.length; i++) {
      const value = sourceBuffer[i];
      if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`downsample: Invalid value at index ${i}: ${value}`);
      }
      accum += value;
      count++;
    }
    
    if (count === 0) {
      result[offsetResult] = 0;
    } else {
      result[offsetResult] = accum / count;
      if (!isFinite(result[offsetResult])) {
        throw new Error(`downsample: Invalid result at index ${offsetResult}: ${result[offsetResult]} (accum: ${accum}, count: ${count})`);
      }
    }
    
    offsetResult++;
    offsetSource = nextOffsetSource;
  }
  
  return result;
}

/**
 * Converts Float32 audio buffer to Int16 PCM format
 * @param floatBuffer Float32 audio buffer (values -1 to 1)
 * @returns Int16 PCM buffer
 */
export function floatToInt16(floatBuffer: Float32Array): Int16Array {
  if (!floatBuffer || floatBuffer.length === 0) {
    throw new Error('floatToInt16: Invalid buffer (null or empty)');
  }
  
  if (!(floatBuffer instanceof Float32Array)) {
    throw new Error(`floatToInt16: Expected Float32Array, got ${typeof floatBuffer}`);
  }
  
  const int16Buffer = new Int16Array(floatBuffer.length);
  for (let i = 0; i < floatBuffer.length; i++) {
    const value = floatBuffer[i];
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error(`floatToInt16: Invalid value at index ${i}: ${value}`);
    }
    
    // Clamp to [-1, 1] range and convert to Int16
    const s = Math.max(-1, Math.min(1, value));
    // Convert to Int16 range [-32768, 32767]
    const intValue = Math.round(s * 32767);
    
    if (!isFinite(intValue) || intValue < -32768 || intValue > 32767) {
      throw new Error(`floatToInt16: Invalid int16 value at index ${i}: ${intValue} (from ${value})`);
    }
    
    int16Buffer[i] = intValue;
  }
  return int16Buffer;
}
