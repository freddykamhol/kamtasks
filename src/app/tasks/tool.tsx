"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  WorkspaceHero,
  WorkspaceShell,
  WorkspaceStatCard,
  WorkspaceStatGrid,
} from "@/components/workspace-shell";
import type { Event, Task, User } from "@/generated/prisma/client";
import { Quadrant, TaskStatus } from "@/generated/prisma/enums";
import {
  createTaskAction,
  deleteTaskAction,
  moveTaskAction,
  toggleTaskAction,
} from "../actions";

type TaskWithRelations = Task & {
  owner: User | null;
  event: Event | null;
};

type Props = {
  users: User[];
  tasks: TaskWithRelations[];
};

const quadrants: Array<{
  id: Quadrant;
  title: string;
  description: string;
  accent: string;
  glow: string;
  text: string;
}> = [
  {
    id: Quadrant.DO,
    title: "Dringend + Wichtig",
    description: "Sofort greifen und Fokus rein.",
    accent: "border-rose-400/25 bg-rose-400/[0.08]",
    glow: "shadow-[0_18px_60px_rgba(251,113,133,0.10)]",
    text: "text-rose-200",
  },
  {
    id: Quadrant.SCHEDULE,
    title: "Wichtig + Nicht dringend",
    description: "Strategisch planen und sauber terminieren.",
    accent: "border-cyan-400/25 bg-cyan-400/[0.08]",
    glow: "shadow-[0_18px_60px_rgba(34,211,238,0.10)]",
    text: "text-cyan-200",
  },
  {
    id: Quadrant.DELEGATE,
    title: "Dringend + Nicht wichtig",
    description: "Abgeben oder schlank erledigen.",
    accent: "border-amber-300/25 bg-amber-300/[0.08]",
    glow: "shadow-[0_18px_60px_rgba(252,211,77,0.10)]",
    text: "text-amber-100",
  },
  {
    id: Quadrant.ELIMINATE,
    title: "Nicht dringend + Nicht wichtig",
    description: "Raus aus dem Kopf, weg aus dem System.",
    accent: "border-white/10 bg-white/[0.03]",
    glow: "shadow-[0_18px_60px_rgba(255,255,255,0.04)]",
    text: "text-slate-200",
  },
] as const;

const focusWeights: Record<Quadrant, number> = {
  [Quadrant.DO]: 5,
  [Quadrant.SCHEDULE]: 4,
  [Quadrant.DELEGATE]: 2,
  [Quadrant.ELIMINATE]: 1,
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

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="m12 2 1.85 5.15L19 9l-5.15 1.85L12 16l-1.85-5.15L5 9l5.15-1.85L12 2Zm6.5 13 1 2.5L22 18.5 19.5 19.5l-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5ZM5.5 14 6.7 17l3 1.2-3 1.2L5.5 22l-1.2-2.6-3-1.2 3-1.2L5.5 14Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 11h12l1-13H5l1 13Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M7 12h10M13 8l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function getQuadrantMeta(quadrant: Quadrant) {
  return quadrants.find((entry) => entry.id === quadrant) ?? quadrants[0];
}

