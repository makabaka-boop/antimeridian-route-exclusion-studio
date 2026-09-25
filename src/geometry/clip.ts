import { HALF_W, W } from './constants';
import {
  FONE,
  FZERO,
  frac,
  fAddInt,
  fCmp,
  floorDiv,
  lerpPoint,
  maxB,
  minB,
} from './frac';
// Frac 等类型集中定义于 types.ts
import type {
  AnalyzeResult,
  BuiltRoute,
  BuiltZone,
  Frac,
  GlobalInterval,
  InsidePiece,
  LatLon,
  Mi,
  Point,
  Reject,
  RouteOk,
  Witness,
  ZoneOk,
} from './types';
import { inLatRange, inLonRange, unwrapLongitudes } from './unwrap';

interface Edge {
  /** CCW 顶点下标 k：edge 从 ccw[k] 指向 ccw[k+1]。 */
  k: number;
  px: Mi;
  py: Mi;
  dx: Mi;
  dy: Mi;
  /** 对应输入顺序的边号（0 起）。 */
  inputLabel: number;
}

function cross(ax: Mi, ay: Mi, bx: Mi, by: Mi): bigint {
  return ax * by - ay * bx;
}

function validateRange(pts: LatLon[], errors: string[], name: string): void {
  pts.forEach((p, i) => {
    if (typeof p.lat !== 'bigint' || typeof p.lon !== 'bigint') {
      errors.push(`${name}第 ${i + 1} 点不是整数百万分之一度`);
    } else {
      if (!inLatRange(p.lat)) errors.push(`${name}第 ${i + 1} 点纬度 ${p.lat / 1_000_000n}° 超出 ±80°`);
      if (!inLonRange(p.lon)) errors.push(`${name}第 ${i + 1} 点经度超出 ±540°`);
    }
  });
}

/** 短弧差值，结果落在 (-180, 180]；返回是否歧义。 */
function shortDelta(from: Mi, to: Mi): { d: Mi; ambiguous: boolean } {
  const raw = to - from;
  const k = floorDiv(raw + HALF_W, W);
  const d = raw - k * W;
  return { d, ambiguous: d === HALF_W || d === -HALF_W };
}

export function buildZone(raw: LatLon[]): ZoneOk | Reject {
  const errors: string[] = [];
  if (raw.length < 3 || raw.length > 20) {
    errors.push(`禁区顶点数需在 3～20 之间，当前 ${raw.length}`);
    return { ok: false, errors };
  }
  validateRange(raw, errors, '禁区');
  const u = unwrapLongitudes(raw.map((p) => p.lon));
  errors.push(...u.errors.map((e) => `禁区${e}`));
  if (errors.length) return { ok: false, errors };

  const n = raw.length;
  const frame: Point[] = raw.map((p, i) => ({ x: u.points[i], y: p.lat }));

  // 闭合检查：末点沿短弧回到首点必须落在同一副本（差值为 0）。
  const close = shortDelta(frame[n - 1].x, frame[0].x);
  if (close.ambiguous) {
    errors.push('禁区闭合边恰好相差 180°，跨线闭合环方向有歧义');
  } else if (close.d !== 0n) {
    errors.push(`禁区不闭合：末点与首点最短经度差为 ${Number(close.d) / 1e6}°`);
  }

  // 零长边（退化为重合顶点）。
  for (let i = 0; i < n; i++) {
    const a = frame[i];
    const b = frame[(i + 1) % n];
    if (a.x === b.x && a.y === b.y) errors.push(`禁区第 ${i + 1} 边长度为零（相邻顶点重合）`);
  }
  if (errors.length) return { ok: false, errors };

  // 凸性：所有非零相邻边叉积同号；允许共线顶点，但必须有非零面积。
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = frame[i];
    const b = frame[(i + 1) % n];
    const c = frame[(i + 2) % n];
    const cval = cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
    if (cval === 0n) continue;
    const s = cval > 0n ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) {
      errors.push('禁区非凸或自交：相邻边叉积符号不一致');
      break;
    }
  }
  if (errors.length) return { ok: false, errors };
  if (sign === 0) {
    return { ok: false, errors: ['禁区面积为零（全部顶点共线）'] };
  }

  const clockwiseInput = sign < 0;
  const ccwToFrame = clockwiseInput
    ? [0, ...Array.from({ length: n - 1 }, (_, i) => n - 1 - i)]
    : Array.from({ length: n }, (_, i) => i);
  const ccw = ccwToFrame.map((i) => frame[i]);

  let minX = frame[0].x;
  let maxX = frame[0].x;
  let minY = frame[0].y;
  let maxY = frame[0].y;
  for (const p of frame) {
    minX = minB(minX, p.x);
    maxX = maxB(maxX, p.x);
    minY = minB(minY, p.y);
    maxY = maxB(maxY, p.y);
  }

  const zone: BuiltZone = {
    raw,
    frame,
    ccw,
    ccwToFrame,
    clockwiseInput,
    minX,
    maxX,
    minY,
    maxY,
  };
  return { ok: true, zone };
}

