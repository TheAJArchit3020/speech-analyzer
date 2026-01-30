import { useState, useEffect } from 'react';
import { sessionController, LiveAudioStats } from '../session/SessionController';
import { Session as SessionType, TranscriptEvent } from '../storage/db';
import { micCapture } from '../audio/MicCapture';

type MicStatus = 'Idle' | 'Requesting permission' | 'Capturing' | 'Error';

interface AudioDevice {
  deviceId: string;
  label: string;
}

function Session() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [transcriptEvents, setTranscriptEvents] = useState<TranscriptEvent[]>([]);
  const [micStatus, setMicStatus] = useState<MicStatus>('Idle');
  const [audioStats, setAudioStats] = useState<LiveAudioStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Device selection state
  const [inputDeviceId, setInputDeviceId] = useState<string>('');
  const [outputDeviceId, setOutputDeviceId] = useState<string>('');
  
  // Placeholder device arrays
  const [inputDevices] = useState<AudioDevice[]>([
    { deviceId: 'default', label: 'Default Microphone' },
    { deviceId: 'mic1', label: 'Built-in Microphone' },
    { deviceId: 'mic2', label: 'USB Microphone' },
    { deviceId: 'mic3', label: 'Headset Microphone' },
  ]);
  
  const [outputDevices] = useState<AudioDevice[]>([
    { deviceId: 'default', label: 'Default Speakers' },
    { deviceId: 'speaker1', label: 'Built-in Speakers' },
    { deviceId: 'speaker2', label: 'Headphones' },
    { deviceId: 'speaker3', label: 'USB Headset' },
  ]);

  // Load sessions from database
  const loadSessions = async () => {
    try {
      const loadedSessions = await sessionController.getSessions();
      setSessions(loadedSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Initialize device selections with default values
  useEffect(() => {
    if (inputDevices.length > 0 && !inputDeviceId) {
      setInputDeviceId(inputDevices[0].deviceId);
    }
    if (outputDevices.length > 0 && !outputDeviceId) {
      setOutputDeviceId(outputDevices[0].deviceId);
    }
  }, [inputDevices, outputDevices, inputDeviceId, outputDeviceId]);

  // Poll for transcript events while recording
  useEffect(() => {
    if (!isRecording || !currentSessionId) {
      setTranscriptEvents([]);
      return;
    }

    const loadTranscript = async () => {
      try {
        const events = await sessionController.getTranscript(currentSessionId, 50);
        setTranscriptEvents(events);
      } catch (error) {
        console.error('Failed to load transcript:', error);
      }
    };

    // Load immediately
    loadTranscript();

    // Then poll every 500ms
    const intervalId = setInterval(loadTranscript, 500);

    return () => {
      clearInterval(intervalId);
    };
  }, [isRecording, currentSessionId]);

  // Poll for audio stats and update mic status
  useEffect(() => {
    if (!isRecording) {
      setMicStatus('Idle');
      setAudioStats(null);
      return;
    }

    const updateAudioStats = () => {
      // Check if mic is actually capturing
      const isCapturing = micCapture.getIsCapturing();
      if (isCapturing) {
        setMicStatus((prevStatus) => {
          // Only update to Capturing if we're not already in an error state
          if (prevStatus !== 'Error') {
            return 'Capturing';
          }
          return prevStatus;
        });
        const stats = sessionController.getLiveAudioStats();
        setAudioStats(stats);
      }
      // If not capturing but we're recording, status will remain as set
      // (either 'Requesting permission' from handleStart or 'Error' if something failed)
    };

    // Update immediately
    updateAudioStats();

    // Then poll every 100ms for smooth level meter updates
    const intervalId = setInterval(updateAudioStats, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [isRecording]);

  const handleStart = async () => {
    try {
      setMicStatus('Requesting permission');
      setErrorMessage(null);
      const sessionId = await sessionController.startSession();
      
      setCurrentSessionId(sessionId);
      setIsRecording(true);
      // Refresh session list
      console.log('Loading sessions');
      await loadSessions();
      console.log('Sessions loaded');
      console.log('Session ID : ' + sessionId);
    } catch (error: any) {
      console.error('Failed to start session:', error);
      setMicStatus('Error');
      setIsRecording(false);
      setCurrentSessionId(null);
      
      // Check for permission denial
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone permission denied. Please allow microphone access and try again.');
      } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
        setErrorMessage('No microphone found. Please connect a microphone and try again.');
      } else if (error?.message) {
        setErrorMessage(`Error: ${error.message}`);
      } else {
        setErrorMessage('Failed to start session. Please try again.');
      }
    }
  };

  const handleStop = async () => {
    if (currentSessionId) {
      try {
        await sessionController.stopSession(currentSessionId);
        setCurrentSessionId(null);
        setIsRecording(false);
        setErrorMessage(null);
        // Refresh session list
        await loadSessions();
      } catch (error) {
        console.error('Failed to stop session:', error);
      }
    }
  };

  return (
    <div className="session-container">
      <h1>Session</h1>
      
      <div className="device-selection">
        <div className="device-selector">
          <label htmlFor="input-device" className="device-label">
            Input (Microphone):
          </label>
          <select
            id="input-device"
            value={inputDeviceId}
            onChange={(e) => setInputDeviceId(e.target.value)}
            className="device-dropdown"
            disabled={isRecording}
          >
            {inputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
        
        <div className="device-selector">
          <label htmlFor="output-device" className="device-label">
            Output (Speakers/Headphones):
          </label>
          <select
            id="output-device"
            value={outputDeviceId}
            onChange={(e) => setOutputDeviceId(e.target.value)}
            className="device-dropdown"
            disabled={isRecording}
          >
            {outputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="controls">
        <button
          onClick={handleStart}
          disabled={isRecording}
          className="start-button"
        >
          Start
        </button>
        <button
          onClick={handleStop}
          disabled={!isRecording}
          className="stop-button"
        >
          Stop
        </button>
      </div>

      <div className="audio-meters">
        <div className="meter-panel">
          <h2>Mic</h2>
          <div className="meter-info">
            <div className="meter-status">
              <span className="status-label">Status:</span>
              <span className={`status-value status-${micStatus.toLowerCase().replace(' ', '-')}`}>
                {micStatus}
              </span>
            </div>
            
            <div className="meter-level-meter">
              <span className="level-label">Level:</span>
              <div className="level-bar-container">
                <div 
                  className={`level-bar ${micStatus === 'Capturing' && audioStats ? '' : 'disabled'}`}
                  style={{ 
                    width: micStatus === 'Capturing' && audioStats 
                      ? `${audioStats.lastLevel * 100}%` 
                      : '0%' 
                  }}
                />
              </div>
              <span className="level-value">
                {micStatus === 'Capturing' && audioStats 
                  ? `${Math.round(audioStats.lastLevel * 100)}%` 
                  : '0%'}
              </span>
            </div>
            
            {micStatus === 'Capturing' && audioStats && (
              <div className="meter-frames">
                <span className="frames-label">Frames captured:</span>
                <span className="frames-value">{audioStats.framesCaptured.toLocaleString()}</span>
              </div>
            )}
            
            {micStatus === 'Error' && errorMessage && (
              <div className="mic-error-message">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        <div className="meter-panel">
          <h2>Output</h2>
          <div className="meter-info">
            <div className="meter-status">
              <span className="status-label">Status:</span>
              <span className="status-value status-idle">Disabled</span>
            </div>
            
            <div className="meter-level-meter">
              <span className="level-label">Level:</span>
              <div className="level-bar-container">
                <div 
                  className="level-bar disabled"
                  style={{ width: '0%' }}
                />
              </div>
              <span className="level-value">0%</span>
            </div>
          </div>
        </div>
      </div>

      {isRecording && (
        <div className="live-transcript">
          <h2>Live Transcript</h2>
          <div className="transcript-content">
            {transcriptEvents.length === 0 ? (
              <p className="empty-state">Waiting for transcript events...</p>
            ) : (
              transcriptEvents.map((event) => (
                <div key={event.id} className={`transcript-line ${event.speaker.toLowerCase()}`}>
                  <span className="speaker-label">
                    {event.speaker === 'SELF' ? 'YOU' : 'OTHER'}
                  </span>
                  <span className="transcript-text">{event.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="sessions-list">
        <h2>Saved Sessions</h2>
        {sessions.length === 0 ? (
          <p className="empty-state">No saved sessions</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                <span>
                  Session {session.id.slice(0, 8)} - {session.status}
                </span>
                <span className="session-date">
                  {new Date(session.startedAt).toLocaleString()}
                  {session.endedAt && ` - ${new Date(session.endedAt).toLocaleString()}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Session;