export function TasksTool({ users, tasks: initialTasks }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tasks, setTasks] = useState(initialTasks);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskQuadrant, setTaskQuadrant] = useState<Quadrant>(Quadrant.DO);
  const [taskOwnerId, setTaskOwnerId] = useState(users[0]?.id ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [isFocusRolling, setIsFocusRolling] = useState(false);
  const focusRollRef = useRef<number | null>(null);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    if (!taskOwnerId && users[0]) {
      setTaskOwnerId(users[0].id);
    }
  }, [taskOwnerId, users]);

  useEffect(() => {
    return () => {
      if (focusRollRef.current) {
        window.clearInterval(focusRollRef.current);
      }
    };
  }, []);

  const openTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status === TaskStatus.OPEN)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }, [tasks]);

  const doneTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status === TaskStatus.DONE)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [tasks]);

  const focusPool = useMemo(() => {
    return openTasks.flatMap((task) => {
      return Array.from({ length: focusWeights[task.quadrant] }, () => task.id);
    });
  }, [openTasks]);

  const focusTask = useMemo(() => {
    return openTasks.find((task) => task.id === focusTaskId) ?? null;
  }, [focusTaskId, openTasks]);

  const completionRate = tasks.length === 0 ? 0 : Math.round((doneTasks.length / tasks.length) * 100);

  useEffect(() => {
    if (!focusTaskId && openTasks[0]) {
      setFocusTaskId(openTasks[0].id);
      return;
    }

    if (focusTaskId && !openTasks.some((task) => task.id === focusTaskId)) {
      setFocusTaskId(openTasks[0]?.id ?? null);
    }
  }, [focusTaskId, openTasks]);

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

  function handleToggleTask(taskId: string) {
    runAction(async () => {
      await toggleTaskAction(taskId);
    });
  }

  function handleDeleteTask(taskId: string) {
    runAction(async () => {
      await deleteTaskAction(taskId);

      if (focusTaskId === taskId) {
        setFocusTaskId(null);
      }
    });
  }

  function handleMoveTask(taskId: string, quadrant: Quadrant) {
    runAction(async () => {
      await moveTaskAction(taskId, quadrant);
    });
  }

  function handleFocusMission() {
    if (focusPool.length === 0 || isFocusRolling) {
      return;
    }

    if (focusRollRef.current) {
      window.clearInterval(focusRollRef.current);
    }

    setIsFocusRolling(true);
    let steps = 0;
    const maxSteps = 14 + Math.floor(Math.random() * 8);

    focusRollRef.current = window.setInterval(() => {
      const nextId = focusPool[Math.floor(Math.random() * focusPool.length)] ?? openTasks[0]?.id ?? null;
      steps += 1;
      setFocusTaskId(nextId);

      if (steps >= maxSteps) {
        if (focusRollRef.current) {
          window.clearInterval(focusRollRef.current);
          focusRollRef.current = null;
        }

        setFocusTaskId(
          focusPool[Math.floor(Math.random() * focusPool.length)] ?? openTasks[0]?.id ?? null
        );
        setIsFocusRolling(false);
      }
    }, 90);
  }

  return (
    <WorkspaceShell activeKey="tasks">
      <div className="grid gap-4">
        <WorkspaceHero
          eyebrow="Aufgaben"
          title="Checklisten-Matrix"
          description="Offene Aufgaben liegen sauber in ihrer Eisenhower-Zone, erledigte Dinge wandern ins Archiv und der Fokus bleibt trotzdem jederzeit spielerisch steuerbar."
          meta={
            <WorkspaceStatGrid>
              <WorkspaceStatCard label="Offen" value={openTasks.length} tone="cyan" />
              <WorkspaceStatCard label="Erledigt" value={doneTasks.length} tone="emerald" />
              <WorkspaceStatCard label="Quote" value={`${completionRate}%`} tone="amber" />
            </WorkspaceStatGrid>
          }
        />

        <div className="grid gap-4">
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_380px]">
              <section className="min-w-0 rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,_rgba(12,19,36,0.96)_0%,_rgba(8,14,27,0.98)_100%)] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.34)] sm:rounded-[30px] sm:p-5 md:p-6">
                <div className="flex flex-col gap-5 border-b border-white/8 pb-5">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Neue Aufgabe</p>
                    <h3 className="mt-3 text-2xl font-semibold text-white sm:text-[2rem]">
                      Schnell erfassen und direkt einsortieren
                    </h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                      Jede Aufgabe landet sofort in der passenden Zone und bleibt später ohne Reibung verschiebbar, abhakbar oder löschbar.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 2xl:grid-cols-[minmax(0,1.35fr)_240px]">
                  <input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="Welche Aufgabe soll rein?"
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                  />
                  <select
                    value={taskQuadrant}
                    onChange={(event) => setTaskQuadrant(event.target.value as Quadrant)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    {quadrants.map((quadrant) => (
                      <option key={quadrant.id} value={quadrant.id}>
                        {quadrant.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-[220px_220px_minmax(0,1fr)_auto]">
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 max-[380px]:flex-col max-[380px]:items-start">
                    <input
                      value={estimatedMinutes}
                      onChange={(event) => setEstimatedMinutes(event.target.value)}
                      inputMode="numeric"
                      placeholder="30"
                      className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <span className="shrink-0 text-sm text-slate-500 max-[380px]:ml-0">Min.</span>
                  </div>
                  <input
                    type="date"
                    value={deadlineDate}
                    onChange={(event) => setDeadlineDate(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                  <select
                    value={taskOwnerId}
                    onChange={(event) => setTaskOwnerId(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    <option value="">Kein User</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={isPending || !taskTitle.trim()}
                    onClick={handleCreateTask}
                    className="w-full rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60 md:col-span-2 2xl:col-span-1 2xl:w-auto"
                  >
                    Aufgabe anlegen
                  </button>
                </div>
              </section>

              <section className="relative min-w-0 overflow-hidden rounded-[26px] border border-amber-300/18 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_rgba(15,23,42,0.95)_44%,_rgba(4,8,15,1)_100%)] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.34)] sm:rounded-[30px] sm:p-5 md:p-6">
                <div className="absolute inset-x-[-18%] top-[-18%] h-48 rounded-full bg-amber-300/14 blur-3xl" />
                <div className="absolute bottom-[-18%] right-[-8%] h-52 w-52 rounded-full bg-cyan-300/10 blur-3xl" />

                <div className="relative min-w-0">
                  <div className="flex items-center gap-3 max-[380px]:items-start">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200/20 bg-amber-200/10 text-amber-100">
                      <SparkIcon />
                    </span>
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-amber-100/70">Gimmick</p>
                      <h3 className="mt-2 text-xl font-semibold text-white">Prioritäts-Blitz</h3>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    Ein Klick und die Seite zieht dir spielerisch die nächste Mission aus den offenen Aufgaben. Dringende und wichtige Dinge werden dabei stärker gewichtet.
                  </p>

                  <button
                    type="button"
                    disabled={isPending || isFocusRolling || openTasks.length === 0}
                    onClick={handleFocusMission}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/12 px-4 py-3 text-sm font-medium text-amber-50 transition hover:bg-amber-200/18 disabled:opacity-60 sm:w-auto"
                  >
                    <SparkIcon />
                    {isFocusRolling ? "scannt Mission..." : "Mission ziehen"}
                  </button>

                  <div
                    className={`mt-5 rounded-[26px] border px-5 py-5 transition ${
                      focusTask
                        ? "border-amber-200/28 bg-[#0b1020]/80 shadow-[0_0_0_1px_rgba(253,224,71,0.06)]"
                        : "border-white/10 bg-[#0b1020]/70"
                    }`}
                  >
                    {focusTask ? (
                      <>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${getQuadrantMeta(focusTask.quadrant).accent} ${getQuadrantMeta(focusTask.quadrant).text}`}>
                            {getQuadrantMeta(focusTask.quadrant).title}
                          </span>
                          <span className="text-xs text-slate-500">
                            Gewicht {focusWeights[focusTask.quadrant]}x
                          </span>
                        </div>

                        <p className="mt-4 text-2xl font-semibold text-white">
                          {focusTask.title}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-slate-300">
                          {getQuadrantMeta(focusTask.quadrant).description}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                          {focusTask.owner ? (
                            <span className="rounded-full border border-white/10 px-3 py-1">
                              {focusTask.owner.name}
                            </span>
                          ) : null}
                          {focusTask.estimatedMinutes ? (
                            <span className="rounded-full border border-white/10 px-3 py-1">
                              {focusTask.estimatedMinutes} Min.
                            </span>
                          ) : null}
                          {focusTask.deadlineAt ? (
                            <span className="rounded-full border border-white/10 px-3 py-1">
                              Deadline {formatDate(focusTask.deadlineAt)}
                            </span>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500">
                        Keine offene Mission mehr. Zeit für einen kurzen Siegertanz.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {quadrants.map((quadrant) => {
                const quadrantTasks = openTasks.filter((task) => task.quadrant === quadrant.id);

                return (
                  <section
                    key={quadrant.id}
                    className={`min-w-0 rounded-[26px] border p-4 ${quadrant.accent} ${quadrant.glow} sm:rounded-[30px] sm:p-5 md:p-6`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className={`text-xs uppercase tracking-[0.3em] ${quadrant.text}`}>Eisenhower</p>
                        <h3 className="mt-2 text-xl font-semibold text-white">{quadrant.title}</h3>
                        <p className="mt-2 text-sm text-slate-400">{quadrant.description}</p>
                      </div>
                      <span className="w-fit rounded-full border border-white/10 bg-[#09101f] px-3 py-1 text-xs text-slate-300">
                        {quadrantTasks.length} offen
                      </span>
                    </div>

                    <div className="mt-5 space-y-3">
                      {quadrantTasks.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-white/10 bg-[#09101f] px-4 py-8 text-sm text-slate-500">
                          Hier ist gerade Luft. Das ist gut für Fokus.
                        </div>
                      ) : (
                        quadrantTasks.map((task) => {
                          const spotlight = focusTaskId === task.id;

                          return (
                            <article
                              key={task.id}
                              onClick={() => setFocusTaskId(task.id)}
                              className={`min-w-0 rounded-[24px] border bg-[#09101f] p-4 transition ${
                                spotlight
                                  ? "border-amber-300/45 shadow-[0_0_0_1px_rgba(253,224,71,0.14),0_18px_46px_rgba(245,158,11,0.12)]"
                                  : "border-white/8 hover:border-white/16"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleToggleTask(task.id);
                                  }}
                                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-transparent transition hover:border-emerald-300 hover:text-emerald-300"
                                  aria-label="Aufgabe abhaken"
                                >
                                  <CheckIcon />
                                </button>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className={`break-words text-base font-medium ${spotlight ? "text-amber-50" : "text-white"}`}>
                                        {task.title}
                                      </p>
                                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                                        {task.estimatedMinutes ? (
                                          <span className="rounded-full border border-white/10 px-3 py-1">
                                            {task.estimatedMinutes} Min.
                                          </span>
                                        ) : null}
                                        {task.deadlineAt ? (
                                          <span className="rounded-full border border-white/10 px-3 py-1">
                                            Deadline {formatDate(task.deadlineAt)}
                                          </span>
                                        ) : null}
                                        {task.owner ? (
                                          <span className="rounded-full border border-white/10 px-3 py-1">
                                            {task.owner.name}
                                          </span>
                                        ) : null}
                                        {task.event ? (
                                          <span className="rounded-full border border-white/10 px-3 py-1">
                                            Termin: {task.event.title}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDeleteTask(task.id);
                                      }}
                                      className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] text-rose-200 transition hover:bg-rose-400/[0.10] sm:self-auto"
                                      aria-label="Aufgabe löschen"
                                    >
                                      <TrashIcon />
                                    </button>
                                  </div>

                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {quadrants
                                      .filter((option) => option.id !== task.quadrant)
                                      .map((option) => (
                                        <button
                                          key={option.id}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            handleMoveTask(task.id, option.id);
                                          }}
                                          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-200"
                                        >
                                          <ArrowIcon />
                                          {option.title}
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="min-w-0 rounded-[26px] border border-emerald-300/18 bg-[linear-gradient(180deg,_rgba(12,19,36,0.98)_0%,_rgba(8,14,27,1)_100%)] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.30)] sm:rounded-[30px] sm:p-5 md:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">Erledigt</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Archivierte Haken</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    Sauber getrennt von den offenen Aufgaben, aber mit einem Klick wieder aktiv.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-emerald-300/18 bg-emerald-300/[0.08] px-3 py-1 text-xs text-emerald-100">
                  {doneTasks.length} abgeschlossen
                </span>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {doneTasks.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-[#09101f] px-4 py-8 text-sm text-slate-500 lg:col-span-2">
                    Noch keine erledigten Aufgaben. Das wird hier später sehr befriedigend aussehen.
                  </div>
                ) : (
                  doneTasks.map((task) => (
                    <article
                      key={task.id}
                      className="min-w-0 rounded-[24px] border border-emerald-300/12 bg-[#09101f] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleTask(task.id)}
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400 bg-emerald-400 text-slate-950"
                          aria-label="Aufgabe wieder öffnen"
                        >
                          <CheckIcon />
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="break-words text-base font-medium text-slate-400 line-through">
                                {task.title}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                                <span className="rounded-full border border-white/10 px-3 py-1">
                                  {getQuadrantMeta(task.quadrant).title}
                                </span>
                                {task.owner ? (
                                  <span className="rounded-full border border-white/10 px-3 py-1">
                                    {task.owner.name}
                                  </span>
                                ) : null}
                                {task.deadlineAt ? (
                                  <span className="rounded-full border border-white/10 px-3 py-1">
                                    Deadline {formatDate(task.deadlineAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] text-rose-200 transition hover:bg-rose-400/[0.10] sm:self-auto"
                              aria-label="Aufgabe dauerhaft löschen"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
    </WorkspaceShell>
  );
}