export function buildRoute(raw: LatLon[]): RouteOk | Reject {
  const errors: string[] = [];
  if (raw.length < 2 || raw.length > 80) {
    errors.push(`航路点数需在 2～80 之间，当前 ${raw.length}`);
    return { ok: false, errors };
  }
  validateRange(raw, errors, '航路');
  const u = unwrapLongitudes(raw.map((p) => p.lon));
  errors.push(...u.errors.map((e) => `航路${e}`));
  if (errors.length) return { ok: false, errors };

  const frame: Point[] = raw.map((p, i) => ({ x: u.points[i], y: p.lat }));
  for (let i = 1; i < frame.length; i++) {
    if (frame[i].x === frame[i - 1].x && frame[i].y === frame[i - 1].y) {
      errors.push(`航路第 ${i} 段长度为零（相邻点重合）`);
    }
  }
  if (errors.length) return { ok: false, errors };

  let minX = frame[0].x;
  let maxX = frame[0].x;
  for (const p of frame) {
    minX = minB(minX, p.x);
    maxX = maxB(maxX, p.x);
  }
  const route: BuiltRoute = { raw, frame, minX, maxX };
  return { ok: true, route };
}

function buildEdges(zone: BuiltZone): Edge[] {
  const n = zone.ccw.length;
  return zone.ccw.map((p, k) => {
    const q = zone.ccw[(k + 1) % n];
    // 输入顺序边号：未翻转即 k；翻转时 CCW 边是输入边 (idx_k - 1) 的反向。
    const idxK = zone.ccwToFrame[k];
    const inputLabel = zone.clockwiseInput ? (idxK - 1 + n) % n : k;
    return { k, px: p.x, py: p.y, dx: q.x - p.x, dy: q.y - p.y, inputLabel };
  });
}

interface ClipHit {
  lo: Frac;
  hi: Frac;
  loLabel: number;
  hiLabel: number;
}

/** 单段对单个世界副本（shift=k*W）做半平面裁剪；边界计入（>=0）。 */
function clipSegmentCopy(
  a: Point,
  b: Point,
  edges: Edge[],
  shift: Mi,
): ClipHit | null {
  let lo: Frac = FZERO;
  let hi: Frac = FONE;
  let loLabel = -1;
  let hiLabel = -1;

  for (const e of edges) {
    // f(t) = cross(edge, P(t) - vertex)，CCW 多边形内部 f>=0；
    // p = s0 - s1 = -f'(t)：p>0 递减给上界，p<0 递增给下界，p=0 平行。
    const s0 = cross(e.dx, e.dy, a.x - (e.px + shift), a.y - e.py);
    const s1 = cross(e.dx, e.dy, b.x - (e.px + shift), b.y - e.py);
    const p = s0 - s1;
    if (p === 0n) {
      if (s0 < 0n) return null; // 平行且整段在外侧
      continue; // 平行于边：在边上或内侧，边界计入
    }
    const root = frac(s0, p);
    if (p > 0n) {
      // 穿出边：收紧上界
      const c = fCmp(root, hi);
      if (c < 0) {
        hi = root;
        hiLabel = e.inputLabel;
      } else if (c === 0) {
        hiLabel = hiLabel === -1 ? e.inputLabel : Math.min(hiLabel, e.inputLabel);
      }
    } else {
      // 穿入边：收紧下界
      const c = fCmp(root, lo);
      if (c > 0) {
        lo = root;
        loLabel = e.inputLabel;
      } else if (c === 0) {
        loLabel = loLabel === -1 ? e.inputLabel : Math.min(loLabel, e.inputLabel);
      }
    }
    if (fCmp(lo, hi) > 0) return null;
  }
  if (fCmp(lo, hi) > 0) return null;
  return { lo, hi, loLabel, hiLabel };
}

