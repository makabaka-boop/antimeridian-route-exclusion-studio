import { describe, expect, it } from 'vitest';
import { buildRoute, buildZone, analyzeRoute } from '../src/geometry/clip';
import { canonicalLon, shortArcNext, unwrapLongitudes } from '../src/geometry/unwrap';
import { frac, fCmp, fAddInt } from '../src/geometry/frac';
import { makeProjector, projectPoint, splitEdge, zoneEdgeSegments, zoneFillPolygons } from '../src/geometry/render';
import type { LatLon, Mi } from '../src/geometry/types';

const d = (v: number): Mi => BigInt(v * 1_000_000);
const ll = (lon: number, lat: number): LatLon => ({ lon: d(lon), lat: d(lat) });

function expectOk<T extends { ok: boolean }>(r: T): asserts r is Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('期望成功却被拒绝');
}

function expectReject(r: { ok: boolean; errors?: string[] }, includes?: string) {
  expect(r.ok).toBe(false);
  if (includes && r.errors) {
    expect(r.errors.join(';')).toContain(includes);
  }
}

// 普通矩形禁区：经度 [10,20]，纬度 [-5,10]，CCW。
const SQUARE: LatLon[] = [ll(10, -5), ll(20, -5), ll(20, 10), ll(10, 10)];

describe('短弧展开与规范化', () => {
  it('经度规范化到 (-180,180]，-180 归为 +180', () => {
    expect(canonicalLon(d(170))).toBe(d(170));
    expect(canonicalLon(d(-170))).toBe(d(-170));
    expect(canonicalLon(d(180))).toBe(d(180));
    expect(canonicalLon(d(-180))).toBe(d(180));
    expect(canonicalLon(d(190))).toBe(d(-170));
    expect(canonicalLon(d(-190))).toBe(d(170));
    expect(canonicalLon(d(540))).toBe(d(180));
  });

  it('相邻经度按短弧选择世界副本', () => {
    expect(shortArcNext(d(170), d(-170)).x).toBe(d(190));
    expect(shortArcNext(d(-170), d(170)).x).toBe(d(-190));
    expect(shortArcNext(d(10), d(350)).x).toBe(d(-10));
  });

  it('恰好相差 180° 报歧义', () => {
    expect(shortArcNext(d(10), d(190)).ambiguous).toBe(true);
    const u = unwrapLongitudes([d(0), d(180)]);
    expect(u.errors.length).toBe(1);
  });

  it('绕整圈的航路按短弧累计：0→120→-120→0 展开为 0,120,240,360', () => {
    const u = unwrapLongitudes([d(0), d(120), d(-120), d(0)]);
    expectOk({ ok: u.errors.length === 0 });
    expect(u.points).toEqual([d(0), d(120), d(240), d(360)]);
  });

  it('短弧始终取最近副本：150↔-150 在 150 与 210 之间振荡，不绕圈', () => {
    const u = unwrapLongitudes([d(150), d(-150), d(150), d(-150)]);
    expectOk({ ok: u.errors.length === 0 });
    expect(u.points).toEqual([d(150), d(210), d(150), d(210)]);
  });
});

describe('禁区校验', () => {
  it('接受凸矩形（含顺时针输入）', () => {
    expectOk(buildZone(SQUARE));
    const cw = [...SQUARE].reverse();
    const r = buildZone(cw);
    expectOk(r);
    expect(r.zone.clockwiseInput).toBe(true);
  });

  it('拒绝非凸（凹四边形）', () => {
    const concave = [ll(0, 0), ll(20, 0), ll(5, 5), ll(20, 10), ll(0, 10)];
    expectReject(buildZone(concave), '非凸');
  });

  it('拒绝自交蝴蝶结', () => {
    const bowtie = [ll(0, 0), ll(20, 10), ll(20, 0), ll(0, 10)];
    expectReject(buildZone(bowtie), '非凸');
  });

  it('拒绝顶点数越界、坐标越界', () => {
    expectReject(buildZone([ll(0, 0), ll(1, 1)]));
    expectReject(buildZone([ll(0, 81), ll(10, 81), ll(10, 0)]), '纬度');
    expectReject(buildZone([ll(541, 0), ll(10, 0), ll(10, 10)]), '经度');
  });

  it('拒绝共线退化（往返描边）多边形', () => {
    // 0→10→20→0：闭合边走回头路，叉积全为零且伴随退化，必须拒绝
    expectReject(buildZone([ll(0, 0), ll(10, 0), ll(20, 0), ll(0, 0)]));
  });

  it('接受共线但仍有面积的凸多边形（边上多出顶点）', () => {
    expectOk(buildZone([ll(10, -5), ll(15, -5), ll(20, -5), ll(20, 10), ll(10, 10)]));
  });

  it('拒绝含 180° 歧义边的禁区', () => {
    expectReject(buildZone([ll(0, 0), ll(180, 5), ll(0, 10)]), '180');
  });
});

