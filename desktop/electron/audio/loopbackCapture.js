const { desktopCapturer, BrowserWindow, ipcMain } = require('electron');
const { initMain } = require('electron-audio-loopback');
const EventEmitter = require('events');
const path = require('path');

// Initialize electron-audio-loopback in main process
// This must be called before app is ready
let isInitialized = false;
function ensureInitialized() {
  if (!isInitialized) {
    initMain();
    isInitialized = true;
  }
}

/**
 * Calculate RMS (Root Mean Square) level from PCM Int16 buffer
 * @param {Int16Array} buffer PCM Int16 audio buffer
 * @returns {number} RMS level (0..1)
 */
function calculateRMS(buffer) {
  if (!buffer || buffer.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const value = buffer[i];
    // Normalize Int16 (-32768 to 32767) to -1 to 1 range
    const normalized = value / 32768;
    sum += normalized * normalized;
  }

  const mean = sum / buffer.length;
  const rms = Math.sqrt(mean);
  return Math.min(1, Math.max(0, rms)); // Clamp to 0..1
}

/**
 * List available output devices (audio sources for loopback capture)
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function listOutputDevices() {
  try {
    ensureInitialized();
    
    // Use desktopCapturer to get audio sources
    // On Windows, this will list audio output devices available for loopback
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: false,
    });

    // Filter for audio sources (Windows-specific: audio sources have specific naming)
    // Note: electron-audio-loopback may not expose device listing directly
    // For now, return a default device or try to extract from sources
    const audioSources = sources.filter(source => {
      // On Windows, audio loopback sources may be identified by name patterns
      const name = source.name.toLowerCase();
      return name.includes('audio') || name.includes('speaker') || name.includes('headphone');
    });

    if (audioSources.length > 0) {
      return audioSources.map(source => ({
        id: source.id,
        name: source.name,
      }));
    }

    // If no audio sources found or library doesn't support device listing,
    // return default device
    return [{ id: 'default', name: 'Default Output' }];
  } catch (error) {
    console.error('[LoopbackCapture] Error listing output devices:', error);
    // Return default device on error
    return [{ id: 'default', name: 'Default Output' }];
  }
}

/**
 * Start loopback capture from specified output device
 * @param {string} outputDeviceId Device ID to capture from (use 'default' for default output)
 * @param {function} onPcm Callback function that receives PCM Int16Array frames
 * @returns {Promise<void>}
 */
