import type { ReactNode } from "react";
import { AppSidebar, type SidebarKey } from "@/components/app-sidebar";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const statToneClasses = {
  cyan: "border-cyan-300/18 bg-cyan-300/[0.07] text-cyan-50",
  amber: "border-amber-300/18 bg-amber-300/[0.08] text-amber-50",
  rose: "border-rose-300/18 bg-rose-300/[0.08] text-rose-50",
  emerald: "border-emerald-300/18 bg-emerald-300/[0.08] text-emerald-50",
  slate: "border-white/10 bg-white/[0.03] text-white",
} as const;

type WorkspaceShellProps = {
  activeKey: SidebarKey;
  children: ReactNode;
};

type WorkspaceHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type WorkspaceStatGridProps = {
  children: ReactNode;
  className?: string;
};

type WorkspaceStatCardProps = {
  label: string;
  value: ReactNode;
  tone?: keyof typeof statToneClasses;
  className?: string;
};

export function WorkspaceShell({ activeKey, children }: WorkspaceShellProps) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050816] pb-28 text-slate-100 lg:pb-0">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-[-18rem] h-[34rem] bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_rgba(34,211,238,0)_58%)]" />
        <div className="absolute left-[-10rem] top-[18rem] h-[28rem] w-[28rem] rounded-full bg-cyan-300/8 blur-3xl" />
        <div className="absolute right-[-8rem] top-[10rem] h-[24rem] w-[24rem] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute inset-x-0 bottom-[-16rem] h-[32rem] bg-[radial-gradient(circle_at_bottom,_rgba(56,189,248,0.14),_rgba(56,189,248,0)_58%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(5,8,22,0.78)_0%,_rgba(5,8,22,0.92)_44%,_rgba(5,8,22,1)_100%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1840px] min-w-0 flex-col px-4 py-4 lg:flex-row lg:px-6 lg:py-6">
        <AppSidebar activeKey={activeKey} />

        <section className="mt-4 min-w-0 flex-1 lg:mt-0 lg:pl-6">{children}</section>
      </div>
    </main>
  );
}

export function WorkspaceHero({
  eyebrow,
  title,
  description,
  meta,
  children,
  className,
}: WorkspaceHeroProps) {
  return (
    <section
      className={cx(
        "relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,_rgba(12,19,36,0.96)_0%,_rgba(8,14,27,0.98)_100%)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.34)] md:p-6",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-[-8%] top-[-24%] h-56 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_rgba(34,211,238,0)_56%)]" />
      <div className="pointer-events-none absolute right-[-8%] top-10 h-44 w-44 rounded-full bg-amber-300/10 blur-3xl" />

      <div className="relative">
        <div
          className={cx(
            "flex flex-col gap-5",
            meta ? "2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] 2xl:items-start" : ""
          )}
        >
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">{eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl lg:text-[2.35rem] lg:leading-tight">
              {title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400 sm:text-[15px]">
              {description}
            </p>
          </div>

          {meta ? <div className="min-w-0">{meta}</div> : null}
        </div>

        {children ? <div className="mt-6 border-t border-white/8 pt-6">{children}</div> : null}
      </div>
    </section>
  );
}

export function WorkspaceStatGrid({ children, className }: WorkspaceStatGridProps) {
  return <div className={cx("grid gap-3 sm:grid-cols-3", className)}>{children}</div>;
}

export function WorkspaceStatCard({
  label,
  value,
  tone = "slate",
  className,
}: WorkspaceStatCardProps) {
  return (
    <div
      className={cx(
        "rounded-[24px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm",
        statToneClasses[tone],
        className
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white sm:text-[2rem]">{value}</p>
    </div>
  );
}