describe('平面直线裁剪', () => {
  it('穿过矩形的一段给出精确进入/离开参数', () => {
    const r = analyzeRoute(SQUARE, [ll(5, 2.5), ll(25, 2.5)]) as any;
    expect(r.ok).not.toBe(false);
    expect(r.intervals).toHaveLength(1);
    expect(fCmp(r.intervals[0].lo, frac(5n, 20n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, frac(15n, 20n))).toBe(0);
  });

  it('边界计入：落在边界外切线返回空', () => {
    // y=-6，完全在外，与底边平行
    const r = analyzeRoute(SQUARE, [ll(12, -6), ll(18, -6)]) as any;
    expect(r.pieces).toHaveLength(0);
  });

  it('沿边行走：整段在禁区内，无进入/离开见证', () => {
    // 沿底边 y=-5 从 x=12 到 x=18
    const r = analyzeRoute(SQUARE, [ll(12, -5), ll(18, -5)]) as any;
    expect(r.intervals).toHaveLength(1);
    expect(fCmp(r.intervals[0].lo, frac(0n, 1n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, frac(1n, 1n))).toBe(0);
    expect(r.pieces[0].enter).toBeUndefined();
    expect(r.pieces[0].leave).toBeUndefined();
  });

  it('顶点擦过：产生零长度（单点）区间', () => {
    // 直线穿过右下角 (20,-5)：y = x - 25，从 (15,-10) 到 (25,0)
    const r = analyzeRoute(SQUARE, [ll(15, -10), ll(25, 0)]) as any;
    expect(r.intervals).toHaveLength(1);
    expect(fCmp(r.intervals[0].lo, r.intervals[0].hi)).toBe(0);
    expect(fCmp(r.intervals[0].lo, frac(1n, 2n))).toBe(0);
    expect(r.pieces[0].points).toHaveLength(1);
    expect(r.pieces[0].points[0]).toEqual({ x: d(20), y: d(-5) });
  });

  it('顶点进入：从角点进入并贯穿，角点为进入见证', () => {
    // 从左下 (10,-5) 进入（t=2/5），到 (17.5,10) 顶边离开（t=1）
    const r = analyzeRoute(SQUARE, [ll(5, -10), ll(17.5, 10)]) as any;
    expect(r.intervals).toHaveLength(1);
    expect(fCmp(r.intervals[0].lo, frac(2n, 5n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, frac(1n, 1n))).toBe(0);
  });

  it('多段航路：区间跨段相接时合并，画面片段共享航路点', () => {
    const route = [ll(5, 2.5), ll(15, 2.5), ll(25, 2.5)];
    const r = analyzeRoute(SQUARE, route) as any;
    expect(r.intervals).toHaveLength(1);
    // 段0在 t=0.5 进入；段1在 t=0.5 离开 => 全局 [0.5,1.5]
    expect(fCmp(r.intervals[0].lo, frac(1n, 2n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, fAddInt(frac(1n, 2n), 1n))).toBe(0);
    expect(r.pieces[0].segs).toEqual([0, 1]);
    expect(r.pieces[0].points).toHaveLength(3);
  });
});

describe('日界线世界副本', () => {
  // 跨 ±180 的禁区：[170,190]×[-5,5]，CCW
  const DATE_ZONE: LatLon[] = [ll(170, -5), ll(-170, -5), ll(-170, 5), ll(170, 5)];

  it('跨线禁区构建：展开为 170..190 的普通矩形', () => {
    const z = buildZone(DATE_ZONE);
    expectOk(z);
    expect(z.zone.minX).toBe(d(170));
    expect(z.zone.maxX).toBe(d(190));
  });

  it('用 -540..540 的等价经度表示同一禁区，结果一致', () => {
    const rep: LatLon[] = [
      { lon: d(170), lat: d(-5) },
      { lon: d(190), lat: d(-5) }, // 与 -170 等价
      { lon: d(-170), lat: d(5) }, // 保持短弧：190 -> -170 差 -360？短弧为 0
      { lon: d(170), lat: d(5) },
    ];
    expectOk(buildZone(rep));
  });

  it('航路 160 -> -160 横穿禁区：区间 [1/4, 3/4]', () => {
    const r = analyzeRoute(DATE_ZONE, [ll(160, 0), ll(-160, 0)]) as any;
    expect(r.intervals).toHaveLength(1);
    expect(fCmp(r.intervals[0].lo, frac(1n, 4n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, frac(3n, 4n))).toBe(0);
    expect(r.pieces[0].points.length).toBe(2);
  });

  it('等价表示 160 -> 200 给出同一区间', () => {
    const r = analyzeRoute(DATE_ZONE, [ll(160, 0), ll(200, 0)]) as any;
    expect(fCmp(r.intervals[0].lo, frac(1n, 4n))).toBe(0);
    expect(fCmp(r.intervals[0].hi, frac(3n, 4n))).toBe(0);
  });

  it('禁区整体平移一个副本（-190..-170）对航路同样命中', () => {
    const shifted: LatLon[] = [ll(-190, -5), ll(-170, -5), ll(-170, 5), ll(-190, 5)];
    const r = analyzeRoute(shifted, [ll(160, 0), ll(-160, 0)]) as any;
    expect(r.intervals).toHaveLength(1);
  });

  it('绕整圈的闭合航路：0→120→-120→0 展开为 0,120,240,360', () => {
    const route = buildRoute([ll(0, 0), ll(120, 0), ll(-120, 0), ll(0, 0)]);
    expectOk(route);
    expect(route.route.frame.map((p) => p.x)).toEqual([d(0), d(120), d(240), d(360)]);
  });

  it('绕整圈航路两次穿过同一跨线禁区', () => {
    const route = [ll(160, 0), ll(-160, 0), ll(160, 0), ll(-160, 0)];
    // 展开：160,200,160? 短弧 200->160 差 -40 => 160；再 ->-160 短弧 +40 => 200
    const rb = buildRoute(route);
    expectOk(rb);
    const r = analyzeRoute(DATE_ZONE, route) as any;
    // 段0: 160..200 命中 [1/4,3/4]；段1: 200..160 反向命中；段2: 160..200 再命中
    expect(r.intervals.length).toBeGreaterThanOrEqual(2);
  });
});

describe('日界线分段绘制', () => {
  const project = makeProjector(720, 320);

  it('跨 180° 的边切成两段，且每段都在画面条带内', () => {
    const segs = splitEdge({ x: d(160), y: d(0) }, { x: d(200), y: d(0) }, project);
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      expect(Math.abs(s.a.x - s.b.x)).toBeLessThan(720 / 4); // 每段仅 20°，远小于整图
      expect(s.a.x).toBeGreaterThanOrEqual(-0.5);
      expect(s.b.x).toBeLessThanOrEqual(720.5);
    }
  });

  it('端点恰在 180°：按行进方向吸附到正确图缘', () => {
    // 180° 向东离开：180 在图上应与东侧 (-179…) 相连，故吸附到左缘 x=0
    const east = splitEdge({ x: d(180), y: d(0) }, { x: d(185), y: d(0) }, project);
    expect(east[0].a.x).toBeCloseTo(0, 4);
    // 向西到达 180：终点吸附右缘 x=720
    const arrive = splitEdge({ x: d(175), y: d(0) }, { x: d(180), y: d(0) }, project);
    expect(arrive[arrive.length - 1].b.x).toBeCloseTo(720, 4);
    // 从 180 向西走：起点吸附右缘
    const back = splitEdge({ x: d(180), y: d(0) }, { x: d(175), y: d(0) }, project);
    expect(back[0].a.x).toBeCloseTo(720, 4);
  });

  it('跨线禁区填充在左右图缘各得到一个多边形', () => {
    const z = buildZone([ll(170, -5), ll(-170, -5), ll(-170, 5), ll(170, 5)]);
    expectOk(z);
    const polys = zoneFillPolygons(z.zone, project);
    expect(polys).toHaveLength(2);
  });

  it('普通禁区填充只得到一个多边形', () => {
    const z = buildZone(SQUARE);
    expectOk(z);
    expect(zoneFillPolygons(z.zone, project)).toHaveLength(1);
  });

  it('顶点压 180° 经线：填充两块，图缘竖边只描一次', () => {
    const z = buildZone([ll(170, -10), ll(180, -10), ll(180, 10), ll(170, 10)]);
    expectOk(z);
    expect(zoneFillPolygons(z.zone, project)).toHaveLength(2);
    const edges = zoneEdgeSegments(z.zone, project);
    // 图缘 x=720 处的竖边只能出现一条
    const rightEdge = edges.filter((e) => Math.abs(e.a.x - 720) < 1e-6 && Math.abs(e.b.x - 720) < 1e-6);
    expect(rightEdge).toHaveLength(1);
  });

  it('跨线禁区边被日界线切成两组，且都在画面内', () => {
    const z = buildZone([ll(170, -5), ll(-170, -5), ll(-170, 5), ll(170, 5)]);
    expectOk(z);
    const edges = zoneEdgeSegments(z.zone, project);
    // 4 条框边 ×（左/右两缘呈现）：上下边各两段，竖边各一 = 6
    expect(edges).toHaveLength(6);
    for (const e of edges) {
      for (const q of [e.a, e.b]) {
        expect(q.x).toBeGreaterThanOrEqual(-0.5);
        expect(q.x).toBeLessThanOrEqual(720.5);
      }
    }
  });

  it('手柄投影把 190° 规范到 -170°', () => {
    const p = projectPoint({ x: d(190), y: d(0) }, project);
    const q = projectPoint({ x: d(-170), y: d(0) }, project);
    expect(p.x).toBeCloseTo(q.x, 4);
  });
});
