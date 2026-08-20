import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/kalaido";

export interface AccountCardProps {
  name: string;
  email: string;
  onSignOut: () => void;
}

export function AccountCard({ name, email, onSignOut }: AccountCardProps) {
  const initials = (name || email)
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SurfaceCard className="flex max-w-sm items-center gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-none bg-surface-2 text-item font-semibold text-fg-1">
        {initials}
      </div>
      <div className="flex flex-col min-w-0">
        {name && (
          <span className="text-item font-medium truncate text-fg-1">
            {name}
          </span>
        )}
        <span className="text-meta text-fg-3 truncate">{email}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto shrink-0"
        onClick={onSignOut}
      >
        Sign out
      </Button>
    </SurfaceCard>
  );
}
