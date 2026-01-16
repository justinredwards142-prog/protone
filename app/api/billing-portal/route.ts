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

function noStoreJson(body: any, init?: ResponseInit) {
  const res = NextResponse.json(body, init)
  res.headers.set("Cache-Control", "no-store")
  return res
}

// ✅ Type guard so TS knows reset exists
function isBlocked(x: RLResult): x is Extract<RLResult, { ok: false }> {
  return x.ok === false
}

function retryAfterSeconds(blocked: Extract<RLResult, { ok: false }>) {
  return Math.max(1, Math.ceil((blocked.reset - Date.now()) / 1000))
}

export async function POST(req: Request) {
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) return noStoreJson({ error: "Please sign in." }, { status: 401 })

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, stripeCustomerId: true },
  })
  if (!user) return noStoreJson({ error: "User not found." }, { status: 401 })

  // Rate limit
  const rlUser = await enforceRateLimit(`portal:user:${user.id}`, {
    limit: 10,
    windowSeconds: 10 * 60,
    prefix: "protone:portal:user",
  })
  if (isBlocked(rlUser)) {
    const retryAfterSec = retryAfterSeconds(rlUser)
    return noStoreJson(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const ip = getClientIp(req)
  const rlIp = await enforceRateLimit(`portal:ip:${ip}`, {
    limit: 40,
    windowSeconds: 10 * 60,
    prefix: "protone:portal:ip",
  })
  if (isBlocked(rlIp)) {
    const retryAfterSec = retryAfterSeconds(rlIp)
    return noStoreJson(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const customerId = user.stripeCustomerId
  if (!customerId) {
    return noStoreJson({ error: "No Stripe customer found." }, { status: 400 })
  }

  const baseUrl =
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")

  if (!baseUrl) {
    return noStoreJson({ error: "Missing APP_URL (or NEXTAUTH_URL / VERCEL_URL)" }, { status: 500 })
  }

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/`,
  })

  return noStoreJson({ url: portal.url })
}
