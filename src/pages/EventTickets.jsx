// src/pages/EventTickets.jsx — Dedicated Event Ticket Management Page
// Route: /events/:eventId/tickets
// Provides complete attendee list, single ticket issuance, CSV bulk import with preview,
// duplicate detection, capacity checking, badge printing, ZIP export, and check-in scanner integration.

import React, { useState, useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Modal from "../components/Modal";
import { useAuth } from "../lib/useAuth";
import {
  getEvent,
  createTicket,
  importGuests,
  revokeTicket,
  regenerateTicket,
} from "../lib/events";
import {
  DEFAULT_DESIGN,
  buildQrSvg,
  svgToPngBlob,
  downloadBlob,
} from "../lib/qrRender";
import {
  IconCalendar,
  IconTicket,
  IconPlus,
  IconTrash,
  IconEdit,
  IconCopy,
  IconCheck,
  IconDownload,
  IconUpload,
  IconPrinter,
  IconCamera,
  IconUsers,
  IconClose,
} from "../components/Icons";

const TICKET_TYPES = ["General Admission", "VIP", "Staff", "Speaker", "Exhibitor", "Custom"];

export default function EventTickets() {
  const { eventId: paramEventId, id: paramId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const eventId = paramEventId || paramId || searchParams.get("eventId") || searchParams.get("id");

  const [eventData, setEventData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modals
  const [showSingleTicketModal, setShowSingleTicketModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [ticketToView, setTicketToView] = useState(null);

  // Invitation copy feedback & ZIP packing state
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [zipping, setZipping] = useState(false);

  // Single Ticket Form
  const [singleTicketForm, setSingleTicketForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    ticketType: "General Admission",
    company: "",
    customReference: "",
  });

  // Bulk CSV Import State
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [parsedGuests, setParsedGuests] = useState([]);
  const [bulkValidationErrors, setBulkValidationErrors] = useState([]);
  const [importing, setImporting] = useState(false);

  // Fetch Event Details & Tickets
  const refreshEventData = async () => {
    if (!eventId) {
      setError("No event ID provided in the URL.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await getEvent(eventId);
      if (res && res.ok && res.event) {
        setEventData(res.event);
        setTickets(res.tickets || []);
      } else {
        setError(res?.message || "Event not found or access denied.");
      }
    } catch (err) {
      setError(err?.message || "Failed to load event tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshEventData();
  }, [eventId, user]);

  // Handle Single Ticket Creation
  const handleCreateSingleTicket = async (e) => {
    e.preventDefault();
    if (!singleTicketForm.guestName.trim()) return alert("Guest name is required.");
    try {
      await createTicket(eventData.id, singleTicketForm);
      setShowSingleTicketModal(false);
      setSingleTicketForm({
        guestName: "",
        guestEmail: "",
        guestPhone: "",
        ticketType: "General Admission",
        company: "",
        customReference: "",
      });
      await refreshEventData();
    } catch (err) {
      alert(`Could not create ticket: ${err?.message || ""}`);
    }
  };

  // CSV Parsing for Bulk Import
  const handleCsvFileUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      setBulkCsvText(text);
      parseCsvData(text);
    };
    reader.readAsText(file);
  };

  const parseCsvData = (text) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setParsedGuests([]);
      setBulkValidationErrors([]);
      return;
    }

    const firstLine = lines[0].toLowerCase();
    const isHeader =
      firstLine.includes("name") || firstLine.includes("email") || firstLine.includes("ticket");
    const dataLines = isHeader ? lines.slice(1) : lines;

    const parsed = [];
    const errors = [];
    const existingEmails = new Set(
      tickets.map((t) => (t.guestEmail || "").toLowerCase().trim()).filter(Boolean)
    );
    const seenEmailsInFile = new Set();

    dataLines.forEach((line, index) => {
      const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
      const guestName = cols[0] || "";
      const guestEmail = cols[1] || "";
      const guestPhone = cols[2] || "";
      const ticketType = cols[3] || "General Admission";
      const company = cols[4] || "";
      const customReference = cols[5] || "";

      if (!guestName) {
        errors.push(`Row ${index + (isHeader ? 2 : 1)}: Missing guest name.`);
        return;
      }

      const emailLower = guestEmail.toLowerCase();
      let isDuplicate = false;
      if (emailLower) {
        if (existingEmails.has(emailLower) || seenEmailsInFile.has(emailLower)) {
          isDuplicate = true;
        }
        seenEmailsInFile.add(emailLower);
      }

      parsed.push({
        guestName,
        guestEmail,
        guestPhone,
        ticketType,
        company,
        customReference,
        isDuplicate,
      });
    });

    setParsedGuests(parsed);
    setBulkValidationErrors(errors);
  };

  const handleExecuteBulkImport = async () => {
    if (parsedGuests.length === 0) return alert("No valid guests found to import.");
    setImporting(true);
    try {
      const res = await importGuests(eventData.id, parsedGuests);
      alert(`Import completed! Created: ${res.importedCount || res.createdCount || 0}, Skipped duplicates: ${res.duplicateCount || res.duplicatesSkipped || 0}`);
      setShowBulkImportModal(false);
      setBulkCsvText("");
      setParsedGuests([]);
      await refreshEventData();
    } catch (err) {
      alert(`Import failed: ${err?.message || ""}`);
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadSampleCsv = () => {
    const sample =
      "guest_name,guest_email,guest_phone,ticket_type,company,custom_reference\n" +
      "Alice Walker,alice@example.com,+15551234567,VIP,Acme Global,REF-001\n" +
      "Bob Smith,bob@example.com,+15559876543,General Admission,Innovate LLC,REF-002\n" +
      "Charlie Davis,charlie@example.com,+15553334444,Speaker,Tech Conf,REF-003\n";
    downloadBlob(new Blob([sample], { type: "text/csv;charset=utf-8" }), "sample-event-guests.csv");
  };

  // Revoke / Regenerate Ticket Actions
  const handleRevokeTicket = async (ticketId) => {
    if (!window.confirm("Are you sure you want to revoke this ticket? The guest will no longer be allowed entry.")) {
      return;
    }
    try {
      await revokeTicket(ticketId);
      await refreshEventData();
    } catch (err) {
      alert(`Failed to revoke ticket: ${err?.message || ""}`);
    }
  };

  const handleRegenerateTicket = async (ticketId) => {
    if (!window.confirm("Regenerating the token will invalidate any previously sent or printed QR code. Continue?")) {
      return;
    }
    try {
      await regenerateTicket(ticketId);
      await refreshEventData();
    } catch (err) {
      alert(`Failed to regenerate ticket: ${err?.message || ""}`);
    }
  };

  // Export Tickets CSV
  const handleExportTicketsCsv = () => {
    if (tickets.length === 0) return alert("No tickets to export.");
    const header = "id,guest_name,guest_email,guest_phone,ticket_type,company,status,check_in_time,checked_in_by,token\n";
    const rows = tickets.map((t) =>
      [
        t.id,
        `"${(t.guestName || "").replace(/"/g, '""')}"`,
        `"${(t.guestEmail || "").replace(/"/g, '""')}"`,
        `"${(t.guestPhone || "").replace(/"/g, '""')}"`,
        `"${(t.ticketType || "").replace(/"/g, '""')}"`,
        `"${(t.company || "").replace(/"/g, '""')}"`,
        t.status,
        t.checkInTime || "",
        `"${(t.checkedInBy || "").replace(/"/g, '""')}"`,
        t.ticketToken,
      ].join(",")
    );
    const content = header + rows.join("\n");
    downloadBlob(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
      `event-${eventData.id}-tickets.csv`
    );
  };

  // Bulk ZIP Download of all QR Badges
  const handleDownloadAllZip = async () => {
    if (tickets.length === 0) return alert("No tickets to export.");
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      for (const t of tickets) {
        const verifyUrl = `${window.location.origin}/checkin?token=${encodeURIComponent(t.ticketToken)}&eventId=${encodeURIComponent(eventData.id)}`;
        const svg = buildQrSvg(verifyUrl, {
          ...DEFAULT_DESIGN,
          frameStyle: "bar",
          frameText: `${t.ticketType || "TICKET"} - ${t.guestName.slice(0, 18)}`,
        });
        const blob = await svgToPngBlob(svg);
        const filename = `ticket-${(t.guestName || "guest").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${t.id.slice(-6)}.png`;
        zip.file(filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${(eventData.name || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-all-tickets.zip`);
    } catch (err) {
      alert(`Failed to create ZIP: ${err?.message || ""}`);
    } finally {
      setZipping(false);
    }
  };

  // Invitation Message Copy
  const getInvitationText = () => {
    if (!eventData) return "";
    return (
      `🎟️ You're Invited to ${eventData.name}!\n\n` +
      `📅 Date: ${eventData.eventDate || "TBA"}\n` +
      `⏰ Time: ${eventData.startTime || "TBA"} - ${eventData.endTime || "TBA"}\n` +
      `📍 Venue: ${eventData.venueName || "TBA"}${eventData.venueAddress ? ` (${eventData.venueAddress})` : ""}\n` +
      `👤 Organiser: ${eventData.organiserName || "TypQR Events"}\n\n` +
      `Please ensure you present your unique QR ticket upon arrival at the entrance.`
    );
  };

  const handleCopyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(getInvitationText());
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <AppShell currentTab="events" title="Event Ticket Management">
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem" }}>
        {/* Loading State */}
        {loading && (
          <div style={{ textAlign: "center", padding: "4rem 2rem", background: "#ffffff", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 600, color: "#111827", marginBottom: "0.5rem" }}>
              Loading Event Tickets...
            </div>
            <p style={{ color: "#6b7280", margin: 0, fontSize: "0.9rem" }}>
              Fetching attendees and ticket verification codes from database.
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div style={{ padding: "2rem", background: "#ffffff", borderRadius: "12px", border: "1px solid #fecaca", textAlign: "center" }}>
            <div style={{ color: "#dc2626", fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              Unable to load tickets
            </div>
            <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "1.25rem" }}>{error}</p>
            <Link
              to="/events"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                background: "#2563eb",
                color: "#ffffff",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              ← Back to Event Management
            </Link>
          </div>
        )}

        {/* Loaded Event Tickets Content */}
        {!loading && !error && eventData && (
          <div>
            {/* Top Bar Navigation */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Link
                  to="/events"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    padding: "0.45rem 0.85rem",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#374151",
                    textDecoration: "none",
                  }}
                >
                  ← All Events
                </Link>
                <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "#111827" }}>
                  {eventData.name}
                </h1>
                <span
                  style={{
                    padding: "0.2rem 0.6rem",
                    borderRadius: "9999px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    background:
                      eventData.status === "Published"
                        ? "#dcfce7"
                        : eventData.status === "Draft"
                        ? "#fef9c3"
                        : eventData.status === "Cancelled"
                        ? "#fee2e2"
                        : "#e0e7ff",
                    color:
                      eventData.status === "Published"
                        ? "#15803d"
                        : eventData.status === "Draft"
                        ? "#854d0e"
                        : eventData.status === "Cancelled"
                        ? "#b91c1c"
                        : "#4338ca",
                  }}
                >
                  {eventData.status}
                </span>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Link
                  to={`/events/${eventData.id}/checkin`}
                  target="_blank"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.5rem 0.9rem",
                    background: "#059669",
                    color: "#ffffff",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <IconCamera size={16} />
                  Open Live Scanner
                </Link>
              </div>
            </div>

            {/* Event Quick Meta & Progress Header */}
            <div
              style={{
                background: "#ffffff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                padding: "1.25rem",
                marginBottom: "1.5rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Date & Time</div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                  {eventData.eventDate} ({eventData.startTime || "09:00"} - {eventData.endTime || "17:00"})
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Venue</div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                  {eventData.venueName || "Online / TBD"}
                </div>
                {eventData.venueAddress && <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{eventData.venueAddress}</div>}
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Capacity</div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                  {tickets.length} / {eventData.capacity || 100} guests
                </div>
                <div style={{ width: "100%", height: "6px", background: "#f3f4f6", borderRadius: "9999px", marginTop: "0.4rem", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.round((tickets.length / (eventData.capacity || 100)) * 100))}%`,
                      background: tickets.length >= eventData.capacity ? "#ef4444" : "#3b82f6",
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Attendance</div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                  {tickets.filter((t) => t.status === "CheckedIn").length} checked in ({tickets.length > 0 ? Math.round((tickets.filter((t) => t.status === "CheckedIn").length / tickets.length) * 100) : 0}%)
                </div>
              </div>
            </div>

            {/* Invitation Message Card */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "1rem 1.25rem",
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#1e293b", marginBottom: "0.2rem" }}>
                  Guest Invitation Message
                </div>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>
                  Copy ready-to-send invitation text with event details and ticket instructions.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyInvitation}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.45rem 0.8rem",
                  background: copiedInvite ? "#059669" : "#ffffff",
                  color: copiedInvite ? "#ffffff" : "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copiedInvite ? <IconCheck size={15} /> : <IconCopy size={15} />}
                {copiedInvite ? "Copied" : "Copy Invitation"}
              </button>
            </div>

            {/* Ticket Management Toolbar */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 600, color: "#111827", margin: 0 }}>
                Issued Tickets & Guest List ({tickets.length})
              </h2>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setShowSingleTicketModal(true)}
                  disabled={tickets.length >= eventData.capacity}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.8rem",
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    cursor: tickets.length >= eventData.capacity ? "not-allowed" : "pointer",
                    opacity: tickets.length >= eventData.capacity ? 0.6 : 1,
                  }}
                >
                  <IconPlus size={16} />
                  Add Single Guest
                </button>

                <button
                  type="button"
                  onClick={() => setShowBulkImportModal(true)}
                  disabled={tickets.length >= eventData.capacity}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.8rem",
                    background: "#4f46e5",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    cursor: tickets.length >= eventData.capacity ? "not-allowed" : "pointer",
                    opacity: tickets.length >= eventData.capacity ? 0.6 : 1,
                  }}
                >
                  <IconUpload size={16} />
                  Bulk CSV Import
                </button>

                <button
                  type="button"
                  onClick={handleExportTicketsCsv}
                  disabled={tickets.length === 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.75rem",
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  <IconDownload size={15} />
                  Export CSV
                </button>

                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  disabled={tickets.length === 0 || zipping}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.75rem",
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    cursor: zipping ? "wait" : "pointer",
                  }}
                >
                  <IconTicket size={15} />
                  {zipping ? "Packaging ZIP..." : "Download All Badges (ZIP)"}
                </button>
              </div>
            </div>

            {/* Tickets Table */}
            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e5e7eb", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#4b5563" }}>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Guest Name</th>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Contact</th>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Ticket Category</th>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Check-in Log</th>
                    <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
                        No tickets issued yet. Click "Add Single Guest" or "Bulk CSV Import" to register attendees.
                      </td>
                    </tr>
                  ) : (
                    tickets.map((t) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600, color: "#111827" }}>{t.guestName}</div>
                          {t.company && <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{t.company}</div>}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", color: "#4b5563" }}>
                          <div>{t.guestEmail || "—"}</div>
                          {t.guestPhone && <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{t.guestPhone}</div>}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span
                            style={{
                              padding: "0.2rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              background: t.ticketType === "VIP" ? "#fef3c7" : "#f3f4f6",
                              color: t.ticketType === "VIP" ? "#92400e" : "#374151",
                            }}
                          >
                            {t.ticketType || "General"}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span
                            style={{
                              padding: "0.2rem 0.5rem",
                              borderRadius: "9999px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              background:
                                t.status === "CheckedIn"
                                  ? "#dcfce7"
                                  : t.status === "Revoked"
                                  ? "#fee2e2"
                                  : "#eff6ff",
                              color:
                                t.status === "CheckedIn"
                                  ? "#15803d"
                                  : t.status === "Revoked"
                                  ? "#b91c1c"
                                  : "#1d4ed8",
                            }}
                          >
                            {t.status === "CheckedIn" ? "✓ Checked In" : t.status === "Revoked" ? "Revoked" : "Valid"}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.78rem", color: "#6b7280" }}>
                          {t.status === "CheckedIn" ? (
                            <div>
                              <div>{t.checkInTime ? new Date(t.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                              <div>By {t.checkedInBy || "Scanner"}</div>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                            <button
                              type="button"
                              title="View / Print Badge"
                              onClick={() => setTicketToView(t)}
                              style={{
                                padding: "0.3rem 0.5rem",
                                background: "#f3f4f6",
                                border: "1px solid #e5e7eb",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                            >
                              <IconPrinter size={14} />
                            </button>
                            {t.status !== "Revoked" && (
                              <button
                                type="button"
                                title="Regenerate Token"
                                onClick={() => handleRegenerateTicket(t.id)}
                                style={{
                                  padding: "0.3rem 0.5rem",
                                  background: "#f3f4f6",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                ↺
                              </button>
                            )}
                            {t.status !== "Revoked" ? (
                              <button
                                type="button"
                                title="Revoke Ticket"
                                onClick={() => handleRevokeTicket(t.id)}
                                style={{
                                  padding: "0.3rem 0.5rem",
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  border: "1px solid #fecaca",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- MODAL: SINGLE TICKET */}
        {showSingleTicketModal && eventData && (
          <Modal onClose={() => setShowSingleTicketModal(false)} title="Issue Ticket to Guest">
            <form onSubmit={handleCreateSingleTicket}>
              <div style={{ marginBottom: "0.85rem" }}>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Guest Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={singleTicketForm.guestName}
                  onChange={(e) => setSingleTicketForm({ ...singleTicketForm, guestName: e.target.value })}
                  placeholder="Jane Doe"
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.85rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={singleTicketForm.guestEmail}
                    onChange={(e) => setSingleTicketForm({ ...singleTicketForm, guestEmail: e.target.value })}
                    placeholder="jane@example.com"
                    style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={singleTicketForm.guestPhone}
                    onChange={(e) => setSingleTicketForm({ ...singleTicketForm, guestPhone: e.target.value })}
                    placeholder="+1 555 123 4567"
                    style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.85rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                    Ticket Category
                  </label>
                  <select
                    value={singleTicketForm.ticketType}
                    onChange={(e) => setSingleTicketForm({ ...singleTicketForm, ticketType: e.target.value })}
                    style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                  >
                    {TICKET_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                    Company / Organization
                  </label>
                  <input
                    type="text"
                    value={singleTicketForm.company}
                    onChange={(e) => setSingleTicketForm({ ...singleTicketForm, company: e.target.value })}
                    placeholder="Acme Corp"
                    style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
                <button
                  type="button"
                  onClick={() => setShowSingleTicketModal(false)}
                  style={{ padding: "0.55rem 1rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: "0.55rem 1.25rem", background: "#2563eb", color: "#ffffff", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
                >
                  Issue Ticket
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* ------------------------------------------------------------- MODAL: BULK CSV IMPORT */}
        {showBulkImportModal && eventData && (
          <Modal onClose={() => setShowBulkImportModal(false)} title="Bulk Guest CSV Import">
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.85rem", color: "#4b5563" }}>
                Upload a CSV file containing guest names and details. TypQR will automatically detect duplicates, enforce capacity limits, and generate cryptographic QR tokens for each guest.
              </p>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.65rem",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ↓ Download Sample CSV Template
              </button>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleCsvFileUpload(e.target.files[0])}
                style={{ fontSize: "0.85rem" }}
              />
            </div>

            {bulkValidationErrors.length > 0 && (
              <div style={{ padding: "0.6rem 0.8rem", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: "6px", color: "#b91c1c", fontSize: "0.8rem", marginBottom: "1rem" }}>
                <strong>Validation Notices:</strong>
                <ul style={{ margin: "0.3rem 0 0 1rem", padding: 0 }}>
                  {bulkValidationErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsedGuests.length > 0 && (
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.4rem" }}>
                  Preview Parsed Guests ({parsedGuests.length}):
                </div>
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "6px" }}>
                  <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                    <thead style={{ background: "#f9fafb", position: "sticky", top: 0 }}>
                      <tr>
                        <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Name</th>
                        <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Email</th>
                        <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Type</th>
                        <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Duplicate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedGuests.map((g, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "0.4rem 0.6rem" }}>{g.guestName}</td>
                          <td style={{ padding: "0.4rem 0.6rem" }}>{g.guestEmail || "—"}</td>
                          <td style={{ padding: "0.4rem 0.6rem" }}>{g.ticketType}</td>
                          <td style={{ padding: "0.4rem 0.6rem", color: g.isDuplicate ? "#dc2626" : "#16a34a" }}>
                            {g.isDuplicate ? "Yes (will skip)" : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button
                type="button"
                onClick={() => setShowBulkImportModal(false)}
                style={{ padding: "0.55rem 1rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={parsedGuests.length === 0 || importing}
                onClick={handleExecuteBulkImport}
                style={{
                  padding: "0.55rem 1.25rem",
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: parsedGuests.length === 0 || importing ? "not-allowed" : "pointer",
                }}
              >
                {importing ? "Importing Guests..." : `Import ${parsedGuests.length} Guests`}
              </button>
            </div>
          </Modal>
        )}

        {/* ------------------------------------------------------------- MODAL: VIEW & PRINT TICKET BADGE */}
        {ticketToView && eventData && (
          <Modal onClose={() => setTicketToView(null)} title="Ticket Pass & Verification Badge">
            <div
              id="printable-ticket-badge"
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "2px solid #e5e7eb",
                borderRadius: "12px",
                textAlign: "center",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", fontWeight: 700 }}>
                Official Event Pass
              </div>
              <h2 style={{ margin: "0.25rem 0", fontSize: "1.35rem", fontWeight: 700, color: "#111827" }}>
                {eventData.name}
              </h2>
              <div style={{ fontSize: "0.85rem", color: "#4b5563", marginBottom: "1rem" }}>
                {eventData.eventDate} · {eventData.venueName || "Venue TBD"}
              </div>

              <div style={{ display: "flex", justifyContent: "center", margin: "1rem 0" }}>
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(
                    buildQrSvg(
                      `${window.location.origin}/checkin?token=${encodeURIComponent(ticketToView.ticketToken)}&eventId=${encodeURIComponent(eventData.id)}`,
                      { ...DEFAULT_DESIGN, frameStyle: "bar", frameText: ticketToView.ticketType || "TICKET" },
                      { size: 260 }
                    )
                  )}`}
                  alt="Ticket QR"
                  style={{ width: "220px", height: "220px", display: "block" }}
                />
              </div>

              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#111827" }}>
                {ticketToView.guestName}
              </div>
              {ticketToView.company && (
                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{ticketToView.company}</div>
              )}
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ padding: "0.25rem 0.6rem", background: "#fef3c7", color: "#92400e", borderRadius: "9999px", fontSize: "0.8rem", fontWeight: 600 }}>
                  {ticketToView.ticketType || "General Admission"}
                </span>
              </div>
              <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#9ca3af", fontFamily: "monospace" }}>
                TOKEN: {ticketToView.ticketToken.slice(0, 16)}...
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => {
                  const svg = buildQrSvg(
                    `${window.location.origin}/checkin?token=${encodeURIComponent(ticketToView.ticketToken)}&eventId=${encodeURIComponent(eventData.id)}`,
                    { ...DEFAULT_DESIGN, frameStyle: "bar", frameText: ticketToView.ticketType || "TICKET" },
                    { size: 1024 }
                  );
                  svgToPngBlob(svg).then((blob) => {
                    downloadBlob(blob, `ticket-${ticketToView.guestName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
                  });
                }}
                style={{
                  padding: "0.55rem 0.9rem",
                  background: "#f3f4f6",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <IconDownload size={15} />
                Save PNG
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                style={{
                  padding: "0.55rem 1.1rem",
                  background: "#111827",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <IconPrinter size={15} />
                Print Pass
              </button>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
