// lib/prisma.ts
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { Pool, neonConfig } from "@neondatabase/serverless"
import { WebSocket } from "ws"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var __neonPool: Pool | undefined
}

function makePrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL")

  // Neon serverless config (works in Vercel Node runtime)
  neonConfig.webSocketConstructor = WebSocket
  neonConfig.poolQueryViaFetch = true

  const pool = global.__neonPool ?? new Pool({ connectionString })
  if (process.env.NODE_ENV !== "production") global.__neonPool = pool

  const adapter = new PrismaNeon(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export function getPrisma() {
  if (global.__prisma) return global.__prisma
  const prisma = makePrisma()
  if (process.env.NODE_ENV !== "production") global.__prisma = prisma
  return prisma
}
