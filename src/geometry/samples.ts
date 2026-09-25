import type { LatLon } from './types';

export interface Sample {
  name: string;
  desc: string;
  zone: LatLon[];
  route: LatLon[];
}

const ll = (lon: number, lat: number): LatLon => ({
  lon: BigInt(Math.round(lon * 1_000_000)),
  lat: BigInt(Math.round(lat * 1_000_000)),
});

/** 默认示例：跨 ±180° 的凸禁区 + 横穿的航路。 */
export const SAMPLE_CROSS: Sample = {
  name: '跨日界线',
  desc: '禁区横跨 ±180°，航路自西向东穿入、穿出',
  zone: [ll(170, -10), ll(-170, -10), ll(-170, 10), ll(170, 10)],
  route: [ll(150, 0), ll(-150, 0)],
};

/** 顶点擦过：航路恰好经过禁区角点，产生零长度区间。 */
export const SAMPLE_GRAZE: Sample = {
  name: '顶点擦过',
  desc: '航路只碰到右下角点，得到单点区间',
  zone: [ll(10, -5), ll(20, -5), ll(20, 10), ll(10, 10)],
  route: [ll(15, -10), ll(25, 0)],
};

/** 沿边行走 + 边上共线顶点。 */
export const SAMPLE_EDGE: Sample = {
  name: '沿边行走',
  desc: '航路沿禁区顶边行走；禁区含共线顶点',
  zone: [ll(-30, -10), ll(30, -10), ll(30, 10), ll(0, 10), ll(-30, 10)],
  route: [ll(-50, 10), ll(50, 10), ll(50, -20)],
};

/** 顶点落在 ±180° 经线上（边不与日界线重合），跨线闭合环。 */
export const SAMPLE_VERTEX_LINE: Sample = {
  name: '顶点压线',
  desc: '两个顶点恰在 180° 经线上，闭合环跨日界线',
  zone: [ll(170, -10), ll(180, -10), ll(180, 10), ll(170, 10)],
  route: [ll(160, 0), ll(-160, 0)],
};

/** 绕整圈的航路，两次经过同一禁区。 */
export const SAMPLE_WIND: Sample = {
  name: '绕整圈',
  desc: '航路按短弧绕地球一整圈，两次穿过跨线禁区',
  zone: [ll(170, -10), ll(-170, -10), ll(-170, 10), ll(170, 10)],
  route: [ll(0, 0), ll(120, 0), ll(-120, 0), ll(0, 0)],
};

export const SAMPLES: Sample[] = [
  SAMPLE_CROSS,
  SAMPLE_GRAZE,
  SAMPLE_EDGE,
  SAMPLE_VERTEX_LINE,
  SAMPLE_WIND,
];
