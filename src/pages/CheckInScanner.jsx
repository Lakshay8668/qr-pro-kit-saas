// src/pages/CheckInScanner.jsx — Event QR Ticket Check-In Scanner
// Real-time camera scanner using jsQR + manual token check-in with atomic verification.

import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams, useParams, useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { checkInTicket, checkTicket, getEvent } from "../lib/events";
import {
  IconCamera,
  IconCheck,
  IconClose,
  IconTicket,
  IconUserCheck,
} from "../components/Icons";

// Browser audio beep helper
function playBeep(type = "success") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "success") {
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "warning") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // AudioContext not allowed or not supported; ignore
  }
}

export default function CheckInScanner() {
  const { id: routeEventId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const eventId = routeEventId || searchParams.get("eventId") || searchParams.get("id") || "";
  const [eventData, setEventData] = useState(null);
  const [operator, setOperator] = useState(
    localStorage.getItem("typqr_operator_name") || "Gate Scanner"
  );

  const [facingMode, setFacingMode] = useState("environment"); // "environment" | "user"
  const [cameraActive, setCameraActive] = useState(true);
  const [cameraError, setCameraError] = useState("");

  const [manualToken, setManualToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameId = useRef(null);
  const lastScannedToken = useRef("");
  const scanCooldown = useRef(false);

  // Load event info if eventId provided
  useEffect(() => {
    if (!eventId) return;
    getEvent(eventId)
      .then((res) => {
        if (res && res.event) setEventData(res.event);
      })
      .catch(() => {
        // scanner may run without auth; check-in API will validate
      });
  }, [eventId]);

  // Setup Camera Stream
  useEffect(() => {
    if (!cameraActive) {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      return;
    }

    let stream = null;
    let isCancelled = false;

    async function startCamera() {
      setCameraError("");
      try {
        const constraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          requestScanFrame();
        }
      } catch (err) {
        setCameraError("Camera access denied or unavailable: " + (err?.message || ""));
      }
    }

    startCamera();

    return () => {
      isCancelled = true;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks?.() || [];
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [cameraActive, facingMode]);

  // QR Scanning Loop using jsQR
  const requestScanFrame = () => {
    animFrameId.current = requestAnimationFrame(scanTick);
  };

  const scanTick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code && code.data) {
        const raw = code.data.trim();
        // Check if raw data is a full check-in URL or a raw token
        let token = raw;
        try {
          if (raw.includes("token=")) {
            const u = new URL(raw);
            token = u.searchParams.get("token") || token;
          } else if (raw.includes("/checkin/")) {
            token = raw.split("/checkin/").pop().split("?")[0];
          }
        } catch {
          // not a URL, use raw string
        }

        if (token && token !== lastScannedToken.current && !scanCooldown.current) {
          lastScannedToken.current = token;
          scanCooldown.current = true;
          handleProcessCheckIn(token);
          setTimeout(() => {
            scanCooldown.current = false;
          }, 2500);
        }
      }
    }
    if (cameraActive) {
      requestScanFrame();
    }
  };

  // Perform Check-In
  const handleProcessCheckIn = async (token) => {
    if (!token || checking) return;
    setChecking(true);

    try {
      const res = await checkInTicket({
        token,
        eventId: eventId || undefined,
        operator: operator.trim() || "Gate Scanner",
      });

      if (res.ok) {
        playBeep("success");
        const outcome = {
          status: "success",
          code: "valid",
          title: "Check-In Approved",
          message: `Welcome, ${res.ticket.guestName}!`,
          ticket: res.ticket,
          event: res.event,
          timestamp: new Date().toLocaleTimeString(),
        };
        setLastResult(outcome);
        setRecentScans((prev) => [outcome, ...prev.slice(0, 19)]);
      } else {
        // Handled failure from API
        playBeep(res.code === "already_checked_in" ? "warning" : "error");
        const outcome = {
          status: res.code === "already_checked_in" ? "warning" : "error",
          code: res.code || "invalid",
          title:
            res.code === "already_checked_in"
              ? "Already Checked In"
              : res.code === "revoked"
              ? "Ticket Revoked"
              : res.code === "wrong_event"
              ? "Wrong Event"
              : res.code === "event_cancelled"
              ? "Event Cancelled"
              : "Check-In Denied",
          message: res.message || "Invalid ticket token.",
          ticket: res.ticket || null,
          checkInTime: res.checkInTime || null,
          checkedInBy: res.checkedInBy || null,
          timestamp: new Date().toLocaleTimeString(),
        };
        setLastResult(outcome);
        setRecentScans((prev) => [outcome, ...prev.slice(0, 19)]);
      }
    } catch (err) {
      playBeep("error");
      const outcome = {
        status: "error",
        code: err?.body?.code || "error",
        title: "Check-In Failed",
        message: err?.message || "Could not verify ticket.",
        timestamp: new Date().toLocaleTimeString(),
      };
      setLastResult(outcome);
      setRecentScans((prev) => [outcome, ...prev.slice(0, 19)]);
    } finally {
      setChecking(false);
      setManualToken("");
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualToken.trim()) {
      handleProcessCheckIn(manualToken.trim());
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f8fafc", padding: "1rem" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <IconCamera size={22} className="text-blue-400" />
              <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Ticket Scanner</h1>
            </div>
            <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
              {eventData ? eventData.name : "TypQR Check-In Terminal"}
            </p>
          </div>
          <Link
            to={eventId ? `/dashboard?tab=events&eventId=${eventId}` : "/dashboard?tab=events"}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#1e293b",
              color: "#cbd5e1",
              borderRadius: "6px",
              fontSize: "0.8rem",
              textDecoration: "none",
              border: "1px solid #334155",
            }}
          >
            ← Exit
          </Link>
        </div>

        {/* Operator Setting */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
          <label style={{ fontSize: "0.8rem", color: "#94a3b8", whiteSpace: "nowrap" }}>Operator:</label>
          <input
            type="text"
            value={operator}
            onChange={(e) => {
              setOperator(e.target.value);
              localStorage.setItem("typqr_operator_name", e.target.value);
            }}
            placeholder="Gate 1 / Name"
            style={{
              flex: 1,
              padding: "0.35rem 0.6rem",
              borderRadius: "6px",
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#ffffff",
              fontSize: "0.85rem",
            }}
          />
        </div>

        {/* Video Viewport Container */}
        <div
          style={{
            position: "relative",
            width: "100%",
            borderRadius: "12px",
            overflow: "hidden",
            background: "#000000",
            aspectRatio: "4/3",
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            border: "2px solid #334155",
            marginBottom: "1rem",
          }}
        >
          <video
            ref={videoRef}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraActive ? "block" : "none" }}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />

          {/* Target Reticle */}
          {cameraActive && !cameraError && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "220px",
                height: "220px",
                border: "2px solid rgba(59, 130, 246, 0.8)",
                borderRadius: "16px",
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.4)",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "2px",
                  background: "#3b82f6",
                  animation: "scanPulse 2s infinite ease-in-out",
                }}
              />
            </div>
          )}

          {cameraError && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
                textAlign: "center",
                background: "rgba(15, 23, 42, 0.9)",
              }}
            >
              <p style={{ color: "#ef4444", fontSize: "0.9rem", marginBottom: "0.75rem" }}>{cameraError}</p>
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                Switch Camera Mode
              </button>
            </div>
          )}

          {/* Camera controls toolbar */}
          <div
            style={{
              position: "absolute",
              bottom: "10px",
              right: "10px",
              display: "flex",
              gap: "0.5rem",
              zIndex: 10,
            }}
          >
            <button
              type="button"
              onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
              style={{
                padding: "0.4rem 0.75rem",
                background: "rgba(30, 41, 59, 0.85)",
                color: "#f8fafc",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Flip Camera
            </button>
            <button
              type="button"
              onClick={() => setCameraActive(!cameraActive)}
              style={{
                padding: "0.4rem 0.75rem",
                background: "rgba(30, 41, 59, 0.85)",
                color: "#f8fafc",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              {cameraActive ? "Pause" : "Resume"}
            </button>
          </div>
        </div>

        {/* Scan Result Feedback Card */}
        {lastResult && (
          <div
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "10px",
              marginBottom: "1rem",
              background:
                lastResult.status === "success"
                  ? "#064e3b"
                  : lastResult.status === "warning"
                  ? "#78350f"
                  : "#7f1d1d",
              border: `1px solid ${
                lastResult.status === "success"
                  ? "#059669"
                  : lastResult.status === "warning"
                  ? "#d97706"
                  : "#dc2626"
              }`,
              boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "1.05rem" }}>
                {lastResult.status === "success" ? <IconCheck size={20} /> : <IconClose size={20} />}
                <span>{lastResult.title}</span>
              </div>
              <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>{lastResult.timestamp}</span>
            </div>

            <p style={{ margin: "0.25rem 0 0.5rem 0", fontSize: "0.95rem" }}>{lastResult.message}</p>

            {lastResult.ticket && (
              <div
                style={{
                  background: "rgba(0,0,0,0.25)",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  marginTop: "0.5rem",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.35rem",
                }}
              >
                <div><strong>Guest:</strong> {lastResult.ticket.guestName}</div>
                <div><strong>Type:</strong> {lastResult.ticket.ticketType || "General"}</div>
                {lastResult.ticket.company && <div><strong>Company:</strong> {lastResult.ticket.company}</div>}
                {lastResult.checkedInBy && <div><strong>Operator:</strong> {lastResult.checkedInBy}</div>}
              </div>
            )}
          </div>
        )}

        {/* Manual Code Input Form */}
        <form onSubmit={handleManualSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
          <input
            type="text"
            placeholder="Enter ticket token manually..."
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            disabled={checking}
            style={{
              flex: 1,
              padding: "0.6rem 0.8rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#ffffff",
              fontSize: "0.9rem",
            }}
          />
          <button
            type="submit"
            disabled={checking || !manualToken.trim()}
            style={{
              padding: "0.6rem 1.25rem",
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "0.88rem",
              cursor: checking ? "wait" : "pointer",
            }}
          >
            {checking ? "Checking..." : "Verify"}
          </button>
        </form>

        {/* Recent Activity Log */}
        {recentScans.length > 0 && (
          <div>
            <h3 style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8", marginBottom: "0.5rem" }}>
              Recent Check-Ins ({recentScans.length})
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {recentScans.map((scan, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "6px",
                    background: "#1e293b",
                    fontSize: "0.82rem",
                    borderLeft: `4px solid ${
                      scan.status === "success"
                        ? "#10b981"
                        : scan.status === "warning"
                        ? "#f59e0b"
                        : "#ef4444"
                    }`,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>{scan.ticket?.guestName || scan.title}</span>
                    {scan.ticket?.ticketType && (
                      <span style={{ marginLeft: "0.5rem", color: "#94a3b8", fontSize: "0.75rem" }}>
                        ({scan.ticket.ticketType})
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{scan.timestamp}</span>
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background:
                          scan.status === "success"
                            ? "#064e3b"
                            : scan.status === "warning"
                            ? "#78350f"
                            : "#7f1d1d",
                        color: "#fff",
                      }}
                    >
                      {scan.code}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
