// src/pages/GoogleReview.jsx — ProductMate-Style Google Review Link & QR Generator
// ZERO EXTERNAL APIS: Pure local parsing, offline link building, QR styling and saving to TypQR.

import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import QrPreview from "../components/QrPreview";
import { useAuth } from "../lib/useAuth";
import { createLink } from "../lib/links";
import {
  DEFAULT_DESIGN,
  SHAPES,
  EYES,
  buildQrSvg,
  svgToPngBlob,
  downloadBlob,
  downloadSvgString,
  fileToSmallLogo,
} from "../lib/qrRender";
import {
  IconStar,
  IconCopy,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconQrCode,
  IconPlus,
} from "../components/Icons";

// Local regex helpers for Google Place IDs and Maps URLs
const PLACE_ID_REGEX = /^[A-Za-z0-9_\-]{20,120}$/;

export function extractPlaceIdLocally(input) {
  if (!input) return null;
  const str = String(input).trim();

  // 1. Direct Place ID
  if (PLACE_ID_REGEX.test(str) && !str.includes("/") && !str.includes(".")) {
    return str;
  }

  // 2. Query param: placeid or place_id or query_place_id
  const qMatch = str.match(/[?&](?:placeid|place_id|query_place_id)=([A-Za-z0-9_\-]+)/i);
  if (qMatch && qMatch[1]) {
    return qMatch[1];
  }

  // 3. /maps/place/.../data=... where !1s(ChIJ...) is present
  const dataMatch = str.match(/!1s(ChIJ[A-Za-z0-9_\-]+)/i);
  if (dataMatch && dataMatch[1]) {
    return dataMatch[1];
  }

  // 4. /maps/place/ChIJ...
  const chijMatch = str.match(/\/maps\/place\/(ChIJ[A-Za-z0-9_\-]+)/i);
  if (chijMatch && chijMatch[1]) {
    return chijMatch[1];
  }

  // 5. Hex pair pattern in data: 0x...:0x... (note: hex pair is CID, not standard place ID string, so we don't fabricate)
  return null;
}

