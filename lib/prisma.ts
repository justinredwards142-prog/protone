// lib/prisma.ts
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"

// In Node (Vercel serverless), Neon serverless driver needs ws
import ws from "ws"
neonConfig.webSocketConstructor = ws

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("Missing DATABASE_URL")

  // ✅ IMPORTANT: pass PoolConfig / connectionString into PrismaNeon
  const adapter = new PrismaNeon({ connectionString: url })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export function getPrisma() {
  if (global.__prisma) return global.__prisma
  const client = createPrismaClient()
  if (process.env.NODE_ENV !== "production") global.__prisma = client
  return client
}
