import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface OrganizingSplashProps {
  speed?: number;
  showStatus?: boolean;
  ending?: boolean;
  progress?: number;
  onSkip?: () => void;
  onEnded?: () => void;
  onSnapshotReady?: () => void;
}

interface Chip {
  shape: "sq" | "arm" | "k";
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

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

const ROUND_CONFIGS = [
  {
    phiPeak: 0.7 * Math.PI,
    yLand: 0.04,
    floorScale: 1.0,
    toppleRot: 0.5,
  },
  {
    phiPeak: 0.82 * Math.PI,
    yLand: -0.05,
    floorScale: 0.96,
    toppleRot: -0.7,
  },
  {
    phiPeak: 0.6 * Math.PI,
    yLand: 0.06,
    floorScale: 1.0,
    toppleRot: 0.88,
  },
  {
    phiPeak: 0.76 * Math.PI,
    yLand: 0.0,
    floorScale: 0.98,
    toppleRot: -0.32,
  },
  {
    phiPeak: 0.85 * Math.PI,
    yLand: -0.06,
    floorScale: 0.95,
    toppleRot: -0.85,
  },
  {
    phiPeak: 0.66 * Math.PI,
    yLand: 0.03,
    floorScale: 0.99,
    toppleRot: 0.35,
  },
  {
    phiPeak: 0.73 * Math.PI,
    yLand: -0.03,
    floorScale: 0.97,
    toppleRot: 0.65,
  },
  {
    phiPeak: 0.58 * Math.PI,
    yLand: 0.05,
    floorScale: 1.0,
    toppleRot: -0.45,
  },
  {
    phiPeak: 0.79 * Math.PI,
    yLand: 0.02,
    floorScale: 0.96,
    toppleRot: 1.02,
  },
  {
    phiPeak: 0.68 * Math.PI,
    yLand: -0.02,
    floorScale: 0.98,
    toppleRot: -0.55,
  },
];

const CYAN_ROUND_CONFIGS = [
  {
    tDrop: 8.0,
    phiPeak: 0.78 * Math.PI,
    yLand: -0.12,
    floorScale: 0.98,
    toppleRot: 0.45,
  },
  {
    tDrop: 3.0,
    phiPeak: 0.48 * Math.PI,
    yLand: 0.12,
    floorScale: 1.0,
    toppleRot: -0.55,
  },
  {
    tDrop: 10.0,
    phiPeak: 0.85 * Math.PI,
    yLand: -0.16,
    floorScale: 0.96,
    toppleRot: 0.7,
  },
  {
    tDrop: 5.0,
    phiPeak: 0.62 * Math.PI,
    yLand: 0.08,
    floorScale: 0.99,
    toppleRot: 0.35,
  },
  {
    tDrop: 8.5,
    phiPeak: 0.82 * Math.PI,
    yLand: -0.14,
    floorScale: 0.95,
    toppleRot: -0.4,
  },
  {
    tDrop: 4.0,
    phiPeak: 0.55 * Math.PI,
    yLand: 0.15,
    floorScale: 1.0,
    toppleRot: -0.65,
  },
  {
    tDrop: 7.5,
    phiPeak: 0.72 * Math.PI,
    yLand: -0.06,
    floorScale: 0.97,
    toppleRot: 0.55,
  },
];

const YELLOW_ROUND_CONFIGS = [
  {
    tDrop: 6.0,
    phiPeak: 0.74 * Math.PI,
    yLand: -0.02,
    floorScale: 0.98,
    toppleRot: 0.4,
  },
  {
    tDrop: 9.0,
    phiPeak: 0.84 * Math.PI,
    yLand: 0.08,
    floorScale: 0.96,
    toppleRot: -0.5,
  },
  {
    tDrop: 3.5,
    phiPeak: 0.52 * Math.PI,
    yLand: -0.1,
    floorScale: 1.0,
    toppleRot: 0.75,
  },
  {
    tDrop: 7.8,
    phiPeak: 0.8 * Math.PI,
    yLand: 0.04,
    floorScale: 0.97,
    toppleRot: -0.3,
  },
  {
    tDrop: 5.5,
    phiPeak: 0.65 * Math.PI,
    yLand: -0.05,
    floorScale: 0.99,
    toppleRot: 0.55,
  },
  {
    tDrop: 8.2,
    phiPeak: 0.77 * Math.PI,
    yLand: 0.12,
    floorScale: 0.95,
    toppleRot: -0.65,
  },
];

const CYAN_SQ_ROUND_CONFIGS = [
  {
    tDrop: 4.5,
    phiPeak: 0.58 * Math.PI,
    yLand: -0.14,
    floorScale: 0.97,
    toppleRot: -0.45,
  },
  {
    tDrop: 8.8,
    phiPeak: 0.82 * Math.PI,
    yLand: 0.05,
    floorScale: 0.96,
    toppleRot: 0.6,
  },
  {
    tDrop: 6.8,
    phiPeak: 0.72 * Math.PI,
    yLand: -0.08,
    floorScale: 1.0,
    toppleRot: -0.35,
  },
  {
    tDrop: 3.2,
    phiPeak: 0.5 * Math.PI,
    yLand: 0.1,
    floorScale: 0.98,
    toppleRot: 0.5,
  },
  {
    tDrop: 9.5,
    phiPeak: 0.86 * Math.PI,
    yLand: -0.18,
    floorScale: 0.95,
    toppleRot: -0.75,
  },
  {
    tDrop: 5.2,
    phiPeak: 0.64 * Math.PI,
    yLand: 0.02,
    floorScale: 0.99,
    toppleRot: 0.4,
  },
];

const K_LOGO_ROUND_CONFIGS = [
  {
    tDrop: 7.2,
    phiPeak: 0.72 * Math.PI,
    yLand: 0.05,
    floorScale: 0.98,
    toppleRot: 0.45,
  },
  {
    tDrop: 3.5,
    phiPeak: 0.48 * Math.PI,
    yLand: -0.12,
    floorScale: 1.0,
    toppleRot: -0.6,
  },
  {
    tDrop: 9.2,
    phiPeak: 0.84 * Math.PI,
    yLand: 0.14,
    floorScale: 0.96,
    toppleRot: 0.85,
  },
  {
    tDrop: 5.0,
    phiPeak: 0.62 * Math.PI,
    yLand: 0.0,
    floorScale: 0.99,
    toppleRot: -0.35,
  },
  {
    tDrop: 8.6,
    phiPeak: 0.8 * Math.PI,
    yLand: -0.15,
    floorScale: 0.95,
    toppleRot: -0.75,
  },
  {
    tDrop: 4.2,
    phiPeak: 0.55 * Math.PI,
    yLand: 0.08,
    floorScale: 0.98,
    toppleRot: 0.6,
  },
  {
    tDrop: 9.8,
    phiPeak: 0.86 * Math.PI,
    yLand: -0.04,
    floorScale: 0.96,
    toppleRot: 0.4,
  },
  {
    tDrop: 6.5,
    phiPeak: 0.68 * Math.PI,
    yLand: 0.16,
    floorScale: 1.0,
    toppleRot: -0.5,
  },
  {
    tDrop: 3.0,
    phiPeak: 0.45 * Math.PI,
    yLand: -0.08,
    floorScale: 0.99,
    toppleRot: 0.7,
  },
  {
    tDrop: 8.0,
    phiPeak: 0.76 * Math.PI,
    yLand: 0.02,
    floorScale: 0.97,
    toppleRot: -0.4,
  },
  {
    tDrop: 5.8,
    phiPeak: 0.65 * Math.PI,
    yLand: -0.16,
    floorScale: 0.95,
    toppleRot: -0.8,
  },
  {
    tDrop: 9.0,
    phiPeak: 0.82 * Math.PI,
    yLand: 0.1,
    floorScale: 0.98,
    toppleRot: 0.95,
  },
  {
    tDrop: 4.8,
    phiPeak: 0.58 * Math.PI,
    yLand: -0.02,
    floorScale: 1.0,
    toppleRot: 0.3,
  },
  {
    tDrop: 7.6,
    phiPeak: 0.74 * Math.PI,
    yLand: 0.06,
    floorScale: 0.97,
    toppleRot: -0.65,
  },
  {
    tDrop: 6.0,
    phiPeak: 0.7 * Math.PI,
    yLand: -0.1,
    floorScale: 0.99,
    toppleRot: 0.5,
  },
];
interface RoundConfig {
  tDrop?: number;
  phiPeak: number;
  yLand: number;
  floorScale: number;
  toppleRot: number;
}

function calcChipTrajectory(
  c: Chip,
  t: number,
  period: number,
  offset: number,
  phiStart: number,
  configs: RoundConfig[],
  xCenter: number,
  rTrack: number,
  R: number,
  ex: number,
) {
  const tLocal = t + offset;
  const tau = ((tLocal % period) + period) % period;
  const N = Math.floor(tLocal / period);
  const roundIdx = ((N % configs.length) + configs.length) % configs.length;
  const cfg = configs[roundIdx];

  const tDrop = period - 1.25;
  const dropDur = 0.65;
  const toppleDur = 0.6;
  const tImpact = tDrop + dropDur;

  const xStart = xCenter + rTrack * Math.cos(phiStart);
  const yStart = rTrack * Math.sin(phiStart);

  const xTop = xCenter + rTrack * Math.cos(cfg.phiPeak);
  const yTop = rTrack * Math.sin(cfg.phiPeak);
  const xFloor = xCenter + rTrack * cfg.floorScale;
  const yLand = cfg.yLand * R * ex;
  const rotSettle = c.rot0 + cfg.toppleRot;
  const rotDrop = c.rot0 - (cfg.phiPeak - phiStart);

  let lx: number;
  let ly: number;
  let rot: number;

  if (tau < tDrop) {
    const p = tau / tDrop;
    const phi = phiStart + p * (cfg.phiPeak - phiStart);
    lx = xCenter + rTrack * Math.cos(phi);
    ly = rTrack * Math.sin(phi);
    rot = c.rot0 - (phi - phiStart);
  } else if (tau < tImpact) {
    const p = (tau - tDrop) / dropDur;
    lx = xTop + (xFloor - xTop) * (p * p);
    ly = yTop + (yLand - yTop) * (p * Math.sqrt(p));
    rot = rotDrop;
  } else {
    const s = (tau - tImpact) / toppleDur;
    const bounce = Math.sin(s * Math.PI) * 0.035 * R * ex * Math.exp(-3.5 * s);
    const tipEase = 1 - Math.exp(-4.5 * s) * Math.cos(3.5 * s);
    const rollEase = s * s;
    lx = xFloor - bounce + (xStart - xFloor) * rollEase;
    ly = yLand + (yStart - yLand) * s;
    rot =
      rotDrop +
      (rotSettle - rotDrop) * tipEase +
      (c.rot0 - rotSettle) * rollEase;
  }

  return { x: lx, y: ly, rot };
}

function chipPos(
  c: Chip,
  _ft: number,
  R: number,
  ex: number,
  t: number,
  index: number,
) {
  const xCenter = 0.433 * R * ex;
  const rDrum = 0.7 * R * ex;
  const pieceRadius = 0.72 * (c.size * R * ex);
  const rTrack = rDrum - pieceRadius;

  const CHIP_SPECS = [
    { period: 6.4, offset: 0.0, phiStart: -0.15, configs: ROUND_CONFIGS },
    { period: 7.6, offset: 2.5, phiStart: -0.55, configs: CYAN_ROUND_CONFIGS },
    { period: 5.5, offset: 4.2, phiStart: 0.35, configs: YELLOW_ROUND_CONFIGS },
    {
      period: 6.8,
      offset: 1.2,
      phiStart: -0.9,
      configs: CYAN_SQ_ROUND_CONFIGS,
    },
    { period: 7.2, offset: 3.5, phiStart: 0.7, configs: K_LOGO_ROUND_CONFIGS },
  ];

  const spec = CHIP_SPECS[index] ?? CHIP_SPECS[0];
  return calcChipTrajectory(
    c,
    t,
    spec.period,
    spec.offset,
    spec.phiStart,
    spec.configs,
    xCenter,
    rTrack,
    R,
    ex,
  );
}

function drawChipPath(ctx: CanvasRenderingContext2D, c: Chip, s: number) {
  if (c.shape === "sq") {
    ctx.rect(-s / 2, -s / 2, s, s);
  } else if (c.shape === "arm") {
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
  } else if (c.shape === "k") {
    const u = s / 30;
    ctx.rect((0.5 - 14.5) * u, (0.5 - 15) * u, 8.81 * u, 8.81 * u);
    ctx.rect((0.5 - 14.5) * u, (19.5 - 15) * u, 8.81 * u, 8.81 * u);
    ctx.moveTo((27.69 - 14.5) * u, (0.5 - 15) * u);
    ctx.lineTo((27.69 - 14.5) * u, (9.39 - 15) * u);
    ctx.lineTo((18.39 - 14.5) * u, (18.69 - 15) * u);
    ctx.lineTo((9.5 - 14.5) * u, (18.69 - 15) * u);
    ctx.lineTo((9.5 - 14.5) * u, (9.8 - 15) * u);
    ctx.lineTo((18.8 - 14.5) * u, (0.5 - 15) * u);
    ctx.closePath();
    ctx.moveTo((27.69 - 14.5) * u, (28.69 - 15) * u);
    ctx.lineTo((18.8 - 14.5) * u, (28.69 - 15) * u);
    ctx.lineTo((9.5 - 14.5) * u, (19.39 - 15) * u);
    ctx.lineTo((9.5 - 14.5) * u, (10.5 - 15) * u);
    ctx.lineTo((18.39 - 14.5) * u, (10.5 - 15) * u);
    ctx.lineTo((27.69 - 14.5) * u, (19.8 - 15) * u);
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
  _lw: number,
) {
  const canvas = ctx.canvas;
  const dprRatio = canvas ? canvas.width / (canvas.clientWidth || 1) : 1;

  if (c.shape === "k") {
    const strokeWidth = 10 * dprRatio;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.beginPath();
    drawChipPath(ctx, c, s);
    ctx.lineWidth = strokeWidth * 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.stroke();

    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.restore();
    return;
  }

  const strokeWidth = 3 * dprRatio;

  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.beginPath();
  drawChipPath(ctx, c, s);
  ctx.fillStyle = c.color;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.4));
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.strokeStyle = c.color;
  ctx.stroke();
  ctx.restore();
}

