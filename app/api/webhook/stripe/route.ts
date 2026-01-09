import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const sig = (await headers()).get("stripe-signature")
  if (!sig) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 })

  const body = await req.text()

  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error("❌ Stripe signature verify failed:", err?.message)
    return NextResponse.json({ error: "Bad signature" }, { status: 400 })
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any

      const userId =
        (session.client_reference_id as string | null) ??
        (session.metadata?.userId as string | null) ??
        null

      const customerId = (session.customer as string | null) ?? null
      const subscriptionId = (session.subscription as string | null) ?? null

      console.log("✅ checkout.session.completed", { userId, customerId, subscriptionId })

      if (userId && customerId) {
        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        })
      }

      // Flip premium immediately by reading the subscription
      if (userId && subscriptionId) {
        const subResp = await stripe.subscriptions.retrieve(subscriptionId)

// Stripe types in your version wrap the object; use a safe unwrap.
const sub: any = (subResp as any)?.data ?? subResp

const isActive = sub.status === "active" || sub.status === "trialing"
const priceId = sub.items?.data?.[0]?.price?.id ?? null

const periodEndUnix = sub.current_period_end as number | undefined
const periodEnd = typeof periodEndUnix === "number" ? new Date(periodEndUnix * 1000) : null


        await prisma.user.update({
          where: { id: userId },
          data: {
            isPremium: isActive,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: periodEnd,
          },
        })

        console.log("✅ Premium updated for user", { userId, isActive })
      }

      return NextResponse.json({ received: true })
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object as any
      const customerId = sub.customer as string
      const isActive = sub.status === "active" || sub.status === "trialing"
      const priceId = sub.items?.data?.[0]?.price?.id ?? null
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null

      // Primary update by customerId (works after checkout stored it)
      const updated = await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          isPremium: isActive,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          stripeCurrentPeriodEnd: periodEnd,
        },
      })

      console.log("✅ subscription event updateMany", { customerId, updated: updated.count, isActive })

      return NextResponse.json({ received: true })
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as any
      const customerId = sub.customer as string

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          isPremium: false,
          stripeSubscriptionId: null,
          stripePriceId: null,
          stripeCurrentPeriodEnd: null,
        },
      })

      console.log("✅ subscription deleted", { customerId })
      return NextResponse.json({ received: true })
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error("❌ Webhook handler failed:", err?.message || err)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
