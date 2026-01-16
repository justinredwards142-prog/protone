// lib/prisma.ts
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function makeClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("Missing DATABASE_URL")

  // PrismaNeon expects a PoolConfig-style object in this version
  const adapter = new PrismaNeon({ connectionString: url })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export function getPrisma() {
  if (global.__prisma) return global.__prisma
  const client = makeClient()
  if (process.env.NODE_ENV !== "production") global.__prisma = client
  return client
}
