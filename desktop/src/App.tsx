import { useEffect, useState } from 'react';
import Session from './components/Session';

function App() {
  const [electronAvailable, setElectronAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if Electron API is available
    const checkElectronAPI = () => {
      const available = !!(window as any).electronAPI?.db;
      setElectronAvailable(available);
      
      if (!available) {
        console.warn('Electron API not available. Make sure you are running the app through Electron using "npm run dev"');
      }
    };

    // Check immediately
    checkElectronAPI();

    // Also check after a short delay in case preload script loads asynchronously
    const timeout = setTimeout(checkElectronAPI, 100);
    
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="app">
      {electronAvailable === false && (
        <div style={{
          padding: '12px',
          backgroundColor: '#ff6b6b',
          color: 'white',
          textAlign: 'center',
          fontWeight: 'bold',
          marginBottom: '20px'
        }}>
          ⚠️ Electron API not available. Please run the app using "npm run dev" in the desktop directory.
        </div>
      )}
      <Session />
    </div>
  );
}

export default App;
