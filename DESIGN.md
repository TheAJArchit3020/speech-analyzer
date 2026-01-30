Real-Time Voice Coach (Desktop, Windows-first)
1. Product Overview

This product is a desktop application that listens to live conversations (Zoom, Google Meet, Teams, etc.), transcribes both speakers in real time locally, and analyzes the full conversation after the call ends to provide structured coaching feedback.

v1 Focus

Interview Coach

Desktop only

Windows first, macOS next

Post-call analysis only (no real-time coaching overlays)

2. Core Principles

Local-first
Audio capture and transcription happen on the user’s machine.

Cloud-only for intelligence
The backend is used only for:

user accounts

session history

queued AI analysis

report storage

Non-intrusive
The app never interrupts a live conversation.

Extensible by design
New “coaches” (Sales, Support, Leadership, etc.) can be added without touching the core pipeline.

3. What v1 Does (In Scope)

Capture:

Microphone audio (user)

System audio (other speaker)

Real-time local transcription

Speaker separation using audio source (mic vs system)

Live transcript UI

Post-call analysis using LLM

Persistent user accounts

Session history & reports

4. What v1 Does NOT Do (Out of Scope)

Mobile apps

Real-time coaching hints during calls

Live trading / CRM integrations

Team dashboards

Raw audio cloud storage

Perfect diarization across multiple speakers

Payments (can be feature-flagged later)

5. High-Level Architecture
Key Decision

Desktop handles audio + transcription

Backend handles analysis + persistence

Queue decouples analysis from UX

Architecture Diagram (Logical)
┌────────────────────────────────────────────┐
│ Desktop App (Electron)                     │
│                                            │
│ - Mic Audio Capture                        │
│ - System Audio Capture (WASAPI loopback)   │
│ - Local Real-time Transcription            │
│ - Speaker labeling (SELF / OTHER)          │
│ - Live Transcript UI                       │
│ - Local SQLite storage                     │
└────────────────────┬───────────────────────┘
                     │ upload transcript + meta
                     ▼
┌────────────────────────────────────────────┐
│ Backend API                                │
│                                            │
│ - Auth (Google / Magic Link)               │
│ - Users & Plans                            │
│ - Sessions metadata                        │
│ - Enqueue analysis job                     │
└────────────────────┬───────────────────────┘
                     │ BullMQ job
                     ▼
┌────────────────────────────────────────────┐
│ Redis Queue                                │
└────────────────────┬───────────────────────┘
                     ▼
┌────────────────────────────────────────────┐
│ Analysis Worker                            │
│                                            │
│ - Coach plugin (Interview.v1)              │
│ - Metrics extraction                       │
│ - OpenAI API calls                         │
│ - Report generation                        │
└────────────────────┬───────────────────────┘
                     ▼
┌────────────────────────────────────────────┐
│ Postgres                                   │
│                                            │
│ - users                                    │
│ - plans                                    │
│ - sessions                                 │
│ - transcripts (text only)                  │
│ - reports (JSON)                           │
└────────────────────────────────────────────┘

6. Desktop App (Windows-first)
Responsibilities

Audio capture (mic + system)

Local transcription

Live transcript rendering

Session lifecycle

Upload transcript when session ends

Display coaching report

6.1 Audio Capture

Windows (v1):

Microphone → standard input device

System audio → WASAPI loopback

Two separate audio streams

Speaker labeling rule (v1):

Mic stream → SELF

System stream → OTHER

This avoids complex diarization.

6.2 Local Transcription

Uses a local Whisper-based runtime

Runs continuously during the call

Emits transcript events in near real time

Modes

Fast (lower accuracy)

Balanced (default)

Accurate (slower)

6.3 Transcript Event Model
type TranscriptEvent = {
  sessionId: string
  speaker: "SELF" | "OTHER"
  startMs: number
  endMs: number
  text: string
  isFinal: boolean
}

6.4 Turn Segmentation

Raw events are merged into conversation turns.

Rules

Merge consecutive events from same speaker

Split turn if silence gap > 1200ms

type Turn = {
  speaker: "SELF" | "OTHER"
  startMs: number
  endMs: number
  text: string
}


Turns are the primary input to analysis.

6.5 Local Storage (SQLite)

Used for:

Reliability

Offline safety

Fast UI reads

Tables

sessions

transcript_events

turns

reports_cache

7. Backend System
Responsibilities

User authentication

Plan & usage tracking

Session persistence

Queue-based analysis

Report storage & retrieval

7.1 Authentication

Pattern

Login happens in browser

Desktop receives auth via deep-link or one-time code

Desktop exchanges code for tokens

Supported:

Google OAuth

Magic link (email)

Tokens stored securely on device.

7.2 Backend Data Models (Postgres)
users

id

email

name

created_at

plans

id

user_id

tier (FREE, PRO)

monthly_minutes_limit

minutes_used

renewal_at

sessions

id

user_id

coach_type (INTERVIEW_V1)

status (RUNNING, COMPLETED)

started_at

ended_at

device_os

app_version

settings_json

transcripts

id

session_id

transcript_json (turns + timestamps)

created_at

reports

id

session_id

coach_id

schema_version

report_json

created_at

8. Analysis Pipeline (Core Intelligence)
When analysis runs

Only after session ends

Triggered explicitly by desktop

Analysis Flow

Desktop uploads transcript turns

Backend saves transcript

Backend enqueues analysis job

Worker processes job:

computes metrics

builds prompt

calls OpenAI

validates output

Report saved to DB

Desktop fetches report

9. Coach Plugin Architecture (Extensibility)
Why

To support multiple coaching niches without rewriting the system.

Coach Interface
interface Coach {
  id: string                // "interview.v1"
  schemaVersion: number
  analyze(input: CoachInput): Promise<CoachOutput>
}


Input

session metadata

transcript turns

optional coach config

Output

structured JSON report

Folder Structure
/backend
  /coaches
    /interview_v1
      coach.ts
      rubric.ts
      prompts.ts


Adding a new coach = new folder + registration.

10. Interview Coach v1 (Initial Coach)
What it evaluates

Answer clarity

Structure (directness, examples)

Rambling detection

Filler words

Speaking pace

Interruptions

Missed opportunities

Report Schema (v1)
{
  "summary": {
    "overall_score": 0,
    "one_line_feedback": ""
  },
  "strengths": [
    { "title": "", "evidence": "", "why_it_matters": "" }
  ],
  "improvements": [
    {
      "title": "",
      "evidence": "",
      "fix": "",
      "example_rewrite": ""
    }
  ],
  "missed_opportunities": [
    { "title": "", "what_happened": "", "better_response": "" }
  ],
  "metrics": {
    "talk_ratio_self": 0.0,
    "fillers_per_min": 0.0,
    "avg_answer_seconds": 0.0,
    "interruptions_self": 0
  },
  "next_session_goals": []
}

11. Queue & Scalability

Redis + BullMQ

Analysis jobs are idempotent

Workers scale horizontally

Transcription load stays on user device

12. Privacy & Security

Raw audio never uploaded by default

Only transcript text is sent to backend

Encrypted storage at rest

User can delete any session

Explicit consent screen on first launch

13. Platform Roadmap (After v1)

macOS support

Sales Coach

Real-time coaching overlays (optional)

Team dashboards

Language coaching

Enterprise plans

14. Definition of “Done” for v1

User can run a real Zoom interview

Transcript appears live

Session ends cleanly

Report generated within ~1–2 minutes

Feedback is genuinely useful