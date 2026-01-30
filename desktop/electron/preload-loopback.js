const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC methods for loopback audio capture
contextBridge.exposeInMainWorld('electronAPI', {
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
  sendPcmData: (pcmArray) => ipcRenderer.send('loopback-pcm-data', pcmArray),
});
