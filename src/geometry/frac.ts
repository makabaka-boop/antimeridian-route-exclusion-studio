import type { Frac, Mi, Point } from './types';

/** bigint 绝对值。 */
export function absB(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function gcdB(a: bigint, b: bigint): bigint {
  a = absB(a);
  b = absB(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1n;
}

/** 约分分数，保证 den > 0。 */
export function frac(num: bigint, den: bigint): Frac {
  if (den === 0n) throw new Error('分母为零');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcdB(num, den);
  return { num: num / g, den: den / g };
}

export function fAdd(a: Frac, b: Frac): Frac {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

/** 整数加分数。 */
export function fAddInt(a: Frac, n: bigint): Frac {
  return frac(a.num + n * a.den, a.den);
}

export function fSub(a: Frac, b: Frac): Frac {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function fCmp(a: Frac, b: Frac): number {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l === r ? 0 : l < r ? -1 : 1;
}

export function fMax(a: Frac, b: Frac): Frac {
  return fCmp(a, b) >= 0 ? a : b;
}

export function fMin(a: Frac, b: Frac): Frac {
  return fCmp(a, b) <= 0 ? a : b;
}

export const FZERO: Frac = { num: 0n, den: 1n };
export const FONE: Frac = { num: 1n, den: 1n };

export function fToNumber(a: Frac): number {
  return Number(a.num) / Number(a.den);
}

/** 整数点按分数参数做精确线性插值。 */
export function lerpPoint(a: Point, b: Point, t: Frac): { x: Frac; y: Frac } {
  return {
    x: frac(a.x * t.den + (b.x - a.x) * t.num, t.den),
    y: frac(a.y * t.den + (b.y - a.y) * t.num, t.den),
  };
}

/** floor 整除（向负无穷取整）。 */
export function floorDiv(a: Mi, b: Mi): bigint {
  const q = a / b;
  const r = a % b;
  if (r !== 0n && (r < 0n) !== (b < 0n)) return q - 1n;
  return q;
}

export function minB(a: Mi, b: Mi): Mi {
  return a < b ? a : b;
}

export function maxB(a: Mi, b: Mi): Mi {
  return a > b ? a : b;
}
