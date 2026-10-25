// src/pages/ShortLinks.jsx — TypQR First-Party Short Link Generator & Manager
// Zero External APIs: 100% first-party URL shortening, click tracking, dynamic over-the-air updates, and QR generation.

import React, { useState, useEffect, useMemo } from "react";
import AppShell from "../components/AppShell";
import Modal from "../components/Modal";
import QrPreview from "../components/QrPreview";
import { useAuth } from "../lib/useAuth";
import {
  subscribeToMyLinks,
  subscribeToScans,
  createShortLink,
  updateLink,
  deleteLink,
  publicBase,
  formatShortUrl,
} from "../lib/links";
import {
  DEFAULT_DESIGN,
  buildQrSvg,
  svgToPngBlob,
  downloadBlob,
  downloadSvgString,
} from "../lib/qrRender";
import {
  IconLink,
  IconPlus,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconQrCode,
  IconDownload,
  IconChart,
  IconEdit,
  IconTrash,
  IconPlay,
  IconPause,
  IconSearch,
} from "../components/Icons";

function formatDate(ts) {
  if (!ts) return "—";
  let d = null;
  if (typeof ts?.toDate === "function") d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts === "number") d = new Date(ts);
  else if (typeof ts === "string") d = new Date(ts);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------- Edit Destination Modal
