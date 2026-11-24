import wordmarkSrc from "@kalaido/primitives/assets/brand/kalaido-wordmark-signature-dark.svg";
import { cn } from "@kalaido/primitives/lib/css-utils";

export function SplashScreen() {
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
