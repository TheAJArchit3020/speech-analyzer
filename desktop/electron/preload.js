const { contextBridge, ipcRenderer } = require('electron');

// Function to report errors to main process
function reportError(error, context = '') {
  try {
    const errorInfo = {
      message: error.message || String(error),
      stack: error.stack,
      name: error.name,
      context: context,
      timestamp: new Date().toISOString(),
    };
    ipcRenderer.send('renderer-error', errorInfo);
    console.error('[Preload] Error reported to main process:', errorInfo);
  } catch (reportError) {
    console.error('[Preload] Failed to report error:', reportError);
  }
}

// Catch unhandled errors and promise rejections in the renderer
window.addEventListener('error', (event) => {
  console.error('[Preload] Global error caught:', event.error || event.message);
  if (event.error) {
    reportError(event.error, 'window.onerror');
  } else {
    reportError(new Error(event.message), 'window.onerror');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Preload] Unhandled promise rejection:', event.reason);
  const error = event.reason instanceof Error 
    ? event.reason 
    : new Error(String(event.reason));
  reportError(error, 'unhandledrejection');
});

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    db: {
      createSession: () => ipcRenderer.invoke('db:createSession'),
      endSession: (sessionId) => ipcRenderer.invoke('db:endSession', sessionId),
      listSessions: () => ipcRenderer.invoke('db:listSessions'),
      insertTranscriptEvent: (event) => ipcRenderer.invoke('db:insertTranscriptEvent', event),
      listTranscriptEvents: (sessionId, limit) => ipcRenderer.invoke('db:listTranscriptEvents', sessionId, limit),
    },
    // Expose error reporting function for renderer to use
    reportError: (error, context) => {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      reportError(errorObj, context);
    },
  });
  console.log('[Preload] Electron API exposed successfully');
} catch (error) {
  console.error('[Preload] Failed to expose Electron API:', error);
  reportError(error, 'preload-setup');
}
