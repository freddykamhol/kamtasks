"use server";

import { revalidatePath } from "next/cache";
import { Quadrant, TaskStatus } from "@/generated/prisma/enums";
import { syncCalendarSource, syncStaleCalendarSources } from "@/lib/calendar-sync";
import { buildDayPlan, getAutoGanttLane } from "@/lib/day-planner";
import { getDepartureOriginAddress } from "@/lib/origins";
import { prisma } from "@/lib/prisma";
import { getTravelMinutesBetweenAddresses } from "@/lib/route-service";

type CreateTaskInput = {
  title: string;
  quadrant: Quadrant;
  estimatedMinutes?: number;
  deadlineDate?: string;
  ownerId?: string;
};

type CreateUserInput = {
  name: string;
  email?: string;
};

type CreateEventInput = {
  title: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  travelMinutes?: number;
  travelSourceLabel?: string;
  ownerId?: string;
  location?: string;
  invites?: string;
  notes?: string;
};

type UpdateEventInput = {
  eventId: string;
  title: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  travelMinutes?: number;
  travelSourceLabel?: string;
  ownerId?: string;
  location?: string;
  invites?: string;
  notes?: string;
};

type EventSuggestionInput = {
  isoDate: string;
  durationMinutes?: number;
  location?: string;
  departureOriginKey?: string;
  timeOfDay?: "early_morning" | "morning" | "midday" | "afternoon" | "evening";
};

type TravelEstimateInput = {
  location?: string;
  departureOriginKey?: string;
};

type CreateCalendarSourceInput = {
  name: string;
  url: string;
};

function clampDurationMinutes(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return 60;
  }

  return Math.min(Math.max(Math.round(value), 15), 12 * 60);
}

function resolveEventTiming(startAtInput: string, durationMinutesInput?: number, endAtInput?: string) {
  const startAt = new Date(startAtInput);

  if (Number.isNaN(startAt.getTime())) {
    return null;
  }

  if (endAtInput) {
    const endAt = new Date(endAtInput);

    if (Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      return null;
    }

    const durationMinutes = Math.max(Math.round((endAt.getTime() - startAt.getTime()) / 60_000), 1);
    return { startAt, endAt, durationMinutes };
  }

  const durationMinutes = clampDurationMinutes(durationMinutesInput);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt, durationMinutes };
}

function snapToQuarter(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);

  const minutes = next.getMinutes();
  const remainder = minutes % 15;

  if (remainder !== 0) {
    next.setMinutes(minutes + (15 - remainder));
  }

  return next;
}

function getTimeOfDayWindow(isoDate: string, timeOfDay: EventSuggestionInput["timeOfDay"]) {
  const ranges = {
    early_morning: [6, 8],
    morning: [8, 11],
    midday: [11, 14],
    afternoon: [14, 18],
    evening: [18, 22],
  } as const;
  const [startHour, endHour] = ranges[timeOfDay ?? "morning"];
  const start = new Date(`${isoDate}T00:00:00`);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(`${isoDate}T00:00:00`);
  end.setHours(endHour, 0, 0, 0);
  return { start, end };
}

function formatLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function refreshHome() {
  revalidatePath("/");
  revalidatePath("/gantt");
  revalidatePath("/calendar");
  revalidatePath("/api/calendar/feed");
}

export async function createTaskAction(input: CreateTaskInput) {
  const title = input.title.trim();

  if (!title) {
    return;
  }

  const taskCount = await prisma.task.count();

  await prisma.task.create({
    data: {
      title,
      quadrant: input.quadrant,
      estimatedMinutes: input.estimatedMinutes || null,
      deadlineAt: input.deadlineDate ? new Date(`${input.deadlineDate}T00:00:00`) : null,
      ownerId: input.ownerId || null,
      sortOrder: taskCount + 1,
    },
  });

  refreshHome();
}

export async function generateDayPlanAction(isoDate: string) {
  const day = new Date(`${isoDate}T09:00:00`);

  if (Number.isNaN(day.getTime())) {
    return;
  }

  const startOfDay = new Date(day);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(day);
  endOfDay.setHours(23, 59, 59, 999);

  const tasks = await prisma.task.findMany({
    where: {
      status: TaskStatus.OPEN,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      quadrant: true,
      status: true,
      estimatedMinutes: true,
      deadlineAt: true,
      sortOrder: true,
    },
  });

  const plan = buildDayPlan(tasks, day);
  const lane = getAutoGanttLane();

  await prisma.task.updateMany({
    where: {
      ganttLane: lane,
      ganttStart: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    data: {
      ganttStart: null,
      ganttEnd: null,
      ganttLane: null,
    },
  });

  for (const entry of plan) {
    await prisma.task.update({
      where: { id: entry.taskId },
      data: {
        ganttStart: entry.start,
        ganttEnd: entry.end,
        ganttLane: lane,
      },
    });
  }

  refreshHome();
}

export async function setTaskScheduleAction(input: {
  taskId: string;
  isoDate: string;
  startMinute: number;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      estimatedMinutes: true,
    },
  });

  if (!task) {
    return;
  }

  const duration = Math.min(Math.max(task.estimatedMinutes ?? 30, 15), 8 * 60);
  const clampedStart = Math.min(Math.max(input.startMinute, 9 * 60), 24 * 60 - duration);

  const start = new Date(`${input.isoDate}T00:00:00`);
  start.setHours(0, clampedStart, 0, 0);

  const end = new Date(start.getTime() + duration * 60_000);

  await prisma.task.update({
    where: { id: input.taskId },
    data: {
      ganttStart: start,
      ganttEnd: end,
      ganttLane: getAutoGanttLane(),
    },
  });

  refreshHome();
}

