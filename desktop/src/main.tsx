import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Global error handler to report errors to Electron main process
window.addEventListener('error', (event) => {
  console.error('[Renderer] Global error:', event.error || event.message);
  if (window.electronAPI?.reportError) {
    const error = event.error || new Error(event.message);
    window.electronAPI.reportError(error, 'window.onerror');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer] Unhandled promise rejection:', event.reason);
  if (window.electronAPI?.reportError) {
    const error = event.reason instanceof Error 
      ? event.reason 
      : new Error(String(event.reason));
    window.electronAPI.reportError(error, 'unhandledrejection');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
