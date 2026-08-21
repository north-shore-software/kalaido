import type { ReactNode } from "react";
import { Mark } from "@/components/kalaido";

export interface OnboardingShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function OnboardingShell({
  title,
  description,
  children,
}: OnboardingShellProps) {
  return (
    <div
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="m-auto flex w-full max-w-2xl flex-col gap-8 p-8">
        <header className="flex flex-col items-center text-center">
          <Mark className="mb-4 size-16 p-2 animate-glow-shimmer" />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="text-body text-fg-2">{description}</p>
            )}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
