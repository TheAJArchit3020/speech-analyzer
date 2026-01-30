import { calculateRMS, downsample, floatToInt16 } from './audioUtils';

export interface MicCaptureOptions {
  onLevel?: (level: number) => void;
  onPcmFrame?: (pcm16: Int16Array) => void;
  targetSampleRate?: number; // Default: 16000
}

/**
 * Microphone capture using Web Audio API with AnalyserNode.
 * Modern implementation that avoids deprecated ScriptProcessorNode.
 * Captures audio from the default microphone, computes RMS levels,
 * downsamples to 16kHz, and outputs PCM Int16 frames.
 */
export class MicCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private silentGain: GainNode | null = null;
  private isCapturing: boolean = false;
  private sampleIntervalId: ReturnType<typeof setInterval> | null = null;

  private onLevelCallback?: (level: number) => void;
  private onPcmFrameCallback?: (pcm16: Int16Array) => void;
  private targetSampleRate: number = 16000;

  // Buffer to accumulate samples for PCM frame generation
  private sampleBuffer: Float32Array[] = [];
  private samplesPerFrame: number = 0;
  private sourceSampleRate: number = 0;

  /**
   * Starts microphone capture and audio processing
   */
  async start(options: MicCaptureOptions = {}): Promise<void> {
    if (this.isCapturing) {
      this.stop();
    }

    this.onLevelCallback = options.onLevel;
    this.onPcmFrameCallback = options.onPcmFrame;
    this.targetSampleRate = options.targetSampleRate || 16000;
    
    try {
      // Request microphone access using navigator.mediaDevices.getUserMedia
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      // Create AudioContext with error handling
      try {
        this.audioContext = new AudioContext({
          sampleRate: 48000, // Most browsers use 48kHz
        });
        
        // Resume AudioContext if it's suspended (required in some browsers/Electron)
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        this.sourceSampleRate = this.audioContext.sampleRate;
      } catch (error: any) {
        console.error('[MicCapture] Failed to create AudioContext:', error);
        // Clean up media stream
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(track => track.stop());
          this.mediaStream = null;
        }
        throw new Error(`Failed to initialize audio context: ${error.message || error}`);
      }

      // Create source node from media stream
      try {
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      } catch (error: any) {
        console.error('[MicCapture] Failed to create MediaStreamSource:', error);
        this.cleanup();
        throw new Error(`Failed to create audio source: ${error.message || error}`);
      }

      // Create AnalyserNode for processing audio
      try {
        this.analyserNode = this.audioContext.createAnalyser();
        // Set fftSize to control buffer size (must be power of 2)
        // 2048 gives us ~43ms of audio at 48kHz (good balance)
        this.analyserNode.fftSize = 2048;
        this.analyserNode.smoothingTimeConstant = 0.8;
        
        // Create a silent gain node to keep the audio context active
        // without playing audio through speakers
        this.silentGain = this.audioContext.createGain();
        this.silentGain.gain.value = 0; // Silent output
        
        // Calculate how many samples we need per PCM frame
        // We want to generate frames at approximately the target sample rate
        const frameDuration = 0.1; // 100ms frames
        this.samplesPerFrame = Math.round(this.sourceSampleRate * frameDuration);
        
        // Connect the audio processing chain
        // Source -> Analyser -> Silent Gain -> Destination
        // This keeps the context active without audio feedback
        this.sourceNode.connect(this.analyserNode);
        this.analyserNode.connect(this.silentGain);
        this.silentGain.connect(this.audioContext.destination);
      } catch (error: any) {
        console.error('[MicCapture] Failed to create AnalyserNode:', error);
        this.cleanup();
        throw new Error(`Failed to create audio analyser: ${error.message || error}`);
      }

      // Reset sample buffer
      this.sampleBuffer = [];

      // Start periodic audio sampling
      // Sample at ~100Hz (every 10ms) for responsive level updates
      const sampleInterval = 10; // milliseconds
      this.startSampling(sampleInterval);

      this.isCapturing = true;
      console.log('[MicCapture] Started successfully');
    } catch (error) {
      // Clean up on error
      this.cleanup();
      throw error;
    }
  }

  /**
   * Starts periodic audio sampling using setInterval
   */
  private startSampling(intervalMs: number): void {
    if (this.sampleIntervalId !== null) {
      clearInterval(this.sampleIntervalId);
    }

    this.sampleIntervalId = setInterval(() => {
      if (!this.isCapturing || !this.analyserNode || !this.audioContext) {
        return;
      }

      try {
        this.processAudioFrame();
      } catch (error: any) {
        console.error('[MicCapture] Error in audio processing:', error);
        // Don't stop on error, just log it
      }
    }, intervalMs);
  }

  /**
   * Processes a single audio frame from the analyser
   */
  private processAudioFrame(): void {
    if (!this.analyserNode || !this.audioContext) {
      return;
    }

    // Get the buffer size from analyser
    const bufferLength = this.analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    
    // Get time domain data (raw audio samples)
    this.analyserNode.getFloatTimeDomainData(dataArray);

    // Calculate RMS level for this frame
    let rms: number;
    try {
      rms = calculateRMS(dataArray);
    } catch (error: any) {
      console.error('[MicCapture] Error calculating RMS:', error);
      return;
    }

    // Call level callback
    if (this.onLevelCallback) {
      try {
        this.onLevelCallback(rms);
      } catch (callbackError: any) {
        console.error('[MicCapture] Error in onLevel callback:', callbackError);
      }
    }

    // Accumulate samples for PCM frame generation
    this.sampleBuffer.push(new Float32Array(dataArray));

    // Check if we have enough samples for a PCM frame
    const totalSamples = this.sampleBuffer.reduce((sum, buf) => sum + buf.length, 0);
    
    if (totalSamples >= this.samplesPerFrame) {
      // Concatenate all buffered samples
      const concatenated = new Float32Array(totalSamples);
      let offset = 0;
      for (const buf of this.sampleBuffer) {
        concatenated.set(buf, offset);
        offset += buf.length;
      }

      // Take only what we need for this frame
      const frameSamples = concatenated.slice(0, this.samplesPerFrame);
      
      // Keep remaining samples for next frame
      const remaining = concatenated.slice(this.samplesPerFrame);
      this.sampleBuffer = remaining.length > 0 ? [remaining] : [];

      // Downsample to target sample rate
      let downsampled: Float32Array;
      try {
        downsampled = downsample(frameSamples, this.sourceSampleRate, this.targetSampleRate);
        if (!downsampled || downsampled.length === 0) {
          return;
        }
      } catch (error: any) {
        console.error('[MicCapture] Error downsampling:', error);
        return;
      }

      // Convert to PCM Int16
      let pcm16: Int16Array;
      try {
        pcm16 = floatToInt16(downsampled);
        if (!pcm16 || pcm16.length === 0) {
          return;
        }
      } catch (error: any) {
        console.error('[MicCapture] Error converting to PCM16:', error);
        return;
      }

      // Call PCM frame callback
      if (this.onPcmFrameCallback) {
        try {
          const pcmCopy = new Int16Array(pcm16);
          this.onPcmFrameCallback(pcmCopy);
        } catch (callbackError: any) {
          console.error('[MicCapture] Error in onPcmFrame callback:', callbackError);
        }
      }
    }
  }

  /**
   * Stops microphone capture and closes audio context
   */
  stop(): void {
    this.isCapturing = false;
    this.cleanup();
  }

  /**
   * Checks if microphone is currently capturing
   */
  getIsCapturing(): boolean {
    return this.isCapturing;
  }

  /**
   * Cleans up audio resources
   */
  private cleanup(): void {
    // Stop sampling intervals
    if (this.sampleIntervalId !== null) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }

    // Disconnect nodes
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.silentGain = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.analyserNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }

    // Stop all tracks in the media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    // Clear buffers
    this.sampleBuffer = [];

    // Clear callbacks
    this.onLevelCallback = undefined;
    this.onPcmFrameCallback = undefined;
  }
}

export const micCapture = new MicCapture();
