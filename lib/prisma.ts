// lib/prisma.ts
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL")

  // Use fetch transport (avoids ws/bufferutil issues on serverless)
  neonConfig.poolQueryViaFetch = true

  const adapter = new PrismaNeon({ connectionString })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

/**
 * Lazy getter so importing this file never connects during build.
 */
export function getPrisma() {
  if (global.__prisma) return global.__prisma
  const client = createPrismaClient()
  if (process.env.NODE_ENV !== "production") global.__prisma = client
  return client
}
