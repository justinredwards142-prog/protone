import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const WEEKLY_LIMIT = 10

function weekKeyMondayUTC(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diff)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json(
      { isPremium: false, used: null, limit: WEEKLY_LIMIT, remaining: null },
      { status: 401 }
    )
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isPremium: true },
  })
  if (!user) {
    return NextResponse.json(
      { isPremium: false, used: null, limit: WEEKLY_LIMIT, remaining: null },
      { status: 401 }
    )
  }

  const isPremium = !!user.isPremium

  if (isPremium) {
    return NextResponse.json({ isPremium: true, used: 0, limit: null, remaining: null })
  }

  const weekKey = weekKeyMondayUTC()
  const row = await prisma.weeklyUsage.findUnique({
    where: { userId_weekKey: { userId: user.id, weekKey } },
    select: { used: true },
  })

  const used = row?.used ?? 0
  const remaining = Math.max(0, WEEKLY_LIMIT - used)

  return NextResponse.json({ isPremium: false, used, limit: WEEKLY_LIMIT, remaining })
}
