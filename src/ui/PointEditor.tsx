import type { LatLon } from '../geometry/types';

interface Props {
  title: string;
  points: LatLon[];
  onChange: (points: LatLon[]) => void;
  min: number;
  max: number;
}

/** 以「度」为单位的简单数字表格编辑器，内部仍以整数百万分之一度存储。 */
export function PointEditor({ title, points, onChange, min, max }: Props) {
  const set = (i: number, key: 'lon' | 'lat', text: string) => {
    const v = Number(text);
    if (Number.isNaN(v)) return;
    const next = points.map((p, j) =>
      j === i ? { ...p, [key]: BigInt(Math.round(v * 1_000_000)) } : p,
    );
    onChange(next);
  };

  return (
    <div>
      <h3>
        {title}（{points.length} 点，单位：度）
      </h3>
      {points.map((p, i) => (
        <div className="row" key={i}>
          <span className="idx">{i + 1}</span>
          <input
            type="number"
            step={0.000001}
            min={min}
            max={max}
            value={Number(p.lon) / 1e6}
            onChange={(e) => set(i, 'lon', e.target.value)}
            title="经度（内部按整数百万分之一度存储）"
          />
          <input
            type="number"
            step={0.000001}
            min={-80}
            max={80}
            value={Number(p.lat) / 1e6}
            onChange={(e) => set(i, 'lat', e.target.value)}
            title="纬度"
          />
          <button
            className="del"
            title="删除该点"
            onClick={() => onChange(points.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="actions">
        <button
          onClick={() =>
            onChange([
              ...points,
              { lon: points[points.length - 1]?.lon ?? 0n, lat: points[points.length - 1]?.lat ?? 0n },
            ])
          }
        >
          ＋ 追加
        </button>
      </div>
    </div>
  );
}
