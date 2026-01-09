import type { NextAuthOptions } from "next-auth"
import NextAuth from "next-auth"
import EmailProvider from "next-auth/providers/email"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY!)

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  debug: true,

    pages: {
    signIn: "/signin",
  },

  providers: [
    EmailProvider({
      // Dummy SMTP values (required by type, not used)
      server: {
        host: "smtp.resend.com",
        port: 587,
        auth: { user: "resend", pass: "resend" },
      },
      from: process.env.EMAIL_FROM,

      async sendVerificationRequest({ identifier, url }) {
        if (!process.env.RESEND_API_KEY) {
          throw new Error("RESEND_API_KEY is missing")
        }
        if (!process.env.EMAIL_FROM) {
          throw new Error("EMAIL_FROM is missing")
        }

        const resp = await resend.emails.send({
          from: process.env.EMAIL_FROM,
          to: identifier,
          subject: "Sign in to ProTone",
          html: `
            <div style="font-family: system-ui, sans-serif; line-height:1.5">
              <h2>Sign in to ProTone</h2>
              <p>Click the button below to sign in:</p>
              <p style="margin:20px 0">
                <a href="${url}" style="background:#7C3AED;color:white;padding:10px 14px;border-radius:10px;text-decoration:none;display:inline-block;">
                  Sign in
                </a>
              </p>
              <p>If you didn’t request this, you can ignore this email.</p>
            </div>
          `,
        })

        // Resend returns either { id: string } or { error: ... }
        const maybeError = (resp as any)?.error
        if (maybeError) {
          console.error("Resend sendVerificationRequest failed:", maybeError)
          throw new Error(
            typeof maybeError?.message === "string" ? maybeError.message : "Resend failed"
          )
        }
      },
    }),
  ],
}

const handler = NextAuth(authOptions)
export { handler }
