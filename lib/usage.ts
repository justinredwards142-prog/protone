// lib/usage.ts
import { getPrisma } from "@/lib/prisma"

export function weekKeyMondayUTC(date = new Date()) {
  // Monday-based week key in UTC, format YYYY-MM-DD (the Monday date)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun,1=Mon,...
  const diff = (day + 6) % 7 // Mon -> 0, Tue -> 1, ... Sun -> 6
  d.setUTCDate(d.getUTCDate() - diff)

  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export async function getWeeklyUsage(userId: string, weekKey: string) {
  const prisma = getPrisma()
  const row = await prisma.weeklyUsage.findUnique({
    where: { userId_weekKey: { userId, weekKey } },
    select: { used: true },
  })
  return row?.used ?? 0
}

/**
 * Reserve 1 usage for the current week for a free user.
 * Returns ok=false if already at/over limit.
 */
export async function reserveWeeklyUsage(opts: { userId: string; limit: number }) {
  const prisma = getPrisma()
  const weekKey = weekKeyMondayUTC()

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.weeklyUsage.findUnique({
      where: { userId_weekKey: { userId: opts.userId, weekKey } },
      select: { used: true },
    })

    const usedBefore = existing?.used ?? 0
    if (usedBefore >= opts.limit) {
      return {
        ok: false as const,
        weekKey,
        used: usedBefore,
        remaining: 0,
      }
    }

    const updated = await tx.weeklyUsage.upsert({
      where: { userId_weekKey: { userId: opts.userId, weekKey } },
      create: { userId: opts.userId, weekKey, used: 1 },
      update: { used: { increment: 1 } },
      select: { used: true },
    })

    const usedAfter = updated.used
    return {
      ok: true as const,
      weekKey,
      used: usedAfter,
      remaining: Math.max(0, opts.limit - usedAfter),
    }
  })

  return result
}

/**
 * If OpenAI call fails after reserve, roll back the reservation for that weekKey.
 * Best-effort: never throws.
 */
export async function rollbackWeeklyUsage(userId: string, weekKey: string) {
  try {
    const prisma = getPrisma()
    await prisma.$transaction(async (tx) => {
      const row = await tx.weeklyUsage.findUnique({
        where: { userId_weekKey: { userId, weekKey } },
        select: { id: true, used: true },
      })
      if (!row) return

      if (row.used <= 1) {
        await tx.weeklyUsage.delete({ where: { id: row.id } })
      } else {
        await tx.weeklyUsage.update({
          where: { id: row.id },
          data: { used: { decrement: 1 } },
        })
      }
    })
  } catch {
    // swallow
  }
}
