import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/css-utils.ts";
import { defineRoute, defineTransitions } from "@/routes/route-kit";

export interface SplashAltProps {
  speed?: number;
  density?: number;
  showStatus?: boolean;
  ending?: boolean;
  onEnded?: () => void;
  onSnapshotReady?: () => void;
}

interface Chip {
  shape: "sq" | "arm";
  flip: boolean;
  color: string;
  alpha: number;
  size: number;
  r0: number;
  th0: number;
  a1: number;
  w1: number;
  f1: number;
  a2: number;
  w2: number;
  f2: number;
  ar: number;
  wr: number;
  fr: number;
  rot0: number;
  spin: number;
  wa: number;
  seed: number;
  hero: boolean;
}

const PHRASES = [
  "converging fragments…",
  "rotating the lens…",
  "grouping by theme…",
  "distilling…",
  "composing snapshot…",
  "still working — this takes a few minutes",
];

const COLORS = ["#F4C904", "#0AB9EC", "#EE029B"];
const ALPHAS = [1, 0.72, 0.45];

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

function fold(th: number): number {
  const P = Math.PI / 3;
  const m = (((th + P / 2) % (2 * P)) + 2 * P) % (2 * P);
  return (m < P ? m : 2 * P - m) - P / 2;
}

function chipPos(c: Chip, ft: number, R: number, ex: number) {
  const raw =
    c.th0 +
    ft * 0.07 +
    c.a1 * Math.sin(ft * c.w1 + c.f1) +
    c.a2 * Math.sin(ft * c.w2 + c.f2);
  const th = fold(raw);
  const rr = (c.r0 + c.ar * Math.sin(ft * c.wr + c.fr)) * R * ex;
  return {
    x: rr * Math.cos(th),
    y: rr * Math.sin(th),
    rot: c.rot0 + ft * c.spin,
  };
}

function drawChipPath(ctx: CanvasRenderingContext2D, c: Chip, s: number) {
  if (c.shape === "sq") {
    ctx.rect(-s / 2, -s / 2, s, s);
  } else {
    const u = s / 18.2;
    const m = c.flip ? -1 : 1;
    const p: [number, number][] = [
      [9.1, -9.1],
      [9.1, -0.2],
      [-0.2, 9.1],
      [-9.1, 9.1],
      [-9.1, 0.2],
      [0.2, -9.1],
    ];
    ctx.moveTo(p[0][0] * u, p[0][1] * u * m);
    for (let i = 1; i < 6; i++) {
      ctx.lineTo(p[i][0] * u, p[i][1] * u * m);
    }
    ctx.closePath();
  }
}

function kLayout(R: number) {
  const u = (R * 0.62) / 30;
  const cs: [number, number][] = [
    [4.905, 4.905],
    [4.905, 23.905],
    [18.595, 9.595],
    [18.595, 19.595],
  ];
  const sz = [8.81 * u, 8.81 * u, 18.19 * u, 18.19 * u];
  return cs.map((c, i) => ({
    x: (c[0] - 14.5) * u,
    y: (c[1] - 15) * u,
    size: sz[i],
  }));
}

function drawOneChip(
  ctx: CanvasRenderingContext2D,
  c: Chip,
  s: number,
  alpha: number,
  lw: number,
) {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.beginPath();
  drawChipPath(ctx, c, s);
  ctx.fillStyle = c.color;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.stroke();
}