export async function clearTaskScheduleAction(taskId: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      ganttStart: null,
      ganttEnd: null,
      ganttLane: null,
    },
  });

  refreshHome();
}

export async function moveTaskAction(taskId: string, quadrant: Quadrant) {
  await prisma.task.update({
    where: { id: taskId },
    data: { quadrant },
  });

  refreshHome();
}

export async function toggleTaskAction(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (!task) {
    return;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: task.status === TaskStatus.DONE ? TaskStatus.OPEN : TaskStatus.DONE,
    },
  });

  refreshHome();
}

export async function createUserAction(input: CreateUserInput) {
  const name = input.name.trim();
  const email = input.email?.trim();

  if (!name) {
    return;
  }

  await prisma.user.create({
    data: {
      name,
      email: email || null,
    },
  });

  refreshHome();
}

export async function createEventAction(input: CreateEventInput) {
  const title = input.title.trim();

  if (!title || !input.startAt) {
    return;
  }

  const timing = resolveEventTiming(input.startAt, input.durationMinutes, input.endAt);

  if (!timing) {
    return;
  }

  await prisma.event.create({
    data: {
      title,
      startAt: timing.startAt,
      endAt: timing.endAt,
      durationMinutes: timing.durationMinutes,
      travelMinutes: input.travelMinutes ?? null,
      travelSourceLabel: input.travelSourceLabel?.trim() || null,
      ownerId: input.ownerId || null,
      location: input.location?.trim() || null,
      invites: input.invites?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });

  refreshHome();
}

export async function updateEventAction(input: UpdateEventInput) {
  const title = input.title.trim();

  if (!input.eventId || !title || !input.startAt) {
    return;
  }

  const timing = resolveEventTiming(input.startAt, input.durationMinutes, input.endAt);

  if (!timing) {
    return;
  }

  await prisma.event.update({
    where: { id: input.eventId },
    data: {
      title,
      startAt: timing.startAt,
      endAt: timing.endAt,
      durationMinutes: timing.durationMinutes,
      travelMinutes: input.travelMinutes ?? null,
      travelSourceLabel: input.travelSourceLabel?.trim() || null,
      ownerId: input.ownerId || null,
      location: input.location?.trim() || null,
      invites: input.invites?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });

  refreshHome();
}

export async function deleteEventAction(eventId: string) {
  if (!eventId) {
    return;
  }

  await prisma.event.delete({
    where: { id: eventId },
  });

  refreshHome();
}

export async function getEventSuggestionsAction(input: EventSuggestionInput) {
  if (!input.isoDate) {
    return [];
  }

  const durationMinutes = clampDurationMinutes(input.durationMinutes);
  const originAddress = getDepartureOriginAddress(input.departureOriginKey);
  const targetLocation = input.location?.trim() || "";
  const suggestions: Array<{
    startAt: string;
    endAt: string;
    travelMinutes: number;
    sourceLabel: string;
  }> = [];
  const travelLookup = new Map<string, Promise<number>>();

  async function getTravelMinutes(fromAddress: string, toAddress: string) {
    const cacheKey = `${fromAddress}__${toAddress}`;
    const cached = travelLookup.get(cacheKey);

    if (cached) {
      return cached;
    }

    const nextLookup = getTravelMinutesBetweenAddresses(fromAddress, toAddress);
    travelLookup.set(cacheKey, nextLookup);
    return nextLookup;
  }

  let previousEvent:
    | {
        endAt: Date;
        location: string | null;
      }
    | null = null;

  const travelFromOrigin = targetLocation
    ? await getTravelMinutes(originAddress, targetLocation)
    : 0;

  for (let dayOffset = 0; dayOffset < 7 && suggestions.length < 3; dayOffset += 1) {
    const lookupDate = new Date(`${input.isoDate}T00:00:00`);
    lookupDate.setDate(lookupDate.getDate() + dayOffset);
    const lookupIsoDate = formatLocalDateKey(lookupDate);
    const { start: dayStart, end: dayEnd } = getTimeOfDayWindow(lookupIsoDate, input.timeOfDay);

    const existingEvents = await prisma.event.findMany({
      where: {
        startAt: {
          lte: dayEnd,
        },
        endAt: {
          gte: dayStart,
        },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        travelMinutes: true,
      },
    });

    previousEvent = null;
    const baseCandidates = [...existingEvents, null];

    for (const nextEvent of baseCandidates) {
      const previousLocation = previousEvent?.location?.trim() || "";
      const [travelFromPrevious, travelPreviousToOrigin] = previousLocation
        ? await Promise.all([
            targetLocation ? getTravelMinutes(previousLocation, targetLocation) : Promise.resolve(0),
            getTravelMinutes(previousLocation, originAddress),
          ])
        : [travelFromOrigin, 0];
      const previousBufferMinutes = previousEvent ? 15 : 0;
      const previousEndAt = previousEvent ? new Date(previousEvent.endAt) : null;

      const earliestDirectStart = previousEndAt
        ? snapToQuarter(
            new Date(
              previousEndAt.getTime() + (previousBufferMinutes + travelFromPrevious) * 60_000
            )
          )
        : snapToQuarter(new Date(dayStart.getTime() + travelFromOrigin * 60_000));
      const earliestHomeStart = previousEndAt
        ? snapToQuarter(
            new Date(
              previousEndAt.getTime() +
                (previousBufferMinutes + travelPreviousToOrigin + travelFromOrigin) * 60_000
            )
          )
        : snapToQuarter(new Date(dayStart.getTime() + travelFromOrigin * 60_000));

      let candidateStart = new Date(earliestDirectStart);
      const nextStart = nextEvent ? new Date(nextEvent.startAt) : dayEnd;
      const latestAllowedEnd = new Date(nextStart.getTime() - (nextEvent ? 15 : 0) * 60_000);

      while (suggestions.length < 3) {
        const mustLeaveFromPrevious =
          Boolean(previousEndAt && previousLocation) && candidateStart < earliestHomeStart;
        const travelMinutes = mustLeaveFromPrevious ? travelFromPrevious : travelFromOrigin;
        const sourceLabel = mustLeaveFromPrevious ? previousLocation : originAddress;
        const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60_000);

        if (candidateEnd > latestAllowedEnd || candidateEnd > dayEnd) {
          break;
        }

        suggestions.push({
          startAt: candidateStart.toISOString(),
          endAt: candidateEnd.toISOString(),
          travelMinutes,
          sourceLabel,
        });

        candidateStart = new Date(candidateStart.getTime() + 15 * 60_000);
      }

      if (nextEvent) {
        previousEvent = {
          endAt: new Date(nextEvent.endAt),
          location: nextEvent.location,
        };
      }

      if (suggestions.length >= 3) {
        break;
      }
    }
  }

  return suggestions.slice(0, 3);
}

export async function getTravelEstimateAction(input: TravelEstimateInput) {
  const sourceLabel = getDepartureOriginAddress(input.departureOriginKey);
  const targetLocation = input.location?.trim() || "";

  if (!targetLocation) {
    return {
      travelMinutes: 0,
      sourceLabel,
    };
  }

  const travelMinutes = await getTravelMinutesBetweenAddresses(sourceLabel, targetLocation);

  return {
    travelMinutes,
    sourceLabel,
  };
}

function normalizeHexColor(color: string) {
  const trimmed = color.trim();

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }

  return "#7dd3fc";
}

export async function createCalendarSourceAction(input: CreateCalendarSourceInput) {
  const name = input.name.trim();
  const url = input.url.trim();

  if (!name || !url) {
    return;
  }

  const source = await prisma.calendarSource.create({
    data: {
      name,
      url,
    },
  });

  await syncCalendarSource(source.id);
  refreshHome();
}

export async function updateCalendarSourceColorAction(input: { sourceId: string; color: string }) {
  if (!input.sourceId) {
    return;
  }

  await prisma.calendarSource.update({
    where: { id: input.sourceId },
    data: {
      color: normalizeHexColor(input.color),
    },
  });

  refreshHome();
}

export async function deleteCalendarSourceAction(sourceId: string) {
  if (!sourceId) {
    return;
  }

  await prisma.calendarSource.delete({
    where: { id: sourceId },
  });

  refreshHome();
}

export async function syncCalendarSourceAction(sourceId: string) {
  if (!sourceId) {
    return;
  }

  await syncCalendarSource(sourceId);
  refreshHome();
}

export async function syncCalendarSourcesIfNeededAction() {
  await syncStaleCalendarSources();
  refreshHome();
}
