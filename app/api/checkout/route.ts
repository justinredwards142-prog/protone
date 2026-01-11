import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

export async function POST() {
  const session = await getServerSession(buildAuthOptions())
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

  return NextResponse.json({ url: checkout.url })
}
