import { NextResponse } from "next/server"
import OpenAI from "openai"
import { getServerSession } from "next-auth"
import { authOptions } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const WEEKLY_LIMIT = 10

const NORMAL_TONES = new Set(["professional", "casual"])
const FUN_TONES = new Set(["5yearold", "sarcastic", "unhinged", "angry", "overly-polite"])
const MODES = new Set(["normal", "fun"])

function cleanStr(v: unknown, max = 6000) {
  if (typeof v !== "string") return ""
  return v.trim().slice(0, max)
}

function weekKeyMondayUTC(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diff)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Please sign in." }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isPremium: true },
  })
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 401 })

  const isPremium = !!user.isPremium
  const weekKey = weekKeyMondayUTC()

  let reservedOne = false

  try {
    const body = await req.json()

    const input = cleanStr(body?.input, 6000)
    const recipient = cleanStr(body?.recipient, 120) || "someone"
    const mode = cleanStr(body?.mode, 20)
    const tone = cleanStr(body?.tone, 40)

    if (!input) return NextResponse.json({ error: "Missing input." }, { status: 400 })
    if (!MODES.has(mode)) return NextResponse.json({ error: "Invalid mode." }, { status: 400 })

    const toneOk = mode === "normal" ? NORMAL_TONES.has(tone) : FUN_TONES.has(tone)
    if (!toneOk) return NextResponse.json({ error: "Invalid tone for selected mode." }, { status: 400 })

    // Enforce weekly limit for free users
    if (!isPremium) {
      await prisma.weeklyUsage.upsert({
        where: { userId_weekKey: { userId: user.id, weekKey } },
        create: { userId: user.id, weekKey, used: 0 },
        update: {},
      })

      const updated = await prisma.weeklyUsage.updateMany({
        where: { userId: user.id, weekKey, used: { lt: WEEKLY_LIMIT } },
        data: { used: { increment: 1 } },
      })

      if (updated.count === 0) {
        return NextResponse.json(
          { isPremium: false, result: "Weekly limit reached.", used: WEEKLY_LIMIT, limit: WEEKLY_LIMIT, remaining: 0 },
          { status: 429 }
        )
      }

      reservedOne = true
    }

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

    if (isPremium) {
      return NextResponse.json({ isPremium: true, result, used: 0, limit: null, remaining: null })
    }

    const row = await prisma.weeklyUsage.findUnique({
      where: { userId_weekKey: { userId: user.id, weekKey } },
      select: { used: true },
    })

    const usedNow = row?.used ?? WEEKLY_LIMIT
    const remaining = Math.max(0, WEEKLY_LIMIT - usedNow)

    return NextResponse.json({ isPremium: false, result, used: usedNow, limit: WEEKLY_LIMIT, remaining })
  } catch {
    // Roll back reservation if OpenAI fails
    if (reservedOne) {
      try {
        await prisma.weeklyUsage.update({
          where: { userId_weekKey: { userId: user.id, weekKey } },
          data: { used: { decrement: 1 } },
        })
      } catch {
        // ignore
      }
    }
    return NextResponse.json({ error: "Failed to rewrite." }, { status: 500 })
  }
}
