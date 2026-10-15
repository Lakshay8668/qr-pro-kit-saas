// src/pages/Bulk.jsx
// Bulk-create editable QR codes: paste "label,url" lines (or upload a CSV),
// get a ZIP of PNGs + a mapping.csv. Great for tables, products, staff, branches.

import { useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar";
import AuthForm from "../components/AuthForm";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/useAuth";
import { createLinks, createBulkQuantity, dynamicUrlFor } from "../lib/links";
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
  const [bulkMode, setBulkMode] = useState("csv"); // "csv" | "quantity"
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState(25);
  const [labelPrefix, setLabelPrefix] = useState("Table QR");
  const [defaultDest, setDefaultDest] = useState(
    typeof window !== "undefined" ? `${window.location.origin}/draft` : "https://qr-pro-kit-saas-production.up.railway.app/draft"
  );
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

    if (bulkMode === "quantity") {
      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty < 10 || qty > 1000) {
        return setError("Please enter a valid quantity between 10 and 1,000 QR codes.");
      }
      const targetUrl = (defaultDest || "").trim();
      if (!isValidHttpUrl(targetUrl)) {
        return setError("Please enter a valid HTTP or HTTPS placeholder destination URL.");
      }
      if (!me?.isAdmin && remainingDynamic !== null && qty > remainingDynamic) {
        setUpgrade(true);
        return setError(`Your account has ${remainingDynamic} editable QR codes remaining, but you requested ${qty}. Please reduce quantity or upgrade your plan.`);
      }

      setBusy(true);
      try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const csv = ["index,id,label,qr_link,destination"];
        setProgress(`Creating ${qty} dynamic QR records in durable database…`);
        const ids = await createBulkQuantity({
          quantity: qty,
          labelPrefix: labelPrefix.trim() || "Batch QR",
          defaultDestination: targetUrl,
          design,
        });
        refreshBilling();
        for (let i = 0; i < ids.length; i++) {
          setProgress(`Rendering image ${i + 1} of ${ids.length}…`);
          const id = ids[i];
          const rowLabel = `${labelPrefix.trim() || "Batch QR"} #${i + 1}`;
          const link = dynamicUrlFor(id);
          const png = await svgToPngBlob(buildQrSvg(link, design, { size: 1024 }));
          zip.file(`${String(i + 1).padStart(4, "0")}-${slug(rowLabel)}.png`, png);
          csv.push([i + 1, id, rowLabel, link, targetUrl].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
        }
        zip.file("mapping.csv", csv.join("\n"));
        setProgress("Packaging ZIP download…");
        downloadBlob(await zip.generateAsync({ type: "blob" }), `qr-bulk-${qty}.zip`);
        setDone(`Successfully generated ${qty} editable QR codes in draft mode! Downloaded ZIP containing high-resolution PNGs and mapping.csv. All records are ready in your Dashboard.`);
      } catch (e) {
        setError(e?.message || "Bulk quantity generation failed.");
        setUpgrade(!!e?.upgrade);
      } finally {
        setBusy(false);
        setProgress("");
      }
      return;
    }

    // Mode A: CSV upload
    const { rows, bad } = parse(text);
    if (!rows.length) return setError("No valid lines found. Use one per line: label,https://example.com");
    const maxAllowed = me?.isAdmin ? 1000 : MAX_ROWS;
    if (rows.length > maxAllowed) return setError(`Please keep it to ${maxAllowed} rows per batch (you have ${rows.length}).`);
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
              <h2>Bulk QR Code Generator</h2>
              <p>Batch create editable QR codes for menus, retail products, inventory, badges, or branch locations.</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
            <button
              type="button"
              className={`chip ${bulkMode === "csv" ? "chip-on" : ""}`}
              onClick={() => { setBulkMode("csv"); setError(""); }}
            >
              Mode A: CSV / Custom Links
            </button>
            <button
              type="button"
              className={`chip ${bulkMode === "quantity" ? "chip-on" : ""}`}
              onClick={() => { setBulkMode("quantity"); setError(""); }}
            >
              Mode B: Quantity Generator (10–1000)
            </button>
          </div>

          {bulkMode === "csv" ? (
            <>
              <label>
                Upload CSV (optional)
                <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
              </label>
              <label>
                Lines (one per line: <code>label,https://example.com</code>)
                <textarea
                  rows={8}
                  placeholder={"Table 1,https://menu.example.com/t1\nTable 2,https://menu.example.com/t2"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <div className="row2">
                <label>
                  Quantity (10 – 1,000)
                  <input
                    type="number"
                    min="10"
                    max="1000"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label>
                  Label Prefix
                  <input
                    type="text"
                    maxLength={30}
                    placeholder="e.g. Table, Seat, Shelf"
                    value={labelPrefix}
                    onChange={(e) => setLabelPrefix(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Default / Draft Target URL
                <input
                  type="url"
                  placeholder="https://yourbrand.com/welcome"
                  value={defaultDest}
                  onChange={(e) => setDefaultDest(e.target.value)}
                />
                <span className="field-hint" style={{ marginTop: "4px" }}>
                  All generated QR codes will initially redirect here. You can re-assign any QR's target URL individually anytime from the Dashboard without changing the printed codes.
                </span>
              </label>
            </>
          )}

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
          <p>Generate high-volume batches of branded editable QR codes via CSV upload or custom quantity (10–1,000) with ZIP export and mapping CSV.</p>
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
