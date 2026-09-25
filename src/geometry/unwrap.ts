import { HALF_W, LON_LIMIT, LAT_LIMIT, MICRO, W } from './constants';
import type { Mi } from './types';
import { floorDiv } from './frac';

/** 规范化到 (-180°, 180°]：180° 保留为 +180，-180 变为 +180。 */
export function canonicalLon(lon: Mi): Mi {
  let x = lon - floorDiv(lon + HALF_W - 1n, W) * W;
  // floorDiv((lon + 179.999999), 360)：lon=180 -> 0；lon=-180 -> -1，归到 +180
  if (x <= -HALF_W) x += W;
  if (x > HALF_W) x -= W;
  return x;
}

export function inLonRange(lon: Mi): boolean {
  return lon >= -LON_LIMIT && lon <= LON_LIMIT;
}

export function inLatRange(lat: Mi): boolean {
  return lat >= -LAT_LIMIT && lat <= LAT_LIMIT;
}

/**
 * 短弧展开：从前一点经度 prev 出发，选与 prev 相差不超过 180° 的等价表示。
 * 恰好相差 180° 为歧义，ambiguous=true。
 */
export function shortArcNext(prev: Mi, lon: Mi): { x: Mi; ambiguous: boolean } {
  const d0 = lon - prev;
  const k = floorDiv(d0 + HALF_W, W);
  const d = d0 - k * W; // (-180, 180]
  if (d === HALF_W || d === -HALF_W) {
    return { x: prev + d, ambiguous: true };
  }
  return { x: prev + d, ambiguous: false };
}

export interface UnwrapResult {
  points: Mi[];
  errors: string[];
}

/**
 * 将经度序列按短弧展开。起点规范化到 (-180,180]，之后每跳取最短弧。
 * 任一跳恰好 180° 即报歧义错误。
 */
export function unwrapLongitudes(lons: Mi[]): UnwrapResult {
  const errors: string[] = [];
  if (lons.length === 0) return { points: [], errors };
  const points: Mi[] = [canonicalLon(lons[0])];
  for (let i = 1; i < lons.length; i++) {
    const r = shortArcNext(points[i - 1], lons[i]);
    if (r.ambiguous) {
      errors.push(`第 ${i + 1} 点与前一点经度恰好相差 180°，边的走向有歧义`);
    }
    points.push(r.x);
  }
  return { points, errors };
}

/** 供 UI 显示：百万分之一度 -> 度（number）。 */
export function microToDeg(m: Mi | number): number {
  return Number(m) / Number(MICRO);
}

/** 供 UI 解析：度（number）-> 百万分之一度整数。 */
export function degToMicro(d: number): Mi {
  return BigInt(Math.round(d * Number(MICRO)));
}
