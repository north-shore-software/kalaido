import { Pill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";

export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2">
      {(["Google", "GitHub"] as const).map((provider) => (
        <Button
          key={provider}
          variant="outline"
          size="default"
          disabled
          className="justify-start gap-2.5 font-mono text-body-sm text-muted-foreground"
        >
          Continue with {provider}
          <Pill tone="muted" className="ml-auto">
            Coming soon
          </Pill>
        </Button>
      ))}
    </div>
  );
}
