import { Quadrant } from "@/generated/prisma/enums";
import { prisma } from "./prisma";

export async function ensureSeedData() {
  const userCount = await prisma.user.count();

  if (userCount > 0) {
    return;
  }

  const owner = await prisma.user.create({
    data: {
      name: "KAM Admin",
      email: "admin@kamtasks.local",
    },
  });

  const planner = await prisma.user.create({
    data: {
      name: "Projektplanung",
      email: "planung@kamtasks.local",
    },
  });

  const roadmapEvent = await prisma.event.create({
    data: {
      title: "Roadmap-Abstimmung",
      startAt: new Date("2026-03-12T09:00:00"),
      endAt: new Date("2026-03-12T10:00:00"),
      ownerId: planner.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "Release-Blocker prüfen",
      quadrant: Quadrant.DO,
      estimatedMinutes: 45,
      deadlineAt: new Date("2026-03-11T00:00:00"),
      ownerId: owner.id,
      sortOrder: 1,
    },
  });

  await prisma.task.create({
    data: {
      title: "Q2-Roadmap planen",
      quadrant: Quadrant.SCHEDULE,
      estimatedMinutes: 120,
      deadlineAt: new Date("2026-03-14T00:00:00"),
      ownerId: planner.id,
      eventId: roadmapEvent.id,
      ganttStart: new Date("2026-03-13T08:00:00"),
      ganttEnd: new Date("2026-03-14T16:00:00"),
      ganttLane: "Planung",
      sortOrder: 2,
    },
  });

  await prisma.task.create({
    data: {
      title: "Meeting-Zusammenfassung delegieren",
      quadrant: Quadrant.DELEGATE,
      estimatedMinutes: 35,
      deadlineAt: new Date("2026-03-12T00:00:00"),
      ownerId: owner.id,
      sortOrder: 3,
    },
  });

  await prisma.task.create({
    data: {
      title: "Alte Slack-Kanäle aufräumen",
      quadrant: Quadrant.ELIMINATE,
      estimatedMinutes: 20,
      deadlineAt: new Date("2026-03-15T00:00:00"),
      ownerId: owner.id,
      sortOrder: 4,
    },
  });
}
