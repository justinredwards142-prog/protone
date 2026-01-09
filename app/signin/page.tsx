"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"

export default function SignInPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const e = email.trim()
    if (!e) return

    setLoading(true)
    const res = await signIn("email", {
      email: e,
      callbackUrl: "/",
      redirect: false, // so we control the UX
    })
    setLoading(false)

    if (res?.error) {
      setError("Could not send sign-in email. Please try again.")
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen px-4 py-10 bg-gray-50 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="max-w-md mx-auto space-y-6 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm dark:bg-zinc-900 dark:border-zinc-700">
        <h1 className="text-2xl font-bold text-purple-700">Sign in to ProTone</h1>

        {sent ? (
          <p className="text-sm text-gray-700 dark:text-zinc-200">
            ✅ Check your inbox for a sign-in link.
          </p>
        ) : (
          <>
            <label className="text-sm font-semibold text-gray-700 dark:text-zinc-200">
              Email address
            </label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={submit}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl text-lg font-semibold
                         transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              type="button"
            >
              {loading ? "Sending…" : "Email me a sign-in link"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
