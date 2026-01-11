// lib/prisma.ts
import { PrismaClient } from "@prisma/client"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Don't construct PrismaClient unless DATABASE_URL exists (prevents build-time crash)
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error("Missing DATABASE_URL")
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

/**
 * Lazy Prisma getter so importing this file never creates a PrismaClient during build.
 */
export function getPrisma() {
  if (global.__prisma) return global.__prisma
  const client = createPrismaClient()
  if (process.env.NODE_ENV !== "production") global.__prisma = client
  return client
}