function generateChips(density: number): Chip[] {
  const n = Math.max(6, Math.round(density));
  const rnd = Math.random;
  const mk = (): Chip => ({
    shape: rnd() < 0.42 ? "sq" : "arm",
    flip: rnd() < 0.5,
    color: COLORS[(rnd() * 3) | 0],
    alpha: ALPHAS[(rnd() * 3) | 0],
    size: 0.055 + rnd() * 0.14,
    r0: 0.14 + rnd() * 0.8,
    th0: (rnd() - 0.5) * (Math.PI / 3) * 0.9,
    a1: 0.1 + rnd() * 0.16,
    w1: (2 * Math.PI) / (45 + rnd() * 75),
    f1: rnd() * 6.28,
    a2: 0.05 + rnd() * 0.1,
    w2: (2 * Math.PI) / (60 + rnd() * 90),
    f2: rnd() * 6.28,
    ar: 0.04 + rnd() * 0.12,
    wr: (2 * Math.PI) / (50 + rnd() * 80),
    fr: rnd() * 6.28,
    rot0: rnd() * 6.28,
    spin: (rnd() - 0.5) * 0.12,
    wa: (2 * Math.PI) / (30 + rnd() * 40),
    seed: rnd() * 6.28,
    hero: false,
  });

  const chips: Chip[] = [];
  for (let i = 0; i < n; i++) chips.push(mk());

  const heroSpec = [
    { shape: "sq" as const, color: "#F4C904", flip: false, size: 0.115 },
    { shape: "sq" as const, color: "#0AB9EC", flip: false, size: 0.115 },
    { shape: "arm" as const, color: "#0AB9EC", flip: false, size: 0.165 },
    { shape: "arm" as const, color: "#EE029B", flip: true, size: 0.165 },
  ];

  for (let i = 0; i < 4; i++) {
    Object.assign(chips[i], heroSpec[i], {
      alpha: 1,
      hero: true,
      r0: 0.25 + i * 0.18,
      th0: (i - 1.5) * 0.22,
    });
  }

  return chips;
}

