// lib/usage.ts
import { prisma } from "@/lib/prisma"

export const FREE_WEEKLY_LIMIT = 10

// Monday 00:00 UTC week key, e.g. "2026-01-05"
export function weekKeyMondayUTC(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun, 1=Mon
  const diffToMonday = (day + 6) % 7 // Mon->0, Tue->1, ... Sun->6
  d.setUTCDate(d.getUTCDate() - diffToMonday)
  return d.toISOString().slice(0, 10)
}

export async function getWeeklyUsage(userId: string) {
  const key = weekKeyMondayUTC()

  const row = await prisma.weeklyUsage.upsert({
    where: { userId_weekKey: { userId, weekKey: key } },
    update: {},
    create: { userId, weekKey: key, used: 0 },
    select: { used: true },
  })

  return { used: row.used, weekKey: key }
}

/**
 * Atomically increments usage by 1 for the current week.
 * Returns the new used count.
 */
export async function reserveWeeklyUsage(userId: string) {
  const key = weekKeyMondayUTC()

  // Ensure row exists
  await prisma.weeklyUsage.upsert({
    where: { userId_weekKey: { userId, weekKey: key } },
    update: {},
    create: { userId, weekKey: key, used: 0 },
  })

  const updated = await prisma.weeklyUsage.update({
    where: { userId_weekKey: { userId, weekKey: key } },
    data: { used: { increment: 1 } },
    select: { used: true },
  })

  return { used: updated.used, weekKey: key }
}

/**
 * Decrements usage by 1 (min 0). Useful if OpenAI fails after we reserved.
 */
export async function rollbackWeeklyUsage(userId: string) {
  const key = weekKeyMondayUTC()

  const row = await prisma.weeklyUsage.findUnique({
    where: { userId_weekKey: { userId, weekKey: key } },
    select: { used: true },
  })

  if (!row) return { used: 0, weekKey: key }

  const nextUsed = Math.max(0, row.used - 1)

  const updated = await prisma.weeklyUsage.update({
    where: { userId_weekKey: { userId, weekKey: key } },
    data: { used: nextUsed },
    select: { used: true },
  })

  return { used: updated.used, weekKey: key }
}
