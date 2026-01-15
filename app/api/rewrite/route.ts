// app/api/rewrite/route.ts
import { NextResponse } from "next/server"
import OpenAI from "openai"
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth"
import { getPrisma } from "@/lib/prisma"
import { reserveWeeklyUsage, rollbackWeeklyUsage } from "@/lib/usage"
import { enforceRateLimit, type RLResult } from "@/lib/ratelimit"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const WEEKLY_LIMIT = 10
const NORMAL_TONES = new Set(["professional", "casual"])
const FUN_TONES = new Set(["5yearold", "sarcastic", "unhinged", "angry", "overly-polite"])
const MODES = new Set(["normal", "fun"])

type RewritePayload =
  | {
      result: string
      used: number
      limit: number | "Unlimited"
      remaining: number | "Unlimited"
      isPremium: boolean
    }
  | {
      error: string
      used?: number
      limit?: number | "Unlimited"
      remaining?: number | "Unlimited"
      isPremium?: boolean
    }

function cleanStr(v: unknown, max = 6000) {
  if (typeof v !== "string") return ""
  return v.trim().slice(0, max)
}

// Best-effort: identify caller IP (Vercel / proxies)
function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for")
  if (xf) return xf.split(",")[0]?.trim() || "unknown"
  return req.headers.get("x-real-ip") ?? "unknown"
}

// Type guard so TS knows reset exists in the blocked case
function isBlocked(x: RLResult): x is Extract<RLResult, { ok: false }> {
  return x.ok === false
}

export async function POST(req: Request) {
  // 1) Must be signed in
  const session = await getServerSession(buildAuthOptions())
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json(
      { error: "Please sign in.", used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false } satisfies RewritePayload,
      { status: 401 }
    )
  }

  // 2) Resolve user
  const prisma = getPrisma()
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isPremium: true },
  })

  if (!user) {
    return NextResponse.json(
      { error: "User not found.", used: 0, limit: WEEKLY_LIMIT, remaining: WEEKLY_LIMIT, isPremium: false } satisfies RewritePayload,
      { status: 401 }
    )
  }

  const isPremium = Boolean(user.isPremium)

  // 3) Rate limit BEFORE reserving weekly usage / calling OpenAI
  // Use lower numbers temporarily to prove it’s working:
  // - Per-user: 5/min
  // - Per-IP: 10/min
  const perUserKey = `rewrite:user:${user.id}`
  const rlUser = await enforceRateLimit(perUserKey, { limit: 5, windowSeconds: 60 })
  console.log("[RL:user]", perUserKey, rlUser)

  if (isBlocked(rlUser)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlUser.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many requests. Please slow down." } satisfies RewritePayload,
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  const ip = getClientIp(req)
  const perIpKey = `rewrite:ip:${ip}`
  const rlIp = await enforceRateLimit(perIpKey, { limit: 10, windowSeconds: 60 })
  console.log("[RL:ip]", perIpKey, rlIp)

  if (isBlocked(rlIp)) {
    const retryAfterSec = Math.max(1, Math.ceil((rlIp.reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many requests. Please slow down." } satisfies RewritePayload,
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    )
  }

  let reserved = false
  let reservedWeekKey = ""

  try {
    const body = await req.json()

    const input = cleanStr(body?.input, 6000)
    const recipient = cleanStr(body?.recipient, 120) || "someone"
    const mode = cleanStr(body?.mode, 20)
    const tone = cleanStr(body?.tone, 40)

    if (!input) return NextResponse.json({ error: "Missing input." } satisfies RewritePayload, { status: 400 })
    if (!MODES.has(mode)) return NextResponse.json({ error: "Invalid mode." } satisfies RewritePayload, { status: 400 })

    const toneOk = mode === "normal" ? NORMAL_TONES.has(tone) : FUN_TONES.has(tone)
    if (!toneOk) return NextResponse.json({ error: "Invalid tone for selected mode." } satisfies RewritePayload, { status: 400 })

    // 4) Weekly limit (free users only)
    let used = 0
    let remaining: number | "Unlimited" = WEEKLY_LIMIT
    let limit: number | "Unlimited" = WEEKLY_LIMIT

    if (!isPremium) {
      const resv = await reserveWeeklyUsage({ userId: user.id, limit: WEEKLY_LIMIT })
      reserved = true
      reservedWeekKey = resv.weekKey

      if (!resv.ok) {
        return NextResponse.json(
          { result: "Weekly limit reached.", used: resv.used, limit: WEEKLY_LIMIT, remaining: resv.remaining, isPremium: false } satisfies RewritePayload,
          { status: 429 }
        )
      }

      used = resv.used
      remaining = resv.remaining
      limit = WEEKLY_LIMIT
    } else {
      remaining = "Unlimited"
      limit = "Unlimited"
    }

    // 5) Call OpenAI
    const system =
      "You rewrite messages. Output ONLY the rewritten message. " +
      "Preserve key details, names, dates, and intent. Do not add disclaimers."

    const userPrompt = [
      `Recipient: ${recipient}`,
      `Mode: ${mode}`,
      `Tone: ${tone}`,
      "",
      "Message to rewrite:",
      input,
    ].join("\n")

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      temperature: mode === "fun" ? 0.9 : 0.4,
      max_tokens: 500,
    })

    const result = response.choices?.[0]?.message?.content?.trim() || "No response"

    return NextResponse.json({ result, used, limit, remaining, isPremium } satisfies RewritePayload)
  } catch {
    if (reserved && reservedWeekKey) await rollbackWeeklyUsage(user.id, reservedWeekKey)
    return NextResponse.json({ error: "Failed to rewrite." } satisfies RewritePayload, { status: 500 })
  }
}
