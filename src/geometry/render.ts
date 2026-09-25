import { HALF_W, LAT_LIMIT, MICRO, W } from './constants';
import { FONE, FZERO, frac, fCmp, fToNumber } from './frac';
import { canonicalLon } from './unwrap';
import type { BuiltZone, Frac, Mi, Point } from './types';

export interface XY {
  x: number;
  y: number;
}

export interface ScreenSegment {
  a: XY;
  b: XY;
}

/** 中点所在世界副本 k：使平移后经度落在 (-180,180]。 */
function worldCopy(mx: number): bigint {
  // k = floor((mx + 179.999999) / 360)：180° 本身归 k=0（画在右缘）。
  const almostHalf = Number(HALF_W) - 1;
  return BigInt(Math.floor((mx + almostHalf) / Number(W)));
}

/**
 * 把展开平面上的一条线段在所有奇数倍 180° 经线处切开，
 * 每一小段按「其中点所在的世界副本」平移到画面条带后投影。
 * 端点恰在 ±180° 时，由相邻小段的中点决定它吸附到左缘还是右缘，
 * 因而跨日界线的边不会横贯整张世界图。
 */
export function splitEdge(
  a: Point,
  b: Point,
  project: (p: Point) => XY,
): ScreenSegment[] {
  if (a.x === b.x && a.y === b.y) {
    const q = projectPoint(a, project);
    return [{ a: q, b: q }];
  }
  const dx = b.x - a.x;
  const cuts: Frac[] = [];
  if (dx !== 0n) {
    // 航路展开范围远小于 ±900°，奇数经线 k*360±180 取这些足够。
    for (let k = -5n; k <= 5n; k++) {
      const meridian = k * W + HALF_W; // ..., -540, -180, 180, 540, ...
      if ((meridian > a.x && meridian < b.x) || (meridian < a.x && meridian > b.x)) {
        cuts.push(frac(meridian - a.x, dx));
      }
    }
  }
  cuts.sort((c1, c2) => fCmp(c1, c2));
  const ts: Frac[] = [FZERO, ...cuts, FONE];

  const segs: ScreenSegment[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const p0 = lerpNum(a, b, ts[i]);
    const p1 = lerpNum(a, b, ts[i + 1]);
    const mid = lerpNum(a, b, {
      num: ts[i].num * ts[i + 1].den + ts[i + 1].num * ts[i].den,
      den: 2n * ts[i].den * ts[i + 1].den,
    });
    const k = worldCopy(mid.x);
    segs.push({ a: toStrip(p0, k, project), b: toStrip(p1, k, project) });
  }
  return segs;
}

/** 数值插值（仅用于渲染）。 */
function lerpNum(a: Point, b: Point, t: Frac): { x: number; y: number } {
  const tn = fToNumber(t);
  return {
    x: Number(a.x) + (Number(b.x) - Number(a.x)) * tn,
    y: Number(a.y) + (Number(b.y) - Number(a.y)) * tn,
  };
}

/** 将小段端点平移到画面条带 [-180,180]，切口吸附到图缘。 */
function toStrip(p: { x: number; y: number }, k: bigint, project: (q: Point) => XY): XY {
  let x = p.x - Number(k * W);
  if (x > Number(HALF_W)) x = Number(HALF_W);
  if (x < -Number(HALF_W)) x = -Number(HALF_W);
  return project({ x: BigInt(Math.round(x)), y: BigInt(Math.round(p.y)) });
}

/** 单个点（顶点、航路点手柄）规范化到 (-180,180] 后投影。 */
export function projectPoint(p: Point, project: (q: Point) => XY): XY {
  return project({ x: canonicalLon(p.x), y: p.y });
}

/**
 * 等距矩形投影：经度 [-180,180]、纬度 [-80,80] 映射到给定宽高的 SVG。
 */
export function makeProjector(width: number, height: number): (p: Point) => XY {
  return makeMapper(width, height).project;
}

export interface Mapper {
  project: (p: Point) => XY;
  unproject: (s: XY) => { lon: Mi; lat: Mi };
}

export function makeMapper(width: number, height: number): Mapper {
  const sx = width / Number(2n * HALF_W);
  const sy = height / Number(2n * LAT_LIMIT);
  return {
    project: (p) => ({
      x: (Number(p.x) + Number(HALF_W)) * sx,
      y: height - (Number(p.y) + Number(LAT_LIMIT)) * sy,
    }),
    unproject: (s) => ({
      lon: BigInt(Math.round(s.x / sx - Number(HALF_W))),
      lat: BigInt(Math.round((height - s.y) / sy - Number(LAT_LIMIT))),
    }),
  };
}

type PNum = { x: Mi; y: Mi };

/**
 * 禁区可见边：对 k=-1,0,1 三个副本，把每条真实边用 Cohen–Sutherland
 * 裁到画面矩形。与 zoneFillPolygons 同一份裁剪，图缘不会出现重复描边。
 */
