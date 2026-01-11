// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, ctx: any) {
  // Create options at request time (avoids build-time evaluation issues)
  const handler = NextAuth(buildAuthOptions())
  return handler(req as any, ctx)
}

export async function POST(req: Request, ctx: any) {
  const handler = NextAuth(buildAuthOptions())
  return handler(req as any, ctx)
}
