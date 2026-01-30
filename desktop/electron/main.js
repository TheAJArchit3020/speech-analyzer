const { app, BrowserWindow, ipcMain, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const { initializeDb, getDb } = require('./db');
const { randomUUID } = require('crypto');
const loopbackCapture = require('./audio/loopbackCapture');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Store reference to main window for sending events
let mainWindow = null;

// Initialize crash reporter - must be called before app is ready
// Crash dumps are saved to the default location
const crashReporterConfig = {
  productName: 'Speech Analyzer',
  companyName: 'Speech Analyzer',
  submitURL: '', // Empty for local crash dumps
  uploadToServer: false, // Don't upload, just save locally
  ignoreSystemCrashHandler: false,
  extra: {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  },
};

crashReporter.start(crashReporterConfig);

// Get crash dump directory after app is ready
let crashDumpDir = '';
app.whenReady().then(() => {
  // Get the actual crash dump directory from crash reporter
  // Note: crashReporter.getCrashesDirectory() is not available in all Electron versions
  // So we'll check common locations
  
  const userDataPath = app.getPath('userData');
  crashDumpDir = path.join(userDataPath, 'Crashes');
  
  // Common crash dump locations by platform
  const defaultLocations = [];
  if (process.platform === 'win32') {
    // Windows: Usually in %LOCALAPPDATA%\CrashDumps or %TEMP%\CrashDumps
    if (process.env.LOCALAPPDATA) {
      defaultLocations.push(path.join(process.env.LOCALAPPDATA, 'CrashDumps'));
    }
    if (process.env.TEMP) {
      defaultLocations.push(path.join(process.env.TEMP, 'CrashDumps'));
    }
  } else if (process.platform === 'darwin') {
    // macOS: ~/Library/Logs/DiagnosticReports
    if (process.env.HOME) {
      defaultLocations.push(path.join(process.env.HOME, 'Library', 'Logs', 'DiagnosticReports'));
    }
  } else {
    // Linux: ~/.config/[productName]/Crashes or system location
    if (process.env.HOME) {
      defaultLocations.push(path.join(process.env.HOME, '.config', 'Speech Analyzer', 'Crashes'));
    }
  }
  
  console.log('[Main] Crash reporter initialized');
  console.log('[Main] Crash dumps will be saved to system default location');
  console.log('[Main] Checking for crash dumps in:');
  console.log('[Main]   -', crashDumpDir);
  defaultLocations.forEach(loc => {
    if (loc && fs.existsSync(loc)) {
      console.log('[Main]   -', loc, '(exists)');
    } else if (loc) {
      console.log('[Main]   -', loc);
    }
  });
});

function createWindow() {
  // Resolve preload script path
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[Main] Preload script path:', preloadPath);
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });
  
  // Log when preload script loads
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Window finished loading');
  });

  // Handle renderer process crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    const timestamp = new Date().toISOString();
    console.error(`[Main] ========== RENDERER PROCESS CRASHED ==========`);
    console.error(`[Main] Timestamp: ${timestamp}`);
    console.error('[Main] Crash details:', JSON.stringify({
      reason: details.reason || 'unknown',
      exitCode: details.exitCode !== undefined ? details.exitCode : 'unknown',
      killed: details.killed !== undefined ? details.killed : 'unknown',
    }, null, 2));
    
    // Log all available properties from details
    console.error('[Main] All crash details:', details);
    console.error('[Main] Details keys:', Object.keys(details));
    
    // Log the last error before crash
    if (lastErrorBeforeCrash) {
      console.error('[Main] Last error before crash:');
      console.error('[Main]   Timestamp:', lastErrorBeforeCrash.timestamp);
      console.error('[Main]   Context:', lastErrorBeforeCrash.errorInfo.context);
      console.error('[Main]   Error:', lastErrorBeforeCrash.errorInfo.message);
      console.error('[Main]   Stack:', lastErrorBeforeCrash.errorInfo.stack);
    } else {
      console.error('[Main] No errors were reported before the crash');
    }
    
    // Write crash report to file
    try {
      const crashReportPath = path.join(app.getPath('userData'), 'crash-report.txt');
      const crashReport = `\n${'='.repeat(80)}\n` +
        `CRASH REPORT\n` +
        `${'='.repeat(80)}\n` +
        `Timestamp: ${timestamp}\n` +
        `Reason: ${details.reason || 'unknown'}\n` +
        `Exit Code: ${details.exitCode !== undefined ? details.exitCode : 'unknown'}\n` +
        `Killed: ${details.killed !== undefined ? details.killed : 'unknown'}\n` +
        `\nAll Details:\n${JSON.stringify(details, null, 2)}\n` +
        `\nLast Error Before Crash:\n` +
        (lastErrorBeforeCrash ? 
          `  Timestamp: ${lastErrorBeforeCrash.timestamp}\n` +
          `  Context: ${lastErrorBeforeCrash.errorInfo.context || 'unknown'}\n` +
          `  Error: ${lastErrorBeforeCrash.errorInfo.message || 'unknown'}\n` +
          `  Stack: ${lastErrorBeforeCrash.errorInfo.stack || 'no stack'}\n`
          : '  No errors reported before crash\n') +
        `${'='.repeat(80)}\n`;
      fs.appendFileSync(crashReportPath, crashReport);
      console.error(`[Main] Crash report written to: ${crashReportPath}`);
    } catch (reportError) {
      console.error('[Main] Failed to write crash report:', reportError);
    }
    
    if (crashDumpDir) {
      console.error('[Main] Crash dump directory:', crashDumpDir);
    }
    console.error(`[Main] =============================================`);
    
    // Try to list crash dumps from multiple possible locations
    const possibleDumpDirs = [
      crashDumpDir,
      path.join(app.getPath('userData'), 'Crashes'),
    ];
    
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      possibleDumpDirs.push(path.join(process.env.LOCALAPPDATA, 'CrashDumps'));
    }
    
    let foundDumps = false;
    possibleDumpDirs.forEach(dir => {
      if (!dir) return;
      try {
        if (fs.existsSync(dir)) {
          const crashFiles = fs.readdirSync(dir)
            .filter(f => f.endsWith('.dmp') || f.includes('Speech Analyzer') || f.includes('electron'))
            .map(f => {
              const filePath = path.join(dir, f);
              try {
                const stats = fs.statSync(filePath);
                return { file: f, size: stats.size, mtime: stats.mtime, dir: dir };
              } catch {
                return null;
              }
            })
            .filter(f => f !== null)
            .sort((a, b) => b.mtime - a.mtime) // Most recent first
            .slice(0, 5); // Show last 5
          
          if (crashFiles.length > 0) {
            if (!foundDumps) {
              console.error('[Main] Recent crash dumps found:');
              foundDumps = true;
            }
            crashFiles.forEach(({ file, size, mtime, dir: fileDir }) => {
              console.error(`[Main]   - ${fileDir}/${file} (${(size / 1024).toFixed(2)} KB, ${mtime.toISOString()})`);
            });
          }
        }
      } catch (error) {
        // Ignore errors for individual directories
      }
    });
    
    if (!foundDumps) {
      console.error('[Main] No crash dump files found in common locations');
      console.error('[Main] Crash dumps may be generated by the system crash handler');
    }
    
    // In development, show an error dialog
    if (isDev) {
      const { dialog } = require('electron');
      const errorLogPath = path.join(app.getPath('userData'), 'error-log.txt');
      const crashReportPath = path.join(app.getPath('userData'), 'crash-report.txt');
      
      dialog.showErrorBox(
        'Renderer Process Crashed',
        `The renderer process crashed.\n\n` +
        `Reason: ${details.reason || 'unknown'}\n` +
        `Exit Code: ${details.exitCode !== undefined ? details.exitCode : 'unknown'}\n` +
        `Killed: ${details.killed !== undefined ? details.killed : 'unknown'}\n\n` +
        `Timestamp: ${timestamp}\n\n` +
        `Check these files for details:\n` +
        `- Error log: ${errorLogPath}\n` +
        `- Crash report: ${crashReportPath}\n\n` +
        `Crash dumps location:\n${crashDumpDir || 'See console for locations'}\n\n` +
        `To analyze .dmp files on Windows:\n` +
        `1. Install WinDbg Preview from Microsoft Store\n` +
        `2. Open the .dmp file\n` +
        `3. Run: !analyze -v\n` +
        `Or use Visual Studio: File > Open > File (select .dmp)`
      );
    }
  });

  // Handle unresponsive renderer
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] Renderer process became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[Main] Renderer process became responsive again');
  });

  // Handle GPU process crashes
  // Note: This event is emitted on the app object, not deprecated
  app.on('gpu-process-crashed', (event, killed) => {
    const timestamp = new Date().toISOString();
    console.error(`[Main] ========== GPU PROCESS CRASHED ==========`);
    console.error(`[Main] Timestamp: ${timestamp}`);
    console.error('[Main] Killed:', killed !== undefined ? killed : 'unknown');
    if (crashDumpDir) {
      console.error('[Main] Crash dump directory:', crashDumpDir);
    }
    console.error(`[Main] =========================================`);
  });

  // Clean up loopback capture when window closes
  mainWindow.on('closed', () => {
    // Remove level event listener if it exists
    if (loopbackCapture.levelHandler) {
      loopbackCapture.removeListener('level', loopbackCapture.levelHandler);
      loopbackCapture.levelHandler = null;
    }
    // Stop loopback capture if it's running
    if (loopbackCapture.isCapturing) {
      loopbackCapture.stopLoopback();
    }
    mainWindow = null;
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  return mainWindow;
}

app.whenReady().then(() => {
  // Initialize database with error handling
  try {
    initializeDb();
    console.log('[Main] Database initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to initialize database:', error);
    // Don't crash the app, but log the error
    // The app can still run, but database operations will fail
  }

  // Set up IPC handler for renderer error reporting
  let lastErrorBeforeCrash;
  ipcMain.on('renderer-error', (event, errorInfo) => {
    console.log('[Main] Renderer error reported:', errorInfo);
    const timestamp = new Date().toISOString();
    lastErrorBeforeCrash = { timestamp, errorInfo };

    
    console.error(`[Main] ========== RENDERER ERROR REPORT ==========`);
    console.error(`[Main] Timestamp: ${timestamp}`);
    console.error('[Main] Context:', errorInfo.context || 'unknown');
    console.error('[Main] Error:', errorInfo.message || errorInfo);
    if (errorInfo.stack) {
      console.error('[Main] Stack:', errorInfo.stack);
    }
    if (errorInfo.name) {
      console.error('[Main] Error name:', errorInfo.name);
    }
    console.error(`[Main] ===========================================`);
    
    // Write error to file for later analysis
    try {
      const errorLogPath = path.join(app.getPath('userData'), 'error-log.txt');
      const errorLogEntry = `\n${'='.repeat(80)}\n` +
        `Timestamp: ${timestamp}\n` +
        `Context: ${errorInfo.context || 'unknown'}\n` +
        `Error: ${errorInfo.message || String(errorInfo)}\n` +
        `Name: ${errorInfo.name || 'unknown'}\n` +
        `Stack: ${errorInfo.stack || 'no stack'}\n` +
        `${'='.repeat(80)}\n`;
      fs.appendFileSync(errorLogPath, errorLogEntry);
      console.log(`[Main] Error logged to: ${errorLogPath}`);
    } catch (logError) {
      console.error('[Main] Failed to write error log:', logError);
    }
    
    // Add to crash reporter extra parameters
    try {
      crashReporter.addExtraParameter('lastRendererError', errorInfo.message || String(errorInfo));
      crashReporter.addExtraParameter('lastErrorContext', errorInfo.context || 'unknown');
      if (errorInfo.stack) {
        // Truncate stack if too long (crash reporter has limits)
        const stack = errorInfo.stack.length > 1000 
          ? errorInfo.stack.substring(0, 1000) + '...'
          : errorInfo.stack;
        crashReporter.addExtraParameter('lastRendererErrorStack', stack);
      }
    } catch (crashReporterError) {
      console.error('[Main] Failed to add crash reporter parameters:', crashReporterError);
    }
  });

  // Set up IPC handlers with error handling
  ipcMain.handle('db:createSession', async () => {
    try {
      const db = getDb();
      if (!db) {
        throw new Error('Database not initialized. Please restart the app.');
      }
      
      const id = randomUUID();
      const startedAt = Date.now();
      const status = 'RUNNING';

      db.prepare(
        'INSERT INTO sessions (id, startedAt, endedAt, status) VALUES (?, ?, ?, ?)'
      ).run(id, startedAt, null, status);

      return {
        id,
        startedAt,
        endedAt: null,
        status,
      };
    } catch (error) {
      console.error('[IPC] Error creating session:', error);
      // Return error details instead of crashing
      throw new Error(`Failed to create session: ${error.message || error}`);
    }
  });

  ipcMain.handle('db:endSession', async (event, sessionId) => {
    try {
      const db = getDb();
      if (!db) {
        throw new Error('Database not initialized. Please restart the app.');
      }
      
      const endedAt = Date.now();
      const status = 'COMPLETED';

      db.prepare(
        'UPDATE sessions SET endedAt = ?, status = ? WHERE id = ?'
      ).run(endedAt, status, sessionId);
    } catch (error) {
      console.error('[IPC] Error ending session:', error);
      throw new Error(`Failed to end session: ${error.message || error}`);
    }
  });

  ipcMain.handle('db:listSessions', async () => {
    try {
      const db = getDb();
      if (!db) {
        throw new Error('Database not initialized. Please restart the app.');
      }
      
      const rows = db.prepare(
        'SELECT id, startedAt, endedAt, status FROM sessions ORDER BY startedAt DESC'
      ).all();

      return rows.map(row => ({
        id: row.id,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        status: row.status,
      }));
    } catch (error) {
      console.error('[IPC] Error listing sessions:', error);
      throw new Error(`Failed to list sessions: ${error.message || error}`);
    }
  });

  ipcMain.handle('db:insertTranscriptEvent', async (event, transcriptEvent) => {
    try {
      const db = getDb();
      if (!db) {
        throw new Error('Database not initialized. Please restart the app.');
      }
      
      const {
        id,
        sessionId,
        speaker,
        startMs,
        endMs,
        text,
        isFinal,
      } = transcriptEvent;

      db.prepare(
        'INSERT INTO transcript_events (id, sessionId, speaker, startMs, endMs, text, isFinal) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, sessionId, speaker, startMs, endMs, text, isFinal);
    } catch (error) {
      console.error('[IPC] Error inserting transcript event:', error);
      throw new Error(`Failed to insert transcript event: ${error.message || error}`);
    }
  });

  ipcMain.handle('db:listTranscriptEvents', async (event, sessionId, limit) => {
    try {
      const db = getDb();
      if (!db) {
        throw new Error('Database not initialized. Please restart the app.');
      }
      
      let rows;
      
      if (limit && limit > 0) {
        const stmt = db.prepare(
          'SELECT id, sessionId, speaker, startMs, endMs, text, isFinal FROM transcript_events WHERE sessionId = ? ORDER BY startMs ASC LIMIT ?'
        );
        rows = stmt.all(sessionId, limit);
      } else {
        const stmt = db.prepare(
          'SELECT id, sessionId, speaker, startMs, endMs, text, isFinal FROM transcript_events WHERE sessionId = ? ORDER BY startMs ASC'
        );
        rows = stmt.all(sessionId);
      }

      return rows.map(row => ({
        id: row.id,
        sessionId: row.sessionId,
        speaker: row.speaker,
        startMs: row.startMs,
        endMs: row.endMs,
        text: row.text,
        isFinal: row.isFinal,
      }));
    } catch (error) {
      console.error('[IPC] Error listing transcript events:', error);
      throw new Error(`Failed to list transcript events: ${error.message || error}`);
    }
  });

  // Audio loopback IPC handlers
  ipcMain.handle('audio:listOutputs', async () => {
    try {
      const devices = await loopbackCapture.listOutputDevices();
      return devices;
    } catch (error) {
      console.error('[IPC] Error listing output devices:', error);
      throw new Error(`Failed to list output devices: ${error.message || error}`);
    }
  });

  ipcMain.handle('audio:startLoopback', async (event, outputDeviceId) => {
    try {
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      // Remove existing level handler if any
      if (loopbackCapture.levelHandler) {
        loopbackCapture.removeListener('level', loopbackCapture.levelHandler);
        loopbackCapture.levelHandler = null;
      }

      // Start loopback capture with PCM callback
      await loopbackCapture.startLoopback(outputDeviceId, (pcmBuffer) => {
        // PCM frames are handled by loopbackCapture internally
        // Level events are emitted separately
      });

      // Set up level event listener to send to renderer
      const levelHandler = ({ level }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('audio:loopbackLevel', { level });
        }
      };

      loopbackCapture.on('level', levelHandler);
      loopbackCapture.levelHandler = levelHandler; // Store for cleanup

      console.log('[IPC] Started loopback capture for device:', outputDeviceId);
    } catch (error) {
      console.error('[IPC] Error starting loopback capture:', error);
      throw new Error(`Failed to start loopback capture: ${error.message || error}`);
    }
  });

  ipcMain.handle('audio:stopLoopback', async () => {
    try {
      // Remove level event listener if it exists
      if (loopbackCapture.levelHandler) {
        loopbackCapture.removeListener('level', loopbackCapture.levelHandler);
        loopbackCapture.levelHandler = null;
      }

      loopbackCapture.stopLoopback();
      console.log('[IPC] Stopped loopback capture');
    } catch (error) {
      console.error('[IPC] Error stopping loopback capture:', error);
      throw new Error(`Failed to stop loopback capture: ${error.message || error}`);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Global error handlers with crash reporting
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise);
  console.error('[Main] Reason:', reason);
  console.error('[Main] Stack:', reason instanceof Error ? reason.stack : String(reason));
  
  // Log to crash reporter
  crashReporter.addExtraParameter('unhandledRejection', String(reason));
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
  console.error('[Main] Stack:', error.stack);
  
  // Log to crash reporter
  crashReporter.addExtraParameter('uncaughtException', error.message);
  crashReporter.addExtraParameter('uncaughtExceptionStack', error.stack || '');
  
  // In development, don't exit immediately so we can see the error
  if (!isDev) {
    // In production, we might want to quit, but for now let's just log
    console.error('[Main] App will continue running. Check crash dumps in:', crashDumpDir);
  }
});

// Listen for child process crashes (like renderer processes)
process.on('exit', (code) => {
  console.log(`[Main] Process exiting with code: ${code}`);
});

// Log crash dump locations and check for existing dumps on startup
app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  crashDumpDir = path.join(userDataPath, 'Crashes');
  
  // Check multiple possible crash dump locations
  const possibleDumpDirs = [
    crashDumpDir,
    path.join(userDataPath, 'crash-dumps'),
  ];
  
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    possibleDumpDirs.push(path.join(process.env.LOCALAPPDATA, 'CrashDumps'));
  } else if (process.platform === 'darwin' && process.env.HOME) {
    possibleDumpDirs.push(path.join(process.env.HOME, 'Library', 'Logs', 'DiagnosticReports'));
  }
  
  let totalDumps = 0;
  possibleDumpDirs.forEach(dir => {
    if (!dir) return;
    try {
      if (fs.existsSync(dir)) {
        const crashFiles = fs.readdirSync(dir)
          .filter(f => f.endsWith('.dmp') || f.includes('Speech Analyzer') || f.includes('electron'));
        if (crashFiles.length > 0) {
          totalDumps += crashFiles.length;
          console.log(`[Main] Found ${crashFiles.length} crash dump file(s) in ${dir}:`);
          crashFiles.slice(0, 3).forEach(file => {
            try {
              const filePath = path.join(dir, file);
              const stats = fs.statSync(filePath);
              console.log(`[Main]   - ${file} (${(stats.size / 1024).toFixed(2)} KB, ${stats.mtime.toISOString()})`);
            } catch {
              console.log(`[Main]   - ${file}`);
            }
          });
          if (crashFiles.length > 3) {
            console.log(`[Main]   ... and ${crashFiles.length - 3} more`);
          }
        }
      }
    } catch (error) {
      // Ignore errors for individual directories
    }
  });
  
  if (totalDumps === 0) {
    console.log(`[Main] No crash dumps found. New crashes will be saved to system default location.`);
  }
});
