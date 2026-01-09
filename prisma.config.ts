import path from "path"
import dotenv from "dotenv"
import { defineConfig, env } from "prisma/config"

dotenv.config({ path: path.resolve(process.cwd(), ".env") })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
})
