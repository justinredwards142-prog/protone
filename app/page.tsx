"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import confetti from "canvas-confetti"
import { signOut, useSession } from "next-auth/react"

const WEEKLY_LIMIT = 10

function getTypeDelayForLen(len: number) {
  if (len > 900) return 4
  if (len > 500) return 7
  if (len > 250) return 11
  return 15
}

export default function Home() {
  const { data: session, status } = useSession()

  const [mode, setMode] = useState<"normal" | "fun">("normal")
  const [tone, setTone] = useState("professional")
  const [recipient, setRecipient] = useState("my boss")
  const [recipientOther, setRecipientOther] = useState("")
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const [animatedOutput, setAnimatedOutput] = useState("")
  const [loading, setLoading] = useState(false)
  const [hasRewritten, setHasRewritten] = useState(false)
  const [isTyping, setIsTyping] = useState(false)

  // Premium + usage snapshot (server-truth)
  const [isPremium, setIsPremium] = useState(false)
  const [weeklyUsed, setWeeklyUsed] = useState<number | null>(null)
  const [weeklyLimit, setWeeklyLimit] = useState<number>(WEEKLY_LIMIT)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Dark mode
  const [theme, setTheme] = useState<"light" | "dark">("light")

  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const signedIn = status === "authenticated"
  const limitReached = signedIn && !isPremium && remaining !== null && remaining <= 0

  const remainingLabel = useMemo(() => {
    if (!signedIn) return "Sign in to get started"
    if (isPremium) return "Premium: Unlimited"

    if (typeof weeklyUsed === "number") {
      const left = typeof remaining === "number" ? ` • ${remaining} left this week` : ""
      return `Used ${weeklyUsed} / ${weeklyLimit}${left}`
    }
    return `Used … / ${weeklyLimit}`
  }, [signedIn, isPremium, weeklyUsed, weeklyLimit, remaining])

  // Theme init
  useEffect(() => {
    const saved = localStorage.getItem("protone-theme") as "light" | "dark" | null
    const systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    const initial = saved ?? (systemPrefersDark ? "dark" : "light")
    setTheme(initial)
    document.documentElement.classList.toggle("dark", initial === "dark")
  }, [])

  // Cleanup typing interval
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current)
    }
  }, [])

  // Fetch usage snapshot on login (so banner is correct after logout/login)
  useEffect(() => {
    if (status !== "authenticated") {
      setIsPremium(false)
      setWeeklyUsed(null)
      setRemaining(null)
      setWeeklyLimit(WEEKLY_LIMIT)
      return
    }

    ;(async () => {
      try {
        const res = await fetch("/api/usage")
        if (!res.ok) return
        const data = await res.json()

        if (typeof data?.isPremium === "boolean") setIsPremium(data.isPremium)

        if (typeof data?.used === "number") setWeeklyUsed(data.used)
        if (typeof data?.limit === "number") setWeeklyLimit(data.limit)
        if (typeof data?.remaining === "number") setRemaining(data.remaining)

        // For premium responses where used/remaining might be null, keep UI sane
        if (data?.isPremium === true) {
          setWeeklyUsed(0)
          setRemaining(null)
        }
      } catch {
        // ignore
      }
    })()
  }, [status])

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("protone-theme", next)
    document.documentElement.classList.toggle("dark", next === "dark")
  }

  const goToSignIn = () => {
    window.location.href = "/signin"
  }

  const upgrade = async () => {
    if (!signedIn) {
      goToSignIn()
      return
    }
    try {
      const res = await fetch("/api/checkout", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (data?.url) {
        window.location.href = data.url
        return
      }
      alert(data?.error || "Checkout unavailable")
    } catch {
      alert("Checkout unavailable")
    }
  }

  const rewrite = async () => {
    if (!signedIn) {
      goToSignIn()
      return
    }
    if (limitReached) return
    if (!input.trim()) return

    const resolvedRecipient = recipient === "other" ? (recipientOther.trim() || "someone") : recipient

    setLoading(true)
    setOutput("")
    setAnimatedOutput("")
    setIsTyping(false)
    setHasRewritten(true)

    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current)
      typingIntervalRef.current = null
    }

    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, tone, recipient: resolvedRecipient, mode }),
      })

      const data = await res.json().catch(() => ({}))

      // ✅ Always sync from server truth (works for 200 + 429)
      if (typeof data?.isPremium === "boolean") setIsPremium(data.isPremium)
      if (typeof data?.used === "number") setWeeklyUsed(data.used)
      if (typeof data?.limit === "number") setWeeklyLimit(data.limit)
      if (typeof data?.remaining === "number") setRemaining(data.remaining)

      if (data?.isPremium === true) {
        setWeeklyUsed(0)
        setRemaining(null)
      }

      if (!res.ok) {
        const msg = data?.error || data?.result || "Request failed"
        setOutput("")
        setAnimatedOutput(msg)
        setIsTyping(false)
        return
      }

      const result = data?.result || "No response"
      setOutput(result)

      // Animated reveal
      const delay = getTypeDelayForLen(result.length)
      setIsTyping(true)

      let i = 0
      typingIntervalRef.current = setInterval(() => {
        i++
        setAnimatedOutput(result.slice(0, i))
        if (i >= result.length) {
          if (typingIntervalRef.current) clearInterval(typingIntervalRef.current)
          typingIntervalRef.current = null
          setIsTyping(false)
        }
      }, delay)

      // Fun confetti
      if (mode === "fun") {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.65 },
          colors: ["#7C3AED", "#C4B5FD"],
        })
      }
    } catch {
      setAnimatedOutput("Something went wrong. Please try again.")
      setIsTyping(false)
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current)
      typingIntervalRef.current = null
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-4 py-10 bg-gray-50 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="max-w-xl mx-auto space-y-8">
        {/* Header row: logo + auth + theme toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14">
              <svg viewBox="0 0 100 100" className="w-full h-full rounded-full">
                <circle cx="50" cy="50" r="50" fill="#7C3AED" />
                <text x="50%" y="55%" textAnchor="middle" fill="white" fontSize="42" fontWeight="bold" dy=".3em">
                  P
                </text>
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-purple-700">ProTone</h1>
          </div>

          <div className="flex items-center gap-2">
            {signedIn ? (
              <>
                <span className="hidden sm:inline text-sm text-gray-600 dark:text-zinc-300 max-w-[220px] truncate">
                  {session?.user?.email}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all
                             dark:bg-zinc-900 dark:border-zinc-700"
                  type="button"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={goToSignIn}
                className="px-3 py-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all
                           dark:bg-zinc-900 dark:border-zinc-700"
                type="button"
              >
                Sign in
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="px-3 py-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all
                         dark:bg-zinc-900 dark:border-zinc-700"
              aria-label="Toggle dark mode"
              type="button"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        {/* Branded intro */}
        <div className="reveal bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm dark:bg-zinc-900 dark:border-zinc-700">
          <p className="text-base font-medium text-gray-700 dark:text-zinc-200">
            Rewrite messages instantly with the right tone —{" "}
            <span className="text-purple-700 font-semibold">professional, casual, or fun</span>.
          </p>

          <div className="mt-3 text-sm text-gray-600 dark:text-zinc-300">
            {signedIn ? (
              <p>
                {isPremium ? (
                  <>
                    <span className="font-semibold">Premium</span>: Unlimited rewrites.
                  </>
                ) : (
                  <>
                    Free plan: <span className="font-semibold">{remainingLabel}</span>.
                  </>
                )}
              </p>
            ) : (
              <p>
                <span className="font-semibold">Sign in</span> to start using ProTone.
              </p>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="font-semibold text-gray-700 dark:text-zinc-200">Enter your message</label>
          <textarea
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your message here…"
            className="resize-none"
          />
          <p className="text-xs text-gray-500 dark:text-zinc-400">🔒 Your messages are not stored or saved.</p>
        </div>

        {/* Controls (stacked) */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="font-semibold text-gray-700 dark:text-zinc-200">Mode</label>
            <select
              value={mode}
              onChange={(e) => {
                const m = e.target.value as "normal" | "fun"
                setMode(m)
                setTone(m === "normal" ? "professional" : "5yearold")
              }}
            >
              <option value="normal">Normal ({remainingLabel})</option>
              <option value="fun">Fun 🎉 ({remainingLabel})</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700 dark:text-zinc-200">Tone</label>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              {mode === "normal" ? (
                <>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                </>
              ) : (
                <>
                  <option value="5yearold">5-year-old 👶</option>
                  <option value="sarcastic">Sarcastic 🙃</option>
                  <option value="unhinged">Unhinged 🤪</option>
                  <option value="angry">Angry 😡</option>
                  <option value="overly-polite">Overly polite 🙏</option>
                </>
              )}
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700 dark:text-zinc-200">Who is this for?</label>
            <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="my boss">My boss</option>
              <option value="my friend">My friend</option>
              <option value="my parents">My parents</option>
              <option value="other">Other</option>
            </select>

            {recipient === "other" && (
              <input
                value={recipientOther}
                onChange={(e) => setRecipientOther(e.target.value)}
                placeholder="e.g. my landlord, a client, my teacher…"
                className="w-full"
              />
            )}
          </div>
        </div>

        {/* Limit notice + direct upgrade CTA */}
        {limitReached && (
          <div className="notice-box reveal space-y-3">
            <p className="font-semibold text-purple-800 dark:text-purple-200">
              You’ve used all your free rewrites for this week
            </p>
            <button
              onClick={upgrade}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl font-semibold"
              type="button"
            >
              Upgrade to Premium for unlimited
            </button>
          </div>
        )}

        {/* Rewrite button */}
        <button
          onClick={rewrite}
          disabled={loading || limitReached}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl text-lg font-semibold
                     transition-all duration-150 active:scale-[0.99]
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Rewriting…" : signedIn ? "Rewrite" : "Sign in to rewrite"}
        </button>

        {/* Premium upsell card (shown when signed in and not premium) */}
        {signedIn && !isPremium && (
          <div className="reveal bg-purple-50 border border-purple-200 rounded-2xl p-5 text-center space-y-3 dark:bg-purple-950/30 dark:border-purple-900">
            <p className="text-lg font-semibold text-purple-800 dark:text-purple-200">🚀 Go unlimited with ProTone Premium</p>
            <p className="text-purple-700 dark:text-purple-200/90">Unlimited rewrites — no weekly limits.</p>
            <button
              onClick={upgrade}
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-semibold
                         transition-all duration-150 active:scale-[0.99]"
              type="button"
            >
              Upgrade to Premium
            </button>
          </div>
        )}

        {/* Testimonials BEFORE rewrite */}
        {!hasRewritten && <Testimonials />}

        {/* Output */}
        {animatedOutput && (
          <>
            <div className="output-box reveal">
              <div className="flex items-center justify-end mb-2">
                <button onClick={() => navigator.clipboard.writeText(output)} className="copy-button" type="button">
                  Copy
                </button>
              </div>

              <div className="whitespace-pre-wrap break-words">
                {animatedOutput}
                {isTyping && <span className="cursor">|</span>}
              </div>
            </div>

            {/* Testimonials AFTER rewrite */}
            <Testimonials />
          </>
        )}
      </div>
    </div>
  )
}

function Testimonials() {
  return (
    <div className="reveal mt-8 text-center space-y-6">
      <h3 className="text-2xl font-bold text-gray-800 dark:text-zinc-100">Loved by early users</h3>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            role: "Marketing Manager",
            text: "ProTone saves me from overthinking every message. I use it before emailing clients and my boss.",
          },
          {
            role: "Early user",
            text: "The fun modes are hilarious but still useful. I’ve never laughed so much rewriting a text.",
          },
          {
            role: "Startup founder",
            text: "This replaced rewriting emails in my head 10 times before sending them.",
          },
        ].map((t) => (
          <div
            key={t.role}
            className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm dark:bg-zinc-900 dark:border-zinc-700"
          >
            <div className="text-yellow-400 text-lg leading-none">★★★★★</div>
            <p className="text-gray-700 mt-2 dark:text-zinc-200">“{t.text}”</p>
            <p className="text-sm text-gray-500 mt-3 dark:text-zinc-400">— {t.role}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
