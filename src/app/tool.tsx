"use client";

import type { DragEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import type { CalendarSource, Event, Task, User } from "@/generated/prisma/client";
import { Quadrant, TaskStatus } from "@/generated/prisma/enums";
import { getStableTaskColor } from "@/lib/gantt-colors";
import {
  createTaskAction,
  generateDayPlanAction,
  moveTaskAction,
  toggleTaskAction,
} from "./actions";

const quadrants = [
  {
    id: Quadrant.DO,
    title: "Dringend + Wichtig",
    action: "Sofort erledigen",
    accent: "border-rose-400/30 bg-rose-400/10",
  },
  {
    id: Quadrant.SCHEDULE,
    title: "Wichtig + Nicht dringend",
    action: "Terminieren",
    accent: "border-cyan-400/30 bg-cyan-400/10",
  },
  {
    id: Quadrant.DELEGATE,
    title: "Dringend + Nicht wichtig",
    action: "Delegieren",
    accent: "border-amber-400/30 bg-amber-400/10",
  },
  {
    id: Quadrant.ELIMINATE,
    title: "Nicht dringend + Nicht wichtig",
    action: "Eliminieren",
    accent: "border-white/10 bg-white/[0.04]",
  },
] as const;
type TaskWithRelations = Task & {
  owner: User | null;
  event: Event | null;
};

type EventWithRelations = Event & {
  owner: User | null;
  tasks: Task[];
};

type DashboardEventWithRelations = Event & {
  owner: User | null;
  tasks: Task[];
  calendarSource?: CalendarSource | null;
};

type Props = {
  users: User[];
  tasks: TaskWithRelations[];
  allEvents: DashboardEventWithRelations[];
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M9.55 17.45 4.1 12l1.4-1.4 4.05 4.05 8.95-8.95L19.9 7.1z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMinutesSinceDayStart(value: Date | string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

export function EisenhowerTool({
  users,
  tasks: initialTasks,
  allEvents,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tasks, setTasks] = useState(initialTasks);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverQuadrant, setDragOverQuadrant] = useState<Quadrant | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskQuadrant, setTaskQuadrant] = useState<Quadrant>(Quadrant.DO);
  const [taskOwnerId, setTaskOwnerId] = useState(users[0]?.id ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [planningDate, setPlanningDate] = useState(formatDateInput(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    if (!taskOwnerId && users[0]) {
      setTaskOwnerId(users[0].id);
    }
  }, [users, taskOwnerId]);

  const todayPlan = tasks
    .filter((task) => task.ganttStart && task.ganttEnd)
    .filter((task) => {
      return formatDateInput(new Date(task.ganttStart as Date)) === planningDate;
    })
    .sort((left, right) => {
      return new Date(left.ganttStart ?? 0).getTime() - new Date(right.ganttStart ?? 0).getTime();
    });

  const todayEvents = useMemo(() => {
    const now = new Date();

    return allEvents
      .filter((event) => {
        const startAt = new Date(event.startAt);

        return (
          startAt.getFullYear() === now.getFullYear() &&
          startAt.getMonth() === now.getMonth() &&
          startAt.getDate() === now.getDate()
        );
      })
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  }, [allEvents]);

  const selectedEvent = useMemo(
    () => allEvents.find((event) => event.id === selectedEventId) ?? null,
    [allEvents, selectedEventId]
  );

  function runAction(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function handleCreateTask() {
    runAction(async () => {
      await createTaskAction({
        title: taskTitle,
        quadrant: taskQuadrant,
        estimatedMinutes: Number(estimatedMinutes) || undefined,
        deadlineDate: deadlineDate || undefined,
        ownerId: taskOwnerId || undefined,
      });
      setTaskTitle("");
      setEstimatedMinutes("30");
      setDeadlineDate("");
    });
  }

  function handleGenerateDayPlan() {
    runAction(async () => {
      await generateDayPlanAction(planningDate);
    });
  }

  function handleToggleTask(taskId: string) {
    runAction(async () => {
      await toggleTaskAction(taskId);
    });
  }

  function handleMoveTask(taskId: string, quadrant: Quadrant) {
    runAction(async () => {
      await moveTaskAction(taskId, quadrant);
    });
  }

  function handleDragStart(event: DragEvent<HTMLElement>, taskId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDraggedTaskId(taskId);
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDragOverQuadrant(null);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, quadrantId: Quadrant) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverQuadrant(quadrantId);
  }

  function handleDrop(event: DragEvent<HTMLElement>, quadrantId: Quadrant) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;

    if (taskId) {
      handleMoveTask(taskId, quadrantId);
    }

    setDraggedTaskId(null);
    setDragOverQuadrant(null);
  }

  async function handleSendNavigation(event: EventWithRelations) {
    if (!event.location?.trim()) {
      return;
    }

    const appleMapsUrl = `https://maps.apple.com/?daddr=${encodeURIComponent(event.location)}&dirflg=d`;

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: event.title,
          text: `Navigation zu ${event.title}`,
          url: appleMapsUrl,
        });
        return;
      } catch {
        // Fallback below when share is cancelled or unavailable.
      }
    }

    window.open(appleMapsUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,_#0b1020_0%,_#060912_100%)] pb-28 text-slate-100 lg:pb-0">
      <div className="mx-auto flex min-h-screen max-w-[1800px] min-w-0 flex-col px-4 py-4 lg:flex-row lg:px-6 lg:py-6">
        <AppSidebar activeKey="dashboard" />

        <section className="mt-4 min-w-0 flex-1 lg:mt-0 lg:pl-6">
          <div className="grid gap-4">
            <div className="rounded-[28px] border border-white/10 bg-[#0c1324] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.35)] sm:p-5 md:p-6">
              <div className="border-b border-white/8 pb-4 sm:pb-5">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500 sm:text-sm">
                  Aufgaben anlegen
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[1.3fr_260px]">
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Neue Aufgabe" className="min-w-0 rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40" />
                  <select value={taskQuadrant} onChange={(event) => setTaskQuadrant(event.target.value as Quadrant)} className="min-w-0 rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40">
                    {quadrants.map((quadrant) => (
                      <option key={quadrant.id} value={quadrant.id}>
                        {quadrant.action}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[220px_220px_220px_180px]">
                  <div className="flex items-center rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3">
                    <input value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} inputMode="numeric" placeholder="30" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />
                    <span className="ml-3 shrink-0 text-sm text-slate-500">Minuten</span>
                  </div>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3">
                    <input type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />
                    <span className="ml-3 shrink-0 text-sm text-slate-500">Deadline</span>
                  </div>
                  <select value={taskOwnerId} onChange={(event) => setTaskOwnerId(event.target.value)} className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40">
                    <option value="">Kein User</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={isPending} onClick={handleCreateTask} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2 xl:col-span-1">
                    Aufgabe speichern
                  </button>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-white/8 bg-[#09101f] p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_180px_1fr] xl:items-center">
                  <input type="date" value={planningDate} onChange={(event) => setPlanningDate(event.target.value)} className="min-w-0 rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40" />
                  <button type="button" disabled={isPending} onClick={handleGenerateDayPlan} className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-60">
                    Tagesplan erzeugen
                  </button>
                  <p className="text-sm leading-6 text-slate-400 md:col-span-2 xl:col-span-1">
                    Logik: Priorität nach Eisenhower, 15 Minuten Pause nach 90 Minuten Fokus und Mittagspause von 12:30 bis 13:00.
                  </p>
                </div>
              </div>

              <section className="mt-5 rounded-[28px] border border-white/10 bg-[#09101f] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)] sm:p-5 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500 sm:text-sm">
                      Gantt
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">
                      Tagesaktueller Gantt
                    </h3>
                  </div>
                  <div className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                    {planningDate}
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-[#0c1324]">
                  {todayPlan.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500">
                      Noch kein automatischer Gantt-Vorschlag für den gewählten Tag.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 p-3 sm:p-4 md:hidden">
                        {todayPlan.map((task) => {
                          const taskColor = getStableTaskColor(task.id);

                          return (
                            <article
                              key={task.id}
                              className="rounded-2xl border border-white/10 bg-[#09101f] p-4"
                              style={{ boxShadow: `inset 3px 0 0 ${taskColor.uiBorder}` }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white">
                                    {task.title}
                                  </p>
                                  <p className="mt-2 text-sm text-slate-300">
                                    {formatTime(task.ganttStart as Date)} - {formatTime(task.ganttEnd as Date)}
                                  </p>
                                </div>
                                {task.estimatedMinutes ? (
                                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-300">
                                    {task.estimatedMinutes} Min.
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                                {task.owner ? (
                                  <span className="rounded-full border border-white/10 px-2 py-1">
                                    {task.owner.name}
                                  </span>
                                ) : null}
                                {task.deadlineAt ? (
                                  <span className="rounded-full border border-rose-400/20 px-2 py-1 text-rose-200">
                                    Deadline {formatDate(task.deadlineAt)}
                                  </span>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>

                      <div className="hidden overflow-x-auto md:block">
                        <div className="min-w-[980px]">
                        <div className="border-b border-white/8 bg-[#0b1325]">
                          <div
                            className="grid"
                            style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}
                          >
                            {Array.from({ length: 15 }).map((_, index) => (
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
                          {todayPlan.map((task) => {
                            const startMinutes = getMinutesSinceDayStart(task.ganttStart as Date) - 9 * 60;
                            const endMinutes = getMinutesSinceDayStart(task.ganttEnd as Date) - 9 * 60;
                            const left = Math.max((startMinutes / (15 * 60)) * 100, 0);
                            const width = Math.max(((endMinutes - startMinutes) / (15 * 60)) * 100, 0);
                            const taskColor = getStableTaskColor(task.id);
                            const compactBar = width < 12;
                            const compactLabelOnLeft = compactBar && left > 76;

                            return (
                              <div key={task.id} className="relative h-11 rounded-xl md:h-12">
                                <div
                                  className="absolute inset-y-0 left-0 right-0 grid"
                                  style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}
                                >
                                  {Array.from({ length: 15 }).map((_, index) => (
                                    <div
                                      key={index}
                                      className="border-l border-white/6 first:border-l-0"
                                    />
                                  ))}
                                </div>
                                <div
                                  className="absolute top-1 h-9 rounded-xl md:top-1.5"
                                  style={{
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    border: `1px solid ${taskColor.uiBorder}`,
                                    backgroundColor: taskColor.uiFill,
                                  }}
                                >
                                  <div
                                    className={`relative flex h-full items-center ${
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
                                          <p className="truncate text-[11px] text-cyan-100">
                                            {formatDateTime(task.ganttStart as Date)} - {formatDateTime(task.ganttEnd as Date)}
                                          </p>
                                        </>
                                      ) : (
                                        <div className="rounded-lg border border-white/10 bg-[#09101f] px-2 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)] ring-1 ring-[#09101f]">
                                          <p className="whitespace-nowrap text-xs font-semibold text-white">
                                            {task.title}
                                          </p>
                                          <p className="whitespace-nowrap text-[11px] text-slate-200">
                                            {formatDateTime(task.ganttStart as Date)} - {formatDateTime(task.ganttEnd as Date)}
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
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section className="mt-5 rounded-[28px] border border-white/10 bg-[#09101f] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)] sm:p-5 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500 sm:text-sm">
                      Heutige Termine
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">
                      Alle Termine für heute
                    </h3>
                  </div>
                  <div className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                    {todayEvents.length} Termine
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:gap-4 xl:grid-cols-2">
                  {todayEvents.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500 xl:col-span-2">
                      Heute sind keine Termine geplant.
                    </div>
                  ) : (
                    todayEvents.map((event) => {
                      const departureTime =
                        event.travelMinutes && event.travelMinutes > 0
                          ? new Date(new Date(event.startAt).getTime() - event.travelMinutes * 60_000)
                          : null;

                      return (
                        <article
                          key={event.id}
                          className="min-w-0 rounded-[24px] border border-white/10 bg-[#0c1324] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] sm:p-5"
                        >
                          <p className="break-words text-base font-semibold text-white sm:text-lg">{event.title}</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <p className="text-sm text-slate-300">
                              {formatTime(event.startAt)} - {formatTime(event.endAt)}
                              {departureTime ? ` (Abfahrt ${formatTime(departureTime)})` : ""}
                            </p>
                            <p className="text-sm text-slate-400 sm:text-right">
                              Abfahrt von {event.travelSourceLabel?.trim() || "Zuhause"}
                            </p>
                          </div>
                          <p className="mt-2 break-words text-sm text-slate-400">
                            {event.location?.trim() || "Kein Ort hinterlegt"}
                          </p>

                          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            <button
                              type="button"
                              disabled={!event.location?.trim()}
                              onClick={() => void handleSendNavigation(event)}
                              className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 transition hover:border-cyan-300/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                              Navigation auf Telefon senden
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedEventId(event.id)}
                              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:border-white/20 hover:text-white sm:w-auto"
                            >
                              Details öffnen
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="mt-5 rounded-[28px] border border-white/10 bg-[#09101f] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)] sm:p-5 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500 sm:text-sm">
                      Eisenhower-Matrix
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">
                      Aufgaben priorisieren
                    </h3>
                  </div>
                  <p className="text-sm text-slate-400 sm:max-w-sm sm:text-right">
                    Mobil lassen sich Aufgaben direkt per Button verschieben. Auf Desktop bleibt Drag-and-Drop aktiv.
                  </p>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {quadrants.map((quadrant) => {
                    const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant.id);

                    return (
                      <section
                        key={quadrant.id}
                        onDragOver={(event) => handleDragOver(event, quadrant.id)}
                        onDragLeave={() => setDragOverQuadrant(null)}
                        onDrop={(event) => handleDrop(event, quadrant.id)}
                        className={`rounded-[24px] border p-4 transition sm:p-5 ${quadrant.accent} ${dragOverQuadrant === quadrant.id ? "scale-[1.01] border-cyan-300/50 shadow-[0_0_0_1px_rgba(103,232,249,0.25)]" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-white">{quadrant.title}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-300">{quadrant.action}</p>
                          </div>
                          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                            {quadrantTasks.length}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          {quadrantTasks.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500">
                              Keine Aufgaben in diesem Feld.
                            </div>
                          ) : (
                            quadrantTasks.map((task) => (
                              <article key={task.id} draggable onDragStart={(event) => handleDragStart(event, task.id)} onDragEnd={handleDragEnd} className={`rounded-2xl border border-white/8 bg-[#09101f] p-3 transition sm:p-4 ${draggedTaskId === task.id ? "opacity-50" : ""}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <button type="button" onClick={() => handleToggleTask(task.id)} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${task.status === TaskStatus.DONE ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-white/20 text-transparent"}`} aria-label="Aufgabe umschalten">
                                    <CheckIcon />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    <p className={`break-words text-sm ${task.status === TaskStatus.DONE ? "text-slate-500 line-through" : "text-white"}`}>
                                      {task.title}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                                      {task.estimatedMinutes ? (
                                        <span className="rounded-full border border-white/10 px-2 py-1">
                                          {task.estimatedMinutes} Min.
                                        </span>
                                      ) : null}
                                      {task.deadlineAt ? (
                                        <span className="rounded-full border border-rose-400/20 px-2 py-1 text-rose-200">
                                          Deadline: {formatDate(task.deadlineAt)}
                                        </span>
                                      ) : null}
                                      {task.owner ? <span className="rounded-full border border-white/10 px-2 py-1">{task.owner.name}</span> : null}
                                      {task.ganttStart && task.ganttEnd ? (
                                        <span className="rounded-full border border-cyan-400/20 px-2 py-1 text-cyan-200">
                                          Gantt: {formatDateTime(task.ganttStart)} - {formatDateTime(task.ganttEnd)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  {quadrants.filter((option) => option.id !== task.quadrant).map((option) => (
                                    <button key={option.id} type="button" disabled={isPending} onClick={() => handleMoveTask(task.id, option.id)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-cyan-400/30 hover:text-cyan-200 disabled:opacity-60">
                                      {option.action}
                                    </button>
                                  ))}
                                </div>
                              </article>
                            ))
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>

            </div>
          </div>
        </section>
      </div>

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#020617]/72 p-3 backdrop-blur-sm sm:p-4 md:items-center">
          <div className="max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-white/10 bg-[#0c1324] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:max-h-[calc(100vh-2rem)] sm:p-5 md:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Termin-Details</p>
                <h3 className="mt-2 break-words text-xl font-semibold text-white sm:text-2xl">{selectedEvent.title}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {formatDate(selectedEvent.startAt)} · {formatTime(selectedEvent.startAt)} - {formatTime(selectedEvent.endAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                Schließen
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Zeit</p>
                <p className="mt-2 text-sm text-white">
                  {formatTime(selectedEvent.startAt)} - {formatTime(selectedEvent.endAt)}
                </p>
                {selectedEvent.travelMinutes ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Abfahrt {formatTime(new Date(new Date(selectedEvent.startAt).getTime() - selectedEvent.travelMinutes * 60_000))}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  Von {selectedEvent.travelSourceLabel?.trim() || "Zuhause"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Ort</p>
                <p className="mt-2 text-sm text-white">{selectedEvent.location || "Kein Ort hinterlegt"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Einladungen</p>
                <p className="mt-2 text-sm text-white">{selectedEvent.invites || "Keine Einladungen"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Verantwortlich</p>
                <p className="mt-2 text-sm text-white">{selectedEvent.owner?.name || "Kein User"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-4 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Notizen</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{selectedEvent.notes || "Keine Details hinterlegt"}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
