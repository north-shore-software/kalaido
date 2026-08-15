import wordmarkSrc from "@/assets/brand/kalaido-wordmark.png";
import { cn } from "@/lib/css-utils.ts";
import { defineRoute } from "@/routes/route-kit";
import { splashTransitions } from "./Splash.transitions";

export default function Splash() {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-700",
        "opacity-100",
      )}
    >
      <img
        src={wordmarkSrc}
        alt="Kalaido"
        draggable={false}
        className="h-12 w-auto select-none object-contain animate-in fade-in duration-1000 ease-out"
      />
    </div>
  );
}

export const splashRoute = defineRoute({
  id: "splash",
  path: "/splash",
  aliases: ["/"],
  feature: "Boot",
  requiredScope: [],
  transitions: splashTransitions,
  Component: Splash,
});