/** 收集单段在所有必要世界副本中的区间并合并。 */
function clipSegmentAllCopies(
  a: Point,
  b: Point,
  zone: BuiltZone,
  edges: Edge[],
): ClipHit[] {
  const segMinX = minB(a.x, b.x);
  const segMaxX = maxB(a.x, b.x);
  const segMinY = minB(a.y, b.y);
  const segMaxY = maxB(a.y, b.y);
  // [zoneMinX+kW, zoneMaxX+kW] 与段 bbox 相交
  const k0 = floorDiv(segMinX - zone.maxX, W);
  const k1 = floorDiv(segMaxX - zone.minX, W);
  const hits: ClipHit[] = [];
  for (let k = k0; k <= k1; k++) {
    const shift = k * W;
    if (zone.maxX + shift < segMinX || zone.minX + shift > segMaxX) continue;
    if (zone.maxY < segMinY || zone.minY > segMaxY) continue;
    const hit = clipSegmentCopy(a, b, edges, shift);
    if (hit) hits.push(hit);
  }
  hits.sort((p, q) => fCmp(p.lo, q.lo));
  const merged: ClipHit[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && fCmp(h.lo, last.hi) <= 0) {
      if (fCmp(h.hi, last.hi) > 0) {
        last.hi = h.hi;
        last.hiLabel = h.hiLabel;
      }
    } else {
      merged.push({ ...h });
    }
  }
  return merged;
}

function makeWitness(
  route: BuiltRoute,
  seg: number,
  t: Frac,
  edgeLabel: number,
  kind: 'enter' | 'leave',
): Witness {
  return {
    t: fAddInt(t, BigInt(seg)),
    point: lerpPoint(route.frame[seg], route.frame[seg + 1], t),
    edge: edgeLabel + 1,
    kind,
  };
}

function fracFloor(f: Frac): bigint {
  // 本问题中全局参数恒非负
  return f.num / f.den;
}

