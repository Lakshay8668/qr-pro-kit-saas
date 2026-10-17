// src/components/EditQrModal.jsx — Complete, Professional QR Editing Experience
// Supports both Static QR codes and Dynamic QR codes with design customizer and live preview.

import React, { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import Modal from "./Modal";
import QrPreview from "./QrPreview";
import BioEditor from "./BioEditor";
import { hashPassword } from "../lib/password";
import { uploadUserFile } from "../lib/storage";
import { isStorageConfigured } from "../lib/firebase";
import { updateLink, createLink, dynamicUrlFor } from "../lib/links";
import { isValidHttpUrl } from "../lib/qrPayloads";
import {
  DEFAULT_DESIGN,
  SHAPES,
  EYES,
  buildQrSvg,
  svgToPngBlob,
  downloadBlob,
  downloadSvgString,
} from "../lib/qrRender";
import {
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconCheck,
  IconQrCode,
  IconPlus,
} from "./Icons";

const PRESETS = [
  { name: "Classic", fg: "#111827", fg2: "", bg: "#ffffff" },
  { name: "Royal Purple", fg: "#4f46e5", fg2: "#7c3aed", bg: "#ffffff" },
  { name: "Ocean Blue", fg: "#0284c7", fg2: "#06b6d4", bg: "#ffffff" },
  { name: "Emerald", fg: "#059669", fg2: "#10b981", bg: "#ffffff" },
  { name: "Sunset", fg: "#e11d48", fg2: "#f97316", bg: "#ffffff" },
  { name: "Midnight Dark", fg: "#f9fafb", fg2: "", bg: "#111827" },
];

function toDateInput(val) {
  if (!val) return "";
  let d = null;
  if (typeof val?.toDate === "function") d = val.toDate();
  else if (val instanceof Date) d = val;
  else if (typeof val === "number") d = new Date(val);
  else if (typeof val === "string") d = new Date(val);
  if (!d || isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EditQrModal({ link, uid, features, onClose, onCreatedNew }) {
  const isStatic = link.kind === "static";
  const isBio = link.kind === "bio";
  const isFile = link.type === "pdf";
  const canPw = !features || features?.password || Boolean(link.password?.hash);
  const canOs = !features || features?.deviceTargeting || Boolean(link.destinations?.ios || link.destinations?.android);

  // Active sub-tab in editor
  const [activeTab, setActiveTab] = useState(isStatic ? "details" : "destination");

  // Form states
  const [label, setLabel] = useState(link.label || "");
  const [destination, setDestination] = useState(link.destination || "");
  const [ios, setIos] = useState(link.destinations?.ios || "");
  const [android, setAndroid] = useState(link.destinations?.android || "");
  const [bio, setBio] = useState(link.bio || null);
  const [expiry, setExpiry] = useState(toDateInput(link.expiresAt));
  const [maxScans, setMaxScans] = useState(link.maxScans || "");
  const [newPw, setNewPw] = useState("");
  const [removePw, setRemovePw] = useState(false);
  const [active, setActive] = useState(link.active !== false);
  const [newFile, setNewFile] = useState(null);
  const [progress, setProgress] = useState(0);

  // Design state
  const [design, setDesign] = useState({
    ...DEFAULT_DESIGN,
    ...(link.design || {}),
  });

  // Replacement static QR state
  const [showReplacePrompt, setShowReplacePrompt] = useState(false);
  const [newStaticPayload, setNewStaticPayload] = useState("");
  const [newStaticLabel, setNewStaticLabel] = useState("");
  const [replacingStatic, setReplacingStatic] = useState(false);

  // Status & copy states
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const fileInputRef = useRef(null);

  const patchDesign = (p) => setDesign((d) => ({ ...d, ...p }));

  const dynamicUrl = dynamicUrlFor(link.id);
  const qrDisplayValue = isStatic ? link.payload || "" : dynamicUrl;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(dynamicUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      window.prompt("Copy dynamic URL:", dynamicUrl);
    }
  };

  const handleCopyPayload = async () => {
    try {
      await navigator.clipboard.writeText(link.payload || "");
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
      window.prompt("Copy static payload:", link.payload || "");
    }
  };

  // Logo upload handler
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Logo image must be smaller than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      patchDesign({ logo: ev.target?.result });
    };
    reader.readAsDataURL(file);
  };

  // Direct download from editor
  const handleDownload = async (format) => {
    try {
      const svg = buildQrSvg(qrDisplayValue, design, { size: format === "svg" ? 1024 : Number(format) });
      const filename = `qr-${(label || link.id).replace(/[^\w-]+/g, "-").slice(0, 30)}`;
      if (format === "svg") {
        downloadSvgString(svg, `${filename}.svg`);
      } else {
        const px = Number(format);
        const blob = await svgToPngBlob(svg);
        downloadBlob(blob, `${filename}-${px}.png`);
      }
    } catch (err) {
      alert(err?.message || "Download failed.");
    }
  };

  // Create explicit new static QR if user wants to change destination
  const handleCreateNewStaticQr = async () => {
    setError("");
    const content = newStaticPayload.trim();
    if (!content) {
      setError("Please enter the new destination URL or text for the new static QR.");
      return;
    }
    setReplacingStatic(true);
    try {
      const newName = newStaticLabel.trim() || `${label || "QR"} (v2)`;
      const newId = await createLink({
        kind: "static",
        payload: content,
        label: newName,
        ownerId: uid,
        type: link.type || "url",
        design,
      });
      setSuccess(`New static QR code created successfully (#${newId})! Original QR was preserved.`);
      setShowReplacePrompt(false);
      if (onCreatedNew) onCreatedNew(newId);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err?.message || "Failed to create replacement static QR.");
    } finally {
      setReplacingStatic(false);
    }
  };

  // Save changes handler
  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      if (isStatic) {
        // Save static QR: label and design
        await updateLink(link.id, {
          label: label.trim() || "Untitled QR",
          design,
        });
        setSuccess("Static QR label and design updated successfully!");
        setTimeout(() => onClose(), 1000);
        return;
      }

      // Dynamic QR save: validate destination
      if (!isBio) {
        if (!newFile && !isValidHttpUrl(destination.trim())) {
          throw new Error("Destination must be a valid http or https URL.");
        }
        if (ios && !isValidHttpUrl(ios.trim())) {
          throw new Error("iPhone URL must be a valid http or https URL.");
        }
        if (android && !isValidHttpUrl(android.trim())) {
          throw new Error("Android URL must be a valid http or https URL.");
        }
      }

      let uploadedDestination = destination.trim();
      if (newFile && uid) {
        uploadedDestination = await uploadUserFile(uid, newFile, setProgress);
      }

      const patch = {
        label: label.trim() || "Untitled QR",
        active,
        design,
        expiresAt: expiry ? new Date(`${expiry}T23:59:59`) : null,
        maxScans: maxScans ? Number(maxScans) : null,
      };

      if (isBio) {
        patch.bio = bio;
      } else {
        patch.destination = uploadedDestination;
        if (canOs) {
          patch.destinations = {
            ios: ios.trim() || null,
            android: android.trim() || null,
          };
        }
      }

      if (removePw) {
        patch.password = null;
      } else if (newPw && canPw) {
        patch.password = await hashPassword(newPw);
      }

      await updateLink(link.id, patch);
      setSuccess("QR code updated! Destination and styling changes are live immediately.");
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err?.message || "Save failed. Please check your inputs.");
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit ${isStatic ? "Static" : "Dynamic"} QR Code`} onClose={onClose} wide={true}>
      <div className="edit-modal-layout">
        {/* Left Column: Form & Configuration */}
        <div className="edit-form-col">
          {/* Header pill strip */}
          <div className="edit-meta-strip">
            <span className={`pill ${isStatic ? "pill-static" : "pill-active"}`}>
              {isStatic ? "Static Direct QR" : "Dynamic Tracked QR"}
            </span>
            <span className="pill pill-id">#{link.id}</span>
            {link.type && <span className="pill pill-type">{link.type.toUpperCase()}</span>}
            {!isStatic && (
              <span className={`pill ${active ? "pill-active" : "pill-paused"}`}>
                {active ? "Active" : "Paused"}
              </span>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="edit-tab-bar">
            {isStatic ? (
              <>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "details" ? "active" : ""}`}
                  onClick={() => setActiveTab("details")}
                >
                  Details &amp; Content
                </button>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "design" ? "active" : ""}`}
                  onClick={() => setActiveTab("design")}
                >
                  Design &amp; Branding
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "destination" ? "active" : ""}`}
                  onClick={() => setActiveTab("destination")}
                >
                  Destination
                </button>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "details" ? "active" : ""}`}
                  onClick={() => setActiveTab("details")}
                >
                  Details &amp; Link
                </button>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "design" ? "active" : ""}`}
                  onClick={() => setActiveTab("design")}
                >
                  Design &amp; Style
                </button>
                <button
                  type="button"
                  className={`edit-tab-btn ${activeTab === "advanced" ? "active" : ""}`}
                  onClick={() => setActiveTab("advanced")}
                >
                  Advanced Controls
                </button>
              </>
            )}
          </div>

          {/* TAB: STATIC DETAILS */}
          {isStatic && activeTab === "details" && (
            <div className="edit-tab-pane">
              <label className="edit-field-label">
                QR Code Name / Label
                <input
                  type="text"
                  className="dash-input"
                  value={label}
                  placeholder="e.g. WiFi Lobby Card"
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                />
              </label>

              <div className="static-explanation-banner">
                <div className="banner-title">ℹ️ About Static QR Codes</div>
                <p>
                  Static QR codes encode their content directly into the printed matrix. Once generated or printed,
                  the encoded destination cannot be changed without re-printing.
                </p>
                <p style={{ marginTop: "6px" }}>
                  You can update this QR's name, colors, frame, and design at any time and re-download it.
                </p>
              </div>

              <div className="read-only-content-box">
                <div className="box-header">
                  <span>Encoded Destination / Content (Read-Only)</span>
                  <div className="box-header-actions" style={{ display: "flex", gap: "6px" }}>
                    <button type="button" className="mini-action-btn" onClick={handleCopyPayload}>
                      {copiedPayload ? <><IconCheck size={13} /> Copied</> : <><IconCopy size={13} /> Copy</>}
                    </button>
                    {(link.payload?.startsWith("http://") || link.payload?.startsWith("https://")) && (
                      <a href={link.payload} target="_blank" rel="noreferrer" className="mini-action-btn">
                        <IconExternalLink size={13} /> Open
                      </a>
                    )}
                  </div>
                </div>
                <div className="content-display">{link.payload || "—"}</div>
              </div>

              {/* Action to create replacement static QR if needed */}
              <div className="replace-action-box">
                <div className="replace-header">
                  <div>
                    <span className="replace-title">Need a different destination?</span>
                    <p className="replace-sub">
                      Generate a new static QR code without overwriting or breaking this existing one.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowReplacePrompt(!showReplacePrompt)}
                  >
                    <IconPlus size={14} /> Create Replacement QR
                  </button>
                </div>

                {showReplacePrompt && (
                  <div className="replace-prompt-form">
                    <label className="edit-field-label">
                      New Destination URL or Content
                      <input
                        type="text"
                        className="dash-input"
                        placeholder="https://example.com/new-target"
                        value={newStaticPayload}
                        onChange={(e) => setNewStaticPayload(e.target.value)}
                      />
                    </label>
                    <label className="edit-field-label">
                      New QR Name (optional)
                      <input
                        type="text"
                        className="dash-input"
                        placeholder={`${label || "QR"} (v2)`}
                        value={newStaticLabel}
                        onChange={(e) => setNewStaticLabel(e.target.value)}
                      />
                    </label>
                    <div className="prompt-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={replacingStatic || !newStaticPayload.trim()}
                        onClick={handleCreateNewStaticQr}
                      >
                        {replacingStatic ? "Creating…" : "Generate New Static QR"}
                      </button>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => setShowReplacePrompt(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DYNAMIC DESTINATION */}
          {!isStatic && activeTab === "destination" && (
            <div className="edit-tab-pane">
              <div className="dynamic-info-banner">
                <div className="banner-title">⚡ Instant Over-The-Air Redirect</div>
                <p>
                  Updating the destination below will immediately redirect all scans to the new URL.
                  Your existing printed QR codes and permanent short link <code>{dynamicUrl}</code> remain 100% active and unchanged.
                </p>
              </div>

              {!isBio ? (
                <>
                  <label className="edit-field-label">
                    Destination URL
                    <input
                      type="url"
                      className="dash-input"
                      placeholder="https://yourwebsite.com/promotion"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      disabled={Boolean(newFile)}
                    />
                  </label>

                  {isFile && (
                    <label className="edit-field-label" style={{ marginTop: "12px" }}>
                      Replace Hosted File (keeps the same QR)
                      <input
                        type="file"
                        className="dash-input"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        disabled={!isStorageConfigured()}
                        onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                      />
                      {!isStorageConfigured() && (
                        <span className="field-hint">Cloud storage is not provisioned; edit the URL above.</span>
                      )}
                    </label>
                  )}

                  {/* Device-specific redirects */}
                  <div className="device-targeting-group">
                    <div className="group-title">
                      <span>Device-Targeted Redirects (Optional)</span>
                      {!canOs && <Link to="/pricing" className="lock-badge">Pro</Link>}
                    </div>
                    <div className="row2">
                      <label className="edit-field-label">
                        iPhone / iOS Target URL
                        <input
                          type="url"
                          className="dash-input"
                          placeholder="App Store URL"
                          value={ios}
                          disabled={!canOs}
                          onChange={(e) => setIos(e.target.value)}
                        />
                      </label>
                      <label className="edit-field-label">
                        Android Target URL
                        <input
                          type="url"
                          className="dash-input"
                          placeholder="Play Store URL"
                          value={android}
                          disabled={!canOs}
                          onChange={(e) => setAndroid(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ marginTop: "10px" }}>
                  <BioEditor value={bio} onChange={setBio} />
                </div>
              )}
            </div>
          )}

          {/* TAB: DYNAMIC DETAILS */}
          {!isStatic && activeTab === "details" && (
            <div className="edit-tab-pane">
              <label className="edit-field-label">
                QR Code Name / Label
                <input
                  type="text"
                  className="dash-input"
                  value={label}
                  placeholder="e.g. Summer Campaign Poster"
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                />
              </label>

              <div className="read-only-content-box">
                <div className="box-header">
                  <span>Dynamic Short URL &amp; QR ID (Permanent)</span>
                  <div className="box-header-actions">
                    <button type="button" className="mini-action-btn" onClick={handleCopyLink}>
                      {copiedLink ? <><IconCheck size={13} /> Copied</> : <><IconCopy size={13} /> Copy Link</>}
                    </button>
                    <a href={dynamicUrl} target="_blank" rel="noreferrer" className="mini-action-btn">
                      <IconExternalLink size={13} /> Test Redirect
                    </a>
                  </div>
                </div>
                <div className="content-display" style={{ fontFamily: "monospace", fontSize: "13px" }}>
                  {dynamicUrl}
                </div>
                <div className="meta-footer">
                  <span>QR ID: <b>#{link.id}</b></span>
                  <span>Total Scans: <b>{link.scans || 0}</b></span>
                  <span>Created: <b>{link.createdAt ? new Date(link.createdAt.toMillis?.() || link.createdAt).toLocaleDateString() : "—"}</b></span>
                </div>
              </div>
            </div>
          )}

          {/* TAB: DESIGN & BRANDING (Available for BOTH Static and Dynamic) */}
          {activeTab === "design" && (
            <div className="edit-tab-pane">
              <div className="design-section-title">Color Palette Presets</div>
              <div className="presets-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="preset-circle"
                    title={p.name}
                    onClick={() => patchDesign({ fg: p.fg, fg2: p.fg2, bg: p.bg })}
                    style={{ background: `linear-gradient(135deg, ${p.fg}, ${p.fg2 || p.fg})` }}
                  />
                ))}
              </div>

              <div className="options-grid three">
                <label className="edit-field-label">
                  QR Pattern Color
                  <input
                    type="color"
                    className="color-picker-input"
                    value={design.fg || "#111827"}
                    onChange={(e) => patchDesign({ fg: e.target.value })}
                  />
                </label>
                <label className="edit-field-label">
                  Gradient To (Optional)
                  <div className="inline-pick-wrap">
                    <input
                      type="color"
                      className="color-picker-input"
                      value={design.fg2 || design.fg || "#111827"}
                      onChange={(e) => patchDesign({ fg2: e.target.value })}
                    />
                    {design.fg2 && (
                      <button
                        type="button"
                        className="mini-clear-btn"
                        onClick={() => patchDesign({ fg2: "" })}
                        title="Remove gradient"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </label>
                <label className="edit-field-label">
                  Background Color
                  <input
                    type="color"
                    className="color-picker-input"
                    value={design.bg || "#ffffff"}
                    onChange={(e) => patchDesign({ bg: e.target.value })}
                  />
                </label>
              </div>

              <div className="options-grid three">
                <label className="edit-field-label">
                  Pattern / Dots
                  <select
                    className="dash-input"
                    value={design.shape || "square"}
                    onChange={(e) => patchDesign({ shape: e.target.value })}
                  >
                    {SHAPES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="edit-field-label">
                  Corner Eye Style
                  <select
                    className="dash-input"
                    value={design.eye || "square"}
                    onChange={(e) => patchDesign({ eye: e.target.value })}
                  >
                    {EYES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="edit-field-label">
                  Eye Color (Optional)
                  <div className="inline-pick-wrap">
                    <input
                      type="color"
                      className="color-picker-input"
                      value={design.eyeColor || design.fg || "#111827"}
                      onChange={(e) => patchDesign({ eyeColor: e.target.value })}
                    />
                    {design.eyeColor && (
                      <button
                        type="button"
                        className="mini-clear-btn"
                        onClick={() => patchDesign({ eyeColor: "" })}
                        title="Reset eye color"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </label>
              </div>

              {/* Frame Customizer */}
              <div className="options-grid">
                <label className="edit-field-label">
                  Call-to-Action Frame
                  <select
                    className="dash-input"
                    value={design.frameStyle || "none"}
                    onChange={(e) => patchDesign({ frameStyle: e.target.value })}
                  >
                    <option value="none">No Frame</option>
                    <option value="text">Text Below</option>
                    <option value="bar">Filled Bar</option>
                  </select>
                </label>
                <label className="edit-field-label">
                  Frame Text
                  <input
                    type="text"
                    className="dash-input"
                    placeholder="Scan me"
                    maxLength={24}
                    disabled={design.frameStyle === "none"}
                    value={design.frameText || ""}
                    onChange={(e) => patchDesign({ frameText: e.target.value })}
                  />
                </label>
              </div>

              {/* Logo Upload & Scale */}
              <div className="logo-customizer-box">
                <label className="edit-field-label">
                  Center Logo Image (Optional)
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="dash-input"
                    accept="image/*"
                    onChange={handleLogoUpload}
                  />
                </label>
                {design.logo && (
                  <div className="logo-preview-row">
                    <img src={design.logo} alt="Logo" className="logo-thumb" width="40" height="40" />
                    <div className="logo-scale-wrap">
                      <span className="scale-label">Scale: {Math.round((design.logoScale || 0.22) * 100)}%</span>
                      <input
                        type="range"
                        min="12"
                        max="30"
                        value={Math.round((design.logoScale || 0.22) * 100)}
                        onChange={(e) => patchDesign({ logoScale: Number(e.target.value) / 100 })}
                      />
                    </div>
                    <button
                      type="button"
                      className="mini-remove-btn"
                      onClick={() => patchDesign({ logo: null })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: ADVANCED CONTROLS (Dynamic only) */}
          {!isStatic && activeTab === "advanced" && (
            <div className="edit-tab-pane">
              {/* Active / Paused Switch */}
              <div className="advanced-toggle-box">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <div>
                    <div className="switch-title">Active Link Status</div>
                    <div className="switch-desc">
                      {active
                        ? "QR is active and resolving scans to the destination."
                        : "QR is temporarily paused. Scanners will see a friendly pause notice."}
                    </div>
                  </div>
                </label>
              </div>

              {/* Expiry & Scan Limit */}
              <div className="row2" style={{ marginTop: "14px" }}>
                <label className="edit-field-label">
                  Campaign Expiration Date
                  <input
                    type="date"
                    className="dash-input"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
                <label className="edit-field-label">
                  Max Scan Limit
                  <input
                    type="number"
                    className="dash-input"
                    min="1"
                    placeholder="e.g. 500"
                    value={maxScans}
                    onChange={(e) => setMaxScans(e.target.value)}
                  />
                </label>
              </div>

              {/* Password Gate */}
              <div className="password-gate-box" style={{ marginTop: "14px" }}>
                <label className="edit-field-label">
                  {link.password?.hash
                    ? "Password Protection is ON — enter a new password to change:"
                    : "Password Protect QR (Optional):"}
                  {!canPw && <Link to="/pricing" className="lock-badge">Pro</Link>}
                  <input
                    type="text"
                    autoComplete="off"
                    className="dash-input"
                    placeholder={canPw ? "min 4 characters" : "Upgrade to Pro to password-protect"}
                    value={newPw}
                    disabled={removePw || !canPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                </label>

                {link.password?.hash && (
                  <label className="check" style={{ marginTop: "8px" }}>
                    <input
                      type="checkbox"
                      checked={removePw}
                      onChange={(e) => setRemovePw(e.target.checked)}
                    />
                    Remove password protection entirely
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Feedback & Actions */}
          {error && <div className="alert error" style={{ marginTop: "16px" }}>{error}</div>}
          {success && <div className="alert success" style={{ marginTop: "16px" }}>{success}</div>}

          <div className="edit-modal-footer">
            <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? (progress > 0 && progress < 100 ? `Uploading ${progress}%…` : "Saving Changes…")
                : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Right Column: Live Interactive Preview */}
        <div className="edit-preview-col">
          <div className="preview-sticky-card">
            <div className="preview-card-title">Live QR Preview</div>
            <div className="preview-stage-wrap">
              <QrPreview value={qrDisplayValue || dynamicUrl || "https://typqr.com"} design={design} size={220} />
            </div>

            <div className="preview-meta-info">
              <div className="meta-row">
                <span className="meta-lbl">Type:</span>
                <span className="meta-val">{isStatic ? "Static Direct" : "Dynamic Redirect"}</span>
              </div>
              <div className="meta-row">
                <span className="meta-lbl">Target:</span>
                <span className="meta-val truncate" title={isStatic ? link.payload : destination || dynamicUrl}>
                  {isStatic ? link.payload : destination || dynamicUrl}
                </span>
              </div>
            </div>

            {/* Direct Downloads */}
            <div className="preview-downloads">
              <button
                type="button"
                className="download-pill-btn"
                onClick={() => handleDownload("1024")}
              >
                <IconDownload size={13} /> PNG 1024
              </button>
              <button
                type="button"
                className="download-pill-btn"
                onClick={() => handleDownload("2048")}
              >
                <IconDownload size={13} /> PNG 2048
              </button>
              <button
                type="button"
                className="download-pill-btn outline"
                onClick={() => handleDownload("svg")}
              >
                <IconDownload size={13} /> SVG
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
