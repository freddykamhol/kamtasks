import { ensureSeedData } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { EisenhowerTool } from "./tool";

export default async function Home() {
  await ensureSeedData();

  const [users, tasks, allEvents] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.findMany({
      include: {
        owner: true,
        event: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.event.findMany({
      include: {
        owner: true,
        tasks: true,
        calendarSource: true,
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return <EisenhowerTool users={users} tasks={tasks} allEvents={allEvents} />;
}
