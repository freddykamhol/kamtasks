import { ensureSeedData } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { GanttTool } from "./tool";

export default async function GanttPage() {
  await ensureSeedData();

  const [tasks, users] = await Promise.all([
    prisma.task.findMany({
      include: {
        owner: true,
        event: true,
      },
      orderBy: [{ ganttStart: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return <GanttTool tasks={tasks} users={users} />;
}
