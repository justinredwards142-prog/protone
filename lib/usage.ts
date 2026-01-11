// lib/usage.ts
import { prisma } from "@/lib/prisma"

export function weekKeyMondayUTC(date = new Date()) {
  // Monday-based week key in UTC: YYYY-MM-DD of Monday
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun ... 6=Sat
  const diffToMonday = (day + 6) % 7 // Mon->0, Tue->1, ... Sun->6
  d.setUTCDate(d.getUTCDate() - diffToMonday)

  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export async function getWeeklyUsage(userId: string, weekKey: string) {
  const row = await prisma.weeklyUsage.findUnique({
    where: { userId_weekKey: { userId, weekKey } },
    select: { used: true },
  })
  return row?.used ?? 0
}

/**
 * Atomically "reserves" 1 usage for this user/week.
 * Returns ok=false if user is already at/over limit.
 */
export async function reserveWeeklyUsage(opts: { userId: string; limit: number }) {
  const weekKey = weekKeyMondayUTC()

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.weeklyUsage.findUnique({
      where: { userId_weekKey: { userId: opts.userId, weekKey } },
      select: { id: true, used: true },
    })

    const usedNow = existing?.used ?? 0
    if (usedNow >= opts.limit) {
      return { ok: false as const, used: usedNow, remaining: 0, weekKey }
    }

    const updated = await tx.weeklyUsage.upsert({
      where: { userId_weekKey: { userId: opts.userId, weekKey } },
      create: { userId: opts.userId, weekKey, used: 1 },
      update: { used: { increment: 1 } },
      select: { used: true },
    })

    const remaining = Math.max(0, opts.limit - updated.used)
    return { ok: true as const, used: updated.used, remaining, weekKey }
  })

  return result
}

/**
 * If OpenAI fails after reserving, roll back that 1 usage.
 */
export async function rollbackWeeklyUsage(userId: string, weekKey: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.weeklyUsage.findUnique({
      where: { userId_weekKey: { userId, weekKey } },
      select: { used: true },
    })
    if (!row) return

    if (row.used <= 1) {
      await tx.weeklyUsage.delete({ where: { userId_weekKey: { userId, weekKey } } })
    } else {
      await tx.weeklyUsage.update({
        where: { userId_weekKey: { userId, weekKey } },
        data: { used: { decrement: 1 } },
      })
    }
  })
}
