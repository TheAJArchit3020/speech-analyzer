let Database;
try {
  Database = require('better-sqlite3');
  console.log('[DB] better-sqlite3 module loaded successfully');
} catch (error) {
  console.error('[DB] Failed to load better-sqlite3 module:', error);
  console.error('[DB] This usually means the native module needs to be rebuilt for Electron.');
  console.error('[DB] Please run: npm run rebuild');
  throw error;
}

const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db = null;
let initializationFailed = false;
let initializationError = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  
  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  return path.join(dbDir, 'sessions.db');
}

function initializeDb() {
  if (db) {
    return db;
  }

  // If initialization previously failed, don't try again
  if (initializationFailed) {
    throw initializationError || new Error('Database initialization previously failed');
  }

  if (!app.isReady()) {
    const error = new Error('App must be ready before initializing database');
    initializationFailed = true;
    initializationError = error;
    throw error;
  }

  try {
    const dbPath = getDbPath();
    console.log('[DB] Initializing database at:', dbPath);
    db = new Database(dbPath);
    console.log('[DB] Database connection established');
  } catch (error) {
    console.error('[DB] Failed to create database connection:', error);
    initializationFailed = true;
    initializationError = error;
    
    // Check for common better-sqlite3 issues
    const errorMessage = error.message || String(error);
    if (errorMessage.includes('better-sqlite3') || 
        errorMessage.includes('Cannot find module') ||
        errorMessage.includes('was compiled against')) {
      const rebuildError = new Error(
        'Database module not properly built for Electron. ' +
        'Please run: npm run rebuild'
      );
      initializationError = rebuildError;
      throw rebuildError;
    }
    throw error;
  }

  try {
    // Create sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        startedAt INTEGER NOT NULL,
        endedAt INTEGER,
        status TEXT NOT NULL
      )
    `);

    // Create transcript_events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS transcript_events (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        speaker TEXT NOT NULL,
        startMs INTEGER NOT NULL,
        endMs INTEGER NOT NULL,
        text TEXT NOT NULL,
        isFinal INTEGER NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions(id)
      )
    `);
    
    console.log('[DB] Database tables initialized');
  } catch (error) {
    console.error('[DB] Failed to create database tables:', error);
    // Close the database connection if table creation fails
    if (db) {
      try {
        db.close();
      } catch (closeError) {
        console.error('[DB] Error closing database:', closeError);
      }
      db = null;
    }
    initializationFailed = true;
    initializationError = error;
    throw error;
  }

  return db;
}

function getDb() {
  if (!db && !initializationFailed) {
    try {
      return initializeDb();
    } catch (error) {
      // Error already logged and tracked in initializeDb
      return null;
    }
  }
  
  if (initializationFailed) {
    return null;
  }
  
  return db;
}

module.exports = {
  initializeDb,
  getDb,
};
