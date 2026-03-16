"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  WorkspaceHero,
  WorkspaceShell,
  WorkspaceStatCard,
  WorkspaceStatGrid,
} from "@/components/workspace-shell";
import type { Event, Task, User } from "@/generated/prisma/client";
import { Quadrant } from "@/generated/prisma/enums";
import { getStableTaskColor } from "@/lib/gantt-colors";
import {
  clearTaskScheduleAction,
  generateDayPlanAction,
  setTaskScheduleAction,
} from "../actions";
import { useRouter } from "next/navigation";

type TaskWithRelations = Task & {
  owner: User | null;
  event: Event | null;
};

type Props = {
  tasks: TaskWithRelations[];
  users: User[];
};

const timelineStart = 9 * 60;
const timelineEnd = 24 * 60;
const timelineMinutes = timelineEnd - timelineStart;
const slotSize = 15;
const slotCount = timelineMinutes / slotSize;
const hourCount = (timelineEnd - timelineStart) / 60;
const quadrantSections = [
  {
    key: Quadrant.DO,
    title: "Sofort erledigen",
    accent: "border-rose-400/30 bg-rose-400/10 text-rose-100",
  },
  {
    key: Quadrant.SCHEDULE,
    title: "Terminieren",
    accent: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  },
  {
    key: Quadrant.DELEGATE,
    title: "Delegieren",
    accent: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  {
    key: Quadrant.ELIMINATE,
    title: "Eliminieren",
    accent: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  },
] as const;

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: Date | string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: Date | string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
  }).format(new Date(value));
}

