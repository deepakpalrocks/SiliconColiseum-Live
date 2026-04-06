import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "..", "data.db");

let db;

export async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  migrate();
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      wallet_address TEXT UNIQUE NOT NULL,
      signature TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Track user deposits to the shared wallet
  db.run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tx_hash TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'confirmed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Track per-user USDT balance (virtual accounting within the shared wallet)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id TEXT PRIMARY KEY,
      usdt_balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      initial_budget REAL NOT NULL,
      current_balance REAL NOT NULL,
      tokens TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      personality TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      token TEXT NOT NULL,
      amount REAL NOT NULL,
      avg_buy_price REAL NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      UNIQUE(agent_id, token)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      token TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      price REAL NOT NULL,
      token_amount REAL NOT NULL,
      confidence REAL,
      reasoning TEXT,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      should_trade INTEGER NOT NULL,
      reasoning TEXT,
      market_analysis TEXT,
      raw_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Withdrawal requests
  db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      to_address TEXT NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Migration: add tx_hash and status to trades if missing
  try {
    const testStmt = db.prepare("SELECT tx_hash FROM trades LIMIT 1");
    testStmt.free();
  } catch {
    try { db.run("ALTER TABLE trades ADD COLUMN tx_hash TEXT"); } catch {}
    try { db.run("ALTER TABLE trades ADD COLUMN status TEXT DEFAULT 'completed'"); } catch {}
  }

  // Migration: add wallet columns to users if missing
  try {
    const testStmt = db.prepare("SELECT wallet_address FROM users LIMIT 1");
    testStmt.free();
  } catch {
    try { db.run("ALTER TABLE users ADD COLUMN wallet_address TEXT DEFAULT ''"); } catch {}
    try { db.run("ALTER TABLE users ADD COLUMN signature TEXT DEFAULT ''"); } catch {}
    try { db.run("ALTER TABLE users ADD COLUMN message TEXT DEFAULT ''"); } catch {}
  }

  saveDb();
}

// Helper: run query and get all rows as objects
export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run query and get first row as object
export function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

// Helper: run a write statement
export function execute(sql, params = []) {
  db.run(sql, params);
  saveDb();
}
