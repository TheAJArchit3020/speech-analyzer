import { db, Session, TranscriptEvent } from '../storage/db';
import { micCapture } from '../audio/MicCapture';

export interface LiveAudioStats {
  framesCaptured: number;
  lastLevel: number;
}

export class SessionController {
  private currentSessionId: string | null = null;
  private framesCaptured: number = 0;
  private lastLevel: number = 0;

  /**
   * Starts a new session and returns its ID.
   * Automatically starts microphone capture.
   */
  async startSession(): Promise<string> {
    try {
      const session = await db.createSession();
      this.currentSessionId = session.id;

      // Reset audio stats
      this.framesCaptured = 0;
      this.lastLevel = 0;
      console.log('Starting session');
      // Start microphone capture
      // If mic capture fails, we still have a session, so log the error but don't fail
      try {
        await micCapture.start({
          onLevel: (level) => {
            this.lastLevel = level;
          },
          onPcmFrame: () => {
            this.framesCaptured++;
          },
        });
      } catch (micError) {
        console.error('Failed to start microphone capture:', micError);
        // Don't throw - the session is created, mic can be started later
        // But we should still return the session ID
      }
      console.log('Session ID : ' + session.id);
      return session.id;
    } catch (error) {
      // If session creation fails, clean up
      this.currentSessionId = null;
      this.framesCaptured = 0;
      this.lastLevel = 0;
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    // Stop microphone capture
    micCapture.stop();

    // Reset stats
    this.framesCaptured = 0;
    this.lastLevel = 0;
    this.currentSessionId = null;

    // End the session in the database
    await db.endSession(sessionId);
  }

  /**
   * Gets all sessions, ordered by most recent first
   */
  async getSessions(): Promise<Session[]> {
    return await db.listSessions();
  }

  /**
   * Gets transcript events for a session, ordered by startMs ascending.
   * @param sessionId The session ID
   * @param limit Optional limit on number of events to return
   */
  async getTranscript(sessionId: string, limit?: number): Promise<TranscriptEvent[]> {
    return await db.listTranscriptEvents(sessionId, limit);
  }

  /**
   * Gets live audio capture statistics for the current session.
   * @returns Audio stats (framesCaptured, lastLevel) or null if no active session
   */
  getLiveAudioStats(): LiveAudioStats | null {
    if (!this.currentSessionId) {
      return null;
    }

    return {
      framesCaptured: this.framesCaptured,
      lastLevel: this.lastLevel,
    };
  }

  /**
   * Gets the current active session ID.
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
}

export const sessionController = new SessionController();
