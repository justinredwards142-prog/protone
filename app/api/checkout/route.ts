import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/auth"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"

export const runtime = "nodejs"

export async function POST() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, stripeCustomerId: true, isPremium: true },
  })
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 401 })

  const appUrl = process.env.APP_URL
  const priceId = process.env.STRIPE_PRICE_ID
  if (!appUrl || !priceId) {
    return NextResponse.json({ error: "Missing APP_URL or STRIPE_PRICE_ID" }, { status: 500 })
  }

  // If already premium, you typically send them to a billing portal.
  // For now, return a friendly message (or create /api/billing-portal later).
  if (user.isPremium) {
    return NextResponse.json({ error: "You already have Premium." }, { status: 400 })
  }

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
    // keep metadata in sync
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

    // Include session_id for optional client-side refresh/verification
    success_url: `${appUrl}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?canceled=1`,
  })

  return NextResponse.json({ url: checkout.url })
}
