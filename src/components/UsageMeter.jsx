// src/components/UsageMeter.jsx — "12 of 50 used" progress bar; turns amber at 80% and red at 100%.
export default function UsageMeter({ label, used, limit, hint }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = used >= limit ? "full" : pct >= 80 ? "warn" : "ok";
  const f = (n) => Number(n).toLocaleString("en-IN");
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{f(used)} <em>/ {f(limit)}</em></strong>
      </div>
      <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <div className="meter-hint">{hint}</div>}
    </div>
  );
}
