import NextAuth from "next-auth"
import { buildAuthOptions } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getAuthHandler() {
  // Construct at request time, not at import/build time
  return NextAuth(buildAuthOptions())
}

export async function GET(req: Request) {
  const handler = getAuthHandler()
  return handler(req)
}

export async function POST(req: Request) {
  const handler = getAuthHandler()
  return handler(req)
}
