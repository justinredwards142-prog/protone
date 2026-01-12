import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { getPrisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

export async function POST() {
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { stripeCustomerId: true },
  })
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer found." }, { status: 400 })
  }

  const appUrl = process.env.APP_URL
  if (!appUrl) return NextResponse.json({ error: "Missing APP_URL" }, { status: 500 })

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/`,
  })

  return NextResponse.json({ url: portal.url })
}
