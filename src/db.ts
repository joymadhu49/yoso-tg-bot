import Database from 'better-sqlite3';
import path from 'path';
import { encrypt, decrypt } from './crypto.js';

const DB_PATH = path.join(process.cwd(), 'yoso-bot.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        private_key_encrypted TEXT NOT NULL,
        smart_account TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        telegram_id INTEGER PRIMARY KEY,
        rounds INTEGER DEFAULT 10,
        min_delay_sec INTEGER DEFAULT 30,
        max_delay_sec INTEGER DEFAULT 180,
        min_usdc REAL DEFAULT 0.05,
        max_usdc REAL DEFAULT 0.10,
        yes_chance INTEGER DEFAULT 55,
        sell_chance INTEGER DEFAULT 40,
        max_positions INTEGER DEFAULT 5,
        mode TEXT DEFAULT 'flip'
      );
    `);
  }
  return _db;
}

export type UserRow = {
  telegram_id: number;
  private_key_encrypted: string;
  smart_account: string;
  created_at: string;
};

export type UserSettingsRow = {
  telegram_id: number;
  rounds: number;
  min_delay_sec: number;
  max_delay_sec: number;
  min_usdc: number;
  max_usdc: number;
  yes_chance: number;
  sell_chance: number;
  max_positions: number;
  mode: string;
};

export function getUser(telegramId: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
}

export function saveUser(telegramId: number, privateKey: string, smartAccount: string): void {
  const encrypted = encrypt(privateKey);
  getDb().prepare(
    'INSERT OR REPLACE INTO users (telegram_id, private_key_encrypted, smart_account) VALUES (?, ?, ?)'
  ).run(telegramId, encrypted, smartAccount);
  // Ensure default settings exist
  getDb().prepare(
    'INSERT OR IGNORE INTO user_settings (telegram_id) VALUES (?)'
  ).run(telegramId);
}

export function getUserPrivateKey(telegramId: number): string | null {
  const user = getUser(telegramId);
  if (!user) return null;
  return decrypt(user.private_key_encrypted);
}

export function getUserSettings(telegramId: number): UserSettingsRow {
  const row = getDb().prepare('SELECT * FROM user_settings WHERE telegram_id = ?').get(telegramId) as UserSettingsRow | undefined;
  if (row) return row;
  // Return defaults
  return {
    telegram_id: telegramId,
    rounds: 10,
    min_delay_sec: 30,
    max_delay_sec: 180,
    min_usdc: 0.05,
    max_usdc: 0.10,
    yes_chance: 55,
    sell_chance: 40,
    max_positions: 5,
    mode: 'flip',
  };
}

export function updateSetting(telegramId: number, key: string, value: number | string): void {
  const allowed = ['rounds', 'min_delay_sec', 'max_delay_sec', 'min_usdc', 'max_usdc', 'yes_chance', 'sell_chance', 'max_positions', 'mode'];
  if (!allowed.includes(key)) throw new Error(`Invalid setting: ${key}`);
  getDb().prepare('INSERT OR IGNORE INTO user_settings (telegram_id) VALUES (?)').run(telegramId);
  getDb().prepare(`UPDATE user_settings SET ${key} = ? WHERE telegram_id = ?`).run(value, telegramId);
}

export function deleteUser(telegramId: number): void {
  getDb().prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
  getDb().prepare('DELETE FROM user_settings WHERE telegram_id = ?').run(telegramId);
}