async function startLoopback(outputDeviceId, onPcm) {
  if (loopbackCapture.isCapturing) {
    throw new Error('Loopback capture is already running. Stop it first.');
  }

  try {
    ensureInitialized();

    // Create a hidden BrowserWindow to capture audio stream
    // This is necessary because electron-audio-loopback works with MediaStream
    // which is only available in renderer processes
    const hiddenWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload-loopback.js'),
      },
    });

    // Create a simple HTML page with the audio capture script
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><title>Loopback Capture</title></head>
      <body>
        <script>
          (async () => {
            // Enable loopback audio via IPC
            await window.electronAPI.enableLoopbackAudio();
            
            // Get loopback audio stream using getDisplayMedia
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });
            
            // Remove video tracks
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach(track => {
              track.stop();
              stream.removeTrack(track);
            });
            
            // Process audio stream with Web Audio API
            const audioContext = new AudioContext({ sampleRate: 48000 });
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            source.connect(analyser);
            
            // Connect to destination to keep context active
            const gain = audioContext.createGain();
            gain.gain.value = 0; // Silent
            analyser.connect(gain);
            gain.connect(audioContext.destination);
            
            // Buffer for accumulating samples
            let sampleBuffer = [];
            const samplesPerFrame = Math.round(48000 * 0.1); // 100ms frames at 48kHz
            
            // Process audio frames
            const processFrame = () => {
              if (!window.isCapturing) return;
              
              const bufferLength = analyser.fftSize;
              const dataArray = new Float32Array(bufferLength);
              analyser.getFloatTimeDomainData(dataArray);
              
              // Accumulate samples
              sampleBuffer.push(new Float32Array(dataArray));
              
              const totalSamples = sampleBuffer.reduce((sum, buf) => sum + buf.length, 0);
              
              if (totalSamples >= samplesPerFrame) {
                // Concatenate samples
                const concatenated = new Float32Array(totalSamples);
                let offset = 0;
                for (const buf of sampleBuffer) {
                  concatenated.set(buf, offset);
                  offset += buf.length;
                }
                
                // Take frame samples
                const frameSamples = concatenated.slice(0, samplesPerFrame);
                const remaining = concatenated.slice(samplesPerFrame);
                sampleBuffer = remaining.length > 0 ? [remaining] : [];
                
                // Convert Float32 to Int16 PCM
                const pcm16 = new Int16Array(frameSamples.length);
                for (let i = 0; i < frameSamples.length; i++) {
                  const s = Math.max(-1, Math.min(1, frameSamples[i]));
                  pcm16[i] = Math.round(s * 32767);
                }
                
                // Send PCM data to main process
                window.electronAPI.sendPcmData(Array.from(pcm16));
              }
              
              requestAnimationFrame(processFrame);
            };
            
            window.isCapturing = true;
            window.audioStream = stream;
            window.audioContext = audioContext;
            processFrame();
          })();
        </script>
      </body>
      </html>
    `;

    // Load the HTML content
    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Wait for window to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for hidden window to load'));
      }, 10000);
      
      hiddenWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Set up IPC handler to receive PCM data from renderer
    const pcmHandler = (event, pcmArray) => {
      if (loopbackCapture.isCapturing) {
        const pcmBuffer = new Int16Array(pcmArray);
        
        // Store for RMS calculation
        lastPcmBuffer = pcmBuffer;
        
        // Call user's PCM callback
        if (onPcm) {
          onPcm(pcmBuffer);
        }
      }
    };

    // Store references for cleanup
    loopbackCapture.hiddenWindow = hiddenWindow;
    loopbackCapture.pcmHandler = pcmHandler;
    loopbackCapture.isCapturing = true;
    loopbackCapture.onPcmCallback = onPcm;

    // Set up IPC listener
    ipcMain.on('loopback-pcm-data', pcmHandler);

    // Start RMS level monitoring
    startRMSMonitoring();

    console.log('[LoopbackCapture] Started loopback capture');
  } catch (error) {
    console.error('[LoopbackCapture] Error starting loopback capture:', error);
    if (loopbackCapture.hiddenWindow) {
      loopbackCapture.hiddenWindow.destroy();
      loopbackCapture.hiddenWindow = null;
    }
    loopbackCapture.isCapturing = false;
    throw error;
  }
}

/**
 * Stop loopback capture
 */
function stopLoopback() {
  if (!loopbackCapture.isCapturing) {
    return;
  }

  try {
    // Stop capturing in renderer
    if (loopbackCapture.hiddenWindow && !loopbackCapture.hiddenWindow.isDestroyed()) {
      loopbackCapture.hiddenWindow.webContents.executeJavaScript(`
        if (window.isCapturing) {
          window.isCapturing = false;
          if (window.audioStream) {
            window.audioStream.getTracks().forEach(track => track.stop());
          }
          if (window.audioContext) {
            window.audioContext.close();
          }
        }
        window.electronAPI.disableLoopbackAudio();
      `).catch(err => {
        console.error('[LoopbackCapture] Error stopping capture in renderer:', err);
      });

      // Destroy hidden window
      loopbackCapture.hiddenWindow.destroy();
      loopbackCapture.hiddenWindow = null;
    }

    // Remove IPC listener
    if (loopbackCapture.pcmHandler) {
      ipcMain.removeListener('loopback-pcm-data', loopbackCapture.pcmHandler);
      loopbackCapture.pcmHandler = null;
    }

    // Stop RMS monitoring
    stopRMSMonitoring();

    loopbackCapture.isCapturing = false;
    loopbackCapture.onPcmCallback = null;

    console.log('[LoopbackCapture] Stopped loopback capture');
  } catch (error) {
    console.error('[LoopbackCapture] Error stopping loopback capture:', error);
    loopbackCapture.isCapturing = false;
  }
}

// RMS level monitoring
let rmsInterval = null;
let lastPcmBuffer = null;

function startRMSMonitoring() {
  stopRMSMonitoring();

  // Emit level events at least every 100ms
  rmsInterval = setInterval(() => {
    if (lastPcmBuffer && loopbackCapture.isCapturing) {
      const level = calculateRMS(lastPcmBuffer);
      loopbackCapture.emit('level', { level });
      lastPcmBuffer = null; // Clear after processing
    }
  }, 100);
}

function stopRMSMonitoring() {
  if (rmsInterval) {
    clearInterval(rmsInterval);
    rmsInterval = null;
  }
  lastPcmBuffer = null;
}


// Export module
const loopbackCapture = Object.assign(new EventEmitter(), {
  listOutputDevices,
  startLoopback,
  stopLoopback,
  isCapturing: false,
  hiddenWindow: null,
  pcmHandler: null,
  onPcmCallback: null,
});

module.exports = loopbackCapture;
