// lib/ratelimit.ts
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

export type RLResult = { ok: true } | { ok: false; reset: number }

/**
 * Vercel-safe Upstash rate limiter
 *
 * Env required:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 */
export async function enforceRateLimit(
  key: string,
  opts?: { limit?: number; windowSeconds?: number }
): Promise<RLResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  // If env missing → do not block traffic
  if (!url || !token) {
    console.warn("[ratelimit] Missing Upstash env vars — rate limiting disabled")
    return { ok: true }
  }

  const redis = new Redis({ url, token })

  const limit = opts?.limit ?? 5
  const windowSeconds = Math.max(1, opts?.windowSeconds ?? 60)

  // IMPORTANT: Upstash expects a string duration (it calls .match() on it)
  const duration = `${windowSeconds} s` as any

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, duration),
    prefix: "protone:rl",
    analytics: true,
  })

  const res = await ratelimit.limit(key)

  if (!res.success) return { ok: false, reset: res.reset }
  return { ok: true }
}