export function zoneEdgeSegments(
  zone: BuiltZone,
  project: (p: Point) => XY,
): { a: XY; b: XY; key: string }[] {
  const out: { a: XY; b: XY; key: string }[] = [];
  const n = zone.ccw.length;
  for (const k of [-1n, 0n, 1n]) {
    const shift = k * W;
    for (let i = 0; i < n; i++) {
      const pa = zone.ccw[i];
      const pb = zone.ccw[(i + 1) % n];
      const a: PNum = { x: pa.x + shift, y: pa.y };
      const b: PNum = { x: pb.x + shift, y: pb.y };
      const c = clipSegmentRect(a, b, -HALF_W, HALF_W, -LAT_LIMIT, LAT_LIMIT);
      if (c) {
        // 图缘 ±180° 只由一侧副本绘制：右缘归 k=0，左缘归 k=-1，避免重复描边。
        const onLeftEdge = c[0].x === -HALF_W && c[1].x === -HALF_W;
        const onRightEdge = c[0].x === HALF_W && c[1].x === HALF_W;
        if ((k === 0n && onLeftEdge) || (k === -1n && onRightEdge)) continue;
        out.push({ a: project(c[0]), b: project(c[1]), key: `ze-${k}-${i}` });
      }
    }
  }
  return out;
}

/** 线段对轴对齐矩形裁剪；完全在外返回 null（边界计入）。 */
function clipSegmentRect(
  aIn: PNum,
  bIn: PNum,
  minX: Mi,
  maxX: Mi,
  minY: Mi,
  maxY: Mi,
): [PNum, PNum] | null {
  let a = aIn;
  let b = bIn;
  {
    const code = (p: PNum): number =>
      (p.x < minX ? 1 : 0) | (p.x > maxX ? 2 : 0) | (p.y < minY ? 4 : 0) | (p.y > maxY ? 8 : 0);
    let ca = code(a);
    let cb = code(b);
    for (let iter = 0; iter < 4 && (ca !== 0 || cb !== 0); iter++) {
      if ((ca & cb) !== 0) return null;
      const out = ca !== 0 ? ca : cb;
      const isA = ca !== 0;
      let np: PNum;
      if (out & 1) np = { x: minX, y: a.y + ((b.y - a.y) * (minX - a.x)) / (b.x - a.x) };
      else if (out & 2) np = { x: maxX, y: a.y + ((b.y - a.y) * (maxX - a.x)) / (b.x - a.x) };
      else if (out & 4) np = { x: a.x + ((b.x - a.x) * (minY - a.y)) / (b.y - a.y), y: minY };
      else np = { x: a.x + ((b.x - a.x) * (maxY - a.y)) / (b.y - a.y), y: maxY };
      if (isA) {
        a = np;
        ca = code(a);
      } else {
        b = np;
        cb = code(b);
      }
    }
  }
  return [a, b];
}

/**
 * 禁区填充：检查 k=-1,0,1 三个世界副本，用 Sutherland–Hodgman
 * 裁到画面矩形 [-180,180]×[-80,80]。凸多边形被凸矩形裁剪仍为凸。
 */
export function zoneFillPolygons(zone: BuiltZone, project: (p: Point) => XY): XY[][] {
  const polys: XY[][] = [];
  for (const k of [-1n, 0n, 1n]) {
    const shift = k * W;
    const poly = clipRect(
      zone.ccw.map((p) => ({ x: p.x + shift, y: p.y })),
      -HALF_W,
      HALF_W,
      -LAT_LIMIT,
      LAT_LIMIT,
    );
    if (poly.length >= 3) polys.push(poly.map(project));
  }
  return polys;
}

function clipRect(polyIn: PNum[], minX: Mi, maxX: Mi, minY: Mi, maxY: Mi): PNum[] {
  let out = polyIn;
  out = clipHalf(out, (p) => p.x >= minX, (a, b) => ({
    x: minX,
    y: a.y + ((b.y - a.y) * (minX - a.x)) / (b.x - a.x),
  }));
  out = clipHalf(out, (p) => p.x <= maxX, (a, b) => ({
    x: maxX,
    y: a.y + ((b.y - a.y) * (maxX - a.x)) / (b.x - a.x),
  }));
  out = clipHalf(out, (p) => p.y >= minY, (a, b) => ({
    x: a.x + ((b.x - a.x) * (minY - a.y)) / (b.y - a.y),
    y: minY,
  }));
  out = clipHalf(out, (p) => p.y <= maxY, (a, b) => ({
    x: a.x + ((b.x - a.x) * (maxY - a.y)) / (b.y - a.y),
    y: maxY,
  }));
  return out;
}

function clipHalf(
  poly: PNum[],
  inside: (p: PNum) => boolean,
  intersect: (a: PNum, b: PNum) => PNum,
): PNum[] {
  if (!poly.length) return [];
  const out: PNum[] = [];
  let prev = poly[poly.length - 1];
  let prevIn = inside(prev);
  for (const cur of poly) {
    const curIn = inside(cur);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
    prev = cur;
    prevIn = curIn;
  }
  return out;
}

/** 百万分之一度 -> 度数字串。 */
export function microDeg(m: Mi | number, digits = 6): string {
  const d = Number(m) / Number(MICRO);
  return `${d.toFixed(digits).replace(/\.?0+$/, '')}°`;
}

export function fracDeg(f: Frac, digits = 6): string {
  const d = fToNumber(f) / Number(MICRO);
  return `${d.toFixed(digits).replace(/\.?0+$/, '')}°`;
}
