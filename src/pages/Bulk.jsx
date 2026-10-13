// src/pages/Bulk.jsx
// Bulk-create editable QR codes: paste "label,url" lines (or upload a CSV),
// get a ZIP of PNGs + a mapping.csv. Great for tables, products, staff, branches.

import { useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar";
import AuthForm from "../components/AuthForm";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/useAuth";
import { createLinks, dynamicUrlFor } from "../lib/links";
import { useBilling } from "../lib/useBilling";
import { normalizeUrl, isValidHttpUrl } from "../lib/qrPayloads";
import { DEFAULT_DESIGN, SHAPES, EYES, buildQrSvg, svgToPngBlob, downloadBlob } from "../lib/qrRender";

const MAX_ROWS = 200;
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "qr";

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parse(text) {
  const rows = [];
  const bad = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      if (i === 0 && /^(label|name|title)\s*,\s*(url|link|destination)/i.test(line)) return; // header row
      const fields = parseCsvLine(line);
      let label = "";
      let rawUrl = "";
      if (fields.length >= 2) {
        label = fields[0].replace(/^"|"$/g, "").trim();
        rawUrl = fields.slice(1).join(",").replace(/^"|"$/g, "").trim();
      } else {
        rawUrl = fields[0].replace(/^"|"$/g, "").trim();
      }
      const url = normalizeUrl(rawUrl);
      if (isValidHttpUrl(url)) rows.push({ label: label || url, url });
      else bad.push(line);
    });
  return { rows, bad };
}

