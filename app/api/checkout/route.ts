// app/api/checkout/route.ts
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
    select: { id: true, email: true, stripeCustomerId: true, isPremium: true },
  })
  if (!user) return noStoreJson({ error: "User not found." }, { status: 401 })

  if (user.isPremium) {
    return noStoreJson(
      { error: "You already have Premium. Use Billing Portal to manage your plan." },
      { status: 409 }
    )
  }

  // Rate limit BEFORE Stripe work
  const rlUser = await enforceRateLimit(`checkout:user:${user.id}`, {
    limit: 5,
    windowSeconds: 10 * 60,
    prefix: "protone:checkout:user",
  })
  if (isBlocked(rlUser)) {
    const retryAfterSec = retryAfterSeconds(rlUser)
    return noStoreJson(
      { error: "Too many checkout attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const ip = getClientIp(req)
  const rlIp = await enforceRateLimit(`checkout:ip:${ip}`, {
    limit: 20,
    windowSeconds: 10 * 60,
    prefix: "protone:checkout:ip",
  })
  if (isBlocked(rlIp)) {
    const retryAfterSec = retryAfterSeconds(rlIp)
    return noStoreJson(
      { error: "Too many checkout attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const appUrl = process.env.APP_URL
  const priceId = process.env.STRIPE_PRICE_ID
  if (!appUrl || !priceId) {
    return noStoreJson({ error: "Missing APP_URL or STRIPE_PRICE_ID" }, { status: 500 })
  }

  const stripe = getStripe()

  let customerId = user.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    })
    customerId = customer.id

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    })
  } else {
    await stripe.customers.update(customerId, {
      email: user.email,
      metadata: { userId: user.id },
    })
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    metadata: { userId: user.id },
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${appUrl}/?success=true`,
    cancel_url: `${appUrl}/?canceled=true`,
  })

  return noStoreJson({ url: checkout.url })
}
