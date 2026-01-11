// lib/stripe.ts
import Stripe from "stripe"

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  return new Stripe(key, {
    // If TS complains about apiVersion, you can remove apiVersion entirely
    apiVersion: "2024-06-20" as any,
    typescript: true,
  })
}
