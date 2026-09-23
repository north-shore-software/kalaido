import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
}

/**
 * The settings-page section heading: a large title over a muted description.
 */
export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-card-title font-bold text-fg-1">{title}</h2>
      {description && <p className="text-body-sm text-fg-3">{description}</p>}
    </div>
  );
}
