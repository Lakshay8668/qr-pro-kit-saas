// src/components/GoogleReviewGenerator.jsx
// ProductMate-style Google Review Link Generator.
// Resolves Google Maps URLs / short links safely via backend, extracts verified Place IDs,
// and builds direct review URLs: https://search.google.com/local/writereview?placeid=PLACE_ID.
// Fully independent of TypQR short links with standalone Copy Link functionality.

import React, { useState } from "react";
import { resolveGoogleReviewLink } from "../lib/links";
import { IconCopy, IconCheck, IconExternalLink } from "./Icons";

export default function GoogleReviewGenerator({ data = {}, setData }) {
  const [inputUrl, setInputUrl] = useState(data.inputUrl || data.placeId || "");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [candidates, setCandidates] = useState([]);

  const directReviewUrl = data.reviewUrl || (data.placeId && data.placeId.startsWith("http")
    ? data.placeId
    : data.placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(data.placeId)}`
    : "");

  const handleGenerate = async (e) => {
    e?.preventDefault?.();
    const raw = (inputUrl || "").trim();
    if (!raw) {
      setError("Please paste a Google Maps link, share link, or Place ID.");
      return;
    }

    setResolving(true);
    setError("");
    setCandidates([]);

    try {
      const res = await resolveGoogleReviewLink(raw);
      if (res.ok && (res.reviewUrl || res.review_url)) {
        const placeId = res.placeId || res.place_id;
        const reviewUrl = res.reviewUrl || res.review_url;
        setData({
          ...data,
          inputUrl: raw,
          placeId,
          reviewUrl,
          businessName: res.business_name || null,
          address: res.address || null,
          resolvedUrl: res.resolvedUrl || res.resolved_url || null,
        });
        setError("");
        setCandidates([]);
        setManualFallback(false);
      } else {
        const msg = res.error || "Could not automatically resolve the Google Place ID from this link. You can paste your official Google review link or Place ID directly.";
        setError(msg);
        if (Array.isArray(res.candidates) && res.candidates.length > 0) {
          setCandidates(res.candidates);
        }
        setManualFallback(true);
      }
    } catch (err) {
      const serverData = err.data || {};
      let msg = serverData.error || err?.message;

      if (Array.isArray(serverData.candidates) && serverData.candidates.length > 0) {
        setCandidates(serverData.candidates);
      }

      if (serverData.code === "multiple_matches") {
        msg = "Multiple matching business locations found. Please select your exact location below:";
      } else if (serverData.code === "insufficient_confidence") {
        msg = serverData.error || "Please verify your location from the suggestions below:";
      } else if (serverData.code === "places_quota_exceeded") {
        msg = "Google Places API quota exceeded. Please check Google Cloud billing or paste your review link directly.";
      } else if (serverData.code === "invalid_api_key") {
        msg = "Google Places API key is unauthorized or invalid. Please check server configuration or paste your review link directly.";
      } else if (serverData.code === "no_match") {
        msg = serverData.error || "No matching business location found. Please paste your review link directly.";
      } else if (serverData.code === "unsupported_url") {
        msg = "Unsupported URL: Please use a Share link from Google Maps (maps.app.goo.gl, share.google) or a full Google Maps place link.";
      } else if (serverData.code === "unsafe_redirect") {
        msg = "Security notice: This link redirected to an unapproved or private network destination.";
      } else if (serverData.code === "upstream_timeout") {
        msg = "Resolution timed out: The Google Maps short link took too long to respond. Please try again or paste the full Google Maps URL directly.";
      } else if (serverData.code === "place_id_not_found") {
        msg = "Place ID not found: Could not identify a specific business location in this link. Please select a specific business on Google Maps, or paste your review link directly.";
      } else if (!msg || msg === "Request failed") {
        msg = "Could not resolve Google Review link. Please try again or paste your review link directly.";
      }
      setError(msg);
      setManualFallback(true);
    } finally {
      setResolving(false);
    }
  };

  const handleSelectCandidate = (cand) => {
    if (!cand || !cand.place_id) return;
    const reviewUrl = cand.review_url || `https://search.google.com/local/writereview?placeid=${encodeURIComponent(cand.place_id)}`;
    setData({
      ...data,
      inputUrl: cand.name || inputUrl,
      placeId: cand.place_id,
      reviewUrl,
      businessName: cand.name || null,
      address: cand.address || null,
    });
    setCandidates([]);
    setError("");
    setManualFallback(false);
  };

  const handleCopy = async (textToCopy) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this Google Review link:", textToCopy);
    }
  };

  const handleManualApply = (val) => {
    const clean = (val || "").trim();
    setManualValue(clean);
    if (!clean) return;

    if (!clean.startsWith("http")) {
      // Looks like a Place ID
      if (!/^[A-Za-z0-9_-]{20,80}$/.test(clean)) {
        setError("Please enter a valid Google Place ID (e.g. ChIJ...) or official Google review link.");
        return;
      }
      const reviewUrl = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(clean)}`;
      setData({
        ...data,
        inputUrl: clean,
        placeId: clean,
        reviewUrl,
      });
      setError("");
      return;
    }

    // Direct URL pasted: validate destination
    try {
      const parsed = new URL(clean);
      const host = parsed.hostname.toLowerCase();
      const isApproved =
        host === "search.google.com" ||
        host === "maps.google.com" ||
        host === "google.com" ||
        host.endsWith(".google.com") ||
        host === "g.page" ||
        host.endsWith(".g.page") ||
        /^(?:[a-z0-9-]+\.)*google\.(?:[a-z]{2,4}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(host);

      if (!isApproved) {
        setError("Invalid review link: Destination must be an official Google domain (search.google.com or g.page).");
        return;
      }

      let placeId = clean;
      const match = clean.match(/(?:placeid|place_id|query_place_id)=([A-Za-z0-9_-]{20,})/i);
      if (match) placeId = match[1];

      setData({
        ...data,
        inputUrl: clean,
        placeId,
        reviewUrl: clean,
      });
      setError("");
    } catch {
      setError("Please paste a valid URL or Place ID.");
    }
  };

  const handleReset = () => {
    setInputUrl("");
    setManualValue("");
    setError("");
    setCandidates([]);
    setManualFallback(false);
    setData({
      ...data,
      inputUrl: "",
      placeId: "",
      reviewUrl: "",
      businessName: null,
      address: null,
      resolvedUrl: null,
    });
  };

  return (
    <div className="google-review-generator" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <label style={{ display: "block", fontWeight: 600, fontSize: "14px", marginBottom: "6px" }}>
          Google Maps Link or Short URL
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            className="dash-input"
            style={{ flex: 1 }}
            placeholder="e.g. https://maps.app.goo.gl/... or https://share.google/..."
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleGenerate(e);
            }}
            disabled={resolving}
          />
          <button
            type="button"
            className="primary-btn"
            style={{ whiteSpace: "nowrap", padding: "8px 16px" }}
            onClick={handleGenerate}
            disabled={resolving || !inputUrl.trim()}
          >
            {resolving ? "Resolving…" : "Generate Review Link"}
          </button>
        </div>
        <p className="field-hint" style={{ marginTop: "6px", fontSize: "12px", color: "var(--text-muted)" }}>
          Supports <code>maps.app.goo.gl</code>, <code>share.google</code>, Google Maps URLs, or business Place IDs.
        </p>
      </div>

      {/* Error state with action to use manual fallback */}
      {error && (
        <div
          className="alert error"
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "#dc2626",
            fontSize: "13px",
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>⚠️ Resolution Notice</div>
          <div>{error}</div>
          {!manualFallback && (
            <button
              type="button"
              className="text-btn"
              onClick={() => setManualFallback(true)}
              style={{ marginTop: "6px", fontSize: "12px", textDecoration: "underline", color: "#b91c1c" }}
            >
              Paste review link or Place ID manually →
            </button>
          )}
        </div>
      )}

      {/* Multiple candidates selection list (Task 5: Matching Safety) */}
      {candidates && candidates.length > 0 && (
        <div
          className="candidates-selection-box"
          style={{
            padding: "12px",
            borderRadius: "8px",
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
            📍 Select your verified location:
          </div>
          {candidates.map((cand, idx) => (
            <div
              key={cand.place_id || idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "6px",
                background: "rgba(0, 0, 0, 0.02)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{cand.name}</div>
                {cand.address && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {cand.address}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="primary-btn"
                style={{ fontSize: "12px", padding: "6px 12px", whiteSpace: "nowrap" }}
                onClick={() => handleSelectCandidate(cand)}
              >
                Select This Listing
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Generated Link Result Card (ProductMate-style) */}
      {directReviewUrl && (
        <div
          className="review-result-card"
          style={{
            padding: "16px",
            borderRadius: "8px",
            background: "rgba(16, 185, 129, 0.07)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#059669", display: "flex", alignItems: "center" }}>
                <IconCheck size={18} />
              </span>
              <strong style={{ fontSize: "14px", color: "#065f46" }}>Official Google Review Link Ready</strong>
            </div>
            {data.placeId && (
              <span
                style={{
                  fontSize: "11px",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#047857",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontWeight: 600,
                  fontFamily: "monospace",
                }}
                title={`Verified Place ID: ${data.placeId}`}
              >
                Place ID: {data.placeId.length > 20 ? `${data.placeId.slice(0, 16)}…` : data.placeId}
              </span>
            )}
          </div>

          {(data.businessName || data.address) && (
            <div style={{ fontSize: "13px", color: "#065f46", fontWeight: 500, lineHeight: 1.4 }}>
              <strong>{data.businessName || "Verified Listing"}</strong>
              {data.address ? ` — ${data.address}` : ""}
            </div>
          )}

          <div
            style={{
              padding: "10px 12px",
              background: "#ffffff",
              borderRadius: "6px",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              fontSize: "13px",
              fontFamily: "monospace",
              color: "#1f2937",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {directReviewUrl}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="primary-btn"
              onClick={() => handleCopy(directReviewUrl)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "13px",
                padding: "6px 14px",
                background: copied ? "#059669" : undefined,
              }}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "Copied to Clipboard!" : "Copy Review Link"}
            </button>

            <a
              href={directReviewUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "13px",
                padding: "6px 14px",
                textDecoration: "none",
              }}
            >
              <IconExternalLink size={14} />
              Test Link
            </a>

            <button
              type="button"
              className="text-btn"
              onClick={handleReset}
              style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "auto" }}
            >
              ✕ Reset
            </button>
          </div>

          <p style={{ margin: 0, fontSize: "12px", color: "#065f46", lineHeight: 1.4 }}>
            💡 When customers open this link or scan your QR code, Google opens directly to your 5-star review submission form.
          </p>
        </div>
      )}

      {/* Manual fallback input */}
      {(manualFallback || !directReviewUrl) && (
        <details
          open={manualFallback}
          onToggle={(e) => setManualFallback(e.target.open)}
          style={{
            fontSize: "13px",
            border: "1px dashed var(--border)",
            borderRadius: "6px",
            padding: "8px 12px",
          }}
        >
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontWeight: 500 }}>
            {manualFallback ? "Manual input / Official link paste" : "Or paste official review link or Place ID manually"}
          </summary>
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              type="text"
              className="dash-input"
              placeholder="ChIJ… or https://search.google.com/local/writereview?placeid=…"
              value={manualValue || data.placeId || ""}
              onChange={(e) => handleManualApply(e.target.value)}
            />
            <p className="field-hint" style={{ fontSize: "11px", margin: 0 }}>
              If you already have your official Google review URL or Place ID from your Google Business Profile, paste it directly here.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
