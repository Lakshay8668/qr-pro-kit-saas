// src/components/QrPreview.jsx
// Renders the QR from the shared SVG builder (same output as the downloads).

import { useMemo } from "react";
import { buildQrSvg, svgToDataUrl, svgSize } from "../lib/qrRender";

export default function QrPreview({ value, design, size = 300, className = "", alt = "QR code" }) {
  const key = JSON.stringify(design || {});
  const { url, w, h, error } = useMemo(() => {
    try {
      const svg = buildQrSvg(value, design, { size });
      const { width, height } = svgSize(svg);
      return { url: svgToDataUrl(svg), w: width, h: height };
    } catch (e) {
      return { error: e?.message || "Could not draw this QR." };
    }
  }, [value, key, size]);

  if (error) {
    return <div className="alert error">This content is too long for a QR code. Shorten it or use an editable link.</div>;
  }
  return <img className={className} src={url} width={w} height={h} alt={alt} style={{ maxWidth: "100%", height: "auto" }} />;
}
