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
    <div>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
