// src/pages/DraftQrPage.jsx
// Intentional destination page for unassigned/draft batch QR codes.
// Clearly explains draft status and guides the owner to assign destination in Dashboard.

import React from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar";

export default function DraftQrPage() {
  return (
    <div className="draft-page-layout" style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "var(--font-sans)" }}>
      <Topbar />

      <main style={{ maxWidth: 640, margin: "60px auto 80px", padding: "0 24px" }}>
        <div
          style={{
            background: "#ffffff",
            borderRadius: 20,
            border: "1px solid #e2e8f0",
            padding: "40px 32px",
            textAlign: "center",
            boxShadow: "0 10px 30px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ marginBottom: "20px" }}>
            <img
              src="/typqr-logo.png"
              alt="TypQR — Scan. Connect. Grow."
              style={{ height: "46px", width: "auto", margin: "0 auto", display: "block", objectFit: "contain" }}
            />
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#eff6ff",
              color: "#3b82f6",
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: "12px",
              fontWeight: 600,
              marginBottom: "16px",
              border: "1px solid #bfdbfe",
            }}
          >
            <span>⚡ Dynamic QR Status</span>
            <span>·</span>
            <span>Draft Mode</span>
          </div>

          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: "0 0 12px" }}>
            Draft QR Code
          </h1>

          <p style={{ fontSize: "15px", color: "#64748b", lineHeight: 1.6, margin: "0 0 28px" }}>
            This QR code was generated in a batch and is currently in <b>Draft Status</b>.
            It has not yet been linked to a live destination URL.
          </p>

          <div
            style={{
              background: "#f1f5f9",
              borderRadius: 12,
              padding: "18px 20px",
              marginBottom: "32px",
              textAlign: "left",
              border: "1px solid #cbd5e1",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b", marginBottom: "6px" }}>
              💡 Are you the owner of this QR code?
            </div>
            <p style={{ fontSize: "13px", color: "#475569", margin: 0, lineHeight: 1.5 }}>
              You can instantly set or change the destination URL anytime from your dashboard.
              Your printed QR code will immediately start redirecting visitors without needing to be reprinted.
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              to="/dashboard?tab=links"
              className="primary-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "12px 24px",
                borderRadius: 10,
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              Open My Dashboard →
            </Link>
            <Link
              to="/"
              className="secondary-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "12px 20px",
                borderRadius: 10,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "14px",
              }}
            >
              Create New QR
            </Link>
          </div>

          <div style={{ marginTop: "36px", paddingTop: "20px", borderTop: "1px solid #f1f5f9", fontSize: "12px", color: "#94a3b8" }}>
            Need help configuring your QR campaign? Contact{" "}
            <a href="mailto:support@engagiumtechnologies.com" style={{ color: "#6366f1", textDecoration: "none" }}>
              support@engagiumtechnologies.com
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
