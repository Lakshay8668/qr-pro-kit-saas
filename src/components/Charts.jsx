// src/components/Charts.jsx — tiny dependency-free charts shared by customer + admin dashboards
export function Bars({ items, height = 90 }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="bars" style={{ height }}>
      {items.map((i, idx) => (
        <div key={idx} className="bar-col" title={`${i.label}: ${i.count}`}>
          <div className="bar" style={{ height: `${(i.count / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export function Breakdown({ title, rows }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  return (
    <div className="break">
      <h4>{title}</h4>
      {rows.length === 0 && <p className="dash-muted">No data yet</p>}
      {rows.map((r) => (
        <div key={r.label} className="break-row">
          <span>{r.label}</span>
          <span className="break-bar">
            <i style={{ width: `${(r.count / total) * 100}%` }} />
          </span>
          <b>{r.count}</b>
        </div>
      ))}
    </div>
  );
}
