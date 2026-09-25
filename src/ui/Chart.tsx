import { useMemo, useRef, useState } from 'react';
import type { AnalyzeResult, BuiltRoute, BuiltZone, Mi, Point } from '../geometry/types';
import {
  makeMapper,
  projectPoint,
  splitEdge,
  zoneEdgeSegments,
  zoneFillPolygons,
  type XY,
} from '../geometry/render';
import { HALF_W, LAT_LIMIT, MICRO } from '../geometry/constants';
import { fToNumber } from '../geometry/frac';
import { canonicalLon } from '../geometry/unwrap';

export type DragTarget =
  | { kind: 'zone'; index: number }
  | { kind: 'route'; index: number };

interface Props {
  zone: BuiltZone | null;
  route: BuiltRoute | null;
  result: AnalyzeResult | null;
  activeInterval: number | null;
  onDragPoint: (target: DragTarget, lon: Mi, lat: Mi) => void;
}

const W = 820;
const H = 520;

export function Chart({ zone, route, result, activeInterval, onDragPoint }: Props) {
  const mapper = useMemo(() => makeMapper(W, H), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragTarget | null>(null);

  const toSvgPoint = (clientX: number, clientY: number): XY => {
    const rect = svgRef.current!.getBoundingClientRect();
    const vb = svgRef.current!.viewBox.baseVal;
    return {
      x: ((clientX - rect.left) / rect.width) * vb.width,
      y: ((clientY - rect.top) / rect.height) * vb.height,
    };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const s = toSvgPoint(e.clientX, e.clientY);
    const g = mapper.unproject(s);
    // 拖到图缘 ±180° 时保持 180 表示；其余为规范经度。
    onDragPoint(drag, canonicalLon(g.lon), g.lat);
  };

  const zoneFills = zone ? zoneFillPolygons(zone, mapper.project) : [];
  const zoneEdges = useMemo(() => {
    if (!zone) return [];
    return zoneEdgeSegments(zone, mapper.project);
  }, [zone, mapper]);

  const routeEdges = useMemo(() => {
    if (!route) return [];
    const out: { a: XY; b: XY; key: string }[] = [];
    route.frame.forEach((p, i) => {
      if (i + 1 >= route.frame.length) return;
      splitEdge(p, route.frame[i + 1], mapper.project).forEach((s, j) =>
        out.push({ a: s.a, b: s.b, key: `re-${i}-${j}` }),
      );
    });
    return out;
  }, [route, mapper]);

  const pieceSegments = useMemo(() => {
    if (!result) return [];
    return result.pieces.map((piece, pi) => {
      const segs: { a: XY; b: XY }[] = [];
      for (let i = 0; i + 1 < piece.points.length; i++) {
        segs.push(...splitEdge(piece.points[i], piece.points[i + 1], mapper.project));
      }
      return { pi, segs };
    });
  }, [result, mapper]);

  const grid = [];
  for (let lon = -180; lon <= 180; lon += 30) {
    const a = mapper.project({ x: BigInt(lon) * MICRO, y: -LAT_LIMIT });
    const b = mapper.project({ x: BigInt(lon) * MICRO, y: LAT_LIMIT });
    const isDate = Math.abs(lon) === 180;
    grid.push(
      <line
        key={`gx-${lon}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={isDate ? 'var(--dateline)' : '#1c2740'}
        strokeWidth={isDate ? 1.6 : 1}
        strokeDasharray={isDate ? '6 4' : undefined}
      />,
    );
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    const a = mapper.project({ x: -HALF_W, y: BigInt(lat) * MICRO });
    const b = mapper.project({ x: HALF_W, y: BigInt(lat) * MICRO });
    grid.push(
      <line
        key={`gy-${lat}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={lat === 0 ? '#28365c' : '#1c2740'}
        strokeWidth={1}
      />,
    );
  }

  return (
    <svg
      ref={svgRef}
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {grid}

      {/* 禁区填充（跨日界线时左右图缘各一块） */}
      {zoneFills.map((poly, i) => (
        <polygon
          key={`zf-${i}`}
          points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="var(--zone)"
          stroke="none"
        />
      ))}

      {/* 禁区边（日界线处分段） */}
      {zoneEdges.map((e) => (
        <line
          key={e.key}
          x1={e.a.x}
          y1={e.a.y}
          x2={e.b.x}
          y2={e.b.y}
          stroke="var(--zone-edge)"
          strokeWidth={2}
        />
      ))}

      {/* 完整航路（浅色底） */}
      {routeEdges.map((e) => (
        <line
          key={e.key}
          x1={e.a.x}
          y1={e.a.y}
          x2={e.b.x}
          y2={e.b.y}
          stroke="var(--route)"
          strokeWidth={1.6}
          opacity={0.7}
        />
      ))}

      {/* 被截航路：区间表与画面共用 pieces 这一份数据 */}
      {pieceSegments.map(({ pi, segs }) => {
        const active = activeInterval === pi;
        return segs.map((s, j) => (
          <line
            key={`pi-${pi}-${j}`}
            x1={s.a.x}
            y1={s.a.y}
            x2={s.b.x}
            y2={s.b.y}
            stroke="var(--inside)"
            strokeWidth={active ? 6 : 3.4}
            strokeLinecap="round"
            opacity={activeInterval === null || active ? 1 : 0.45}
          />
        ));
      })}

      {/* 进入/离开见证 */}
      {result?.witnesses.map((w, i) => {
        const p = projectPoint(
          {
            x: BigInt(Math.round(fToNumber(w.point.x))),
            y: BigInt(Math.round(fToNumber(w.point.y))),
          },
          mapper.project,
        );
        return (
          <g key={`w-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={5}
              fill={w.kind === 'enter' ? 'var(--inside)' : '#ffb38a'}
              stroke="#0b1120"
              strokeWidth={1.5}
            />
            <text
              x={p.x + 7}
              y={p.y - 6}
              className="label-text"
              fill={w.kind === 'enter' ? 'var(--inside)' : '#ffb38a'}
            >
              {w.kind === 'enter' ? '进入' : '离开'}·边{w.edge}
            </text>
          </g>
        );
      })}

      {/* 禁区顶点手柄 */}
      {zone?.frame.map((p: Point, i) => {
        const s = projectPoint(p, mapper.project);
        return (
          <g key={`zh-${i}`} className="handle" onPointerDown={() => setDrag({ kind: 'zone', index: i })}>
            <rect x={s.x - 5} y={s.y - 5} width={10} height={10} fill="var(--zone-edge)" stroke="#0b1120" />
            <text x={s.x + 7} y={s.y + 12} className="label-text">{i + 1}</text>
          </g>
        );
      })}

      {/* 航路点手柄 */}
      {route?.frame.map((p: Point, i) => {
        const s = projectPoint(p, mapper.project);
        return (
          <circle
            key={`rh-${i}`}
            className="handle"
            cx={s.x}
            cy={s.y}
            r={5}
            fill="var(--route)"
            stroke="#0b1120"
            strokeWidth={1.5}
            onPointerDown={() => setDrag({ kind: 'route', index: i })}
          />
        );
      })}
    </svg>
  );
}
