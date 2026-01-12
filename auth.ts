// auth.ts
import type { NextAuthOptions } from "next-auth"
import EmailProvider from "next-auth/providers/email"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { Resend } from "resend"
import { getPrisma } from "@/lib/prisma"

function safeEnv(name: string) {
  return process.env[name] ?? ""
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

        async sendVerificationRequest({ identifier, url }) {
          const apiKey = safeEnv("RESEND_API_KEY")
          if (!apiKey) {
            console.error("Missing RESEND_API_KEY (email sign-in will not work).")
            return
          }

          const resend = new Resend(apiKey)

          await resend.emails.send({
            from: safeEnv("EMAIL_FROM") || "ProTone <onboarding@resend.dev>",
            to: identifier,
            subject: "Your ProTone sign-in link",
            html: `
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
