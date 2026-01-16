// auth.ts
import type { NextAuthOptions } from "next-auth"
import EmailProvider from "next-auth/providers/email"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { Resend } from "resend"
import { getPrisma } from "@/lib/prisma"
import { enforceRateLimit } from "@/lib/ratelimit"
import type { RLResult } from "@/lib/ratelimit"

function safeEnv(name: string) {
  return process.env[name] ?? ""
}

function normEmail(email: string) {
  return email.trim().toLowerCase()
}

function isBlocked(x: RLResult): x is Extract<RLResult, { ok: false }> {
  return x.ok === false
}

export function buildAuthOptions(): NextAuthOptions {
  const prisma = getPrisma()

  return {
    adapter: PrismaAdapter(prisma),
    secret: safeEnv("NEXTAUTH_SECRET"),
    session: { strategy: "jwt" },

    providers: [
      EmailProvider({
        from: safeEnv("EMAIL_FROM") || "ProTone <onboarding@resend.dev>",

        async sendVerificationRequest(params) {
          const { identifier, url, provider } = params

          // ✅ Rate limit BEFORE sending an email (NextAuth v4 params don't include request/ip)
          const email = normEmail(identifier)

          // Per-email: 3 per 10 minutes
          const rlEmail = await enforceRateLimit(`auth:email:${email}`, {
            limit: 3,
            windowSeconds: 10 * 60,
          })
          if (isBlocked(rlEmail)) {
            console.warn("[auth] rate-limited email", { email })
            return
          }

          // Optional global cap (helps if bots spray many different emails)
          // 100 per 10 minutes total across the app
          const rlGlobal = await enforceRateLimit(`auth:global`, {
            limit: 100,
            windowSeconds: 10 * 60,
          })
          if (isBlocked(rlGlobal)) {
            console.warn("[auth] rate-limited global")
            return
          }

          const apiKey = safeEnv("RESEND_API_KEY")
          if (!apiKey) {
            console.error("Missing RESEND_API_KEY (email sign-in will not work).")
            return
          }

          const resend = new Resend(apiKey)

          const from = (provider as any)?.from || safeEnv("EMAIL_FROM") || "ProTone <onboarding@resend.dev>"
          const subject = "Your ProTone sign-in link"

          await resend.emails.send({
            from,
            to: identifier,
            subject,
            html: `
              <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
                <h2 style="margin:0 0 12px">Sign in to ProTone</h2>
                <p style="margin:0 0 16px">Click the link below to sign in:</p>
                <p style="margin:0 0 16px">
                  <a href="${url}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#7c3aed;color:#fff;text-decoration:none">
                    Sign in
                  </a>
                </p>
                <p style="margin:0;color:#666;font-size:12px">
                  If you didn’t request this, you can ignore this email.
                </p>
              </div>
            `,
          })
        },
      }),
    ],

    pages: {
      signIn: "/signin",
      verifyRequest: "/signin?check=1",
    },

    callbacks: {
      async session({ session, token }) {
        if (session.user && token?.sub) {
          ;(session.user as any).id = token.sub
        }
        return session
      },
    },
  }
}
