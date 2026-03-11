import { Quadrant, TaskStatus } from "@/generated/prisma/enums";

type PlanTask = {
  id: string;
  title: string;
  quadrant: Quadrant;
  status: TaskStatus;
  estimatedMinutes: number | null;
  deadlineAt: Date | null;
  sortOrder: number;
};

type PlannedEntry = {
  taskId: string;
  start: Date;
  end: Date;
};

const AUTO_GANTT_LANE = "Auto-Tagesplan";

const quadrantPriority: Record<Quadrant, number> = {
  [Quadrant.DO]: 0,
  [Quadrant.SCHEDULE]: 1,
  [Quadrant.DELEGATE]: 2,
  [Quadrant.ELIMINATE]: 3,
};

function setTime(base: Date, hours: number, minutes: number) {
  const next = new Date(base);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function clampEstimate(minutes: number | null) {
  if (!minutes || Number.isNaN(minutes) || minutes <= 0) {
    return 30;
  }

  return Math.min(Math.max(Math.round(minutes), 15), 8 * 60);
}

export function getAutoGanttLane() {
  return AUTO_GANTT_LANE;
}

export function buildDayPlan(tasks: PlanTask[], day: Date): PlannedEntry[] {
  const dayStart = setTime(day, 9, 0);
  const lunchStart = setTime(day, 12, 30);
  const lunchEnd = setTime(day, 13, 0);
  const dayEnd = setTime(day, 24, 0);

  const queue = tasks
    .filter((task) => task.status === TaskStatus.OPEN)
    .filter((task) => clampEstimate(task.estimatedMinutes) > 0)
    .sort((left, right) => {
      const priorityDiff =
        quadrantPriority[left.quadrant] - quadrantPriority[right.quadrant];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const leftDeadline = left.deadlineAt ? new Date(left.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDeadline = right.deadlineAt ? new Date(right.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;

      if (leftDeadline !== rightDeadline) {
        return leftDeadline - rightDeadline;
      }

      return left.sortOrder - right.sortOrder;
    });

  const planned: PlannedEntry[] = [];
  let cursor = dayStart;
  let focusBlockMinutes = 0;

  for (const task of queue) {
    const duration = clampEstimate(task.estimatedMinutes);

    if (cursor < lunchStart && addMinutes(cursor, duration) > lunchStart) {
      cursor = lunchEnd;
      focusBlockMinutes = 0;
    }

    if (focusBlockMinutes >= 90) {
      cursor = addMinutes(cursor, 15);
      focusBlockMinutes = 0;
    }

    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
      focusBlockMinutes = 0;
    }

    const end = addMinutes(cursor, duration);

    if (end > dayEnd) {
      break;
    }

    planned.push({
      taskId: task.id,
      start: cursor,
      end,
    });

    cursor = end;
    focusBlockMinutes += duration;

    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
      focusBlockMinutes = 0;
    }
  }

  return planned;
}
