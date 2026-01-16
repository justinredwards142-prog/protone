// app/api/billing-portal/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { getPrisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import { enforceRateLimit } from "@/lib/ratelimit"
import type { RLResult } from "@/lib/ratelimit"

export const runtime = "nodejs"

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for")
  if (xf) return xf.split(",")[0]?.trim() || "unknown"
  return req.headers.get("x-real-ip") ?? "unknown"
}

function isBlocked(x: RLResult): x is Extract<RLResult, { ok: false }> {
  return x.ok === false
}

export async function POST(req: Request) {
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, stripeCustomerId: true },
  })

  if (!user) return NextResponse.json({ error: "User not found." }, { status: 401 })

  // Rate limit (portal creation can be abused)
  const rlUser = await enforceRateLimit(`portal:user:${user.id}`, { limit: 10, windowSeconds: 10 * 60 })
  if (isBlocked(rlUser)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlUser.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const ip = getClientIp(req)
  const rlIp = await enforceRateLimit(`portal:ip:${ip}`, { limit: 30, windowSeconds: 10 * 60 })
  if (isBlocked(rlIp)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlIp.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const customerId = user.stripeCustomerId
  if (!customerId) {
    return NextResponse.json({ error: "No Stripe customer found." }, { status: 400 })
  }

  const baseUrl =
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")

  if (!baseUrl) {
    return NextResponse.json({ error: "Missing APP_URL (or NEXTAUTH_URL / VERCEL_URL)" }, { status: 500 })
  }

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/`,
  })

  return NextResponse.json({ url: portal.url })
}
