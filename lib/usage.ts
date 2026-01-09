import Database from "better-sqlite3"
import crypto from "crypto"

const db = new Database("protone.sqlite")

db.exec(`
CREATE TABLE IF NOT EXISTS usage_weekly (
  user_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_key)
);
`)

// Monday-start week key in UTC (good enough for UK; later we can do true Europe/London if needed)
export function weekKeyMondayUTC(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diff)
  // YYYY-MM-DD
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function newAnonId() {
  return crypto.randomUUID()
}

export function getWeeklyUsed(userId: string, weekKey: string) {
  const row = db
    .prepare("SELECT used FROM usage_weekly WHERE user_id = ? AND week_key = ?")
    .get(userId, weekKey) as { used: number } | undefined
  return row?.used ?? 0
}

export function incrementWeeklyUsed(userId: string, weekKey: string) {
  // upsert then increment atomically
  db.prepare(
    "INSERT INTO usage_weekly (user_id, week_key, used) VALUES (?, ?, 0) ON CONFLICT(user_id, week_key) DO NOTHING"
  ).run(userId, weekKey)

  db.prepare("UPDATE usage_weekly SET used = used + 1 WHERE user_id = ? AND week_key = ?").run(userId, weekKey)

  return getWeeklyUsed(userId, weekKey)
}
