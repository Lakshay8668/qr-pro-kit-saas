// src/pages/GoogleReview.jsx — ProductMate-Style Google Review Link & QR Generator
// ZERO EXTERNAL APIS: Pure local parsing, offline link building, QR styling and saving to TypQR.

import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import QrPreview from "../components/QrPreview";
import ShortLinkSection from "../components/ShortLinkSection";
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
import {
  extractPlaceIdLocally,
  isValidGoogleReviewUrl,
  isValidGoogleMapsUrl,
} from "../lib/googleReviewLocal";

export { extractPlaceIdLocally, isValidGoogleReviewUrl, isValidGoogleMapsUrl };

export default function GoogleReviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [placeIdInput, setPlaceIdInput] = useState("");
  const [existingReviewUrl, setExistingReviewUrl] = useState("");

  const [generatedReviewUrl, setGeneratedReviewUrl] = useState("");
  const [destinationType, setDestinationType] = useState(""); // "direct_review" | "maps_listing"
  const [shortUrl, setShortUrl] = useState("");
  const [encodeShortLinkInQr, setEncodeShortLinkInQr] = useState(false);

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

  // Effective QR payload to encode: uses short link if short-link mode is enabled, otherwise the original destination URL
  const qrEncodedValue = useMemo(() => {
    if (encodeShortLinkInQr && shortUrl) return shortUrl;
    return generatedReviewUrl;
  }, [encodeShortLinkInQr, shortUrl, generatedReviewUrl]);

  const handleGenerate = (e) => {
    if (e) e.preventDefault();
    setNotice(null);
    setCopied(false);
    setSavedSuccess(false);
    setShortUrl("");
    setEncodeShortLinkInQr(false);

    // 1. Direct review URL input check
    if (existingReviewUrl && existingReviewUrl.trim()) {
      const trimmed = existingReviewUrl.trim();
      if (isValidGoogleReviewUrl(trimmed)) {
        setGeneratedReviewUrl(trimmed);
        setDestinationType("direct_review");
        return;
      }
      try {
        const u = new URL(trimmed);
        if (u.protocol === "http:" || u.protocol === "https:") {
          setGeneratedReviewUrl(trimmed);
          setDestinationType("direct_review");
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
        setDestinationType("direct_review");
        return;
      }
    }

    // 3. Check Google Maps URL
    const mapsInput = googleMapsUrl.trim();
    if (mapsInput) {
      const extractedFromMaps = extractPlaceIdLocally(mapsInput);
      if (extractedFromMaps) {
        setGeneratedReviewUrl(`https://search.google.com/local/writereview?placeid=${encodeURIComponent(extractedFromMaps)}`);
        setDestinationType("direct_review");
        return;
      }

      // Valid Google Maps URL without an embedded Place ID:
      // DO NOT BLOCK! Generate QR code encoding the Google Maps listing URL directly.
      if (isValidGoogleMapsUrl(mapsInput) || /^https?:\/\//i.test(mapsInput)) {
        setGeneratedReviewUrl(mapsInput);
        setDestinationType("maps_listing");
        setNotice({
          type: "maps_listing_info",
          title: "Google Maps Listing Detected",
          message:
            "This QR code encodes your Google Maps listing. Because this link does not contain a specific Place ID, visitors will open your business on Google Maps and can tap 'Write a Review' directly from the listing.",
        });
        return;
      }
    }

    // 4. If only business name entered with no URL or Place ID
    if (businessName.trim() && !mapsInput && !directPid && !existingReviewUrl) {
      setNotice({
        type: "missing_input",
        title: "Google Maps URL Required",
        message:
          "Please paste your Google Maps business listing URL or Google Place ID. Without an external API key, a listing link is required to generate your QR code.",
      });
      setGeneratedReviewUrl("");
      setDestinationType("");
      return;
    }

    // 5. Fallback: No valid input provided
    setNotice({
      type: "missing_input",
      title: "Input Required",
      message:
        "Please provide a Google Maps URL, a Google Place ID, or an official Google review link to generate your QR code.",
    });
    setGeneratedReviewUrl("");
    setDestinationType("");
  };

  const copyToClipboard = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy link:", text);
    }
  };

  const handleDownloadPng = async () => {
    if (!qrEncodedValue) return;
    const svg = buildQrSvg(qrEncodedValue, design, { size: 1024 });
    const blob = await svgToPngBlob(svg);
    const filename = `${(businessName || "google-review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`;
    downloadBlob(blob, filename);
  };

  const handleDownloadSvg = () => {
    if (!qrEncodedValue) return;
    const svg = buildQrSvg(qrEncodedValue, design, { size: 1024 });
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
        destination: generatedReviewUrl,
        type: "url",
        kind: "redirect",
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
    <AppShell currentTab="reviews" title="Google Review QR Generator">
      <div className="event-mgmt-container" style={{ maxWidth: "1160px", margin: "0 auto", padding: "1.5rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ display: "inline-flex", padding: "0.5rem", borderRadius: "8px", background: "#fef3c7", color: "#d97706" }}>
              <IconStar size={24} />
            </span>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0, color: "#111827" }}>
              Google Review QR Generator
            </h1>
          </div>
          <p style={{ color: "#4b5563", margin: 0, fontSize: "0.95rem" }}>
            Create branded Google Review QR codes that open your 5-star review page or Google Maps listing. 100% first-party with zero external API requirements.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: generatedReviewUrl ? "1.2fr 0.8fr" : "1fr", gap: "2rem", alignItems: "start" }}>
          {/* Input Card */}
          <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 600, color: "#1f2937", marginBottom: "1.25rem" }}>
              Business &amp; Listing Information
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
                  Google Maps URL
                </label>
                <input
                  type="text"
                  placeholder="https://www.google.com/maps/place/... or https://maps.app.goo.gl/..."
                  value={googleMapsUrl}
                  onChange={(e) => setGoogleMapsUrl(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
                <span style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem", display: "block" }}>
                  Paste any Google Maps link. If a Place ID is present, we'll route directly to the review dialog; otherwise, it opens your Maps listing directly.
                </span>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Or Google Place ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. ChIJN1t_tDeuEmsRUsoyG83frY4"
                  value={placeIdInput}
                  onChange={(e) => setPlaceIdInput(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
                <span style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem", display: "block" }}>
                  Direct Google Place ID for guaranteed direct review pop-up dialog.
                </span>
              </div>

              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem" }}>
                  Or Direct Google Review URL (Optional)
                </label>
                <input
                  type="text"
                  placeholder="https://search.google.com/local/writereview?placeid=... or https://g.page/r/..."
                  value={existingReviewUrl}
                  onChange={(e) => setExistingReviewUrl(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                />
              </div>

              {/* Informational Notice */}
              {notice && (
                <div
                  style={{
                    padding: "0.85rem 1rem",
                    borderRadius: "8px",
                    background: notice.type === "maps_listing_info" ? "#eff6ff" : "#fef3c7",
                    border: `1px solid ${notice.type === "maps_listing_info" ? "#bfdbfe" : "#fde68a"}`,
                    color: notice.type === "maps_listing_info" ? "#1e40af" : "#92400e",
                    marginBottom: "1.25rem",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.9rem" }}>{notice.title}</div>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.4 }}>
                    {notice.message}
                  </p>
                </div>
              )}

              {/* Main Button: Generate QR Code */}
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
                <IconQrCode size={18} />
                Generate QR Code
              </button>
            </form>

            {/* Generated Destination Info */}
            {generatedReviewUrl && (
              <div style={{ marginTop: "1.75rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#374151" }}>
                    Destination:
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      padding: "0.2rem 0.55rem",
                      borderRadius: "6px",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      background: destinationType === "direct_review" ? "#dcfce7" : "#dbeafe",
                      color: destinationType === "direct_review" ? "#15803d" : "#1d4ed8",
                    }}
                  >
                    {destinationType === "direct_review" ? "★ Direct Google Review" : "🗺️ Google Maps listing"}
                  </span>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedReviewUrl}
                    style={{
                      flex: 1,
                      padding: "0.6rem 0.8rem",
                      borderRadius: "6px",
                      border: "1px solid #93c5fd",
                      background: "#eff6ff",
                      color: "#1e40af",
                      fontSize: "0.82rem",
                      fontFamily: "monospace",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedReviewUrl)}
                    style={{
                      padding: "0.6rem 0.85rem",
                      background: copied ? "#059669" : "#ffffff",
                      color: copied ? "#ffffff" : "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={generatedReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.6rem 0.8rem",
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
                    <IconExternalLink size={15} />
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
                    {savedSuccess ? "Saved to Dashboard" : saving ? "Saving..." : "Save to My QR Codes"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* QR Code Preview & Customization Sidebar */}
          {generatedReviewUrl && (
            <div style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.5rem" }}>
                QR Code Live Preview
              </h3>
              <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "#6b7280" }}>
                Encodes {encodeShortLinkInQr && shortUrl ? "TypQR Short Link" : destinationType === "direct_review" ? "Direct Review URL" : "Google Maps Listing"}.
              </p>

              <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.25rem", padding: "1.25rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #f3f4f6" }}>
                <QrPreview value={qrEncodedValue} design={design} size={240} />
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
                  Frame Call-To-Action Text
                </label>
                <input
                  type="text"
                  value={design.frameText || ""}
                  onChange={(e) => setDesign({ ...design, frameText: e.target.value })}
                  placeholder="Review us on Google ★"
                  style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button
                  type="button"
                  onClick={() => setDesign({ ...design, frameStyle: design.frameStyle === "bar" ? "none" : "bar" })}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    background: design.frameStyle === "bar" ? "#eff6ff" : "#ffffff",
                    color: design.frameStyle === "bar" ? "#1e40af" : "#374151",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {design.frameStyle === "bar" ? "✓ Frame Active" : "Add Frame"}
                </button>
              </div>

              {/* Integrated Short Link Section directly below the QR code and customisation controls */}
              <ShortLinkSection
                destination={generatedReviewUrl}
                destinationLabel={destinationType === "direct_review" ? "Direct Google Review" : "Google Maps listing"}
                user={user}
                encodeShortLinkInQr={encodeShortLinkInQr}
                onToggleEncodeShortLink={setEncodeShortLinkInQr}
                onShortUrlGenerated={(url) => setShortUrl(url)}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
