// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const handler = NextAuth(buildAuthOptions())

export { handler as GET, handler as POST }