export function isValidGoogleReviewUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "search.google.com" && u.pathname.includes("/local/writereview")) {
      return true;
    }
    if (host === "g.page" && u.pathname.includes("/review")) {
      return true;
    }
    if (host.endsWith(".google.com") && u.searchParams.has("placeid")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function GoogleReviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [placeIdInput, setPlaceIdInput] = useState("");
  const [existingReviewUrl, setExistingReviewUrl] = useState("");

  const [generatedReviewUrl, setGeneratedReviewUrl] = useState("");
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // QR Design Customization
  const [design, setDesign] = useState({
    ...DEFAULT_DESIGN,
    fg: "#1a73e8", // Google blue default
    frameStyle: "bar",
    frameText: "Review us on Google ★",
  });

  const handleGenerate = (e) => {
    if (e) e.preventDefault();
    setNotice(null);
    setCopied(false);
    setSavedSuccess(false);

    // 1. Direct review URL check
    if (existingReviewUrl && existingReviewUrl.trim()) {
      const trimmed = existingReviewUrl.trim();
      if (isValidGoogleReviewUrl(trimmed)) {
        setGeneratedReviewUrl(trimmed);
        return;
      }
      try {
        const u = new URL(trimmed);
        if (u.protocol === "http:" || u.protocol === "https:") {
          setGeneratedReviewUrl(trimmed);
          return;
        }
      } catch {
        // fall through to other inputs
      }
    }

    // 2. Check direct Place ID input
    const directPid = placeIdInput.trim();
    if (directPid) {
      const extracted = extractPlaceIdLocally(directPid);
      if (extracted) {
        setGeneratedReviewUrl(`https://search.google.com/local/writereview?placeid=${encodeURIComponent(extracted)}`);
        return;
      }
    }

    // 3. Check Google Maps URL
    const mapsInput = googleMapsUrl.trim();
    if (mapsInput) {
      const extractedFromMaps = extractPlaceIdLocally(mapsInput);
      if (extractedFromMaps) {
        setGeneratedReviewUrl(`https://search.google.com/local/writereview?placeid=${encodeURIComponent(extractedFromMaps)}`);
        return;
      }
    }

    // 4. Fallback: No Place ID could be extracted locally without external APIs
    // Display exact required prompt notice
    setNotice({
      type: "missing_placeid",
      title: "Place ID Required",
      message:
        "We couldn't find a Place ID in this input. To generate the correct review link without an API, enter your Google Place ID or paste your existing Google Review link.",
    });
    setGeneratedReviewUrl("");
  };

  const copyToClipboard = async () => {
    if (!generatedReviewUrl) return;
    try {
      await navigator.clipboard.writeText(generatedReviewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleDownloadPng = async () => {
    if (!generatedReviewUrl) return;
    const svg = buildQrSvg(generatedReviewUrl, design, { size: 1024 });
    const blob = await svgToPngBlob(svg);
    const filename = `${(businessName || "google-review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`;
    downloadBlob(blob, filename);
  };

  const handleDownloadSvg = () => {
    if (!generatedReviewUrl) return;
    const svg = buildQrSvg(generatedReviewUrl, design, { size: 1024 });
    const filename = `${(businessName || "google-review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.svg`;
    downloadSvgString(svg, filename);
  };

  const handleSaveToDashboard = async () => {
    if (!generatedReviewUrl) return;
    if (!user) {
      navigate("/dashboard");
      return;
    }
    setSaving(true);
    try {
      await createLink({
        label: businessName ? `Google Review: ${businessName}` : "Google Review Link",
        destinationUrl: generatedReviewUrl,
        type: "dynamic",
        design,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      alert(`Could not save link: ${err?.message || "Storage error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell currentTab="reviews" title="Google Review Generator">
      <div className="event-mgmt-container" style={{ maxWidth: "1160px", margin: "0 auto", padding: "1.5rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ display: "inline-flex", p: "0.5rem", borderRadius: "8px", background: "#fef3c7", color: "#d97706" }}>
              <IconStar size={24} />
            </span>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0, color: "#111827" }}>
              Google Review Link Generator
            </h1>
          </div>
          <p style={{ color: "#4b5563", margin: 0, fontSize: "0.95rem" }}>
            Generate 1-click Google 5-star review links and branded QR codes directly to boost your business reputation. Runs 100% locally with zero external API dependencies.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: generatedReviewUrl ? "1.2fr 0.8fr" : "1fr", gap: "2rem", alignItems: "start" }}>
          {/* Input Card */}
          <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 600, color: "#1f2937", marginBottom: "1.25rem" }}>
              Business & Review Information
            </h2>

            <form onSubmit={handleGenerate}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Business Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Acme Cafe & Bakery"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Google Place ID (Recommended)
                </label>
                <input
                  type="text"
                  placeholder="e.g. ChIJN1t_tDeuEmsRUsoyG83frY4"
                  value={placeIdInput}
                  onChange={(e) => setPlaceIdInput(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
                <span style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem", display: "block" }}>
                  Direct Google Place ID for guaranteed review dialog resolution.
                </span>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Or Google Maps URL
                </label>
                <input
                  type="text"
                  placeholder="https://www.google.com/maps/place/..."
                  value={googleMapsUrl}
                  onChange={(e) => setGoogleMapsUrl(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
                <span style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem", display: "block" }}>
                  Full Maps URL containing query_place_id or !1sChIJ... parameter.
                </span>
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Or Existing Google Review URL
                </label>
                <input
                  type="text"
                  placeholder="https://search.google.com/local/writereview?placeid=... or https://g.page/r/..."
                  value={existingReviewUrl}
                  onChange={(e) => setExistingReviewUrl(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
              </div>

              {/* Action notice if Place ID is missing */}
              {notice && (
                <div style={{ padding: "1rem", borderRadius: "8px", background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e", marginBottom: "1.25rem" }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>{notice.title}</div>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.88rem", lineHeight: 1.4 }}>
                    {notice.message}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.82rem" }}>
                    <a
                      href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#b45309", fontWeight: 600, textDecoration: "underline" }}
                    >
                      Find Place ID with Google Place ID Finder →
                    </a>
                    <a
                      href="https://business.google.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#b45309", fontWeight: 600, textDecoration: "underline" }}
                    >
                      Google Business Profile Dashboard →
                    </a>
                  </div>
                </div>
              )}

              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "0.75rem 1.25rem",
                  background: "#1a73e8",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                <IconStar size={18} />
                Generate Review Link
              </button>
            </form>

            {/* Generated Result Card */}
            {generatedReviewUrl && (
              <div style={{ marginTop: "1.75rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
                  Your Direct 5-Star Review Link:
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedReviewUrl}
                    style={{ flex: 1, padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #93c5fd", background: "#eff6ff", color: "#1e40af", fontSize: "0.85rem", fontFamily: "monospace" }}
                  />
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    style={{
                      padding: "0.6rem 1rem",
                      background: copied ? "#059669" : "#ffffff",
                      color: copied ? "#ffffff" : "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                    }}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={generatedReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.6rem 0.85rem",
                      background: "#ffffff",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title="Open Link"
                  >
                    <IconExternalLink size={16} />
                  </a>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    style={{
                      padding: "0.6rem 1rem",
                      background: "#111827",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <IconDownload size={15} />
                    Download PNG
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    style={{
                      padding: "0.6rem 1rem",
                      background: "#ffffff",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <IconDownload size={15} />
                    Download SVG
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToDashboard}
                    disabled={saving}
                    style={{
                      padding: "0.6rem 1rem",
                      background: savedSuccess ? "#059669" : "#4f46e5",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      cursor: saving ? "wait" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    {savedSuccess ? <IconCheck size={15} /> : <IconPlus size={15} />}
                    {savedSuccess ? "Saved to QR Codes" : saving ? "Saving..." : "Save to My QR Codes"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* QR Code Preview & Customization Sidebar */}
          {generatedReviewUrl && (
            <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1f2937", marginBottom: "1rem" }}>
                QR Code Preview & Brand Style
              </h3>

              <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.25rem", padding: "1rem", background: "#f9fafb", borderRadius: "8px" }}>
                <QrPreview value={generatedReviewUrl} design={design} size={240} />
              </div>

              {/* Quick style options */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563" }}>Color</label>
                  <input
                    type="color"
                    value={design.fg}
                    onChange={(e) => setDesign({ ...design, fg: e.target.value })}
                    style={{ width: "100%", height: "36px", padding: "2px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563" }}>Background</label>
                  <input
                    type="color"
                    value={design.bg}
                    onChange={(e) => setDesign({ ...design, bg: e.target.value })}
                    style={{ width: "100%", height: "36px", padding: "2px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer" }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", display: "block", marginBottom: "0.3rem" }}>
                  Corner Eye Shape
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {EYES.map((eye) => (
                    <button
                      key={eye.id}
                      type="button"
                      onClick={() => setDesign({ ...design, eye: eye.id })}
                      style={{
                        flex: 1,
                        padding: "0.4rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "6px",
                        border: design.eye === eye.id ? "2px solid #1a73e8" : "1px solid #d1d5db",
                        background: design.eye === eye.id ? "#eff6ff" : "#ffffff",
                        color: design.eye === eye.id ? "#1a73e8" : "#374151",
                        fontWeight: design.eye === eye.id ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      {eye.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", display: "block", marginBottom: "0.3rem" }}>
                  Pattern Shape
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {SHAPES.map((shape) => (
                    <button
                      key={shape.id}
                      type="button"
                      onClick={() => setDesign({ ...design, shape: shape.id })}
                      style={{
                        flex: 1,
                        padding: "0.4rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "6px",
                        border: design.shape === shape.id ? "2px solid #1a73e8" : "1px solid #d1d5db",
                        background: design.shape === shape.id ? "#eff6ff" : "#ffffff",
                        color: design.shape === shape.id ? "#1a73e8" : "#374151",
                        fontWeight: design.shape === shape.id ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      {shape.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", display: "block", marginBottom: "0.3rem" }}>
                  Frame Banner Text
                </label>
                <input
                  type="text"
                  value={design.frameText}
                  onChange={(e) => setDesign({ ...design, frameText: e.target.value })}
                  placeholder="Review us on Google ★"
                  style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
