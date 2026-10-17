// src/components/QrPreview.jsx
// Professional vector QR preview renderer using direct native SVG markup.
// Avoids data-URL truncation, browser SVG image sandboxing, and flickering.

import React, { useMemo } from "react";
import { buildQrSvg, svgSize } from "../lib/qrRender";

export default function QrPreview({
  value,
  design,
  size = 300,
  className = "",
  alt = "QR code",
  loading = false,
  liveBadge = false,
}) {
  const designKey = JSON.stringify(design || {});
  const trimmedValue = value ? String(value).trim() : "";

  const { svg, w, h, error } = useMemo(() => {
    if (!trimmedValue) {
      return { svg: null, w: size, h: size, error: null };
    }
    try {
      const generatedSvg = buildQrSvg(trimmedValue, design || {}, { size });
      const { width, height } = svgSize(generatedSvg);
      return { svg: generatedSvg, w: width, h: height, error: null };
    } catch (e) {
      const msg = e?.message || "Could not generate QR code.";
      return { svg: null, w: size, h: size, error: msg };
    }
  }, [trimmedValue, designKey, size]);

  if (loading) {
    return (
      <div
        className={`qr-preview-loading ${className}`}
        style={{
          width: size,
          maxWidth: "100%",
          height: size,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          borderRadius: 16,
          border: "1px dashed #cbd5e1",
          color: "#64748b",
          margin: "0 auto",
        }}
      >
        <div className="dash-loading-spinner" style={{ width: 32, height: 32, marginBottom: 12 }} />
        <span style={{ fontSize: "13px", fontWeight: 600 }}>Generating QR code…</span>
      </div>
    );
  }

  if (error) {
    const isTooLong = /too big|amount of data|too long|overflow/i.test(error);
    return (
      <div
        className="alert error"
        style={{
          maxWidth: size,
          margin: "0 auto",
          padding: "16px",
          borderRadius: "12px",
          textAlign: "center",
          fontSize: "13px",
          lineHeight: 1.5,
        }}
      >
        <strong>⚠️ QR Generation Notice</strong>
        <p style={{ margin: "6px 0 0" }}>
          {isTooLong
            ? "This content exceeds standard QR matrix capacity. Please shorten the payload or switch to an editable (dynamic) QR code."
            : error}
        </p>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className={`qr-preview-empty ${className}`}
        style={{
          width: size,
          maxWidth: "100%",
          minHeight: Math.min(size, 260),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          borderRadius: 16,
          border: "1px dashed #cbd5e1",
          padding: "24px 16px",
          textAlign: "center",
          margin: "0 auto",
        }}
      >
        <div style={{ fontSize: "36px", marginBottom: "8px", opacity: 0.6 }}>📱</div>
        <div style={{ fontWeight: 700, fontSize: "14px", color: "#334155" }}>QR Code Preview</div>
        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px", maxWidth: "220px", lineHeight: 1.4 }}>
          Enter a destination or content on the left to see your live QR code.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`qr-preview-container ${className}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        maxWidth: "100%",
        position: "relative",
      }}
    >
      <div
        className="qr-svg-wrapper"
        role="img"
        aria-label={alt}
        data-rendered-value={trimmedValue}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          maxWidth: size,
          lineHeight: 0,
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {liveBadge && (
        <span
          style={{
            marginTop: "8px",
            fontSize: "11px",
            fontWeight: 600,
            color: "#6366f1",
            background: "#eef2ff",
            padding: "2px 8px",
            borderRadius: "999px",
            border: "1px solid #c7d2fe",
          }}
        >
          Live Preview
        </span>
      )}
    </div>
  );
}