export default function Bulk({ embedded = false }) {
  const { user, loading } = useAuth();
  const { me, refresh: refreshBilling } = useBilling(user);
  const [upgrade, setUpgrade] = useState(false);
  const [text, setText] = useState("");
  const [design, setDesign] = useState({ ...DEFAULT_DESIGN, frameStyle: "none" });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  if (loading) return <div className="dash-page"><p className="dash-loading">Loading…</p></div>;
  if (!user) return <AuthForm />;

  const patch = (p) => setDesign((d) => ({ ...d, ...p }));

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  };

  const remainingDynamic = me?.limits?.dynamicQrs !== undefined ? Math.max(0, (me?.limits?.dynamicQrs || 0) - (me?.usage?.dynamicQrs || 0)) : null;

  const run = async () => {
    setError("");
    setUpgrade(false);
    setDone("");
    const { rows, bad } = parse(text);
    if (!rows.length) return setError("No valid lines found. Use one per line: label,https://example.com");
    if (rows.length > MAX_ROWS) return setError(`Please keep it to ${MAX_ROWS} rows per batch (you have ${rows.length}).`);
    if (!me?.isAdmin && remainingDynamic !== null && rows.length > remainingDynamic) {
      setUpgrade(true);
      return setError(`Your account has ${remainingDynamic} editable QR codes remaining, but you entered ${rows.length}. Please reduce the list or upgrade your plan.`);
    }

    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const csv = ["label,qr_link,destination"];
      setProgress(`Creating ${rows.length} QR codes…`);
      // one server call, all-or-nothing: either every QR is created or none (and nothing counts against your plan)
      const ids = await createLinks(rows.map((r) => ({ destination: r.url, label: r.label, type: "url", design })));
      refreshBilling();
      for (let i = 0; i < rows.length; i++) {
        setProgress(`Rendering ${i + 1} of ${rows.length}…`);
        const r = rows[i];
        const link = dynamicUrlFor(ids[i]);
        const png = await svgToPngBlob(buildQrSvg(link, design, { size: 1024 }));
        zip.file(`${String(i + 1).padStart(3, "0")}-${slug(r.label)}.png`, png);
        csv.push([r.label, link, r.url].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      }
      zip.file("mapping.csv", csv.join("\n"));
      setProgress("Zipping…");
      downloadBlob(await zip.generateAsync({ type: "blob" }), "qr-bulk.zip");
      setDone(`Created ${rows.length} editable QR codes.${bad.length ? ` Skipped ${bad.length} invalid line(s).` : ""} They're all in your Dashboard.`);
    } catch (e) {
      setError(e?.message || "Bulk creation failed.");
      setUpgrade(!!e?.upgrade);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const contentJsx = (
    <section className="workspace single" style={{ margin: user ? "16px auto 50px" : "20px auto 70px" }}>
        <div className="card form-card">
          <div className="card-title">
            <div>
              <h2>Bulk create editable QR codes</h2>
              <p>One line per QR: <code>label,url</code> — e.g. restaurant tables, products, branches. Max {MAX_ROWS}.</p>
            </div>
          </div>

          <label>
            Upload CSV (optional)
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
          </label>
          <label>
            Lines
            <textarea
              rows={10}
              placeholder={"Table 1,https://menu.example.com/t1\nTable 2,https://menu.example.com/t2"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>

          <div className="options-grid three">
            <label>
              QR colour
              <input type="color" value={design.fg} onChange={(e) => patch({ fg: e.target.value })} />
            </label>
            <label>
              Background
              <input type="color" value={design.bg} onChange={(e) => patch({ bg: e.target.value })} />
            </label>
            <label>
              Dot style
              <select value={design.shape} onChange={(e) => patch({ shape: e.target.value })}>
                {SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="options-grid">
            <label>
              Corner eyes
              <select value={design.eye} onChange={(e) => patch({ eye: e.target.value })}>
                {EYES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Frame
              <select value={design.frameStyle} onChange={(e) => patch({ frameStyle: e.target.value })}>
                <option value="none">No frame</option>
                <option value="text">Text below</option>
                <option value="bar">Filled bar</option>
              </select>
            </label>
          </div>
          {design.frameStyle !== "none" && (
            <label>
              Frame text
              <input type="text" maxLength={24} value={design.frameText} onChange={(e) => patch({ frameText: e.target.value })} />
            </label>
          )}

          {me && !me?.features?.bulk && !me?.isAdmin && (
            <div className="alert warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <strong>Bulk QR creation requires Pro or Business</strong>
                <p style={{ margin: "4px 0 0", fontSize: 12 }}>Create up to 200 branded editable QR codes at once with individual tracking and mapping CSV.</p>
              </div>
              <Link to="/pricing" className="primary-link" style={{ padding: "8px 16px", fontSize: 13, textDecoration: "none" }}>Upgrade to Pro →</Link>
            </div>
          )}
          {me?.isAdmin ? (
            <p className="field-hint" style={{ margin: "6px 0 10px", color: "var(--qp-brand)", fontWeight: 700 }}>
              👑 Admin Unlimited Access active · No quota caps · Max {MAX_ROWS} per batch
            </p>
          ) : me?.features?.bulk && remainingDynamic !== null ? (
            <p className="field-hint" style={{ margin: "6px 0 10px" }}>
              Plan: <b>{String(me.plan || "pro").toUpperCase()}</b> · Remaining editable codes: <b>{remainingDynamic}</b> of {me?.limits?.dynamicQrs} · Batch cap: {MAX_ROWS}
            </p>
          ) : null}
          {error && (
            <div className="alert error">
              {error}
              {upgrade && <> <Link to="/pricing" className="upgrade-link">See plans →</Link></>}
            </div>
          )}
          {done && <div className="alert success">{done}</div>}
          {progress && <p className="field-hint">{progress}</p>}

          {me && !me?.features?.bulk && !me?.isAdmin ? (
            <Link to="/pricing" className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
              Upgrade to Pro to create bulk QR codes
            </Link>
          ) : (
            <button className="primary" onClick={run} disabled={busy}>
              {busy ? "Working…" : "Create & download ZIP"}
            </button>
          )}
          <p className="field-hint" style={{ marginTop: 12 }}>
            Each QR is editable, so you can later change any destination from the <Link to="/dashboard">Dashboard</Link> without reprinting.
          </p>
        </div>
      </section>
  );

  const bulkContent = (
    <div className="view-bulk-wrap">
      <div className="overview-welcome-card" style={{ marginBottom: "20px" }}>
        <div className="welcome-text-col">
          <h2>Bulk QR Code Generator</h2>
          <p>One line per QR: <code>label,url</code> — e.g. restaurant tables, products, branches. Generates a ZIP of branded PNGs + mapping CSV.</p>
        </div>
        <div className="welcome-action-col">
          <Link to="/dashboard?tab=links" className="secondary-btn">
            ← Back to My QR Codes
          </Link>
        </div>
      </div>
      {contentJsx}
    </div>
  );

  if (embedded) {
    return bulkContent;
  }

  if (user) {
    return (
      <AppShell currentTab="bulk" title="Bulk Create QR Codes">
        {bulkContent}
      </AppShell>
    );
  }

  return (
    <main className="app-shell">
      <Topbar />
      {contentJsx}
    </main>
  );
}
