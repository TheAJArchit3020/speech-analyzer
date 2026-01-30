export interface Session {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
}

export interface TranscriptEvent {
  id: string;
  sessionId: string;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
  isFinal: number;
}

// Extend Window interface to include electronAPI
declare global {
  interface Window {
    electronAPI: {
      db: {
        createSession: () => Promise<Session>;
        endSession: (sessionId: string) => Promise<void>;
        listSessions: () => Promise<Session[]>;
        insertTranscriptEvent: (event: TranscriptEvent) => Promise<void>;
        listTranscriptEvents: (sessionId: string, limit?: number) => Promise<TranscriptEvent[]>;
      };
      reportError: (error: Error | string, context?: string) => void;
    };
  }
}

function ensureElectronAPI() {
  // Check if we're in Electron by looking for the electronAPI
  if (!window.electronAPI || !window.electronAPI.db) {
    // Check if we're in a browser vs Electron
    const isElectron = navigator.userAgent.includes('Electron');
    if (isElectron) {
      throw new Error(
        'Electron API not available. The preload script may not have loaded correctly. ' +
        'Please restart the app and check the console for errors.'
      );
    } else {
      throw new Error(
        'Electron API not available. This app must be run through Electron. ' +
        'Please use "npm run dev" to start the Electron app, or build and run the Electron executable.'
      );
    }
  }
  return window.electronAPI.db;
}

class Database {
  async createSession(): Promise<Session> {
    const db = ensureElectronAPI();
    return await db.createSession();
  }

  async endSession(sessionId: string): Promise<void> {
    const db = ensureElectronAPI();
    await db.endSession(sessionId);
  }

  async listSessions(): Promise<Session[]> {
    const db = ensureElectronAPI();
    return await db.listSessions();
  }

  async insertTranscriptEvent(event: TranscriptEvent): Promise<void> {
    const db = ensureElectronAPI();
    await db.insertTranscriptEvent(event);
  }

  async listTranscriptEvents(sessionId: string, limit?: number): Promise<TranscriptEvent[]> {
    const db = ensureElectronAPI();
    return await db.listTranscriptEvents(sessionId, limit);
  }
}

export const db = new Database();
