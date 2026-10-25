// src/pages/Events.jsx — Enterprise Event Management & QR Ticket Issuance
// Full lifecycle event management, bulk guest imports, cryptographic ticket tokens,
// batch ZIP exports, badge printing, attendance analytics, and live check-in scanner integration.

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Modal from "../components/Modal";
import { useAuth } from "../lib/useAuth";
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
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
  downloadSvgString,
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
  IconShare,
  IconClose,
} from "../components/Icons";

const TICKET_TYPES = ["General Admission", "VIP", "Staff", "Speaker", "Exhibitor", "Custom"];

export default function EventsPage({ embeddedInDashboard = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // List & Stats State
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selected Event Detail View
  const selectedEventId = searchParams.get("eventId") || null;
  const [activeEvent, setActiveEvent] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Modals
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showSingleTicketModal, setShowSingleTicketModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [ticketToView, setTicketToView] = useState(null);

  // Invitation copy feedback
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [zipping, setZipping] = useState(false);

  // Form State for Event Create / Edit
  const [eventForm, setEventForm] = useState({
    name: "",
    venueName: "",
    venueAddress: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    organiserName: "",
    organiserContact: "",
    capacity: 100,
    status: "Published",
  });

  // Form State for Single Ticket
  const [singleTicketForm, setSingleTicketForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    ticketType: "General Admission",
    company: "",
    customReference: "",
  });

  // Bulk Import State
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [parsedGuests, setParsedGuests] = useState([]);
  const [bulkValidationErrors, setBulkValidationErrors] = useState([]);
  const [importing, setImporting] = useState(false);

  // Load events
  const refreshEvents = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await listEvents();
      if (res && res.ok) {
        setEvents(res.events || []);
        setStats(res.stats || null);
      }
    } catch (err) {
      setError(err?.message || "Failed to load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshEvents();
  }, [user]);

  // Load event details if eventId is selected
  useEffect(() => {
    if (!selectedEventId || !user) {
      setActiveEvent(null);
      setTickets([]);
      return;
    }

    setLoadingDetail(true);
    getEvent(selectedEventId)
      .then((res) => {
        if (res && res.ok) {
          setActiveEvent(res.event);
          setTickets(res.tickets || []);
        }
      })
      .catch((err) => {
        alert(`Failed to load event details: ${err?.message || ""}`);
      })
      .finally(() => {
        setLoadingDetail(false);
      });
  }, [selectedEventId, user]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (statusFilter !== "all" && evt.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const n = (evt.name || "").toLowerCase();
        const v = (evt.venueName || "").toLowerCase();
        return n.includes(q) || v.includes(q);
      }
      return true;
    });
  }, [events, statusFilter, searchQuery]);

  // Handle Event Modal Open
  const handleOpenCreateEvent = () => {
    setEditingEvent(null);
    setEventForm({
      name: "",
      venueName: "",
      venueAddress: "",
      eventDate: new Date().toISOString().slice(0, 10),
      startTime: "09:00",
      endTime: "17:00",
      organiserName: user?.displayName || "",
      organiserContact: user?.email || "",
      capacity: 100,
      status: "Published",
    });
    setShowEventModal(true);
  };

  const handleOpenEditEvent = (evt) => {
    setEditingEvent(evt);
    setEventForm({
      name: evt.name || "",
      venueName: evt.venueName || "",
      venueAddress: evt.venueAddress || "",
      eventDate: evt.eventDate || "",
      startTime: evt.startTime || "",
      endTime: evt.endTime || "",
      organiserName: evt.organiserName || "",
      organiserContact: evt.organiserContact || "",
      capacity: evt.capacity || 100,
      status: evt.status || "Published",
    });
    setShowEventModal(true);
  };

  const handleSaveEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.name.trim()) return alert("Please enter an event name.");
    if (!eventForm.eventDate) return alert("Please select an event date.");

    try {
      if (editingEvent) {
        await updateEvent(editingEvent.id, eventForm);
      } else {
        await createEvent(eventForm);
      }
      setShowEventModal(false);
      refreshEvents();
      if (activeEvent && editingEvent && activeEvent.id === editingEvent.id) {
        setActiveEvent({ ...activeEvent, ...eventForm });
      }
    } catch (err) {
      alert(`Could not save event: ${err?.message || ""}`);
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm("Are you sure you want to delete this event and all associated tickets?")) {
      return;
    }
    try {
      await deleteEvent(id);
      if (selectedEventId === id) {
        setSearchParams({});
      }
      refreshEvents();
    } catch (err) {
      alert(`Could not delete event: ${err?.message || ""}`);
    }
  };

  // Single Ticket Creation
  const handleCreateSingleTicket = async (e) => {
    e.preventDefault();
    if (!singleTicketForm.guestName.trim()) return alert("Guest name is required.");
    try {
      await createTicket(activeEvent.id, singleTicketForm);
      setShowSingleTicketModal(false);
      setSingleTicketForm({
        guestName: "",
        guestEmail: "",
        guestPhone: "",
        ticketType: "General Admission",
        company: "",
        customReference: "",
      });
      // refresh details
      const res = await getEvent(activeEvent.id);
      setActiveEvent(res.event);
      setTickets(res.tickets || []);
      refreshEvents();
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
    const existingEmails = new Set(tickets.map((t) => (t.guestEmail || "").toLowerCase()).filter(Boolean));
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
      const res = await importGuests(activeEvent.id, parsedGuests);
      alert(`Import completed! Created: ${res.createdCount}, Skipped duplicates: ${res.duplicatesSkipped}`);
      setShowBulkImportModal(false);
      setBulkCsvText("");
      setParsedGuests([]);
      // Refresh
      const detailRes = await getEvent(activeEvent.id);
      setActiveEvent(detailRes.event);
      setTickets(detailRes.tickets || []);
      refreshEvents();
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
      const res = await getEvent(activeEvent.id);
      setActiveEvent(res.event);
      setTickets(res.tickets || []);
      refreshEvents();
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
      const res = await getEvent(activeEvent.id);
      setActiveEvent(res.event);
      setTickets(res.tickets || []);
      refreshEvents();
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
      `event-${activeEvent.id}-tickets.csv`
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
        const verifyUrl = `${window.location.origin}/checkin?token=${encodeURIComponent(t.ticketToken)}&eventId=${encodeURIComponent(activeEvent.id)}`;
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
      downloadBlob(zipBlob, `${(activeEvent.name || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-all-tickets.zip`);
    } catch (err) {
      alert(`Failed to create ZIP: ${err?.message || ""}`);
    } finally {
      setZipping(false);
    }
  };

  // Copy Invitation Message
  const getInvitationText = () => {
    if (!activeEvent) return "";
    return (
      `🎟️ You're Invited to ${activeEvent.name}!\n\n` +
      `📅 Date: ${activeEvent.eventDate || "TBA"}\n` +
      `⏰ Time: ${activeEvent.startTime || "TBA"} - ${activeEvent.endTime || "TBA"}\n` +
      `📍 Venue: ${activeEvent.venueName || "TBA"}${activeEvent.venueAddress ? ` (${activeEvent.venueAddress})` : ""}\n` +
      `👤 Organiser: ${activeEvent.organiserName || "TypQR Events"}\n\n` +
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

  const content = (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem" }}>
      {/* ---------------------------------------------------------------- VIEW: EVENT DETAIL */}
      {selectedEventId && activeEvent ? (
        <div>
          {/* Back button & Title bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                style={{
                  background: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                ← All Events
              </button>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "#111827" }}>
                {activeEvent.name}
              </h1>
              <span
                style={{
                  padding: "0.2rem 0.6rem",
                  borderRadius: "9999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  background:
                    activeEvent.status === "Published"
                      ? "#dcfce7"
                      : activeEvent.status === "Draft"
                      ? "#fef9c3"
                      : activeEvent.status === "Cancelled"
                      ? "#fee2e2"
                      : "#e0e7ff",
                  color:
                    activeEvent.status === "Published"
                      ? "#15803d"
                      : activeEvent.status === "Draft"
                      ? "#854d0e"
                      : activeEvent.status === "Cancelled"
                      ? "#b91c1c"
                      : "#4338ca",
                }}
              >
                {activeEvent.status}
              </span>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Link
                to={`/events/${activeEvent.id}/checkin`}
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
              <button
                type="button"
                onClick={() => handleOpenEditEvent(activeEvent)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.5rem 0.75rem",
                  background: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <IconEdit size={15} />
                Edit
              </button>
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
                {activeEvent.eventDate} ({activeEvent.startTime || "09:00"} - {activeEvent.endTime || "17:00"})
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Venue</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                {activeEvent.venueName || "Online / TBD"}
              </div>
              {activeEvent.venueAddress && <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{activeEvent.venueAddress}</div>}
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Capacity</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", marginTop: "0.2rem" }}>
                {tickets.length} / {activeEvent.capacity || 100} guests
              </div>
              <div style={{ width: "100%", height: "6px", background: "#f3f4f6", borderRadius: "9999px", marginTop: "0.4rem", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round((tickets.length / (activeEvent.capacity || 100)) * 100))}%`,
                    background: tickets.length >= activeEvent.capacity ? "#ef4444" : "#3b82f6",
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
                disabled={tickets.length >= activeEvent.capacity}
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
                  cursor: tickets.length >= activeEvent.capacity ? "not-allowed" : "pointer",
                  opacity: tickets.length >= activeEvent.capacity ? 0.6 : 1,
                }}
              >
                <IconPlus size={16} />
                Add Single Guest
              </button>

              <button
                type="button"
                onClick={() => setShowBulkImportModal(true)}
                disabled={tickets.length >= activeEvent.capacity}
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
                  cursor: tickets.length >= activeEvent.capacity ? "not-allowed" : "pointer",
                  opacity: tickets.length >= activeEvent.capacity ? 0.6 : 1,
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
                            <div>{t.checkInTime ? new Date(t.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}</div>
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
      ) : (
        /* ---------------------------------------------------------------- VIEW: EVENTS DASHBOARD */
        <div>
          {/* Header */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <IconCalendar size={24} className="text-blue-600" />
                <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0, color: "#111827" }}>
                  Event Management
                </h1>
              </div>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem", color: "#6b7280" }}>
                Create events, issue cryptographic QR tickets, import guests in bulk, and run live mobile check-in.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenCreateEvent}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.6rem 1.1rem",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.9rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <IconPlus size={18} />
              Create Event
            </button>
          </div>

          {/* Stored Metrics KPI Grid */}
          {stats && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "1rem",
                marginBottom: "2rem",
              }}
            >
              <div style={{ background: "#ffffff", padding: "1.1rem", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>Total Events</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#111827", marginTop: "0.3rem" }}>{stats.totalEvents}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>
                  {stats.upcomingEvents} upcoming · {stats.completedEvents} completed
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "1.1rem", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>Total Registered</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#2563eb", marginTop: "0.3rem" }}>{stats.totalRegisteredGuests}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>Active tickets generated</div>
              </div>

              <div style={{ background: "#ffffff", padding: "1.1rem", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>Checked-In Guests</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#059669", marginTop: "0.3rem" }}>{stats.checkedInGuests}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>{stats.pendingCheckIns} pending entry</div>
              </div>

              <div style={{ background: "#ffffff", padding: "1.1rem", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>Attendance Rate</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#7c3aed", marginTop: "0.3rem" }}>{stats.attendancePercentage}%</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>Overall verified check-in</div>
              </div>
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", flex: 1, maxWidth: "400px" }}>
              <input
                type="text"
                placeholder="Search events or venue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.8rem",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.35rem" }}>
              {["all", "Published", "Draft", "Completed", "Cancelled"].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  style={{
                    padding: "0.35rem 0.7rem",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    border: statusFilter === st ? "1px solid #2563eb" : "1px solid #e5e7eb",
                    background: statusFilter === st ? "#eff6ff" : "#ffffff",
                    color: statusFilter === st ? "#1d4ed8" : "#4b5563",
                    fontWeight: statusFilter === st ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {st === "all" ? "All Events" : st}
                </button>
              ))}
            </div>
          </div>

          {/* Events List Cards */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>Loading events...</div>
          ) : filteredEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem 2rem", background: "#ffffff", borderRadius: "12px", border: "1px dashed #d1d5db" }}>
              <IconCalendar size={48} className="text-gray-300" style={{ margin: "0 auto 1rem auto" }} />
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#111827", marginBottom: "0.3rem" }}>
                {searchQuery || statusFilter !== "all" ? "No events match your filter" : "No events created yet"}
              </h3>
              <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                Get started by creating your first event and generating branded QR tickets.
              </p>
              <button
                type="button"
                onClick={handleOpenCreateEvent}
                style={{
                  padding: "0.55rem 1.1rem",
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                + Create Event
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1.25rem" }}>
              {filteredEvents.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    background: "#ffffff",
                    borderRadius: "10px",
                    border: "1px solid #e5e7eb",
                    padding: "1.25rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#111827" }}>
                        {evt.name}
                      </h3>
                      <span
                        style={{
                          padding: "0.15rem 0.5rem",
                          borderRadius: "9999px",
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          background:
                            evt.status === "Published"
                              ? "#dcfce7"
                              : evt.status === "Draft"
                              ? "#fef9c3"
                              : evt.status === "Cancelled"
                              ? "#fee2e2"
                              : "#e0e7ff",
                          color:
                            evt.status === "Published"
                              ? "#15803d"
                              : evt.status === "Draft"
                              ? "#854d0e"
                              : evt.status === "Cancelled"
                              ? "#b91c1c"
                              : "#4338ca",
                        }}
                      >
                        {evt.status}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "0.75rem" }}>
                      📅 {evt.eventDate} · ⏰ {evt.startTime || "09:00"} {evt.venueName ? `· 📍 ${evt.venueName}` : ""}
                    </div>

                    {/* Capacity & Attendance Bar */}
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#4b5563", marginBottom: "0.25rem" }}>
                        <span>Tickets: {evt.ticketsCount || 0} / {evt.capacity || 100}</span>
                        <span>Checked In: {evt.checkedInCount || 0} ({evt.attendancePercentage || 0}%)</span>
                      </div>
                      <div style={{ width: "100%", height: "6px", background: "#f3f4f6", borderRadius: "9999px", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, Math.round(((evt.checkedInCount || 0) / (evt.ticketsCount || 1)) * 100))}%`,
                            background: "#059669",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "0.75rem", borderTop: "1px solid #f3f4f6" }}>
                    <button
                      type="button"
                      onClick={() => setSearchParams({ eventId: evt.id })}
                      style={{
                        padding: "0.4rem 0.8rem",
                        background: "#2563eb",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Manage Tickets →
                    </button>

                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <Link
                        to={`/events/${evt.id}/checkin`}
                        title="Live Scanner"
                        target="_blank"
                        style={{
                          padding: "0.35rem 0.55rem",
                          background: "#f3f4f6",
                          border: "1px solid #e5e7eb",
                          borderRadius: "4px",
                          color: "#374151",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        <IconCamera size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleOpenEditEvent(evt)}
                        title="Edit Event"
                        style={{
                          padding: "0.35rem 0.55rem",
                          background: "#f3f4f6",
                          border: "1px solid #e5e7eb",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        <IconEdit size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEvent(evt.id)}
                        title="Delete Event"
                        style={{
                          padding: "0.35rem 0.55rem",
                          background: "#fee2e2",
                          border: "1px solid #fecaca",
                          color: "#b91c1c",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- MODAL: CREATE / EDIT EVENT */}
      {showEventModal && (
        <Modal onClose={() => setShowEventModal(false)} title={editingEvent ? "Edit Event" : "Create New Event"}>
          <form onSubmit={handleSaveEvent}>
            <div style={{ marginBottom: "0.85rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                Event Name *
              </label>
              <input
                type="text"
                required
                value={eventForm.name}
                onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                placeholder="e.g. Annual Tech Summit 2026"
                style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.85rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Venue Name
                </label>
                <input
                  type="text"
                  value={eventForm.venueName}
                  onChange={(e) => setEventForm({ ...eventForm, venueName: e.target.value })}
                  placeholder="Grand Hall / Online"
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Address
                </label>
                <input
                  type="text"
                  value={eventForm.venueAddress}
                  onChange={(e) => setEventForm({ ...eventForm, venueAddress: e.target.value })}
                  placeholder="123 Main St, City"
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.85rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Event Date *
                </label>
                <input
                  type="date"
                  required
                  value={eventForm.eventDate}
                  onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Start Time
                </label>
                <input
                  type="time"
                  value={eventForm.startTime}
                  onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })}
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  End Time
                </label>
                <input
                  type="time"
                  value={eventForm.endTime}
                  onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.85rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Guest Capacity Limit *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={eventForm.capacity}
                  onChange={(e) => setEventForm({ ...eventForm, capacity: Number(e.target.value) || 100 })}
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>
                  Status
                </label>
                <select
                  value={eventForm.status}
                  onChange={(e) => setEventForm({ ...eventForm, status: e.target.value })}
                  style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                >
                  <option value="Published">Published (Active)</option>
                  <option value="Draft">Draft</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button
                type="button"
                onClick={() => setShowEventModal(false)}
                style={{ padding: "0.55rem 1rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: "0.55rem 1.25rem", background: "#2563eb", color: "#ffffff", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
              >
                {editingEvent ? "Save Changes" : "Create Event"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------------------- MODAL: SINGLE TICKET */}
      {showSingleTicketModal && (
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
      {showBulkImportModal && (
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
      {ticketToView && activeEvent && (
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
              {activeEvent.name}
            </h2>
            <div style={{ fontSize: "0.85rem", color: "#4b5563", marginBottom: "1rem" }}>
              {activeEvent.eventDate} · {activeEvent.venueName || "Venue TBD"}
            </div>

            <div style={{ display: "flex", justifyContent: "center", margin: "1rem 0" }}>
              {/* QR rendered directly from verification URL */}
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(
                  buildQrSvg(
                    `${window.location.origin}/checkin?token=${encodeURIComponent(ticketToView.ticketToken)}&eventId=${encodeURIComponent(activeEvent.id)}`,
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
                  `${window.location.origin}/checkin?token=${encodeURIComponent(ticketToView.ticketToken)}&eventId=${encodeURIComponent(activeEvent.id)}`,
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
  );

  if (embeddedInDashboard) {
    return content;
  }

  return (
    <AppShell currentTab="events" title="Event Management">
      {content}
    </AppShell>
  );
}
