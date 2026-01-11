import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getWeeklyUsage, weekKeyMondayUTC } from "@/lib/usage"

export const runtime = "nodejs"

const WEEKLY_LIMIT = 10

type UsagePayload = {
  used: number
  limit: number | "Unlimited"
  remaining: number | "Unlimited"
  isPremium: boolean
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    const payload: UsagePayload = { used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false }
    return NextResponse.json(payload, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isPremium: true },
  })

  if (!user) {
    const payload: UsagePayload = { used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false }
    return NextResponse.json(payload, { status: 401 })
  }

  const isPremium = Boolean(user.isPremium)

  if (isPremium) {
    const payload: UsagePayload = { used: 0, limit: "Unlimited", remaining: "Unlimited", isPremium: true }
    return NextResponse.json(payload)
  }

  const weekKey = weekKeyMondayUTC()
  const used = await getWeeklyUsage(user.id, weekKey)
  const remaining = Math.max(0, WEEKLY_LIMIT - used)

  const payload: UsagePayload = { used, limit: WEEKLY_LIMIT, remaining, isPremium: false }
  return NextResponse.json(payload)
}
