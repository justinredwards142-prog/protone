import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { getPrisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const prisma = getPrisma()
  const stripe = getStripe()

  const appUrl = process.env.APP_URL
  if (!appUrl) return NextResponse.json({ error: "Missing APP_URL" }, { status: 500 })

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, stripeCustomerId: true },
  })
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 401 })

  // Ensure Stripe customer exists
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

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/`,
  })

  return NextResponse.json({ url: portal.url })
}