const DRAW_ORDER = [3, 0, 1, 2, 4];

function generateChips(): Chip[] {
  const rnd = Math.random;
  const heroSpec = [
    {
      shape: "arm" as const,
      color: "#EE029B",
      flip: true,
      size: 0.65,
      alpha: 0.8,
    },
    {
      shape: "arm" as const,
      color: "#FF6B00",
      flip: false,
      size: 0.5,
      alpha: 0.8,
    },
    {
      shape: "sq" as const,
      color: "#F4C904",
      flip: false,
      size: 0.3,
      alpha: 1.0,
    },
    {
      shape: "sq" as const,
      color: "#0AB9EC",
      flip: false,
      size: 0.44,
      alpha: 0.8,
    },
    {
      shape: "k" as const,
      color: "#ffffff",
      flip: false,
      size: 0.423,
      alpha: 1.0,
    },
  ];

  const th0s = [-0.06, 0.16, -0.16, 0.26, -0.02];

  return heroSpec.map((spec, i) => ({
    ...spec,
    hero: true,
    r0: 0.82,
    th0: th0s[i],
    a1: 0.08 + rnd() * 0.12,
    w1: (2 * Math.PI) / (45 + rnd() * 75),
    f1: rnd() * 6.28,
    a2: 0.04 + rnd() * 0.08,
    w2: (2 * Math.PI) / (60 + rnd() * 90),
    f2: rnd() * 6.28,
    ar: 0.03 + rnd() * 0.08,
    wr: (2 * Math.PI) / (50 + rnd() * 80),
    fr: rnd() * 6.28,
    rot0: rnd() * 6.28,
    spin: (rnd() - 0.5) * 0.12,
    wa: (2 * Math.PI) / (30 + rnd() * 40),
    seed: rnd() * 6.28,
  }));
}

function drawHexagonLoadingBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  progress: number,
  t: number,
  alpha: number,
  lw: number,
) {
  const canvas = ctx.canvas;
  const dprRatio = canvas ? canvas.width / (canvas.clientWidth || 1) : 1;
  const gap12 = 12 * dprRatio;
  const Rbar = R + gap12 / (Math.sqrt(3) / 2);
  const H = Math.sqrt(3) * Rbar;

  const vertices: [number, number][] = [
    [cx + Rbar, cy - H],
    [cx + 2 * Rbar, cy],
    [cx + Rbar, cy + H],
    [cx - Rbar, cy + H],
    [cx - 2 * Rbar, cy],
    [cx - Rbar, cy - H],
  ];

  const barWidth = Math.max(7.2, lw * 5.4);
  const clampedP = Math.max(0, Math.min(1, progress));
  const stage = clampedP >= 0.999 ? 6 : Math.floor(clampedP * 6);
  const pulse = 0.55 + 0.45 * Math.sin(t * 6.0);

  const W = canvas ? canvas.width : 2000;
  const Hcanvas = canvas ? canvas.height : 2000;

  const Hgeo = Math.sqrt(3) * R;
  const innerHex: [number, number][] = [
    [cx + R, cy - Hgeo],
    [cx + 2 * R, cy],
    [cx + R, cy + Hgeo],
    [cx - R, cy + Hgeo],
    [cx - 2 * R, cy],
    [cx - R, cy - Hgeo],
  ];

  ctx.save();
  const outerClip = new Path2D();
  outerClip.rect(0, 0, W, Hcanvas);
  outerClip.moveTo(innerHex[0][0], innerHex[0][1]);
  for (let i = 1; i < innerHex.length; i++) {
    outerClip.lineTo(innerHex[i][0], innerHex[i][1]);
  }
  outerClip.closePath();
  ctx.clip(outerClip, "evenodd");

  ctx.strokeStyle = "#0AB9EC";
  ctx.shadowColor = "#0AB9EC";
  ctx.lineCap = "round";
  ctx.lineJoin = "miter";

  if (stage > 0) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.lineWidth = barWidth;
    ctx.shadowBlur = 8 * dprRatio;
    ctx.beginPath();
    ctx.moveTo(vertices[0][0], vertices[0][1]);
    for (let k = 1; k <= stage; k++) {
      const v = vertices[k % 6];
      ctx.lineTo(v[0], v[1]);
    }
    if (stage === 6) {
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  if (stage < 6) {
    const p0 = vertices[stage];
    const p1 = vertices[(stage + 1) % 6];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * pulse));
    ctx.lineWidth = barWidth;
    ctx.shadowBlur = (6 + 12 * pulse) * dprRatio;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#0AB9EC";
  ctx.lineCap = "round";
  ctx.lineJoin = "miter";
  ctx.lineWidth = barWidth;

  if (stage > 0) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.beginPath();
    ctx.moveTo(vertices[0][0], vertices[0][1]);
    for (let k = 1; k <= stage; k++) {
      const v = vertices[k % 6];
      ctx.lineTo(v[0], v[1]);
    }
    if (stage === 6) {
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  if (stage < 6) {
    const p0 = vertices[stage];
    const p1 = vertices[(stage + 1) % 6];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * pulse));
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
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
  const [status, setStatus] = useState(PHRASES[0]);
  const [statusOpacity, setStatusOpacity] = useState(1);
  const [percent, setPercent] = useState(0);

  const stateRef = useRef({
    speed,
    ending,
    progress,
    onEnded,
    onSnapshotReady,
    endAt: null as number | null,
    snapshotReadyFired: false,
    endedFired: false,
    t0: performance.now(),
    last: performance.now(),
    ft: 0,
    pi: 0,
    lastPercent: 0,
    chips: generateChips(),
  });

  stateRef.current.speed = speed;
  stateRef.current.progress = progress;
  stateRef.current.onEnded = onEnded;
  stateRef.current.onSnapshotReady = onSnapshotReady;

  const triggerEnd = useCallback(() => {
    if (stateRef.current.endAt === null) {
      stateRef.current.endAt = performance.now();
      setStatus("finalizing snapshot…");
      setStatusOpacity(1);
    }
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

      const dprRatio = canvas.width / (canvas.clientWidth || 1);
      const pad120 = 120 * dprRatio;
      const maxRByH = Math.max(30, (H - 2 * pad120) / (2 * Math.sqrt(3)));
      const maxRByW = Math.max(30, (W - 2 * pad120) / 4);
      const R = Math.min(maxRByH, maxRByW) * 0.8;

      const cx = W / 2;
      const cy = H / 2;

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
          setStatusOpacity(0);
          st.onEnded?.();
        }
      }

      const ex = 0.1 + 0.9 * b;
      const lw = Math.max(1, R * 0.006);
      const blending = b < 0.999;
      const baseAngle = Math.PI / 2;
      const cosBase = Math.cos(baseAngle);
      const sinBase = Math.sin(baseAngle);

      if (b > 0.003) {
        const chipPositions = st.chips.map((c, i) =>
          chipPos(c, ft, R, ex, t, i),
        );

        const colStep = 1.5 * R;
        const rowStep = Math.sqrt(3) * R;
        const cols = Math.ceil((cx + R) / colStep) + 1;
        const rows = Math.ceil((cy + R) / rowStep) + 1;

        for (let col = -cols; col <= cols; col++) {
          for (let row = -rows; row <= rows; row++) {
            const hexX = cx + col * colStep;
            const hexY = cy + row * rowStep + (col % 2 !== 0 ? rowStep / 2 : 0);

            if (
              hexX < -R * 1.5 ||
              hexX > W + R * 1.5 ||
              hexY < -R * 1.5 ||
              hexY > H + R * 1.5
            ) {
              continue;
            }

            const isCenterHex = col === 0 && row === 0;

            ctx.save();
            ctx.translate(hexX, hexY);
            ctx.rotate(baseAngle);
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
              ctx.lineTo(
                R * Math.cos(-Math.PI / 6),
                R * Math.sin(-Math.PI / 6),
              );
              ctx.lineTo(R * Math.cos(Math.PI / 6), R * Math.sin(Math.PI / 6));
              ctx.closePath();
              ctx.clip();

              for (const i of DRAW_ORDER) {
                if (i >= st.chips.length) continue;
                const c = st.chips[i];
                if (c.hero && blending && k === 0 && isCenterHex) continue;
                const shimmer = 0.82 + 0.18 * Math.sin(ft * c.wa + c.seed);
                const a =
                  c.shape === "k"
                    ? c.alpha * b * b * g
                    : c.alpha * shimmer * b * g;
                if (a < 0.01) continue;
                const p = chipPositions[i];
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                drawOneChip(ctx, c, c.size * R, a, lw);
                ctx.restore();
              }
              ctx.restore();
            }
            ctx.restore();

            ctx.save();
            ctx.translate(hexX, hexY);
            ctx.rotate(baseAngle);
            ctx.globalAlpha = b * g;
            ctx.strokeStyle = "rgba(140, 140, 140, 0.35)";
            ctx.lineWidth = lw;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
              const a1 = -Math.PI / 6 + (k * Math.PI) / 3;
              const a2 = Math.PI / 6 + (k * Math.PI) / 3;
              ctx.moveTo(0, 0);
              ctx.lineTo(R * Math.cos(a1), R * Math.sin(a1));
              ctx.lineTo(R * Math.cos(a2), R * Math.sin(a2));
              ctx.lineTo(0, 0);
            }
            ctx.stroke();
            ctx.restore();
          }
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, b * g));
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.beginPath();
        ctx.rect(0, 0, W, H);

        const Hgeo = Math.sqrt(3) * R;
        const hexCutout: [number, number][] = [
          [cx + R, cy - Hgeo],
          [cx + 2 * R, cy],
          [cx + R, cy + Hgeo],
          [cx - R, cy + Hgeo],
          [cx - 2 * R, cy],
          [cx - R, cy - Hgeo],
        ];
        ctx.moveTo(hexCutout[0][0], hexCutout[0][1]);
        for (let i = 1; i < hexCutout.length; i++) {
          ctx.lineTo(hexCutout[i][0], hexCutout[i][1]);
        }
        ctx.closePath();

        ctx.fill("evenodd");
        ctx.restore();

        const activeProg =
          st.progress !== undefined ? st.progress : (t % 20.0) / 20.0;
        const curPct = Math.round(activeProg * 100);
        if (curPct !== st.lastPercent) {
          st.lastPercent = curPct;
          setPercent(curPct);
        }
        drawHexagonLoadingBar(ctx, cx, cy, R, activeProg, t, b * g, lw);
      }

      if (blending && g > 0.003) {
        const K = kLayout(R);
        const kTargets = [K[3], K[2], K[0], K[1]];
        for (const i of DRAW_ORDER) {
          if (i >= st.chips.length) continue;
          const c = st.chips[i];
          if (c.shape === "k") continue;
          const kTarget = kTargets[i] ?? K[0];
          const p = chipPos(c, ft, R, ex, t, i);
          const sx = cx + p.x * cosBase - p.y * sinBase;
          const sy = cy + p.x * sinBase + p.y * cosBase;
          const kx = cx + kTarget.x;
          const ky = cy + kTarget.y;
          const x = kx + (sx - kx) * b;
          const y = ky + (sy - ky) * b;
          const rot = (p.rot + baseAngle) * b;
          const s = kTarget.size + (c.size * R - kTarget.size) * b;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          drawOneChip(ctx, c, s, c.alpha * g, lw);
          ctx.restore();
        }
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(statusTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background">
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-9 left-4 z-50 flex items-center gap-1.5 rounded border border-line bg-surface-1/80 px-3 py-1.5 font-mono text-[12px] text-fg-3 backdrop-blur-sm transition-colors hover:bg-surface-2 hover:text-fg-1 cursor-pointer"
        >
          <ArrowLeftIcon className="size-3.5" />
          Skip to app
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
            style={{ opacity: statusOpacity }}
          >
            {status}
          </div>
        </div>
      )}
    </div>
  );
}
