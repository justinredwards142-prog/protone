import { NextResponse } from "next/server"
import { getPrisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const stripe = getStripe()
  const prisma = getPrisma()

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 })

  const signature = req.headers.get("stripe-signature")
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 })

  const body = await req.text()

  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err?.message ?? "Unknown"}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any
        const userId = session?.metadata?.userId || session?.client_reference_id
        const customerId = session?.customer
        const subscriptionId = session?.subscription

        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              isPremium: true,
              stripeCustomerId: typeof customerId === "string" ? customerId : undefined,
              stripeSubscriptionId: typeof subscriptionId === "string" ? subscriptionId : undefined,
            },
          })
        }
        break
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as any

        const subscriptionId = sub?.id
        const customerId = sub?.customer
        const priceId = sub?.items?.data?.[0]?.price?.id
        const periodEnd = sub?.current_period_end

        if (typeof subscriptionId === "string") {
          await prisma.user.updateMany({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
              isPremium: sub?.status === "active" || sub?.status === "trialing",
              stripePriceId: typeof priceId === "string" ? priceId : null,
              stripeCurrentPeriodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
              stripeCustomerId: typeof customerId === "string" ? customerId : null,
            },
          })
        }
        break
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as any
        const subscriptionId = sub?.id

        if (typeof subscriptionId === "string") {
          await prisma.user.updateMany({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
              isPremium: false,
              stripeSubscriptionId: null,
              stripePriceId: null,
              stripeCurrentPeriodEnd: null,
            },
          })
        }
        break
      }

      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Webhook handler failed" }, { status: 500 })
  }
}
