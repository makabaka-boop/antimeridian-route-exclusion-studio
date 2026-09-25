/**
 * 坐标一律以「整数百万分之一度」（microdegree）存储，全程用 bigint
 * 做精确整数运算，渲染时才换算为 number。
 */

export type Mi = bigint;

/** 平面（展开后）上的点，单位百万分之一度。 */
export interface Point {
  x: Mi;
  y: Mi;
}

/** 原始输入点：经纬度，单位百万分之一度。 */
export interface LatLon {
  lat: Mi;
  lon: Mi;
}

/** 约分后的有理数，den > 0。 */
export interface Frac {
  num: bigint;
  den: bigint;
}

/** 单段（2 个航路点之间）在禁区内的参数区间，t ∈ [0,1]。 */
export interface SegmentInterval {
  /** 该段在整条航路中的序号，从 0 开始。 */
  seg: number;
  lo: Frac;
  hi: Frac;
}

/** 合并后的整条航路参数区间 [lo, hi]，使用全局参数（段数为整数部分）。 */
export interface GlobalInterval {
  lo: Frac;
  hi: Frac;
}

/** 进入 / 离开的见证点：精确分数参数与展开平面坐标。 */
export interface Witness {
  /** 全局参数 t（所在段序号为整数部分）。 */
  t: Frac;
  point: { x: Frac; y: Frac };
  /** 命中的禁区边（1 起，沿用输入顶点顺序），顶点擦过时取较小者。 */
  edge: number;
  kind: 'enter' | 'leave';
}

/** 被截航路的一个连续片段（位于禁区内），画面与区间表共用此结构。 */
export interface InsidePiece {
  /** 片段包含的段下标（升序、相邻段共享中间航路点）。 */
  segs: number[];
  points: Point[];
  enter?: Witness;
  leave?: Witness;
}

export interface BuiltZone {
  /** 按输入顺序的原始点（用于交互编辑/标注）。 */
  raw: LatLon[];
  /** 短弧展开后的点。 */
  frame: Point[];
  /** 逆时针（CCW）顺序的顶点，与 frame 坐标同一展开系。 */
  ccw: Point[];
  /** ccw[i] 对应回 frame 的下标。 */
  ccwToFrame: number[];
  /** 是否翻转了输入方向。 */
  clockwiseInput: boolean;
  minX: Mi;
  maxX: Mi;
  minY: Mi;
  maxY: Mi;
}

export interface BuiltRoute {
  raw: LatLon[];
  frame: Point[];
  minX: Mi;
  maxX: Mi;
}

export interface AnalyzeResult {
  ok: true;
  zone: BuiltZone;
  route: BuiltRoute;
  pieces: InsidePiece[];
  witnesses: Witness[];
  /** 合并后区间（全局参数），与 pieces 一一对应。 */
  intervals: GlobalInterval[];
}

export interface Reject {
  ok: false;
  errors: string[];
}

export interface ZoneOk {
  ok: true;
  zone: BuiltZone;
}

export interface RouteOk {
  ok: true;
  route: BuiltRoute;
}