/** 主入口：判定航路在凸禁区内的参数区间、见证与被截航路（单一数据源）。 */
export function analyzeRoute(zoneInput: LatLon[] | BuiltZone, routeInput: LatLon[] | BuiltRoute):
  AnalyzeResult | Reject {
  const z = Array.isArray(zoneInput) ? buildZone(zoneInput) : { ok: true as const, zone: zoneInput };
  if (!z.ok) return z;
  const r = Array.isArray(routeInput)
    ? buildRoute(routeInput)
    : { ok: true as const, route: routeInput };
  if (!r.ok) return r;
  const zone = z.zone;
  const route = r.route;
  const edges = buildEdges(zone);

  interface SegHit {
    seg: number;
    hit: ClipHit;
  }
  const segHits: SegHit[][] = route.frame.slice(0, -1).map((a, seg) =>
    clipSegmentAllCopies(a, route.frame[seg + 1], zone, edges).map((hit) => ({ seg, hit })),
  );

  // 转为全局参数区间（段内 t + seg），跨段相接（t=1 与下段 t=0）即合并。
  interface G {
    lo: Frac;
    hi: Frac;
    segLo: number;
    segHi: number;
    loLabel: number;
    hiLabel: number;
  }
  const globals: G[] = [];
  segHits.forEach((hits, seg) => {
    for (const { hit } of hits) {
      const lo = fAddInt(hit.lo, BigInt(seg));
      const hi = fAddInt(hit.hi, BigInt(seg));
      const last = globals[globals.length - 1];
      if (last && fCmp(lo, last.hi) <= 0) {
        if (fCmp(hi, last.hi) > 0) {
          last.hi = hi;
          last.segHi = seg;
          last.hiLabel = hit.hiLabel;
        }
        if (fCmp(lo, last.lo) < 0) {
          last.lo = lo;
          last.segLo = seg;
          last.loLabel = hit.loLabel;
        }
      } else {
        globals.push({ lo, hi, segLo: seg, segHi: seg, loLabel: hit.loLabel, hiLabel: hit.hiLabel });
      }
    }
  });

  const lastParam = BigInt(route.frame.length - 1);
  const pieces: InsidePiece[] = [];
  const witnesses: Witness[] = [];
  const intervals: GlobalInterval[] = [];

  for (const g of globals) {
    intervals.push({ lo: g.lo, hi: g.hi });
    const s0 = Number(fracFloor(g.lo));
    const loFrac = frac(g.lo.num % g.lo.den, g.lo.den);
    const hiFrac = frac(g.hi.num % g.hi.den, g.hi.den);
    // hi 恰为整数航路点时，末段是 floor(hi)-1（段内参数 t=1）。
    let s1 = Number(fracFloor(g.hi));
    if (fCmp(hiFrac, FZERO) === 0 && s1 > s0) s1 -= 1;

    const segs: number[] = [];
    const points: Point[] = [];
    if (fCmp(g.lo, g.hi) === 0) {
      // 退化区间（顶点擦过、边界单点接触）：片段仅含该见证点。
      let segP = s0;
      let tP = loFrac;
      if (fCmp(loFrac, FZERO) === 0 && segP === route.frame.length - 1) {
        segP -= 1; // 擦过点恰为航路末端点
        tP = FONE;
      }
      segs.push(segP);
      points.push(fracPoint(route.frame[segP], route.frame[segP + 1], tP));
    } else {
      for (let s = s0; s <= s1; s++) {
        segs.push(s);
        const a = route.frame[s];
        const b = route.frame[s + 1];
        const start = s === s0 ? (fCmp(loFrac, FZERO) === 0 ? a : fracPoint(a, b, loFrac)) : a;
        const end = s === s1 ? (fCmp(hiFrac, FZERO) === 0 ? b : fracPoint(a, b, hiFrac)) : b;
        if (s === s0) points.push(start);
        points.push(end);
      }
    }

    const piece: InsidePiece = { segs, points };
    // 进入/离开见证；恰好在端点且擦过多条边时，边号已在裁剪时取较小者。
    if (fCmp(g.lo, FZERO) !== 0) {
      piece.enter = makeWitness(route, s0, loFrac, g.loLabel === -1 ? 0 : g.loLabel, 'enter');
      witnesses.push(piece.enter);
    }
    if (fCmp(g.hi, { num: lastParam, den: 1n }) !== 0) {
      // hi 为整数航路点时，末段为 s1、段内参数 t=1。
      piece.leave = makeWitness(route, s1, fCmp(hiFrac, FZERO) === 0 ? FONE : hiFrac,
        g.hiLabel === -1 ? 0 : g.hiLabel, 'leave');
      witnesses.push(piece.leave);
    }
    pieces.push(piece);
  }

  return { ok: true, zone, route, pieces, witnesses, intervals };
}

function fracPoint(a: Point, b: Point, t: Frac): Point {
  // 裁剪结果用于画面，舍入到 1 微度（百万分之一度）。
  return {
    x: fracRound(lerpPoint(a, b, t).x),
    y: fracRound(lerpPoint(a, b, t).y),
  };
}

export function fracRound(f: Frac): Mi {
  const q = f.num / f.den;
  const r = f.num % f.den;
  if (r === 0n) return q;
  return (r * 2n >= f.den) === (f.num >= 0n) ? q + (f.num >= 0n ? 1n : -1n) : q;
}
