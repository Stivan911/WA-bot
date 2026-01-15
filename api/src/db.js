const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const MIGRATIONS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_number TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'BOT' CHECK (mode IN ('BOT','HUMAN')),
  selected_menu INTEGER NULL,
  last_interaction_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT','FWD','SYS')),
  message_id TEXT NULL,
  from_number TEXT NULL,
  to_number TEXT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT NULL,
  error TEXT NULL,
  meta_json TEXT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_user_id_created_at ON messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

CREATE TABLE IF NOT EXISTS processed_message_ids (
  message_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
`;

function initDb({ DB_PATH }, logger) {
  ensureDirForFile(DB_PATH);

  const db = new Database(DB_PATH);
  db.exec(MIGRATIONS_SQL);

  const stmts = {
    getUserByNumber: db.prepare(`SELECT * FROM users WHERE wa_number = ?`),
    createUser: db.prepare(`
      INSERT INTO users (wa_number, mode, selected_menu, last_interaction_at, created_at, updated_at)
      VALUES (@wa_number, @mode, @selected_menu, @last_interaction_at, @created_at, @updated_at)
    `),
    updateUser: db.prepare(`
      UPDATE users
      SET mode = COALESCE(@mode, mode),
          selected_menu = COALESCE(@selected_menu, selected_menu),
          last_interaction_at = COALESCE(@last_interaction_at, last_interaction_at),
          updated_at = @updated_at
      WHERE wa_number = @wa_number
    `),
    setUserMode: db.prepare(`
      UPDATE users
      SET mode = @mode, selected_menu = NULL, updated_at = @updated_at
      WHERE wa_number = @wa_number
    `),
    setUserSelectedMenu: db.prepare(`
      UPDATE users
      SET selected_menu = @selected_menu, updated_at = @updated_at
      WHERE wa_number = @wa_number
    `),
    listUsers: db.prepare(`
      SELECT id, wa_number, mode, selected_menu, last_interaction_at, created_at, updated_at
      FROM users
      ORDER BY last_interaction_at DESC
      LIMIT @limit OFFSET @offset
    `),
    countUsers: db.prepare(`SELECT COUNT(*) as cnt FROM users`),
    insertMessage: db.prepare(`
      INSERT INTO messages (
        user_id, direction, message_id, from_number, to_number, text,
        timestamp, status, error, meta_json, created_at
      ) VALUES (
        @user_id, @direction, @message_id, @from_number, @to_number, @text,
        @timestamp, @status, @error, @meta_json, @created_at
      )
    `),
    getMessagesByUser: db.prepare(`
      SELECT m.*, u.wa_number
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE u.wa_number = @wa_number
      ORDER BY m.created_at DESC
      LIMIT @limit OFFSET @offset
    `),
    isProcessed: db.prepare(`SELECT 1 FROM processed_message_ids WHERE message_id = ? LIMIT 1`),
    markProcessed: db.prepare(`
      INSERT OR IGNORE INTO processed_message_ids (message_id, processed_at)
      VALUES (?, ?)
    `),
    sweepTimeout: db.prepare(`
      UPDATE users
      SET mode = 'BOT', selected_menu = NULL, updated_at = @now
      WHERE mode = 'HUMAN' AND last_interaction_at < @cutoff
    `),
  };

  function nowMs() { return Date.now(); }

  function getUserByNumber(wa_number) {
    return stmts.getUserByNumber.get(wa_number);
  }

  function upsertUser(wa_number, { mode = 'BOT', selected_menu = null, last_interaction_at = nowMs() } = {}) {
    const existing = getUserByNumber(wa_number);
    const now = nowMs();
    if (!existing) {
      stmts.createUser.run({
        wa_number,
        mode,
        selected_menu,
        last_interaction_at,
        created_at: now,
        updated_at: now,
      });
      return getUserByNumber(wa_number);
    }

    stmts.updateUser.run({
      wa_number,
      mode: null, // don't override mode on inbound unless explicitly asked
      selected_menu: null, // don't override selected_menu on generic upsert
      last_interaction_at,
      updated_at: now,
    });
    return getUserByNumber(wa_number);
  }

  function setUserMode(wa_number, mode) {
    const now = nowMs();
    stmts.setUserMode.run({ wa_number, mode, updated_at: now });
    return getUserByNumber(wa_number);
  }

  function setUserSelectedMenu(wa_number, selected_menu) {
    const now = nowMs();
    stmts.setUserSelectedMenu.run({ wa_number, selected_menu, updated_at: now });
    return getUserByNumber(wa_number);
  }

  function updateLastInteraction(wa_number, last_interaction_at) {
    const now = nowMs();
    stmts.updateUser.run({
      wa_number,
      mode: null,
      selected_menu: null,
      last_interaction_at,
      updated_at: now,
    });
  }

  function listUsers({ limit = 100, offset = 0 } = {}) {
    const rows = stmts.listUsers.all({ limit, offset });
    const total = stmts.countUsers.get().cnt;
    return { rows, total, limit, offset };
  }

  function insertMessage(msg) {
    const now = nowMs();
    stmts.insertMessage.run({
      ...msg,
      meta_json: msg.meta_json ? JSON.stringify(msg.meta_json) : null,
      created_at: now,
    });
  }

  function getMessagesByUser(wa_number, { limit = 20, offset = 0 } = {}) {
    const rows = stmts.getMessagesByUser.all({ wa_number, limit, offset });
    return rows.map(r => ({
      ...r,
      meta_json: r.meta_json ? safeJsonParse(r.meta_json) : null,
    }));
  }

  function safeJsonParse(str) {
    try { return JSON.parse(str); } catch { return null; }
  }

  function isMessageProcessed(message_id) {
    return !!stmts.isProcessed.get(message_id);
  }

  function markMessageProcessed(message_id) {
    const info = stmts.markProcessed.run(message_id, nowMs());
    return info.changes > 0;
  }

  function sweepAutoTimeout({ timeoutMs }) {
    const cutoff = nowMs() - timeoutMs;
    const now = nowMs();
    const info = stmts.sweepTimeout.run({ cutoff, now });
    if (info.changes > 0) {
      logger.info({ changes: info.changes, cutoff }, 'AUTO_TIMEOUT: switched HUMAN -> BOT');
    }
    return info.changes;
  }

  return {
    raw: db,
    getUserByNumber,
    upsertUser,
    setUserMode,
    setUserSelectedMenu,
    updateLastInteraction,
    listUsers,
    insertMessage,
    getMessagesByUser,
    isMessageProcessed,
    markMessageProcessed,
    sweepAutoTimeout,
  };
}

module.exports = { initDb };
