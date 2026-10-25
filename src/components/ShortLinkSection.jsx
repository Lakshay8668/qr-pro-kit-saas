// src/components/ShortLinkSection.jsx — Integrated Short Link Section for QR Generator & Google Review
// Zero external APIs: 100% first-party TypQR short-link creation, validation, copy, open, and QR encoding toggle.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createShortLink, publicBase, formatShortUrl } from "../lib/links";
import { IconCopy, IconCheck, IconExternalLink, IconLink } from "./Icons";

export default function ShortLinkSection({
  destination = "",
  destinationLabel = "",
  user = null,
  encodeShortLinkInQr = false,
  onToggleEncodeShortLink = () => {},
  onShortUrlGenerated = () => {},
}) {
  const [shortUrl, setShortUrl] = useState("");
  const [shortSlug, setShortSlug] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const baseDomain = publicBase();

  const handleCreate = async (e) => {
    if (e) e.preventDefault();
    setError("");

    const targetDest = String(destination || "").trim();
    if (!targetDest || (!targetDest.startsWith("http://") && !targetDest.startsWith("https://"))) {
      setError("Please enter a valid destination URL (starting with http:// or https://) first.");
      return;
    }

    if (!user) {
      setError("Please sign in to create and save persistent short links.");
      return;
    }

    const cleanSlug = customSlug.trim().toLowerCase();
    if (cleanSlug && !/^[a-z0-9-]{3,60}$/.test(cleanSlug)) {
      setError("Custom slug must be 3-60 alphanumeric characters and hyphens.");
      return;
    }

    setLoading(true);
    try {
      const res = await createShortLink({
        destination: targetDest,
        slug: cleanSlug || undefined,
        label: destinationLabel ? `${destinationLabel} Short Link` : "QR Short Link",
        prefix: "s",
      });

      const effectiveSlug = res.slug || cleanSlug || res.id;
      const fullUrl = res.shortUrl || formatShortUrl(effectiveSlug);

      setShortSlug(effectiveSlug);
      setShortUrl(fullUrl);
      setShowCustomInput(false);
      if (onShortUrlGenerated) {
        onShortUrlGenerated(fullUrl);
      }
    } catch (err) {
      setError(err?.message || "Failed to create short link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy short link:", shortUrl);
    }
  };

  return (
    <div
      className="shortlink-integrated-section"
      style={{
        marginTop: "16px",
        padding: "14px",
        background: "var(--bg-elevated, #f8fafc)",
        borderRadius: "8px",
        border: "1px solid var(--border, #e2e8f0)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#2563eb", display: "inline-flex" }}>
            <IconLink size={16} />
          </span>
          <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text, #1e293b)" }}>
            Short Link
          </span>
        </div>
        {destinationLabel && (
          <span
            style={{
              fontSize: "0.75rem",
              padding: "2px 8px",
              borderRadius: "4px",
              fontWeight: 600,
              background: destinationLabel.includes("Direct") ? "#dcfce7" : "#dbeafe",
              color: destinationLabel.includes("Direct") ? "#15803d" : "#1d4ed8",
            }}
          >
            {destinationLabel}
          </span>
        )}
      </div>

      {shortUrl ? (
        <div>
          <div
            style={{
              padding: "8px 10px",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              color: "#1e40af",
              wordBreak: "break-all",
              marginBottom: "8px",
              fontWeight: 600,
            }}
          >
            {shortUrl}
          </div>

          <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={copyToClipboard}
              style={{
                flex: 1,
                padding: "6px 12px",
                background: copied ? "#059669" : "#ffffff",
                color: copied ? "#ffffff" : "#334155",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "Copied!" : "Copy Link"}
            </button>

            <a
              href={shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "6px 12px",
                background: "#ffffff",
                color: "#334155",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
              title="Open working short link redirect in new tab"
            >
              <IconExternalLink size={14} />
              Open Link
            </a>

            <button
              type="button"
              onClick={() => {
                setShowCustomInput((v) => !v);
              }}
              style={{
                padding: "6px 12px",
                background: "#f1f5f9",
                color: "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showCustomInput ? "Cancel" : "Regenerate Short Link"}
            </button>
          </div>

          {showCustomInput && (
            <div style={{ marginBottom: "10px", padding: "10px", background: "#f1f5f9", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                New Custom Slug (Optional):
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <span style={{ padding: "5px 8px", background: "#e2e8f0", borderRadius: "4px 0 0 4px", fontSize: "0.8rem", color: "#64748b", fontFamily: "monospace" }}>
                  /s/
                </span>
                <input
                  type="text"
                  placeholder="e.g. promo-2026"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  style={{ flex: 1, padding: "5px 8px", borderRadius: "0 4px 4px 0", border: "1px solid #cbd5e1", fontSize: "0.82rem" }}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleCreate}
                  style={{
                    padding: "5px 12px",
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {loading ? "Generating..." : "Save"}
                </button>
              </div>
            </div>
          )}

          {/* Toggle short-link mode for the QR preview */}
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "8px" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer", fontSize: "0.82rem", color: "#334155" }}>
              <input
                type="checkbox"
                checked={encodeShortLinkInQr}
                onChange={(e) => onToggleEncodeShortLink(e.target.checked)}
                style={{ marginTop: "2px", width: "15px", height: "15px", accentColor: "#2563eb", cursor: "pointer" }}
              />
              <div>
                <b>Encode Short Link in QR Code</b>
                <div style={{ fontSize: "0.75rem", color: "#64748b", lineHeight: 1.3 }}>
                  {encodeShortLinkInQr
                    ? "✓ QR preview now encodes this short link and redirects to your destination."
                    : "Currently encoding original direct destination. Check to encode the short URL."}
                </div>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.35 }}>
            Create a trackable TypQR short link for this destination to track clicks and update over-the-air.
          </p>

          {showCustomInput && (
            <div style={{ marginBottom: "8px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                Custom Slug (Optional):
              </label>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ padding: "5px 8px", background: "#e2e8f0", borderRadius: "4px 0 0 4px", fontSize: "0.8rem", color: "#64748b", fontFamily: "monospace" }}>
                  /s/
                </span>
                <input
                  type="text"
                  placeholder="e.g. my-custom-link"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  style={{ flex: 1, padding: "5px 8px", borderRadius: "0 4px 4px 0", border: "1px solid #cbd5e1", fontSize: "0.82rem" }}
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              disabled={loading}
              onClick={handleCreate}
              style={{
                flex: 1,
                padding: "7px 12px",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              <IconLink size={14} />
              {loading ? "Creating Short Link..." : "Create Short Link"}
            </button>

            <button
              type="button"
              onClick={() => setShowCustomInput((v) => !v)}
              title="Add custom slug"
              style={{
                padding: "7px 10px",
                background: "#ffffff",
                color: "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showCustomInput ? "Hide Slug" : "+ Custom Slug"}
            </button>
          </div>

          {!user && (
            <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "#64748b" }}>
              <Link to="/dashboard" style={{ color: "#2563eb", fontWeight: 600 }}>Sign in</Link> to create persistent short links.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "8px", padding: "6px 10px", borderRadius: "6px", background: "#fef2f2", color: "#b91c1c", fontSize: "0.78rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