export default function SplashAlt({
  speed = 1,
  density = 26,
  showStatus = true,
  ending = false,
  onEnded,
  onSnapshotReady,
}: SplashAltProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState(PHRASES[0]);
  const [statusOpacity, setStatusOpacity] = useState(1);
  const [phase, setPhase] = useState<"run" | "done">("run");

  const stateRef = useRef({
    speed,
    density,
    ending,
    onEnded,
    onSnapshotReady,
    endAt: null as number | null,
    snapshotReadyFired: false,
    endedFired: false,
    t0: performance.now(),
    last: performance.now(),
    ft: 0,
    pi: 0,
    chips: generateChips(density),
  });

  stateRef.current.speed = speed;
  stateRef.current.density = density;
  stateRef.current.onEnded = onEnded;
  stateRef.current.onSnapshotReady = onSnapshotReady;

  const triggerEnd = useCallback(() => {
    if (stateRef.current.endAt === null) {
      stateRef.current.endAt = performance.now();
      setStatus("finalizing snapshot…");
      setStatusOpacity(1);
    }
  }, []);

  const triggerRestart = useCallback(() => {
    const now = performance.now();
    stateRef.current.endAt = null;
    stateRef.current.t0 = now;
    stateRef.current.last = now;
    stateRef.current.ft = 0;
    stateRef.current.pi = 0;
    stateRef.current.snapshotReadyFired = false;
    stateRef.current.endedFired = false;
    stateRef.current.chips = generateChips(stateRef.current.density);
    setPhase("run");
    setStatus(PHRASES[0]);
    setStatusOpacity(1);
  }, []);

  useEffect(() => {
    if (ending && stateRef.current.endAt === null) {
      triggerEnd();
    }
  }, [ending, triggerEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E") {
        if (stateRef.current.endedFired) {
          triggerRestart();
        } else {
          triggerEnd();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const statusTimer = setInterval(() => {
      if (stateRef.current.endAt !== null) return;
      setStatusOpacity(0);
      setTimeout(() => {
        stateRef.current.pi = (stateRef.current.pi + 1) % PHRASES.length;
        setStatus(PHRASES[stateRef.current.pi]);
        setStatusOpacity(1);
      }, 650);
    }, 9000);

    let rafId: number;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const st = stateRef.current;
      const dt = Math.min(0.05, (now - st.last) / 1000);
      st.last = now;
      const t = (now - st.t0) / 1000;

      const desired = Math.max(6, Math.round(st.density));
      if (desired !== st.chips.length) {
        st.chips = generateChips(desired);
      }

      let flow =
        0.7 +
        0.3 * Math.sin((2 * Math.PI * t) / 45) +
        0.15 * Math.sin((2 * Math.PI * t) / 13 + 1.7);
      flow = Math.max(0.2, flow) * st.speed * (reduced ? 0.15 : 1);
      st.ft += dt * flow;
      const ft = st.ft;

      const W = canvas.width;
      const H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.42;

      let b: number;
      let g = 1;

      if (st.endAt === null) {
        b = smooth((t - 1.0) / 2.2);
      } else {
        const te = (now - st.endAt) / 1000;
        b = 1 - smooth((te - 0.4) / 2.2);
        g = 1 - smooth((te - 3.8) / 1.2);

        if (te > 3.0 && !st.snapshotReadyFired) {
          st.snapshotReadyFired = true;
          setStatus("snapshot ready");
          st.onSnapshotReady?.();
        }

        if (te > 5.2 && !st.endedFired) {
          st.endedFired = true;
          setPhase("done");
          setStatusOpacity(0);
          st.onEnded?.();
        }
      }

      const ex = 0.1 + 0.9 * b;
      const lw = Math.max(1, R * 0.006);
      const blending = b < 0.999;

      if (b > 0.003) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 2);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          if (k === 0) {
            ctx.moveTo(R * Math.cos(a), R * Math.sin(a));
          } else {
            ctx.lineTo(R * Math.cos(a), R * Math.sin(a));
          }
        }
        ctx.closePath();
        ctx.clip();

        for (let k = 0; k < 6; k++) {
          ctx.save();
          ctx.rotate((k * Math.PI) / 3);
          if (k % 2 === 1) ctx.scale(1, -1);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(R * Math.cos(-Math.PI / 6), R * Math.sin(-Math.PI / 6));
          ctx.lineTo(R * Math.cos(Math.PI / 6), R * Math.sin(Math.PI / 6));
          ctx.closePath();
          ctx.clip();

          for (const c of st.chips) {
            if (c.hero && blending && k === 0) continue;
            const shimmer = 0.82 + 0.18 * Math.sin(ft * c.wa + c.seed);
            const a = c.alpha * shimmer * b * g;
            if (a < 0.01) continue;
            const p = chipPos(c, ft, R, ex);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            drawOneChip(ctx, c, c.size * R, a, lw);
            ctx.restore();
          }
          ctx.restore();
        }
        ctx.restore();
      }

      if (blending && g > 0.003) {
        const K = kLayout(R);
        for (let i = 0; i < 4; i++) {
          const c = st.chips[i];
          const p = chipPos(c, ft, R, ex);
          const sx = cx + p.y;
          const sy = cy - p.x;
          const kx = cx + K[i].x;
          const ky = cy + K[i].y;
          const x = kx + (sx - kx) * b;
          const y = ky + (sy - ky) * b;
          const rot = (p.rot - Math.PI / 2) * b;
          const s = K[i].size + (c.size * R - K[i].size) * b;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          drawOneChip(ctx, c, s, g, lw);
          ctx.restore();
        }
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(statusTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [triggerEnd, triggerRestart]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
      {showStatus && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-13 text-center font-mono text-[13px] tracking-[0.08em] text-fg-4 transition-opacity duration-600 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{ opacity: statusOpacity }}
        >
          {status}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (phase === "done") {
            triggerRestart();
          } else {
            triggerEnd();
          }
        }}
        title="dev only — press E"
        className={cn(
          "absolute right-4 bottom-3.5 rounded border border-line px-2.5 py-1",
          "font-mono text-[10px] tracking-[0.1em] text-fg-4 opacity-20",
          "cursor-pointer transition-opacity duration-150 hover:opacity-75",
        )}
      >
        {phase === "done" ? "dev · restart" : "dev · complete (E)"}
      </button>
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
