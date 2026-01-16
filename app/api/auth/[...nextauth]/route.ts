// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"
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

const handler = NextAuth(buildAuthOptions())

async function withRateLimit(req: Request) {
  // Light auth limiter: protects /api/auth/* from being hammered
  const ip = getClientIp(req)
  const rl = await enforceRateLimit(`auth:ip:${ip}`, { limit: 60, windowSeconds: 60 })
  if (isBlocked(rl)) {
    const retryAfterSec = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    })
  }
  // Forward to NextAuth
  return handler(req as any)
}

export async function GET(req: Request) {
  return withRateLimit(req)
}

export async function POST(req: Request) {
  return withRateLimit(req)
}
