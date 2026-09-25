import type { Mi } from './types';

/** 1 度对应的百万分之一度。 */
export const MICRO: Mi = 1_000_000n;
export const W: Mi = 360_000_000n; // 360°
export const HALF_W: Mi = 180_000_000n; // 180°
export const LAT_LIMIT: Mi = 80_000_000n; // ±80°
export const LON_LIMIT: Mi = 540_000_000n; // ±540°
