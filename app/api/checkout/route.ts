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

function isBlocked(x: RLResult): x is Extract<RLResult, { ok: false }> {
  return x.ok === false
}

export async function POST(req: Request) {
  // Must be signed in
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, stripeCustomerId: true, isPremium: true },
  })
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 401 })

  // If already premium, don’t create new checkout sessions
  if (user.isPremium) {
    return NextResponse.json(
      { error: "You already have Premium. Use Billing Portal to manage your plan." },
      { status: 409 }
    )
  }

  // Rate limit BEFORE doing any Stripe work
  const rlUser = await enforceRateLimit(`checkout:user:${user.id}`, { limit: 3, windowSeconds: 10 * 60 })
  if (isBlocked(rlUser)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlUser.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many checkout attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const ip = getClientIp(req)
  const rlIp = await enforceRateLimit(`checkout:ip:${ip}`, { limit: 10, windowSeconds: 10 * 60 })
  if (isBlocked(rlIp)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlIp.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many checkout attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const appUrl = process.env.APP_URL
  const priceId = process.env.STRIPE_PRICE_ID
  if (!appUrl || !priceId) {
    return NextResponse.json({ error: "Missing APP_URL or STRIPE_PRICE_ID" }, { status: 500 })
  }

  const stripe = getStripe()

  // Ensure customer exists + always has metadata.userId
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
    // Keep metadata fresh
    await stripe.customers.update(customerId, {
      email: user.email,
      metadata: { userId: user.id },
    })
  }

  // Create a subscription checkout session
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

  return NextResponse.json({ url: checkout.url })
}
