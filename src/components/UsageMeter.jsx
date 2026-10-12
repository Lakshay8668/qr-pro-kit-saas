// src/components/UsageMeter.jsx — "12 of 50 used" progress bar; turns amber at 80% and red at 100%.
export default function UsageMeter({ label, used, limit, hint }) {
  const isUnlimited = limit >= 99999999;
  const pct = isUnlimited ? 0 : limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = isUnlimited ? "ok" : used >= limit ? "full" : pct >= 80 ? "warn" : "ok";
  const f = (n) => Number(n).toLocaleString("en-IN");
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{f(used)} <em>/ {isUnlimited ? "∞ Unlimited" : f(limit)}</em></strong>
      </div>
      <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={isUnlimited ? 100 : limit} aria-valuenow={used} aria-label={label}>
        <div className={`meter-fill ${tone}`} style={{ width: `${isUnlimited ? 0 : pct}%` }} />
      </div>
      {hint && <div className="meter-hint">{hint}</div>}
    </div>
  );
}
