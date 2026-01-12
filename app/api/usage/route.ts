import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { getPrisma } from "@/lib/prisma"
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
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false } satisfies UsagePayload, {
      status: 401,
    })
  }

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isPremium: true },
  })

  if (!user) {
    return NextResponse.json({ used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false } satisfies UsagePayload, {
      status: 401,
    })
  }

  if (user.isPremium) {
    return NextResponse.json({ used: 0, limit: "Unlimited", remaining: "Unlimited", isPremium: true } satisfies UsagePayload)
  }

  const weekKey = weekKeyMondayUTC()
  const used = await getWeeklyUsage(user.id, weekKey)
  const remaining = Math.max(0, WEEKLY_LIMIT - used)

  return NextResponse.json({ used, limit: WEEKLY_LIMIT, remaining, isPremium: false } satisfies UsagePayload)
}
