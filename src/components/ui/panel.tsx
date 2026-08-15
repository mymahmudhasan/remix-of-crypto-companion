import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared desk-module primitives: consistent header / body rhythm across every tab. */

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel flex min-w-0 flex-col", className)} {...props} />;
}

export function PanelHeader({
  title,
  meta,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="flex size-5 items-center justify-center text-primary">{icon}</span>}
        <h3 className="truncate font-display text-[13px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {meta && (
          <span className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 p-3", className)} {...props} />;
}

export function SectionLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="section-label">{children}</span>
      <span className="section-rule" />
      {hint && <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
