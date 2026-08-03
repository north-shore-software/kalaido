import { Button } from "@/components/ui/button";

export interface OAuthButtonsProps {
  onProvider: (provider: "google" | "github") => void;
  disabled?: boolean;
}

export function OAuthButtons({ onProvider, disabled }: OAuthButtonsProps) {
  return (
    <div className="flex flex-col gap-2 max-w-sm">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onProvider("google")}
        disabled={disabled}
      >
        Continue with Google
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onProvider("github")}
        disabled={disabled}
      >
        Continue with GitHub
      </Button>
    </div>
  );
}
