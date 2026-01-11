// auth.ts
import type { NextAuthOptions } from "next-auth"
import EmailProvider from "next-auth/providers/email"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"

function safeEnv(name: string) {
  // IMPORTANT: do NOT throw here (build must not crash).
  // Return empty string if missing; runtime will show a useful error in server logs.
  return process.env[name] ?? ""
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  // Do not crash builds if missing; NextAuth will behave oddly if missing,
  // but we’ll keep build green and you’ll set env vars in Vercel.
  secret: safeEnv("NEXTAUTH_SECRET"),

  session: { strategy: "jwt" },

  providers: [
    EmailProvider({
      from: safeEnv("EMAIL_FROM") || "ProTone <onboarding@resend.dev>",

      // We use a custom sender via Resend so we don't need SMTP.
      async sendVerificationRequest({ identifier, url }) {
        const apiKey = safeEnv("RESEND_API_KEY")
        if (!apiKey) {
          console.error("Missing RESEND_API_KEY (email sign-in will not work).")
          return
        }

        const resend = new Resend(apiKey)

        const to = identifier
        const subject = "Your ProTone sign-in link"

        // Keep it simple (and robust)
        const html = `
          <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
            <h2 style="margin:0 0 12px">Sign in to ProTone</h2>
            <p style="margin:0 0 16px">Click the link below to sign in:</p>
            <p style="margin:0 0 16px">
              <a href="${url}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#7c3aed;color:#fff;text-decoration:none">
                Sign in
              </a>
            </p>
            <p style="margin:0;color:#666;font-size:12px">If you didn’t request this, you can ignore this email.</p>
          </div>
        `

        await resend.emails.send({
          from: safeEnv("EMAIL_FROM") || "ProTone <onboarding@resend.dev>",
          to,
          subject,
          html,
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
      // Keep current behavior: session.user.email remains available
      if (session.user && token?.sub) {
        ;(session.user as any).id = token.sub
      }
      return session
    },
  },
}
