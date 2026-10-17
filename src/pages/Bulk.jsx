// src/pages/Bulk.jsx
// Bulk-create editable QR codes: CSV upload or Quantity Generator (10–1,000)
// Generates high-volume batch QR codes, visual preview grid, ZIP of PNGs, and mapping.csv.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar";
import AuthForm from "../components/AuthForm";
import AppShell from "../components/AppShell";
import QrPreview from "../components/QrPreview";
import { useAuth } from "../lib/useAuth";
import { createLinks, createBulkQuantity, dynamicUrlFor } from "../lib/links";
import { useBilling } from "../lib/useBilling";
import { normalizeUrl, isValidHttpUrl } from "../lib/qrPayloads";
import { DEFAULT_DESIGN, SHAPES, EYES, buildQrSvg, svgToPngBlob, downloadBlob } from "../lib/qrRender";
import { IconDownload, IconExternalLink, IconQrCode } from "../components/Icons";

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
  const [bulkMode, setBulkMode] = useState("quantity"); // "quantity" | "csv"
  const [text, setText] = useState("");

  // Quantity Mode: Two separate editable numeric inputs
  const [minQuantity, setMinQuantity] = useState("10");
  const [maxQuantity, setMaxQuantity] = useState("100");
  const [targetQuantity, setTargetQuantity] = useState("25");
  const [rangeError, setRangeError] = useState("");

  const [defaultDest, setDefaultDest] = useState(
    typeof window !== "undefined"
      ? `${window.location.origin}/draft`
      : "https://qr-pro-kit-saas-production.up.railway.app/draft"
  );
  const [design, setDesign] = useState({ ...DEFAULT_DESIGN, frameStyle: "none" });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [generatedItems, setGeneratedItems] = useState([]);
  const [zipBlob, setZipBlob] = useState(null);

  if (loading) return <div className="dash-page"><p className="dash-loading">Loading…</p></div>;
  if (!user) return <AuthForm />;

  const canBulk = Boolean(me?.isAdmin || me?.features?.bulk);
  const patch = (p) => setDesign((d) => ({ ...d, ...p }));

  const validateRange = (minVal, maxVal, targetVal) => {
    const min = parseInt(minVal, 10);
    const max = parseInt(maxVal, 10);
    const target = parseInt(targetVal, 10);

    if (isNaN(min) || min < 10 || min > 1000) {
      setRangeError("Minimum quantity must be a whole number between 10 and 1,000.");
      return false;
    }
    if (isNaN(max) || max < 10 || max > 1000) {
      setRangeError("Maximum quantity must be a whole number between 10 and 1,000.");
      return false;
    }
    if (min > max) {
      setRangeError(`Minimum quantity (${min}) cannot be greater than maximum quantity (${max}).`);
      return false;
    }
    if (!isNaN(target) && (target < min || target > max)) {
      setRangeError(`Confirmed batch size (${target}) must be within the specified range (${min} – ${max}).`);
      return false;
    }
    setRangeError("");
    return true;
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  };

  const remainingDynamic =
    me?.limits?.dynamicQrs !== undefined
      ? Math.max(0, (me?.limits?.dynamicQrs || 0) - (me?.usage?.dynamicQrs || 0))
      : null;

  const run = async () => {
    setError("");
    setUpgrade(false);
    setDone("");
    setGeneratedItems([]);
    setZipBlob(null);

    if (!canBulk) {
      setUpgrade(true);
      return setError("Bulk QR creation requires a Pro or Business subscription. Please upgrade your plan.");
    }

    if (bulkMode === "quantity") {
      const min = parseInt(minQuantity, 10);
      const max = parseInt(maxQuantity, 10);
      const qty = parseInt(targetQuantity, 10);

      if (!validateRange(minQuantity, maxQuantity, targetQuantity)) {
        return setError(rangeError || "Please correct the quantity range values.");
      }

      const targetUrl = (defaultDest || "").trim();
      if (!isValidHttpUrl(targetUrl)) {
        return setError("Please enter a valid HTTP or HTTPS placeholder/draft destination URL.");
      }

      if (!me?.isAdmin && remainingDynamic !== null && qty > remainingDynamic) {
        setUpgrade(true);
        return setError(
          `Your account has ${remainingDynamic} editable QR codes remaining, but you requested ${qty}. Please reduce quantity or upgrade your plan.`
        );
      }

      setBusy(true);
      try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const csv = ["index,id,label,qr_link,destination"];
        setProgress(`Creating ${qty} dynamic QR records in durable database…`);

        const ids = await createBulkQuantity({
          quantity: qty,
          minQuantity: min,
          maxQuantity: max,
          defaultDestination: targetUrl,
          design,
        });

        refreshBilling();
        const previews = [];

        for (let i = 0; i < ids.length; i++) {
          setProgress(`Rendering image ${i + 1} of ${ids.length}…`);
          const id = ids[i];
          const rowLabel = `QR #${i + 1}`;
          const link = dynamicUrlFor(id);
          const png = await svgToPngBlob(buildQrSvg(link, design, { size: 1024 }));
          zip.file(`${String(i + 1).padStart(4, "0")}-${slug(rowLabel)}.png`, png);
          csv.push([i + 1, id, rowLabel, link, targetUrl].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

          if (i < 24) {
            previews.push({ id, label: rowLabel, link, targetUrl, index: i + 1 });
          }
        }

        zip.file("mapping.csv", csv.join("\n"));
        setProgress("Packaging ZIP download…");
        const blob = await zip.generateAsync({ type: "blob" });
        setZipBlob(blob);
        downloadBlob(blob, `typqr-bulk-${qty}.zip`);

        setGeneratedItems(previews);
        setDone(
          `Successfully generated ${qty} editable QR codes! Downloaded ZIP containing high-resolution PNGs and mapping.csv. All records are ready in your Dashboard.`
        );
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
      return setError(
        `Your account has ${remainingDynamic} editable QR codes remaining, but you entered ${rows.length}. Please reduce the list or upgrade your plan.`
      );
    }

    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const csv = ["label,qr_link,destination"];
      setProgress(`Creating ${rows.length} QR codes…`);

      const ids = await createLinks(rows.map((r) => ({ destination: r.url, label: r.label, type: "url", design })));
      refreshBilling();
      const previews = [];

      for (let i = 0; i < rows.length; i++) {
        setProgress(`Rendering ${i + 1} of ${rows.length}…`);
        const r = rows[i];
        const link = dynamicUrlFor(ids[i]);
        const png = await svgToPngBlob(buildQrSvg(link, design, { size: 1024 }));
        zip.file(`${String(i + 1).padStart(3, "0")}-${slug(r.label)}.png`, png);
        csv.push([r.label, link, r.url].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

        if (i < 24) {
          previews.push({ id: ids[i], label: r.label, link, targetUrl: r.url, index: i + 1 });
        }
      }

      zip.file("mapping.csv", csv.join("\n"));
      setProgress("Zipping…");
      const blob = await zip.generateAsync({ type: "blob" });
      setZipBlob(blob);
      downloadBlob(blob, `typqr-bulk-${rows.length}.zip`);

      setGeneratedItems(previews);
      setDone(
        `Created ${rows.length} editable QR codes.${bad.length ? ` Skipped ${bad.length} invalid line(s).` : ""} They're all available in your Dashboard.`
      );
    } catch (e) {
      setError(e?.message || "Bulk creation failed.");
      setUpgrade(!!e?.upgrade);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const handleDownloadSinglePng = async (item) => {
    try {
      const svg = buildQrSvg(item.link, design, { size: 1024 });
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `${item.label}-${item.id}.png`);
    } catch (e) {
      alert("Download failed: " + e.message);
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

        {/* Mode Selector */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
          <button
            type="button"
            className={`chip ${bulkMode === "quantity" ? "chip-on" : ""}`}
            onClick={() => { setBulkMode("quantity"); setError(""); }}
          >
            Mode A: Quantity Generator (Range 10–1,000)
          </button>
          <button
            type="button"
            className={`chip ${bulkMode === "csv" ? "chip-on" : ""}`}
            onClick={() => { setBulkMode("csv"); setError(""); }}
          >
            Mode B: CSV / Custom Links
          </button>
        </div>

        {bulkMode === "quantity" ? (
          <>
            {/* Range Controls: Two separate editable numeric inputs */}
            <div className="row2 bulk-quantity-range-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Minimum Quantity
                <input
                  type="number"
                  min="10"
                  max="1000"
                  step="1"
                  value={minQuantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMinQuantity(v);
                    validateRange(v, maxQuantity, targetQuantity);
                  }}
                  placeholder="10"
                  disabled={busy}
                />
                <span className="field-hint">Min permitted: 10</span>
              </label>
              <label>
                Maximum Quantity
                <input
                  type="number"
                  min="10"
                  max="1000"
                  step="1"
                  value={maxQuantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMaxQuantity(v);
                    validateRange(minQuantity, v, targetQuantity);
                  }}
                  placeholder="100"
                  disabled={busy}
                />
                <span className="field-hint">Max permitted: 1,000</span>
              </label>
            </div>

            {/* Confirmed Batch Size to Generate */}
            <div style={{ marginTop: "14px", marginBottom: "16px" }}>
              <label>
                Confirmed Batch Size to Generate
                <input
                  type="number"
                  min={parseInt(minQuantity, 10) || 10}
                  max={parseInt(maxQuantity, 10) || 1000}
                  step="1"
                  value={targetQuantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTargetQuantity(v);
                    validateRange(minQuantity, maxQuantity, v);
                  }}
                  placeholder="e.g. 50"
                  disabled={busy}
                />
                <span className="field-hint" style={{ marginTop: "4px" }}>
                  Permitted batch range: <b>{minQuantity || 10}</b> to <b>{maxQuantity || 1000}</b>. The system will create exactly <b>{targetQuantity || minQuantity}</b> QR codes.
                </span>
              </label>
            </div>

            {rangeError && (
              <div className="alert error" style={{ margin: "10px 0" }}>
                {rangeError}
              </div>
            )}

            <label>
              Default / Draft Target URL
              <input
                type="url"
                placeholder="https://yourbrand.com/welcome"
                value={defaultDest}
                onChange={(e) => setDefaultDest(e.target.value)}
                disabled={busy}
              />
              <span className="field-hint" style={{ marginTop: "4px" }}>
                All generated QR codes initially route here. You can assign each QR code's real destination individually anytime from your Dashboard without reprinting.
              </span>
            </label>
          </>
        ) : (
          <>
            <label>
              Upload CSV (optional)
              <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} disabled={busy} />
            </label>
            <label>
              Lines (one per line: <code>label,https://example.com</code>)
              <textarea
                rows={8}
                placeholder={"Table 1,https://menu.example.com/t1\nTable 2,https://menu.example.com/t2"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}

        {/* Styling controls */}
        <div className="options-grid three" style={{ marginTop: "18px" }}>
          <label>
            QR colour
            <input type="color" value={design.fg} onChange={(e) => patch({ fg: e.target.value })} disabled={busy} />
          </label>
          <label>
            Background
            <input type="color" value={design.bg} onChange={(e) => patch({ bg: e.target.value })} disabled={busy} />
          </label>
          <label>
            Dot style
            <select value={design.shape} onChange={(e) => patch({ shape: e.target.value })} disabled={busy}>
              {SHAPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="options-grid">
          <label>
            Corner eyes
            <select value={design.eye} onChange={(e) => patch({ eye: e.target.value })} disabled={busy}>
              {EYES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Frame
            <select value={design.frameStyle} onChange={(e) => patch({ frameStyle: e.target.value })} disabled={busy}>
              <option value="none">No frame</option>
              <option value="text">Text below</option>
              <option value="bar">Filled bar</option>
            </select>
          </label>
        </div>

        {design.frameStyle !== "none" && (
          <label>
            Frame text
            <input
              type="text"
              maxLength={24}
              value={design.frameText}
              onChange={(e) => patch({ frameText: e.target.value })}
              disabled={busy}
            />
          </label>
        )}

        {/* Bulk Entitlement Warning Banner */}
        {!canBulk && (
          <div className="alert warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: "16px" }}>
            <div>
              <strong>Bulk QR creation requires Pro or Business</strong>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>Create batches of up to 1,000 branded editable QR codes with individual scan tracking, ZIP archive, and mapping CSV.</p>
            </div>
            <Link to="/pricing" className="primary-link" style={{ padding: "8px 16px", fontSize: 13, textDecoration: "none" }}>Upgrade to Pro →</Link>
          </div>
        )}

        {me?.isAdmin ? (
          <p className="field-hint" style={{ margin: "8px 0 12px", color: "var(--qp-brand)", fontWeight: 700 }}>
            👑 Admin Unlimited Access active · No quota caps · Max 1,000 per batch
          </p>
        ) : canBulk && remainingDynamic !== null ? (
          <p className="field-hint" style={{ margin: "8px 0 12px" }}>
            Plan: <b>{String(me.plan || "pro").toUpperCase()}</b> · Remaining editable codes: <b>{remainingDynamic}</b> of {me?.limits?.dynamicQrs} · Cap: 1,000/batch
          </p>
        ) : null}

        {error && (
          <div className="alert error">
            {error}
            {upgrade && <> <Link to="/pricing" className="upgrade-link">See plans →</Link></>}
          </div>
        )}

        {done && <div className="alert success">{done}</div>}
        {progress && (
          <div style={{ marginTop: "12px", padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: "13px", color: "#166534" }}>
            ⏳ {progress}
          </div>
        )}

        {!canBulk ? (
          <Link to="/pricing" className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: "18px" }}>
            Upgrade to Pro to create bulk QR codes
          </Link>
        ) : (
          <button
            className="primary"
            onClick={run}
            disabled={busy || Boolean(rangeError)}
            style={{ marginTop: "18px" }}
          >
            {busy ? "Generating & Packaging…" : "Generate Batch & Download ZIP"}
          </button>
        )}

        {/* Visual Preview Grid of Generated QR Codes */}
        {generatedItems.length > 0 && (
          <div className="bulk-results-preview-section" style={{ marginTop: "32px", paddingTop: "24px", borderTop: "2px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
                  Generated QR Batch ({generatedItems.length} shown)
                </h3>
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  All generated QR codes are ready to use and saved to your dashboard.
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {zipBlob && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => downloadBlob(zipBlob, `typqr-bulk-${generatedItems.length}.zip`)}
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                  >
                    <IconDownload size={14} /> Re-download ZIP
                  </button>
                )}
                <Link
                  to="/dashboard?tab=links"
                  className="primary-btn"
                  style={{ fontSize: "12px", padding: "6px 14px", textDecoration: "none" }}
                >
                  Manage in Dashboard →
                </Link>
              </div>
            </div>

            <div
              className="bulk-qr-preview-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: "14px",
                marginTop: "14px",
              }}
            >
              {generatedItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "12px",
                    textAlign: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ background: "#f8fafc", borderRadius: 8, padding: 8, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                    <QrPreview value={item.link} design={design} size={120} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#1e293b", marginBottom: 2 }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace", marginBottom: 8 }}>
                    #{item.id}
                  </div>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    <button
                      type="button"
                      className="dash-btn"
                      onClick={() => handleDownloadSinglePng(item)}
                      title="Download PNG"
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      <IconDownload size={12} /> PNG
                    </button>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="dash-btn"
                      title="Test Short Link"
                      style={{ fontSize: "11px", padding: "4px 8px", textDecoration: "none", color: "inherit" }}
                    >
                      <IconExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="field-hint" style={{ marginTop: 20 }}>
          Each QR code is editable over the air. You can re-assign any QR code destination anytime from your <Link to="/dashboard">Dashboard</Link> without reprinting.
        </p>
      </div>
    </section>
  );

  const bulkContent = (
    <div className="view-bulk-wrap">
      <div className="overview-welcome-card" style={{ marginBottom: "20px" }}>
        <div className="welcome-text-col">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <img
              src="/typqr-logo.png"
              alt="TypQR"
              style={{ height: "32px", width: "auto", objectFit: "contain" }}
            />
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--qp-brand)" }}>
              High-Volume Batch Generator
            </span>
          </div>
          <h2>Bulk QR Code Generator</h2>
          <p>
            Generate high-volume batches of branded editable QR codes with configurable quantity range (10–1,000), instant ZIP export, visual preview, and mapping CSV.
          </p>
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
