import { db, TranscriptEvent } from '../storage/db';

/**
 * Generates fake transcript events for testing purposes.
 * Simulates interview conversation between SELF (interviewee) and OTHER (interviewer).
 */
export class FakeTranscriptGenerator {
  private intervalId: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;
  private startTimeMs: number = 0;
  private currentTimeMs: number = 0;
  private speakerIndex: number = 0; // 0 = SELF, 1 = OTHER

  private readonly INTERVIEWER_PHRASES = [
    "Can you tell me about yourself?",
    "What interests you about this role?",
    "Why are you leaving your current position?",
    "What's your biggest strength?",
    "Can you describe a challenging situation you've handled?",
    "How do you handle working under pressure?",
    "Tell me about a time you worked in a team.",
    "Where do you see yourself in five years?",
    "What questions do you have for me?",
    "What do you know about our company?",
    "How do you prioritize your work?",
    "Can you walk me through your resume?",
  ];

  private readonly INTERVIEWEE_PHRASES = [
    "I have about five years of experience in software development.",
    "I'm really excited about this opportunity because it aligns with my career goals.",
    "I'm looking for new challenges and growth opportunities.",
    "I think my strongest skill is problem-solving and communication.",
    "I once had to lead a project with a tight deadline and managed it successfully.",
    "I try to stay organized and break down tasks into manageable pieces.",
    "I enjoy collaborating with others and find it helps me learn and grow.",
    "I hope to be in a leadership role, continuing to contribute meaningfully.",
    "What does the team culture look like here?",
    "I've researched your company and I'm impressed by your recent innovations.",
    "I use a combination of urgency and importance to prioritize tasks.",
    "I started my career as a junior developer and worked my way up through various roles.",
  ];

  /**
   * Starts generating transcript events for the given session.
   * Events are generated every 700ms.
   */
  start(sessionId: string): void {
    if (this.intervalId) {
      this.stop();
    }

    this.sessionId = sessionId;
    this.startTimeMs = Date.now();
    this.currentTimeMs = 0;
    this.speakerIndex = 0; // Start with SELF (interviewee)

    // Generate first event immediately
    this.generateEvent();

    // Then generate events every 700ms
    this.intervalId = setInterval(() => {
      this.generateEvent();
    }, 700);
  }

  /**
   * Stops generating transcript events.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.sessionId = null;
  }

  /**
   * Generates a single transcript event and inserts it into the database.
   */
  private async generateEvent(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    const speaker = this.speakerIndex === 0 ? 'SELF' : 'OTHER';
    
    // Get a random phrase for the current speaker
    const phrases = speaker === 'SELF' ? this.INTERVIEWEE_PHRASES : this.INTERVIEWER_PHRASES;
    const text = phrases[Math.floor(Math.random() * phrases.length)];

    // Calculate event duration (text length * ~100ms per character, minimum 500ms)
    const estimatedDurationMs = Math.max(500, text.length * 80);
    
    const startMs = this.currentTimeMs;
    const endMs = startMs + estimatedDurationMs;
    
    // Create event ID (simple timestamp-based UUID-like string)
    const eventId = `${this.sessionId}-${startMs}-${Math.random().toString(36).substring(7)}`;

    const event: TranscriptEvent = {
      id: eventId,
      sessionId: this.sessionId,
      speaker,
      startMs,
      endMs,
      text,
      isFinal: 1, // Always final for fake events
    };

    try {
      await db.insertTranscriptEvent(event);
      // Update current time for next event
      this.currentTimeMs = endMs + 100; // Small gap between events
      
      // Alternate speaker
      this.speakerIndex = (this.speakerIndex + 1) % 2;
    } catch (error) {
      console.error('Failed to insert transcript event:', error);
    }
  }
}

export const fakeTranscriptGenerator = new FakeTranscriptGenerator();
