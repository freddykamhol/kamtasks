import { ensureSeedData } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { TasksTool } from "./tool";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  await ensureSeedData();

  const [tasks, users] = await Promise.all([
    prisma.task.findMany({
      include: {
        owner: true,
        event: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return <TasksTool tasks={tasks} users={users} />;
}
