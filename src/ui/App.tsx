import { useMemo, useState } from 'react';
import { analyzeRoute, buildRoute, buildZone } from '../geometry/clip';
import type { AnalyzeResult, LatLon } from '../geometry/types';
import { fToNumber } from '../geometry/frac';
import type { Frac } from '../geometry/types';
import { fracDeg, microDeg } from '../geometry/render';
import { SAMPLES, type Sample } from '../geometry/samples';
import { PointEditor } from './PointEditor';
import { Chart, type DragTarget } from './Chart';

const clone = (s: Sample) => ({ zone: s.zone.map((p) => ({ ...p })), route: s.route.map((p) => ({ ...p })) });

function paramText(t: Frac): string {
  return `${fToNumber(t).toFixed(6).replace(/\.?0+$/, '')}`;
}

export function App() {
  const [zoneRaw, setZoneRaw] = useState<LatLon[]>(() => clone(SAMPLES[0]).zone);
  const [routeRaw, setRouteRaw] = useState<LatLon[]>(() => clone(SAMPLES[0]).route);
  const [active, setActive] = useState<number | null>(null);

  const zr = useMemo(() => buildZone(zoneRaw), [zoneRaw]);
  const rr = useMemo(() => buildRoute(routeRaw), [routeRaw]);
  const errors = [
    ...(!zr.ok ? zr.errors : []),
    ...(!rr.ok ? rr.errors : []),
  ];

  const result: AnalyzeResult | null = useMemo(() => {
    if (!zr.ok || !rr.ok) return null;
    const a = analyzeRoute(zr.zone, rr.route);
    return a.ok ? a : null;
  }, [zr, rr]);

  const loadSample = (s: Sample) => {
    const c = clone(s);
    setZoneRaw(c.zone);
    setRouteRaw(c.route);
    setActive(null);
  };

  const onDragPoint = (target: DragTarget, lon: bigint, lat: bigint) => {
    if (target.kind === 'zone') {
      setZoneRaw((prev) => prev.map((p, i) => (i === target.index ? { lon, lat } : p)));
    } else {
      setRouteRaw((prev) => prev.map((p, i) => (i === target.index ? { lon, lat } : p)));
    }
  };

  return (
    <div className="app">
      <div className="panel">
        <h2>输入数据</h2>
        <div className="meta">坐标以整数百万分之一度存储；图中可直接拖拽顶点（拖到图缘即在 ±180°）。</div>
        <h3>示例</h3>
        <div className="samples">
          {SAMPLES.map((s) => (
            <button key={s.name} title={s.desc} onClick={() => loadSample(s)}>
              {s.name}
            </button>
          ))}
        </div>
        <PointEditor title="禁区顶点（3～20，凸）" points={zoneRaw} onChange={setZoneRaw} min={-540} max={540} />
        <PointEditor title="航路点（2～80）" points={routeRaw} onChange={setRouteRaw} min={-540} max={540} />
        {errors.length > 0 && (
          <div className="errors">
            <strong>输入被拒绝：</strong>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {zr.ok && (
          <div className="meta" style={{ marginTop: 10 }}>
            禁区：{zr.zone.raw.length} 顶点，
            {zr.zone.clockwiseInput ? '输入为顺时针（已统一为 CCW 判定）' : '输入为逆时针'}；
            展开经度 {microDeg(zr.zone.minX, 2)} ~ {microDeg(zr.zone.maxX, 2)}
          </div>
        )}
      </div>

      <div className="chart-wrap">
        <div className="chart-title">
          <h2 style={{ margin: 0 }}>Chart（纯 SVG，无在线地图瓦片）</h2>
          <span className="hint">橙色：禁区　蓝色：航路　绿色：位于禁区内的被截航路　黄虚线：±180° 日界线</span>
        </div>
        <Chart
          zone={zr.ok ? zr.zone : null}
          route={rr.ok ? rr.route : null}
          result={result}
          activeInterval={active}
          onDragPoint={onDragPoint}
        />
        <div className="legend">
          <span className="l-zone">禁区（填充与边）</span>
          <span className="l-route">完整航路</span>
          <span className="l-inside">禁区内航路（与右侧区间表同源）</span>
          <span className="l-date">日界线 ±180°</span>
        </div>
      </div>

      <div className="panel">
        <h2>参数区间与见证</h2>
        {!result ? (
          <div className="empty">输入有效后在此列出航路位于禁区内的参数区间。</div>
        ) : result.pieces.length === 0 ? (
          <div className="empty">航路与禁区无任何交点（边界计入，擦过也会给出零长度区间）。</div>
        ) : (
          <>
            <div className="meta">
              共 {result.pieces.length} 段被截航路；全局参数 t 的整数部分为航路段号。点击行可在图上高亮同一被截航路。
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>t 进入</th>
                  <th>t 离开</th>
                  <th>进入见证（经度,纬度 / 边）</th>
                  <th>离开见证</th>
                </tr>
              </thead>
              <tbody>
                {result.pieces.map((piece, i) => {
                  const iv = result.intervals[i];
                  return (
                    <tr
                      key={i}
                      className={`interval${active === i ? ' active' : ''}`}
                      onClick={() => setActive(active === i ? null : i)}
                    >
                      <td>{i + 1}</td>
                      <td>{paramText(iv.lo)}</td>
                      <td>{paramText(iv.hi)}</td>
                      <td>
                        {piece.enter ? (
                          <span className="witness-enter">
                            {fracDeg(piece.enter.point.x)}, {fracDeg(piece.enter.point.y)} ·边
                            {piece.enter.edge}
                          </span>
                        ) : (
                          <span className="pill">航路起点</span>
                        )}
                      </td>
                      <td>
                        {piece.leave ? (
                          <span className="witness-leave">
                            {fracDeg(piece.leave.point.x)}, {fracDeg(piece.leave.point.y)} ·边
                            {piece.leave.edge}
                          </span>
                        ) : (
                          <span className="pill">航路终点</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3>全部见证（按航路顺序）</h3>
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>全局 t</th>
                  <th>展开平面经度</th>
                  <th>纬度</th>
                  <th>边</th>
                </tr>
              </thead>
              <tbody>
                {result.witnesses.map((w, i) => (
                  <tr key={i}>
                    <td className={w.kind === 'enter' ? 'witness-enter' : 'witness-leave'}>
                      {w.kind === 'enter' ? '进入' : '离开'}
                    </td>
                    <td>{paramText(w.t)}</td>
                    <td>{fracDeg(w.point.x)}</td>
                    <td>{fracDeg(w.point.y)}</td>
                    <td>{w.edge}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
