"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const navigationItems = [
  { label: "Dashboard", href: "/", key: "dashboard" },
  { label: "Aufgaben", href: "/", key: "tasks" },
  { label: "Gantt", href: "/gantt", key: "gantt" },
  { label: "Kalender", href: "/calendar", key: "calendar" },
  { label: "Einstellungen", href: "/", key: "settings" },
] as const;

type SidebarKey = (typeof navigationItems)[number]["key"];

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="currentColor" />
    </svg>
  );
}

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

function GanttIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4 6h7v3H4zm9 0h7v3h-7zM4 11h12v3H4zm14 0h2v3h-2zM4 16h5v3H4zm7 0h9v3h-9z"
        fill="currentColor"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path d="M7 2h2v3h6V2h2v3h3v17H4V5h3zm11 7H6v11h12z" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="m19.43 12.98 1.34-1.03-1.28-2.22-1.63.34a6.97 6.97 0 0 0-1.17-.68L16.5 7.7l-2.5-.42-.67 1.53c-.4-.04-.78-.04-1.18 0l-.67-1.53-2.5.42-.19 1.69c-.42.18-.82.4-1.19.68l-1.62-.34-1.28 2.22 1.34 1.03a7.4 7.4 0 0 0 0 1.36l-1.34 1.03 1.28 2.22 1.62-.34c.37.28.77.5 1.2.68l.18 1.69 2.5.42.67-1.53c.4.04.78.04 1.18 0l.67 1.53 2.5-.42.19-1.69c.42-.18.82-.4 1.18-.68l1.63.34 1.28-2.22-1.34-1.03c.05-.45.05-.91 0-1.36M12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5"
        fill="currentColor"
      />
    </svg>
  );
}

const icons = [GridIcon, CheckIcon, GanttIcon, CalendarIcon, SettingsIcon];
const expandedWidth = "lg:w-[284px] lg:min-w-[284px]";
const collapsedWidth = "lg:w-[104px] lg:min-w-[104px]";

export function AppSidebar({ activeKey }: { activeKey: SidebarKey }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem("kamtasks-sidebar-collapsed") === "true";
  });

  useEffect(() => {
    window.localStorage.setItem("kamtasks-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  return (
    <>
      <aside
        className={`hidden flex-col rounded-[28px] border border-white/10 bg-[#0c1324] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] transition-all duration-300 lg:flex lg:min-h-[calc(100vh-3rem)] ${
          collapsed ? collapsedWidth : expandedWidth
        }`}
      >
        <div
          className={`rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,_#0b1020_0%,_#080d19_100%)] ${
            collapsed ? "px-3 py-4" : "px-4 py-4"
          }`}
        >
          <div className={`flex ${collapsed ? "flex-col items-center gap-3" : "items-start justify-between gap-3"}`}>
            <div className={`min-w-0 ${collapsed ? "flex flex-col items-center text-center" : ""}`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-sm font-semibold tracking-[0.18em] text-cyan-100 shadow-[0_10px_30px_rgba(34,211,238,0.12)]">
                KA
              </div>
              <div className={collapsed ? "mt-3" : "mt-4"}>
                <p className={`text-[11px] uppercase tracking-[0.35em] text-slate-500 ${collapsed ? "lg:hidden" : ""}`}>
                  Navigation
                </p>
                <h1 className={`mt-2 font-semibold tracking-[0.12em] text-white ${collapsed ? "text-sm" : "text-2xl"}`}>
                  {collapsed ? "KAM" : "KAMTasks"}
                </h1>
                <p className={`mt-2 text-sm text-slate-400 ${collapsed ? "hidden" : ""}`}>
                  Planung, Matrix und Gantt an einem Ort.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-cyan-400/20 hover:text-white"
              aria-label="Sidebar ein- oder ausklappen"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                <path
                  d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className={`mt-6 ${collapsed ? "lg:hidden" : ""}`}>
          <p className="px-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
            Arbeitsbereiche
          </p>
        </div>

        <nav className={`mt-4 space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
          {navigationItems.map((item, index) => {
            const Icon = icons[index];
            const active = item.key === activeKey;

            return (
              <Link
                key={item.key}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center rounded-2xl border text-left transition ${
                  active
                    ? "border-cyan-400/25 bg-cyan-400/10 text-white"
                    : "border-white/8 bg-white/[0.02] text-slate-300 hover:border-white/15 hover:bg-white/[0.05]"
                } ${
                  collapsed
                    ? "h-[76px] w-[72px] flex-col justify-center gap-2 px-0 py-0"
                    : "w-full gap-4 px-4 py-3"
                }`}
              >
                {active ? (
                  <span className={`absolute bg-cyan-300 ${collapsed ? "left-1/2 top-0 h-1 w-10 -translate-x-1/2 rounded-b-full" : "left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full"}`} />
                ) : null}
                <span className={`flex items-center justify-center rounded-2xl transition ${active ? "bg-cyan-300/14 text-cyan-100" : "bg-white/6 group-hover:bg-white/10"} ${collapsed ? "h-11 w-11" : "h-11 w-11"}`}>
                  <Icon />
                </span>
                <span
                  className={`tracking-[0.04em] ${collapsed ? "text-[11px] font-medium text-slate-400" : "text-sm font-medium"}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={`mt-auto rounded-[24px] border border-white/10 bg-[#0a0f1d] p-5 ${
            collapsed ? "hidden" : ""
          }`}
        >
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            System
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            SQLite und Prisma laufen direkt im Projekt. Das hält das Deployment
            für Node-fähige Webspaces schlank und ohne externe Datenbank.
          </p>
        </div>
      </aside>

      <nav className="fixed inset-x-3 bottom-3 z-40 rounded-[24px] border border-white/10 bg-[rgba(8,13,25,0.92)] p-2 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-5 gap-1">
          {navigationItems.map((item, index) => {
            const Icon = icons[index];
            const active = item.key === activeKey;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center transition ${
                  active
                    ? "bg-cyan-300/14 text-cyan-100"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl">
                  <Icon />
                </span>
                <span className="truncate text-[10px] font-medium tracking-[0.06em]">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
