import { ensureSeedData } from "@/lib/bootstrap";
import { syncStaleCalendarSources } from "@/lib/calendar-sync";
import { prisma } from "@/lib/prisma";
import { CalendarTool } from "./tool";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  await ensureSeedData();
  await syncStaleCalendarSources();

  const [events, users, calendarSources] = await Promise.all([
    prisma.event.findMany({
      include: {
        owner: true,
        tasks: true,
        calendarSource: true,
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    }),
    prisma.calendarSource.findMany({
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  return <CalendarTool events={events} users={users} calendarSources={calendarSources} />;
}
