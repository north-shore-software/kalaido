import { useSyncRef } from "@kalaido/hooks/use-sync-ref";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  type EndPhase,
  PHRASES,
  runSplashLoop,
} from "./organizing-splash-canvas";

export interface OrganizingSplashProps {
  speed?: number;
  showStatus?: boolean;
  ending?: boolean;
  progress?: number;
  onSkip?: () => void;
  onEnded?: () => void;
  onSnapshotReady?: () => void;
}

export function OrganizingSplash({
  speed = 1,
  showStatus = true,
  ending = false,
  progress,
  onSkip,
  onEnded,
  onSnapshotReady,
}: OrganizingSplashProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phraseState, setPhraseState] = useState({ idx: 0, fading: false });
  const [endPhase, setEndPhase] = useState<EndPhase>("none");
  const [percent, setPercent] = useState(0);

  const propsRef = useRef({
    speed,
    progress,
    onEnded,
    onSnapshotReady,
  });
  useSyncRef(propsRef, {
    speed,
    progress,
    onEnded,
    onSnapshotReady,
  });
  const endAtRef = useRef<number | null>(null);

  const inEndSequence = ending || endPhase !== "none";
  const displayedStatus = inEndSequence
    ? endPhase === "ready" || endPhase === "faded"
      ? "snapshot ready"
      : "finalizing snapshot…"
    : PHRASES[phraseState.idx];
  const displayedOpacity = inEndSequence
    ? endPhase === "faded"
      ? 0
      : 1
    : phraseState.fading
      ? 0
      : 1;

  useEffect(() => {
    if (ending && endAtRef.current === null) {
      endAtRef.current = performance.now();
    }
  }, [ending]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return runSplashLoop(canvas, propsRef, endAtRef, {
      setPhraseState,
      setEndPhase,
      setPercent,
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background">
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-9 right-4 z-50 flex items-center gap-1.5 rounded border border-line bg-surface-1/80 px-3 py-1.5 font-mono text-[12px] text-fg-3 backdrop-blur-sm transition-colors hover:bg-surface-2 hover:text-fg-1 cursor-pointer"
        >
          Skip to app
          <ArrowRightIcon className="size-3.5" />
        </button>
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
      {showStatus && (
        <div className="pointer-events-none absolute inset-x-0 bottom-26 flex flex-col items-center justify-center gap-1 text-center font-mono select-none">
          <div className="tabular-nums font-mono text-[14px] font-semibold tracking-[0.1em] text-[#0AB9EC]">
            {percent}%
          </div>
          <div
            className="text-[13px] tracking-[0.08em] text-white transition-opacity duration-600 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
            style={{ opacity: displayedOpacity }}
          >
            <span key={displayedStatus}>{displayedStatus}</span>
          </div>
        </div>
      )}
    </div>
  );
}
