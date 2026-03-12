import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const dbPath = resolve(process.cwd(), "prisma/dev.db");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

  CREATE TABLE IF NOT EXISTS "CalendarSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7dd3fc',
    "lastSyncedAt" DATETIME,
    "lastSyncStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER,
    "travelMinutes" INTEGER,
    "travelSourceLabel" TEXT,
    "location" TEXT,
    "invites" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "calendarSourceId" TEXT,
    "externalUid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("calendarSourceId") REFERENCES "CalendarSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "quadrant" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "estimatedMinutes" INTEGER,
    "deadlineAt" DATETIME,
    "ownerId" TEXT,
    "eventId" TEXT,
    "ganttStart" DATETIME,
    "ganttEnd" DATETIME,
    "ganttLane" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
`);

const taskColumns = db
  .prepare(`PRAGMA table_info("Task")`)
  .all()
  .map((column) => column.name);

if (!taskColumns.includes("estimatedMinutes")) {
  db.exec(`ALTER TABLE "Task" ADD COLUMN "estimatedMinutes" INTEGER;`);
}

if (!taskColumns.includes("deadlineAt")) {
  db.exec(`ALTER TABLE "Task" ADD COLUMN "deadlineAt" DATETIME;`);
}

const eventColumns = db
  .prepare(`PRAGMA table_info("Event")`)
  .all()
  .map((column) => column.name);

if (!eventColumns.includes("location")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "location" TEXT;`);
}

if (!eventColumns.includes("invites")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "invites" TEXT;`);
}

if (!eventColumns.includes("durationMinutes")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "durationMinutes" INTEGER;`);
}

if (!eventColumns.includes("travelMinutes")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "travelMinutes" INTEGER;`);
}

if (!eventColumns.includes("travelSourceLabel")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "travelSourceLabel" TEXT;`);
}

if (!eventColumns.includes("calendarSourceId")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "calendarSourceId" TEXT;`);
}

if (!eventColumns.includes("externalUid")) {
  db.exec(`ALTER TABLE "Event" ADD COLUMN "externalUid" TEXT;`);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS "Event_calendarSourceId_externalUid_key"
  ON "Event"("calendarSourceId", "externalUid");
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS "CalendarSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7dd3fc',
    "lastSyncedAt" DATETIME,
    "lastSyncStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
`);

db.close();
console.log(`SQLite-Datenbank bereit: ${dbPath}`);