function EditDestinationModal({ link, onClose, onUpdated }) {
  const [destination, setDestination] = useState(link.destination || "");
  const [label, setLabel] = useState(link.label || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedDest = destination.trim();
    if (!/^https?:\/\//i.test(trimmedDest)) {
      setError("Destination must start with http:// or https://");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateLink(link.id, {
        destination: trimmedDest,
        label: label.trim() || link.label,
      });
      if (onUpdated) onUpdated();
      onClose();
    } catch (err) {
      setError(err?.message || "Could not update destination.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Short Link Destination" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "#64748b" }}>
          Update the destination URL over-the-air. Your short link and printed QR codes remain unchanged and will immediately redirect visitors to the new target.
        </p>

        <div>
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#334155", marginBottom: "0.3rem" }}>
            Short URL Slug:
          </label>
          <input
            type="text"
            readOnly
            value={`/s/${link.slug || link.id}`}
            style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f1f5f9", fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#334155", marginBottom: "0.3rem" }}>
            Title / Label:
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#334155", marginBottom: "0.3rem" }}>
            New Destination URL: *
          </label>
          <input
            type="url"
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="https://example.com/new-target"
            style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }}
          />
        </div>

        {error && (
          <div style={{ padding: "0.6rem 0.8rem", borderRadius: "6px", background: "#fef2f2", color: "#b91c1c", fontSize: "0.85rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button type="button" onClick={onClose} className="secondary-btn" style={{ padding: "0.5rem 1rem" }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className="primary-btn" style={{ padding: "0.5rem 1.25rem" }}>
            {saving ? "Saving..." : "Save New Destination"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- QR Code Modal for Short Link
function ShortLinkQrModal({ link, onClose }) {
  const shortUrl = link.shortUrl || formatShortUrl(link.slug || link.id);
  const [design, setDesign] = useState({
    ...DEFAULT_DESIGN,
    fg: "#2563eb",
    frameStyle: "bar",
    frameText: "Scan to Visit",
  });

  const downloadPng = async () => {
    const svg = buildQrSvg(shortUrl, design, { size: 1024 });
    const blob = await svgToPngBlob(svg);
    downloadBlob(blob, `shortlink-${link.slug || link.id}-qr.png`);
  };

  const downloadSvg = () => {
    const svg = buildQrSvg(shortUrl, design, { size: 1024 });
    downloadSvgString(svg, `shortlink-${link.slug || link.id}-qr.svg`);
  };

  return (
    <Modal title={`QR Code for /s/${link.slug || link.id}`} onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 1rem 0", fontSize: "0.88rem", color: "#64748b" }}>
          This QR code encodes your TypQR short URL (<code>{shortUrl}</code>). When scanned, visitors are instantly redirected to <code>{link.destination}</code>.
        </p>

        <div style={{ display: "inline-flex", padding: "1.25rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "1rem" }}>
          <QrPreview value={shortUrl} design={design} size={220} />
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
          <button type="button" onClick={downloadPng} className="primary-btn" style={{ padding: "0.55rem 1rem" }}>
            <IconDownload size={15} /> Download PNG
          </button>
          <button type="button" onClick={downloadSvg} className="secondary-btn" style={{ padding: "0.55rem 1rem" }}>
            <IconDownload size={15} /> Download SVG
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Click Analytics Modal
function ShortLinkAnalyticsModal({ link, onClose }) {
  const [scans, setScans] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToScans(
      link.id,
      (data) => {
        setScans(data || []);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [link.id]);

  const stats = useMemo(() => {
    if (!scans || !scans.length) return null;
    const referrers = {};
    const devices = {};
    const countries = {};

    scans.forEach((s) => {
      const ref = s.referer ? new URL(s.referer.startsWith("http") ? s.referer : `http://${s.referer}`).hostname : "Direct / Bookmark";
      referrers[ref] = (referrers[ref] || 0) + 1;
      const dev = s.device || "Desktop";
      devices[dev] = (devices[dev] || 0) + 1;
      const c = s.country || "Unknown";
      countries[c] = (countries[c] || 0) + 1;
    });

    return { referrers, devices, countries };
  }, [scans]);

  return (
    <Modal title={`Click Analytics for /s/${link.slug || link.id}`} onClose={onClose}>
      <div>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, padding: "1rem", background: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#166534" }}>{link.scans || 0}</div>
            <div style={{ fontSize: "0.78rem", color: "#166534" }}>Total Recorded Clicks</div>
          </div>
          <div style={{ flex: 1, padding: "1rem", background: "#eff6ff", borderRadius: "8px", border: "1px solid #bfdbfe", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1e40af" }}>
              {link.active !== false ? "Active" : "Paused"}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#1e40af" }}>Link Status</div>
          </div>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", color: "#64748b" }}>Loading click logs...</p>
        ) : !scans || !scans.length ? (
          <div style={{ textAlign: "center", padding: "1.5rem", background: "#f8fafc", borderRadius: "8px", color: "#64748b" }}>
            No clicks recorded yet. Share your short link to start tracking visitor clicks!
          </div>
        ) : (
          <div>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#1e293b" }}>Recent Clicks &amp; Referrers</h4>
            <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Time</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Device</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Location</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.slice(0, 20).map((s, idx) => (
                    <tr key={s.id || idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.45rem 0.75rem", whiteSpace: "nowrap" }}>{formatDate(s.ts || s.t)}</td>
                      <td style={{ padding: "0.45rem 0.75rem" }}>{s.device || s.os || "—"}</td>
                      <td style={{ padding: "0.45rem 0.75rem" }}>{s.city ? `${s.city}, ${s.country}` : s.country || "—"}</td>
                      <td style={{ padding: "0.45rem 0.75rem", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.referer || ""}>
                        {s.referer ? s.referer.replace(/^https?:\/\//i, "") : "Direct"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Main Short Links Page
export default function ShortLinksPage() {
  const { user } = useAuth();
  const [links, setLinks] = useState([]);
  const [search, setSearch] = useState("");

  // Creation form states
  const [destinationUrl, setDestinationUrl] = useState("");
  const [label, setLabel] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Result card states
  const [createdResult, setCreatedResult] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Active Modals
  const [editingLink, setEditingLink] = useState(null);
  const [viewingQrLink, setViewingQrLink] = useState(null);
  const [viewingAnalyticsLink, setViewingAnalyticsLink] = useState(null);

  // Subscribe to links
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToMyLinks(
      user.uid,
      (rows) => {
        // Filter to dynamic redirect links
        const redirectLinks = (rows || []).filter((l) => l.kind !== "static");
        setLinks(redirectLinks);
      },
      (err) => console.error("Error loading links:", err)
    );
    return unsub;
  }, [user]);

  // Derived metrics
  const totalClicks = useMemo(() => links.reduce((sum, l) => sum + (l.scans || 0), 0), [links]);
  const activeCount = useMemo(() => links.filter((l) => l.active !== false).length, [links]);

  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => {
      const matchSlug = (l.slug || l.id || "").toLowerCase().includes(q);
      const matchDest = (l.destination || "").toLowerCase().includes(q);
      const matchLabel = (l.label || "").toLowerCase().includes(q);
      return matchSlug || matchDest || matchLabel;
    });
  }, [links, search]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError("");
    const dest = destinationUrl.trim();
    if (!/^https?:\/\//i.test(dest)) {
      setFormError("Destination must start with http:// or https://");
      return;
    }

    const cleanSlug = customSlug.trim().toLowerCase();
    if (cleanSlug && !/^[a-z0-9-]{3,60}$/.test(cleanSlug)) {
      setFormError("Custom slug must be 3-60 alphanumeric characters and hyphens (no spaces).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createShortLink({
        destination: dest,
        slug: cleanSlug || undefined,
        label: label.trim() || undefined,
        prefix: "s",
      });

      const effectiveSlug = res.slug || cleanSlug || res.id;
      const fullShortUrl = res.shortUrl || formatShortUrl(effectiveSlug);

      setCreatedResult({
        id: res.id,
        slug: effectiveSlug,
        shortUrl: fullShortUrl,
        destination: dest,
      });

      // Clear inputs
      setDestinationUrl("");
      setLabel("");
      setCustomSlug("");
    } catch (err) {
      setFormError(err?.message || "Could not create short link. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      window.prompt("Copy short link:", url);
    }
  };

  const handleToggleActive = async (link) => {
    const newActive = link.active === false;
    try {
      await updateLink(link.id, { active: newActive });
    } catch (err) {
      alert(err?.message || "Could not toggle status.");
    }
  };

  const handleDelete = async (link) => {
    const slugStr = link.slug || link.id;
    if (window.confirm(`Delete short link "/s/${slugStr}"? Visitors will no longer be redirected.`)) {
      try {
        await deleteLink(link.id);
        if (createdResult && createdResult.id === link.id) {
          setCreatedResult(null);
        }
      } catch (err) {
        alert(err?.message || "Could not delete link.");
      }
    }
  };

  return (
    <AppShell currentTab="shortlinks" title="Short Links">
      <div className="event-mgmt-container" style={{ maxWidth: "1160px", margin: "0 auto", padding: "1.5rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ display: "inline-flex", padding: "0.5rem", borderRadius: "8px", background: "#dbeafe", color: "#2563eb" }}>
              <IconLink size={24} />
            </span>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0, color: "#111827" }}>
              TypQR Short Links
            </h1>
          </div>
          <p style={{ color: "#4b5563", margin: 0, fontSize: "0.95rem" }}>
            Create memorable, branded short URLs with instant click tracking and over-the-air destination editing. 100% first-party without external APIs.
          </p>
        </div>

        {/* 3 KPI Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Total Short Links</div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1e293b", margin: "0.3rem 0" }}>{links.length}</div>
            <div style={{ fontSize: "0.78rem", color: "#059669" }}>✓ Fully manageable &amp; editable</div>
          </div>

          <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Total Clicks Recorded</div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#2563eb", margin: "0.3rem 0" }}>{totalClicks}</div>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Logged in durable database</div>
          </div>

          <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Active Links</div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#059669", margin: "0.3rem 0" }}>{activeCount}</div>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Receiving live traffic</div>
          </div>
        </div>

        {/* Short Link Creation Card */}
        <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "1.75rem", marginBottom: "2rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, color: "#1e293b", margin: "0 0 1.25rem 0" }}>
            Create a New Short Link
          </h2>

          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1rem", marginBottom: "1.25rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                  Destination URL *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://example.com/your-very-long-landing-page-url"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  style={{ width: "100%", padding: "0.65rem 0.85rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.92rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                    Custom Slug (Optional)
                  </label>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ padding: "0.65rem 0.75rem", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: "0.85rem", color: "#64748b", fontFamily: "monospace" }}>
                      /s/
                    </span>
                    <input
                      type="text"
                      placeholder="e.g. engagium"
                      value={customSlug}
                      onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      style={{ flex: 1, padding: "0.65rem 0.85rem", border: "1px solid #cbd5e1", borderRadius: "0 6px 6px 0", fontSize: "0.92rem" }}
                    />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem", display: "block" }}>
                    Leave blank to auto-generate a unique 7-character slug.
                  </span>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                    Campaign Title / Label (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Summer Promo 2026"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    style={{ width: "100%", padding: "0.65rem 0.85rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.92rem" }}
                  />
                  <span style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem", display: "block" }}>
                    Internal label for your dashboard management.
                  </span>
                </div>
              </div>
            </div>

            {formError && (
              <div style={{ padding: "0.75rem 1rem", borderRadius: "6px", background: "#fef2f2", color: "#b91c1c", fontSize: "0.88rem", marginBottom: "1rem" }}>
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "0.7rem 1.5rem",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "0.95rem",
                cursor: submitting ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <IconPlus size={16} />
              {submitting ? "Creating..." : "Create Short Link"}
            </button>
          </form>

          {/* Generated Result Card */}
          {createdResult && (
            <div style={{ marginTop: "1.75rem", padding: "1.25rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#166534" }}>
                  ✓ Your TypQR Short Link is Ready:
                </span>
                <span style={{ fontSize: "0.78rem", background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                  Active &amp; Tracked
                </span>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input
                  type="text"
                  readOnly
                  value={createdResult.shortUrl}
                  style={{ flex: 1, padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #86efac", background: "#ffffff", fontFamily: "monospace", fontSize: "0.88rem", fontWeight: 600, color: "#166534" }}
                />
                <button
                  type="button"
                  onClick={() => copyUrl(createdResult.shortUrl)}
                  style={{
                    padding: "0.6rem 1rem",
                    background: copiedLink ? "#15803d" : "#ffffff",
                    color: copiedLink ? "#ffffff" : "#166534",
                    border: "1px solid #86efac",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                >
                  {copiedLink ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  {copiedLink ? "Copied" : "Copy"}
                </button>
                <a
                  href={createdResult.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "0.6rem 0.85rem",
                    background: "#ffffff",
                    color: "#166534",
                    border: "1px solid #86efac",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Test Link (Opens in new tab)"
                >
                  <IconExternalLink size={16} />
                </a>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setViewingQrLink(createdResult)}
                  style={{
                    padding: "0.45rem 0.85rem",
                    background: "#166534",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                >
                  <IconQrCode size={14} /> Generate &amp; Download QR Code
                </button>
                <span style={{ fontSize: "0.78rem", color: "#166534" }}>
                  QR code encodes this TypQR short link directly.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Links Management Table */}
        <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#1e293b" }}>
              All Short Links ({links.length})
            </h3>

            <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "0.35rem 0.75rem", width: "260px" }}>
              <IconSearch size={15} className="dash-muted" />
              <input
                type="text"
                placeholder="Search slug or destination..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", paddingLeft: "0.5rem", fontSize: "0.85rem", width: "100%" }}
              />
            </div>
          </div>

          {filteredLinks.length === 0 ? (
            <div style={{ padding: "3rem 1.5rem", textAlign: "center", color: "#64748b" }}>
              {links.length === 0
                ? "No short links created yet. Use the form above to generate your first short URL!"
                : "No short links matched your search query."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase" }}>
                    <th style={{ padding: "0.75rem 1.25rem" }}>Short Link &amp; Slug</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Original Destination</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "center" }}>Clicks</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Created</th>
                    <th style={{ padding: "0.75rem 1.25rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLinks.map((link) => {
                    const shortUrl = link.shortUrl || formatShortUrl(link.slug || link.id);
                    return (
                      <tr key={link.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.85rem 1.25rem" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "0.15rem" }}>
                            {link.label || link.slug || "Untitled"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            <a
                              href={shortUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#2563eb", fontFamily: "monospace", fontSize: "0.82rem", textDecoration: "none" }}
                            >
                              /s/{link.slug || link.id}
                            </a>
                            <button
                              type="button"
                              onClick={() => copyUrl(shortUrl)}
                              title="Copy Short URL"
                              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "#64748b" }}
                            >
                              <IconCopy size={13} />
                            </button>
                          </div>
                        </td>

                        <td style={{ padding: "0.85rem 1rem", maxWidth: "260px" }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#475569", fontSize: "0.82rem" }} title={link.destination}>
                            {link.destination}
                          </div>
                        </td>

                        <td style={{ padding: "0.85rem 1rem", textAlign: "center" }}>
                          <span style={{ fontWeight: 700, color: "#1e293b" }}>{link.scans || 0}</span>
                        </td>

                        <td style={{ padding: "0.85rem 1rem" }}>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(link)}
                            title="Click to toggle Active / Paused"
                            style={{
                              border: "none",
                              borderRadius: "12px",
                              padding: "0.2rem 0.6rem",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.3rem",
                              background: link.active !== false ? "#dcfce7" : "#fee2e2",
                              color: link.active !== false ? "#15803d" : "#b91c1c",
                            }}
                          >
                            {link.active !== false ? <IconPlay size={10} /> : <IconPause size={10} />}
                            {link.active !== false ? "Active" : "Paused"}
                          </button>
                        </td>

                        <td style={{ padding: "0.85rem 1rem", color: "#64748b", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                          {formatDate(link.createdAt)}
                        </td>

                        <td style={{ padding: "0.85rem 1.25rem", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                            <button
                              type="button"
                              onClick={() => setEditingLink(link)}
                              title="Edit Destination URL (Over-the-air)"
                              style={{ padding: "0.4rem 0.6rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", cursor: "pointer", color: "#334155" }}
                            >
                              <IconEdit size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => setViewingQrLink(link)}
                              title="View & Download QR Code"
                              style={{ padding: "0.4rem 0.6rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", cursor: "pointer", color: "#334155" }}
                            >
                              <IconQrCode size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => setViewingAnalyticsLink(link)}
                              title="Click Analytics"
                              style={{ padding: "0.4rem 0.6rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", cursor: "pointer", color: "#334155" }}
                            >
                              <IconChart size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDelete(link)}
                              title="Delete Link"
                              style={{ padding: "0.4rem 0.6rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", cursor: "pointer", color: "#b91c1c" }}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit Destination Modal */}
      {editingLink && (
        <EditDestinationModal
          link={editingLink}
          onClose={() => setEditingLink(null)}
          onUpdated={() => {}}
        />
      )}

      {/* QR Code Modal */}
      {viewingQrLink && (
        <ShortLinkQrModal
          link={viewingQrLink}
          onClose={() => setViewingQrLink(null)}
        />
      )}

      {/* Analytics Modal */}
      {viewingAnalyticsLink && (
        <ShortLinkAnalyticsModal
          link={viewingAnalyticsLink}
          onClose={() => setViewingAnalyticsLink(null)}
        />
      )}
    </AppShell>
  );
}
