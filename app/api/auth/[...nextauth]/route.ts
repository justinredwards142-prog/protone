import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"

export const runtime = "nodejs"

const handler = NextAuth(buildAuthOptions())

export { handler as GET, handler as POST }