function getMinutesSinceDayStart(value: Date | string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function snapToQuarter(minutes: number) {
  return Math.round(minutes / 15) * 15;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const nextRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + nextRadius, y);
  context.lineTo(x + width - nextRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  context.lineTo(x + width, y + height - nextRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  context.lineTo(x + nextRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  context.lineTo(x, y + nextRadius);
  context.quadraticCurveTo(x, y, x + nextRadius, y);
  context.closePath();
}

export function GanttTool({ tasks }: Props) {
  const router = useRouter();
  const ganttExportRef = useRef<HTMLDivElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [planningDate, setPlanningDate] = useState(formatDateInput(new Date()));
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const dayTasks = useMemo(() => {
    return [...tasks]
      .sort((left, right) => {
        const leftScheduled = left.ganttStart && formatDateInput(new Date(left.ganttStart)) === planningDate;
        const rightScheduled =
          right.ganttStart && formatDateInput(new Date(right.ganttStart)) === planningDate;

        if (leftScheduled !== rightScheduled) {
          return leftScheduled ? -1 : 1;
        }

        return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      })
      .map((task) => {
        const scheduledForDay =
          task.ganttStart &&
          task.ganttEnd &&
          formatDateInput(new Date(task.ganttStart)) === planningDate;

        return {
          ...task,
          scheduledForDay,
        };
      });
  }, [planningDate, tasks]);

  const taskLookup = useMemo(() => {
    return new Map(dayTasks.map((task) => [task.id, task]));
  }, [dayTasks]);

  const scheduledTasks = dayTasks.filter((task) => task.scheduledForDay);
  const unscheduledTasks = dayTasks.filter((task) => !task.scheduledForDay);
  const timelineRows = [
    ...scheduledTasks.map((task) => ({ id: task.id, task })),
    { id: "empty-lane", task: null },
  ];
  const scheduledCount = dayTasks.filter((task) => task.scheduledForDay).length;
  const unscheduledCount = dayTasks.length - scheduledCount;

  function runAction(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function handleGenerateDayPlan() {
    runAction(async () => {
      await generateDayPlanAction(planningDate);
    });
  }

  function handleShiftTask(taskId: string, deltaMinutes: number) {
    const task = taskLookup.get(taskId);

    if (!task?.scheduledForDay || !task.ganttStart) {
      return;
    }

    const startMinute = getMinutesSinceDayStart(task.ganttStart) + deltaMinutes;

    runAction(async () => {
      await setTaskScheduleAction({
        taskId,
        isoDate: planningDate,
        startMinute,
      });
    });
  }

  function handleDragStart(taskId: string) {
    setDraggedTaskId(taskId);
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDragOverLaneId(null);
  }

  function handleDrop(
    taskId: string | null,
    startMinute: number
  ) {
    const activeTaskId = draggedTaskId ?? taskId;
    const activeTask = activeTaskId ? taskLookup.get(activeTaskId) : null;

    if (!activeTask) {
      return;
    }

    const duration = Math.min(Math.max(activeTask.estimatedMinutes ?? 30, 15), 8 * 60);
    const snapped = snapToQuarter(startMinute);
    const clamped = Math.min(Math.max(snapped, timelineStart), timelineEnd - duration);

    runAction(async () => {
      await setTaskScheduleAction({
        taskId: activeTask.id,
        isoDate: planningDate,
        startMinute: clamped,
      });
    });

    setDraggedTaskId(null);
    setDragOverLaneId(null);
  }

  async function handleExport(type: "PDF-Datei" | "Excel" | "JPEG") {
    setIsExportOpen(false);

    if (type !== "JPEG") {
      return;
    }

    const exportNode = ganttExportRef.current;

    if (!exportNode) {
      return;
    }

    const width = Math.max(980, Math.ceil(exportNode.scrollWidth));
    const paddingX = 12;
    const headerHeight = 46;
    const rowHeight = 48;
    const rowGap = 12;
    const footerGap = 12;
    const timelineWidth = width - paddingX * 2;
    const height =
      headerHeight +
      footerGap +
      timelineRows.length * rowHeight +
      Math.max(0, timelineRows.length - 1) * rowGap +
      12;

    const canvas = document.createElement("canvas");
    const scale = window.devicePixelRatio > 1 ? 2 : 1;
    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.scale(scale, scale);
    context.fillStyle = "#09101f";
    context.fillRect(0, 0, width, height);

    drawRoundedRect(context, 0.5, 0.5, width - 1, height - 1, 16);
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = "#0b1325";
    context.fillRect(0, 0, width, headerHeight);

    const hourWidth = timelineWidth / hourCount;
    context.font = '11px sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (let index = 0; index < hourCount; index += 1) {
      const x = paddingX + hourWidth * index;

      if (index > 0) {
        context.strokeStyle = "rgba(255,255,255,0.08)";
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      context.fillStyle = "#64748b";
      context.fillText(`${String(index + 9).padStart(2, "0")}:00`, x + hourWidth / 2, headerHeight / 2);
    }

    timelineRows.forEach((row, rowIndex) => {
      const task = row.task;
      const y = headerHeight + footerGap + rowIndex * (rowHeight + rowGap);
      const barY = y + 6;

      context.strokeStyle = "rgba(255,255,255,0.06)";
      drawRoundedRect(context, paddingX, y, timelineWidth, rowHeight, 12);
      context.stroke();

      if (!task?.scheduledForDay) {
        return;
      }

      const startMinutes = getMinutesSinceDayStart(task.ganttStart as Date) - timelineStart;
      const endMinutes = getMinutesSinceDayStart(task.ganttEnd as Date) - timelineStart;
      const clampedStart = Math.min(Math.max(startMinutes, 0), timelineMinutes);
      const clampedEnd = Math.min(Math.max(endMinutes, 0), timelineMinutes);
      const left = (clampedStart / timelineMinutes) * timelineWidth;
      const barWidth = ((clampedEnd - clampedStart) / timelineMinutes) * timelineWidth;
      const compactBar = (barWidth / timelineWidth) * 100 < 12;
      const compactLabelOnLeft = compactBar && (left / timelineWidth) * 100 > 76;
      const color = getStableTaskColor(task.id);

      drawRoundedRect(context, paddingX + left, barY, barWidth, 36, 10);
      context.fillStyle = color.exportFill;
      context.fill();
      context.strokeStyle = color.exportBorder;
      context.lineWidth = 1;
      context.stroke();

      const timeLabel = `${formatTime(task.ganttStart)} - ${formatTime(task.ganttEnd)}`;

      if (!compactBar) {
        context.fillStyle = "#ffffff";
        context.font = '600 12px sans-serif';
        context.textAlign = "left";
        context.fillText(task.title, paddingX + left + 12, barY + 13);
        context.fillStyle = "#dbeafe";
        context.font = '11px sans-serif';
        context.fillText(timeLabel, paddingX + left + 12, barY + 26);

        if (task.estimatedMinutes) {
          context.textAlign = "right";
          context.fillStyle = "#e2e8f0";
          context.fillText(`${task.estimatedMinutes}m`, paddingX + left + barWidth - 10, barY + 20);
        }
      } else {
        context.font = '600 12px sans-serif';
        const labelPadding = 8;
        const titleWidth = context.measureText(task.title).width;
        context.font = '11px sans-serif';
        const timeWidth = context.measureText(timeLabel).width;
        const labelWidth = Math.max(titleWidth, timeWidth) + labelPadding * 2;
        const labelHeight = 34;
        const labelX = compactLabelOnLeft
          ? paddingX + left - labelWidth - 8
          : paddingX + left + barWidth + 8;
        const labelY = y + 7;

        drawRoundedRect(context, labelX, labelY, labelWidth, labelHeight, 8);
        context.fillStyle = "#09101f";
        context.fill();
        context.strokeStyle = "rgba(255,255,255,0.10)";
        context.stroke();

        context.textAlign = "left";
        context.fillStyle = "#ffffff";
        context.font = '600 12px sans-serif';
        context.fillText(task.title, labelX + labelPadding, labelY + 12);
        context.fillStyle = "#cbd5e1";
        context.font = '11px sans-serif';
        context.fillText(timeLabel, labelX + labelPadding, labelY + 24);
      }
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.download = `kamtasks-gantt-${planningDate}.jpg`;
    link.click();
  }

  return (
    <WorkspaceShell activeKey="gantt">
      <div className="grid gap-4">
        <WorkspaceHero
          eyebrow="Gantt"
          title={`Tagesplanung für ${formatDate(planningDate)}`}
          description="Ziehe Aufgaben direkt aus der Matrix in den Tag, justiere sie im Viertelstundenraster und exportiere den Plan in einem durchgängigen Stil."
          meta={
            <WorkspaceStatGrid>
              <WorkspaceStatCard label="Geplant" value={scheduledCount} tone="cyan" />
              <WorkspaceStatCard label="Wartet" value={unscheduledCount} tone="amber" />
              <WorkspaceStatCard label="Zeitfenster" value={`${hourCount}h`} tone="slate" />
            </WorkspaceStatGrid>
          }
        />

        <div className="grid gap-4">
          <section className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,_rgba(12,19,36,0.96)_0%,_rgba(8,14,27,0.98)_100%)] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.34)] sm:rounded-[30px] sm:p-5 md:p-6">
              <div className="flex flex-col gap-4 border-b border-white/8 pb-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Steuerung</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Raster, Auto-Plan und Export</h3>
                  <p className="mt-2 max-w-xl text-sm text-slate-400">
                    Aufgaben aus den Eisenhower-Feldern in den Plan ziehen. Doppelklick auf einen Block entfernt ihn wieder aus dem Gantt.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400 md:gap-4">
                    <span>{scheduledCount} geplant</span>
                    <span>{unscheduledCount} ungeplant</span>
                    <span>Raster: 15 Minuten</span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_200px_minmax(0,1fr)] xl:min-w-[620px]">
                  <input
                    type="date"
                    value={planningDate}
                    onChange={(event) => setPlanningDate(event.target.value)}
                    className="rounded-xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleGenerateDayPlan}
                    className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60"
                  >
                    Tagesplan erzeugen
                  </button>
                  <div className="relative sm:col-span-2 lg:col-span-1">
                    <button
                      type="button"
                      onClick={() => setIsExportOpen((current) => !current)}
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white transition hover:border-white/20"
                    >
                      <span>Export</span>
                      <span className="text-slate-500">{isExportOpen ? "▴" : "▾"}</span>
                    </button>

                    {isExportOpen ? (
                      <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-xl border border-white/10 bg-[#10192c] shadow-[0_18px_60px_rgba(0,0,0,0.4)] sm:left-auto sm:right-0 sm:min-w-[180px]">
                        {["PDF-Datei", "Excel", "JPEG"].map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              handleExport(label as "PDF-Datei" | "Excel" | "JPEG")
                            }
                            className="block w-full border-b border-white/8 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/5 last:border-b-0"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3 md:hidden">
                {scheduledTasks.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-white/10 bg-[#09101f] px-4 py-6 text-sm text-slate-500">
                    Noch kein geplanter Block für diesen Tag.
                  </div>
                ) : (
                  scheduledTasks.map((task) => (
                    <article
                      key={task.id}
                      className="rounded-[18px] border border-white/10 bg-[#09101f] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.18)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{task.title}</p>
                          <p className="mt-2 text-sm text-slate-300">
                            {formatTime(task.ganttStart)} - {formatTime(task.ganttEnd)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                            {task.estimatedMinutes ? <span>{task.estimatedMinutes} Min.</span> : null}
                            {task.owner ? <span>{task.owner.name}</span> : null}
                            {task.deadlineAt ? <span>{formatDate(task.deadlineAt)}</span> : null}
                          </div>
                        </div>
                        <span
                          className="mt-1 h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: getStableTaskColor(task.id).uiBorder }}
                        />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleShiftTask(task.id, -15)}
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:border-white/20 hover:text-white disabled:opacity-60"
                        >
                          -15 Min.
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleShiftTask(task.id, 15)}
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:border-white/20 hover:text-white disabled:opacity-60"
                        >
                          +15 Min.
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            runAction(async () => {
                              await clearTaskScheduleAction(task.id);
                            })
                          }
                          className="rounded-xl border border-rose-400/20 px-3 py-2 text-xs text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-60"
                        >
                          Aus Gantt
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <div
                ref={ganttExportRef}
                className="mt-4 hidden overflow-hidden rounded-[16px] border border-white/10 bg-[#09101f] md:block"
              >
                <div className="overflow-x-auto">
                  <div className="min-w-[680px] md:min-w-[980px]">
                    <div className="border-b border-white/8 bg-[#0b1325]">
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: `repeat(${hourCount}, minmax(0, 1fr))` }}
                      >
                        {Array.from({ length: hourCount }).map((_, index) => (
                          <div
                            key={index}
                            className="border-l border-white/8 px-2 py-3 text-center text-[11px] uppercase tracking-[0.2em] text-slate-500 first:border-l-0"
                          >
                            {String(index + 9).padStart(2, "0")}:00
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 p-2 md:space-y-3 md:p-3">
                      {timelineRows.map((row) => {
                        const task = row.task;
                        const startMinutes = task?.scheduledForDay
                          ? getMinutesSinceDayStart(task.ganttStart as Date) - timelineStart
                          : 0;
                        const endMinutes = task?.scheduledForDay
                          ? getMinutesSinceDayStart(task.ganttEnd as Date) - timelineStart
                          : 0;
                        const clampedStart = Math.min(Math.max(startMinutes, 0), timelineMinutes);
                        const clampedEnd = Math.min(Math.max(endMinutes, 0), timelineMinutes);
                        const width = task?.scheduledForDay
                          ? ((clampedEnd - clampedStart) / timelineMinutes) * 100
                          : 0;
                        const left = task?.scheduledForDay
                          ? (clampedStart / timelineMinutes) * 100
                          : 0;
                        const taskColor = task ? getStableTaskColor(task.id) : null;
                        const compactBar = width < 12;
                        const compactLabelOnLeft = compactBar && left > 76;

                        return (
                          <div key={row.id}>
                            <div
                              onDragOver={(event) => {
                                event.preventDefault();
                                setDragOverLaneId(row.id);
                              }}
                              onDragLeave={() => setDragOverLaneId(null)}
                              className={`relative h-11 rounded-xl transition md:h-12 ${
                                dragOverLaneId === row.id ? "bg-cyan-300/6" : ""
                              }`}
                            >
                              <div
                                className="absolute inset-y-0 left-0 right-0 grid"
                                style={{ gridTemplateColumns: `repeat(${hourCount}, minmax(0, 1fr))` }}
                              >
                                {Array.from({ length: hourCount }).map((_, index) => (
                                  <div
                                    key={index}
                                    className="border-l border-white/6 first:border-l-0"
                                  />
                                ))}
                              </div>
                              <div
                                className="absolute inset-0 grid"
                                style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
                              >
                                {Array.from({ length: slotCount }).map((_, index) => {
                                  const slotMinute = timelineStart + index * slotSize;

                                  return (
                                    <button
                                      key={index}
                                      type="button"
                                      onDragOver={(event) => {
                                        event.preventDefault();
                                        setDragOverLaneId(row.id);
                                      }}
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        handleDrop(task?.id ?? null, slotMinute);
                                      }}
                                      onClick={() => handleDrop(task?.id ?? null, slotMinute)}
                                      className="border-l border-white/5 first:border-l-0 hover:bg-cyan-300/6"
                                      aria-label={`Plane Aufgabe um ${String(
                                        Math.floor(slotMinute / 60)
                                      ).padStart(2, "0")}:${String(slotMinute % 60).padStart(2, "0")}`}
                                    />
                                  );
                                })}
                              </div>

                              {!task?.scheduledForDay && draggedTaskId ? (
                                <div className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-xs text-cyan-200">
                                  Hier einplanen
                                </div>
                              ) : null}

                              {task?.scheduledForDay ? (
                                <div
                                  draggable
                                  onDragStart={() => handleDragStart(task.id)}
                                  onDragEnd={handleDragEnd}
                                  onDoubleClick={() =>
                                    runAction(async () => {
                                      await clearTaskScheduleAction(task.id);
                                    })
                                  }
                                  className={`absolute top-1 z-10 h-9 rounded-xl transition md:top-1.5 ${
                                    draggedTaskId === task.id ? "opacity-70" : ""
                                  }`}
                                  style={{
                                    width: `${width}%`,
                                    left: `${left}%`,
                                  }}
                                >
                                    <div
                                      className="absolute inset-0 rounded-xl transition"
                                      style={{
                                        border: `1px solid ${taskColor?.uiBorder}`,
                                        backgroundColor: draggedTaskId === task.id ? taskColor?.exportFill.replace("0.22", "0.16") : taskColor?.uiFill,
                                        boxShadow: draggedTaskId === task.id ? taskColor?.uiActive : "none",
                                      }}
                                    />
                                  <div
                                    className={`pointer-events-none relative z-10 flex h-full items-center ${
                                      compactBar ? "justify-center px-2" : "justify-between gap-3 px-3"
                                    }`}
                                  >
                                    <div
                                      className={`min-w-0 ${
                                        compactBar
                                          ? compactLabelOnLeft
                                            ? "absolute right-full mr-2 min-w-max"
                                            : "absolute left-full ml-2 min-w-max"
                                          : ""
                                      }`}
                                    >
                                      {!compactBar ? (
                                        <>
                                          <p className="truncate text-xs font-semibold text-white">
                                            {task.title}
                                          </p>
                                          <p className="truncate text-[11px] text-slate-100">
                                            {formatTime(task.ganttStart)} - {formatTime(task.ganttEnd)}
                                          </p>
                                        </>
                                      ) : (
                                        <div className="rounded-lg border border-white/10 bg-[#09101f] px-2 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)] ring-1 ring-[#09101f]">
                                          <p className="whitespace-nowrap text-xs font-semibold text-white">
                                            {task.title}
                                          </p>
                                          <p className="whitespace-nowrap text-[11px] text-slate-200">
                                            {formatTime(task.ganttStart)} - {formatTime(task.ganttEnd)}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                    {!compactBar && task.estimatedMinutes ? (
                                      <span className="shrink-0 text-[11px] text-slate-200">
                                        {task.estimatedMinutes}m
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[26px] border border-white/10 bg-[#0c1324] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.34)] sm:rounded-[30px] sm:p-5 md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Eisenhower
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    Aufgabenquelle für den Tagesplan
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-400 md:gap-4">
                  <span>{scheduledCount} im Gantt</span>
                  <span>{unscheduledCount} zum Einplanen</span>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {quadrantSections.map((section) => {
                  const quadrantTasks = unscheduledTasks.filter(
                    (task) => task.quadrant === section.key
                  );

                  return (
                    <div
                      key={section.key}
                      className="rounded-[18px] border border-white/10 bg-[#09101f] p-3"
                    >
                      <div className={`rounded-xl border px-3 py-2 text-sm font-medium ${section.accent}`}>
                        {section.title}
                      </div>
                      <div className="mt-3 space-y-2">
                        {quadrantTasks.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-xs text-slate-500">
                            Keine offene Aufgabe
                          </div>
                        ) : (
                          quadrantTasks.map((task) => (
                            <div
                              key={task.id}
                              draggable
                              onDragStart={() => handleDragStart(task.id)}
                              onDragEnd={handleDragEnd}
                              className={`cursor-grab rounded-xl border border-white/8 bg-[#0d1628] px-3 py-2.5 transition active:cursor-grabbing ${
                                draggedTaskId === task.id ? "opacity-50" : "hover:border-cyan-300/30"
                              }`}
                            >
                              <p className="text-sm font-medium text-white">{task.title}</p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                {task.estimatedMinutes ? <span>{task.estimatedMinutes} Min.</span> : null}
                                {task.deadlineAt ? <span>{formatDate(task.deadlineAt)}</span> : null}
                                {task.owner ? <span>{task.owner.name}</span> : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
