import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  adapter?: PrismaBetterSqlite3;
};

const databasePath = path.join(process.cwd(), "prisma", "dev.db");
const adapter =
  globalForPrisma.adapter ??
  new PrismaBetterSqlite3({
    url: databasePath,
  });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.adapter = adapter;
}
