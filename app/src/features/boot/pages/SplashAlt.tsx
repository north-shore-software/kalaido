import wordmarkSrc from "@/assets/brand/kalaido-wordmark.png";
import { cn } from "@/lib/css-utils.ts";
import { defineRoute, defineTransitions } from "@/routes/route-kit";

export default function SplashAlt() {
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

export const splashAltRoute = defineRoute({
  id: "splash-alt",
  path: "/splash-alt",
  feature: "Boot",
  requiredScope: [],
  transitions: defineTransitions({}),
  Component: SplashAlt,
});
