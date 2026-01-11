import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const handler = NextAuth(buildAuthOptions())
  return handler(req as any)
}

export async function POST(req: Request) {
  const handler = NextAuth(buildAuthOptions())
  return handler(req as any)
}
