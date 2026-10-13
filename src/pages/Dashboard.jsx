// src/pages/Dashboard.jsx — Bitly-Inspired Enterprise SaaS QR Management Platform
// Multi-tenant, secure, persistent QR management with Overview, My QR Codes, Analytics, Folders, Settings & Help.

import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import EditQrModal from "../components/EditQrModal";
import Modal from "../components/Modal";
import UsageMeter from "../components/UsageMeter";
import AuthForm from "../components/AuthForm";
import QrPreview from "../components/QrPreview";
import { Bars, Breakdown } from "../components/Charts";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import {
  subscribeToMyLinks,
  subscribeToScans,
  updateLink,
  deleteLink,
  dynamicUrlFor,
  linkStatus,
} from "../lib/links";
import {
  buildQrSvg,
  svgToDataUrl,
  svgToPngBlob,
  downloadBlob,
  downloadSvgString,
} from "../lib/qrRender";
import { summarize, scansToCsv } from "../lib/analytics";
import {
  IconDashboard,
  IconQrCode,
  IconPlus,
  IconBulk,
  IconChart,
  IconFolder,
  IconSettings,
  IconHelp,
  IconEdit,
  IconTrash,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconPause,
  IconPlay,
  IconCheck,
} from "../components/Icons";

function formatDate(ts) {
  if (!ts) return "—";
  let d = null;
  if (typeof ts?.toDate === "function") d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts === "number") d = new Date(ts);
  else if (typeof ts === "string") d = new Date(ts);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

// ---------------------------------------------------------------- Analytics Modal
function AnalyticsModal({ link, onClose }) {
  const [scans, setScans] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const unsub = subscribeToScans(link.id, setScans, () =>
      setErr("Couldn't load scan details. Verify backend storage connection.")
    );
    return unsub;
  }, [link.id]);

  const s = useMemo(() => (scans ? summarize(scans) : null), [scans]);

  const exportCsv = () => {
    downloadBlob(
      new Blob([scansToCsv(scans)], { type: "text/csv;charset=utf-8" }),
      `scans-${link.id}.csv`
    );
  };

  return (
    <Modal title={`Scan Analytics — ${link.label || link.id}`} onClose={onClose} wide={true}>
      {err && <div className="alert error">{err}</div>}
      {!scans ? (
        <p className="dash-loading">Loading scan records…</p>
      ) : scans.length === 0 ? (
        <div className="analytics-empty-state">
          <div className="empty-chart-icon">📊</div>
          <h3>No scans recorded yet</h3>
          <p>
            When users scan your dynamic QR code or visit <code>{dynamicUrlFor(link.id)}</code>,
            scan metrics, unique visitors, devices, and cities will appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="dash-stats">
            <div className="dash-stat">
              <span className="dash-stat-val">{s.total}</span>
              <span className="dash-stat-label">Total scans</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-val">{s.unique}</span>
              <span className="dash-stat-label">Unique visitors</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-val">{s.today}</span>
              <span className="dash-stat-label">Today</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-val">{s.last7}</span>
              <span className="dash-stat-label">Last 7 days</span>
            </div>
            {link.kind === "bio" && (
              <div className="dash-stat">
                <span className="dash-stat-val">{s.clicks}</span>
                <span className="dash-stat-label">Button clicks</span>
              </div>
            )}
          </div>

          <h4 style={{ margin: "20px 0 8px" }}>Scans — last 14 days</h4>
          <Bars items={s.byDay} />
          <div className="bar-axis">
            <span>{s.byDay[0]?.label}</span>
            <span>{s.byDay[s.byDay.length - 1]?.label}</span>
          </div>

          <h4 style={{ margin: "20px 0 8px" }}>Scans by hour of day</h4>
          <Bars items={s.byHour} height={60} />
          <div className="bar-axis">
            <span>12 am</span>
            <span>12 pm</span>
            <span>11 pm</span>
          </div>

          <div className="break-grid" style={{ marginTop: "20px" }}>
            <Breakdown title="Country" rows={s.byCountry} />
            <Breakdown title="City" rows={s.byCity} />
            {link.kind === "bio" && <Breakdown title="Top clicked buttons" rows={s.topLinks} />}
            <Breakdown title="Device" rows={s.byDevice} />
            <Breakdown title="Operating system" rows={s.byOS} />
            <Breakdown title="Browser / app" rows={s.byBrowser} />
            <Breakdown title="Language" rows={s.byLang} />
          </div>

          <div className="modal-foot" style={{ marginTop: "20px" }}>
            <span className="dash-muted">Showing {scans.length} recorded scans (up to 2,000).</span>
            <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!scans.length}>
              <IconDownload size={14} /> Export CSV
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Table Row Component
function LinkRow({ link, onEdit, onAnalytics }) {
  const [copied, setCopied] = useState(false);
  const isStatic = link.kind === "static";
  const url = isStatic ? link.payload || "" : dynamicUrlFor(link.id);
  const status = linkStatus(link);

  const thumb = useMemo(() => {
    try {
      return svgToDataUrl(buildQrSvg(url, link.design || {}, { size: 96 }));
    } catch {
      return "";
    }
  }, [url, JSON.stringify(link.design || {})]);

  const handleDelete = () => {
    const msg = isStatic
      ? `Delete "${link.label || "this static QR"}" from your dashboard? This will remove it from your management list.`
      : `Delete "${link.label || "this dynamic link"}" and all scan history? This action cannot be undone.`;
    if (window.confirm(msg)) {
      deleteLink(link.id).catch((e) => alert(e?.message || "Delete failed"));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy URL:", url);
    }
  };

  const handleDownload = async (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (!v) return;
    try {
      const filename = `qr-${(link.label || link.id).replace(/[^\w-]+/g, "-").slice(0, 30)}`;
      if (v === "svg") {
        downloadSvgString(buildQrSvg(url, link.design || {}, { size: 1024 }), `${filename}.svg`);
      } else {
        const px = Number(v);
        const blob = await svgToPngBlob(buildQrSvg(url, link.design || {}, { size: px }));
        downloadBlob(blob, `${filename}-${px}.png`);
      }
    } catch (err) {
      alert(err?.message || "Download failed");
    }
  };

  const toggleActive = () => updateLink(link.id, { active: link.active === false }).catch(() => {});

  const limitText = [
    link.expiresAt ? `Expires ${toDateInput(link.expiresAt)}` : "",
    link.maxScans ? `Max ${link.maxScans} scans` : "",
    link.password?.hash ? "🔒 Password" : "",
    link.destinations?.ios || link.destinations?.android ? "Per-OS target" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="table-data-row">
      <td style={{ width: "56px" }}>
        {thumb ? (
          <img className="qr-table-thumb" src={thumb} alt="QR" width="48" height="48" />
        ) : (
          <div className="qr-thumb-fallback">QR</div>
        )}
      </td>
      <td>
        <div className="cell-title-row">
          <span className="qr-row-label">{link.label || "Untitled QR"}</span>
          <span className="pill pill-id">#{link.id}</span>
          <span className={`pill ${isStatic ? "pill-static" : "pill-dynamic"}`}>
            {isStatic ? "Static" : "Dynamic"}
          </span>
        </div>
        <div className="qr-row-sub">
          {link.type || "url"} · Created {formatDate(link.createdAt)}
          {link.adminPaused ? " · Paused by admin" : ""}
        </div>
      </td>
      <td>
        {isStatic ? (
          <div>
            <span className="dest-link" title={link.payload}>
              {String(link.payload || "").slice(0, 65)}
            </span>
            <div className="qr-row-sub">Direct Static Content</div>
          </div>
        ) : link.kind === "bio" ? (
          <div>
            <a href={url} target="_blank" rel="noreferrer" className="dash-link dest-link">
              {url}
            </a>
            <div className="qr-row-sub">Bio Page · {link.bio?.links?.length || 0} buttons</div>
          </div>
        ) : (
          <div>
            <a href={url} target="_blank" rel="noreferrer" className="dash-link dest-link" style={{ fontWeight: 600 }}>
              {url}
            </a>
            <div className="qr-row-sub truncate" title={link.destination}>
              Target: {link.destination}
            </div>
          </div>
        )}
        {limitText && <div className="qr-row-sub limit-flags">{limitText}</div>}
      </td>
      <td style={{ textAlign: "center" }}>
        {isStatic ? (
          <span className="dash-muted" title="Static QRs are not trackable">—</span>
        ) : (
          <div>
            <span className="scans-count-bold">{link.scans ?? 0}</span>
            {link.lastScannedAt && (
              <div className="qr-row-sub">Last: {formatDate(link.lastScannedAt)}</div>
            )}
          </div>
        )}
      </td>
      <td>
        <span className={`pill pill-${status.id}`}>{status.label}</span>
      </td>
      <td className="row-actions-cell">
        <button
          type="button"
          className="table-action-icon-btn"
          title="Edit QR code details, destination & design"
          onClick={() => onEdit(link)}
        >
          <IconEdit size={14} />
          <span>Edit</span>
        </button>

        {!isStatic && (
          <button
            type="button"
            className="table-action-icon-btn"
            title="View scan analytics"
            onClick={() => onAnalytics(link)}
          >
            <IconChart size={14} />
            <span>Analytics</span>
          </button>
        )}

        <button
          type="button"
          className="table-action-icon-btn"
          title={isStatic ? "Copy content" : "Copy dynamic link"}
          onClick={handleCopy}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>

        {!isStatic && (
          <button
            type="button"
            className="table-action-icon-btn"
            title={link.active === false ? "Resume QR" : "Pause QR"}
            onClick={toggleActive}
            disabled={link.adminPaused}
          >
            {link.active === false ? <IconPlay size={13} /> : <IconPause size={13} />}
            <span>{link.active === false ? "Resume" : "Pause"}</span>
          </button>
        )}

        <select
          className="table-download-select"
          defaultValue=""
          onChange={handleDownload}
          aria-label="Download QR"
        >
          <option value="">Download…</option>
          <option value="1024">PNG (1024 px)</option>
          <option value="2048">PNG (2048 px)</option>
          <option value="svg">SVG Vector</option>
        </select>

        <button
          type="button"
          className="table-action-icon-btn text-danger"
          title="Delete QR code"
          onClick={handleDelete}
        >
          <IconTrash size={14} />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- Main Dashboard Page
export default function Dashboard({ defaultTab }) {
  const { user, loading } = useAuth();
  const { me } = useBilling(user);
  const [links, setLinks] = useState([]);
  const [dbError, setDbError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Tab: 'overview' | 'links' | 'analytics' | 'folders' | 'settings' | 'help'
  const validTabs = ["overview", "links", "analytics", "folders", "settings", "help"];
  const pathSegment = location.pathname.replace(/^\//, "").split("/")[0];
  const tabFromPath = validTabs.includes(pathSegment) ? pathSegment : null;
  const currentTab = searchParams.get("tab") || tabFromPath || defaultTab || "links";

  const setTab = (tab) => {
    navigate(`/dashboard?tab=${tab}`);
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'dynamic' | 'static'
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'active' | 'paused' | 'expired' | 'limit'
  const [sortBy, setSortBy] = useState("newest"); // 'newest' | 'oldest' | 'scans' | 'label'
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'cards'

  // Modals
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  // Subscribe to links
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToMyLinks(
      user.uid,
      (data) => {
        setLinks(data);
        setDbError("");
      },
      (err) => {
        const msg = err?.message || "";
        if (err?.code === "not-found" || msg.includes("not found") || msg.includes("(default)")) {
          setDbError("Cloud Firestore (default) database has not been initialized in Firebase.");
        } else {
          setDbError(msg || "Could not load links from server database.");
        }
      }
    );
    return unsub;
  }, [user]);

  // Derived metrics
  const totalScans = links.reduce((sum, l) => sum + (l.scans || 0), 0);
  const staticCount = links.filter((l) => l.kind === "static").length;
  const editableCount = links.length - staticCount;
  const activeCount = links.filter((l) => l.kind !== "static" && l.active !== false).length;
  const topLink = [...links].sort((a, b) => (b.scans || 0) - (a.scans || 0))[0];

  // Filtered & Sorted links
  const visibleLinks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = links.filter((l) => {
      // Type filter
      if (typeFilter === "dynamic" && l.kind === "static") return false;
      if (typeFilter === "static" && l.kind !== "static") return false;

      // Status filter
      if (statusFilter !== "all" && linkStatus(l).id !== statusFilter) return false;

      // Text query
      if (!q) return true;
      const labelMatch = (l.label || "").toLowerCase().includes(q);
      const destMatch = (l.destination || "").toLowerCase().includes(q);
      const payloadMatch = (l.payload || "").toLowerCase().includes(q);
      const idMatch = (l.id || "").toLowerCase().includes(q);
      return labelMatch || destMatch || payloadMatch || idMatch;
    });

    // Sort
    result.sort((a, b) => {
      if (sortBy === "scans") {
        return (b.scans || 0) - (a.scans || 0);
      }
      if (sortBy === "label") {
        return (a.label || "").localeCompare(b.label || "");
      }
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (sortBy === "oldest") return ta - tb;
      return tb - ta; // default: newest
    });

    return result;
  }, [links, searchQuery, typeFilter, statusFilter, sortBy]);

  if (loading) {
    return (
      <div className="dash-page">
        <p className="dash-loading">Loading account dashboard…</p>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  const tabTitles = {
    overview: "Platform Overview",
    links: "My QR Codes",
    analytics: "Global Analytics",
    folders: "Campaign Folders",
    settings: "Account & Settings",
    help: "Help & Knowledge Base",
  };

  return (
    <AppShell
      currentTab={currentTab}
      onTabChange={setTab}
      searchQuery={searchQuery}
      onSearchChange={(q) => {
        setSearchQuery(q);
        if (q && currentTab !== "links") {
          setTab("links");
        }
      }}
      title={tabTitles[currentTab] || "My QR Codes"}
    >
      {/* DB Warning (if applicable) */}
      {dbError && (
        <div className="alert warn" style={{ marginBottom: "20px" }}>
          <b>⚠️ Notice:</b> {dbError}
        </div>
      )}

      {/* -------------------- SUB-VIEW: OVERVIEW -------------------- */}
      {currentTab === "overview" && (
        <div className="view-overview-wrap">
          {/* Welcome Banner */}
          <div className="overview-welcome-card">
            <div className="welcome-text-col">
              <h2>Welcome back, {user.displayName || user.email?.split("@")[0]}!</h2>
              <p>
                Here is a summary of your QR code activity, active redirects, and visitor scans.
              </p>
            </div>
            <div className="welcome-action-col">
              <Link to="/" className="primary-btn">
                <IconPlus size={16} /> Create New QR
              </Link>
            </div>
          </div>

          {/* 4 KPI Summary Cards */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-title">Total QR Codes</span>
                <span className="kpi-icon-box bg-purple"><IconQrCode size={18} /></span>
              </div>
              <div className="kpi-val">{links.length}</div>
              <div className="kpi-sub">{editableCount} Dynamic · {staticCount} Static</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-title">Dynamic (Tracked)</span>
                <span className="kpi-icon-box bg-emerald"><IconPlay size={16} /></span>
              </div>
              <div className="kpi-val">{editableCount}</div>
              <div className="kpi-sub">{activeCount} Currently Active</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-title">Total Visitor Scans</span>
                <span className="kpi-icon-box bg-blue"><IconChart size={18} /></span>
              </div>
              <div className="kpi-val">{totalScans}</div>
              <div className="kpi-sub">Across all dynamic campaigns</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-title">Top QR Code</span>
                <span className="kpi-icon-box bg-amber"><IconDashboard size={18} /></span>
              </div>
              <div className="kpi-val text-truncate" style={{ fontSize: "18px" }}>
                {topLink?.label || "None yet"}
              </div>
              <div className="kpi-sub">
                {topLink ? `${topLink.scans || 0} scans logged` : "Create a QR code to begin"}
              </div>
            </div>
          </div>

          {/* Quota & Usage Bar */}
          {me && (
            <div className="overview-usage-panel">
              <div className="usage-panel-head">
                <div>
                  <span className="usage-head-title">Plan Entitlements &amp; Monthly Usage</span>
                  <p className="usage-head-sub">
                    {me.isAdmin ? "👑 Administrator: Unlimited QR codes and scans" : `${me.plan?.toUpperCase()} Plan`}
                  </p>
                </div>
                {!me.isAdmin && me.plan === "free" && (
                  <Link to="/pricing" className="upgrade-pill-btn">
                    Upgrade to Pro →
                  </Link>
                )}
              </div>
              <div className="usage-meter-row">
                <UsageMeter
                  label="Dynamic Editable QRs"
                  used={editableCount}
                  limit={me?.limits?.dynamicQrs ?? 3}
                />
                <UsageMeter
                  label="Monthly Scans"
                  used={me?.usage?.monthlyScans ?? totalScans}
                  limit={me?.limits?.monthlyScans ?? 500}
                />
              </div>
            </div>
          )}

          {/* Quick Actions Shortcuts */}
          <div className="overview-quick-actions">
            <div className="section-header-title">Quick Actions</div>
            <div className="action-cards-grid">
              <Link to="/" className="action-shortcut-card">
                <div className="shortcut-icon bg-purple"><IconPlus size={20} /></div>
                <div className="shortcut-title">Create Single QR</div>
                <div className="shortcut-desc">Generate URL, vCard, WiFi, or Bio QR codes with custom styling.</div>
              </Link>
              <Link to="/bulk" className="action-shortcut-card">
                <div className="shortcut-icon bg-blue"><IconBulk size={20} /></div>
                <div className="shortcut-title">Bulk Create (CSV)</div>
                <div className="shortcut-desc">Upload a spreadsheet of links and generate hundreds of QRs in a ZIP.</div>
              </Link>
              <button
                type="button"
                className="action-shortcut-card text-left"
                onClick={() => setTab("analytics")}
              >
                <div className="shortcut-icon bg-emerald"><IconChart size={20} /></div>
                <div className="shortcut-title">Scan Analytics</div>
                <div className="shortcut-desc">Analyze visitor demographics, devices, operating systems, and hourly scans.</div>
              </button>
            </div>
          </div>

          {/* Recent QR Codes Preview */}
          <div className="overview-recent-section" style={{ marginTop: "28px" }}>
            <div className="section-head-row">
              <div className="section-header-title">Recent QR Codes</div>
              <button type="button" className="link-button" onClick={() => setTab("links")}>
                View all ({links.length}) →
              </button>
            </div>

            {links.length === 0 ? (
              <div className="empty-dash-card">
                <p>No QR codes created yet.</p>
                <Link to="/" className="primary-btn" style={{ display: "inline-flex", width: "auto" }}>
                  Create Your First QR
                </Link>
              </div>
            ) : (
              <div className="bitly-table-card">
                <table className="bitly-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Label &amp; ID</th>
                      <th>Destination</th>
                      <th style={{ textAlign: "center" }}>Scans</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.slice(0, 5).map((l) => (
                      <LinkRow key={l.id} link={l} onEdit={setEditing} onAnalytics={setViewing} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* -------------------- SUB-VIEW: MY QR CODES -------------------- */}
      {currentTab === "links" && (
        <div className="view-links-wrap">
          {/* Filter and Search Toolbar */}
          <div className="links-toolbar-card">
            <div className="toolbar-top-row">
              {/* Type pills */}
              <div className="filter-pill-group">
                <button
                  type="button"
                  className={`filter-pill ${typeFilter === "all" ? "active" : ""}`}
                  onClick={() => setTypeFilter("all")}
                >
                  All ({links.length})
                </button>
                <button
                  type="button"
                  className={`filter-pill ${typeFilter === "dynamic" ? "active" : ""}`}
                  onClick={() => setTypeFilter("dynamic")}
                >
                  Dynamic ({editableCount})
                </button>
                <button
                  type="button"
                  className={`filter-pill ${typeFilter === "static" ? "active" : ""}`}
                  onClick={() => setTypeFilter("static")}
                >
                  Static ({staticCount})
                </button>
              </div>

              {/* Status and Sort Controls */}
              <div className="toolbar-controls-group">
                <select
                  className="dash-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="expired">Expired</option>
                  <option value="limit">Scan Limit</option>
                </select>

                <select
                  className="dash-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort QR codes"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="scans">Most Scans</option>
                  <option value="label">Label (A–Z)</option>
                </select>

                {/* View Mode Toggle */}
                <div className="view-mode-toggle">
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "table" ? "active" : ""}`}
                    onClick={() => setViewMode("table")}
                    title="Table view"
                  >
                    ☰
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "cards" ? "active" : ""}`}
                    onClick={() => setViewMode("cards")}
                    title="Grid view"
                  >
                    ⊞
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Links Results */}
          {links.length === 0 ? (
            <div className="empty-dash-card">
              <div className="empty-icon-graphic">📱</div>
              <h3>No QR codes created yet</h3>
              <p>
                Create your first static or dynamic QR code in the generator to manage and track it here.
              </p>
              <Link to="/" className="primary-btn" style={{ display: "inline-flex", width: "auto", marginTop: "14px" }}>
                <IconPlus size={16} /> Create QR Code
              </Link>
            </div>
          ) : visibleLinks.length === 0 ? (
            <div className="empty-dash-card">
              <h3>No matching QR codes found</h3>
              <p>Try adjusting your search terms or filters.</p>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
                style={{ marginTop: "12px" }}
              >
                Clear all filters
              </button>
            </div>
          ) : viewMode === "table" ? (
            <div className="bitly-table-card">
              <table className="bitly-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Label &amp; ID</th>
                    <th>Destination / Content</th>
                    <th style={{ textAlign: "center" }}>Scans</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLinks.map((link) => (
                    <LinkRow key={link.id} link={link} onEdit={setEditing} onAnalytics={setViewing} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Cards View */
            <div className="qr-card-grid">
              {visibleLinks.map((link) => {
                const isStatic = link.kind === "static";
                const url = isStatic ? link.payload || "" : dynamicUrlFor(link.id);
                const status = linkStatus(link);
                return (
                  <div key={link.id} className="qr-grid-card">
                    <div className="card-top-row">
                      <span className={`pill ${isStatic ? "pill-static" : "pill-dynamic"}`}>
                        {isStatic ? "Static" : "Dynamic"}
                      </span>
                      <span className="pill pill-id">#{link.id}</span>
                      <span className={`pill pill-${status.id}`}>{status.label}</span>
                    </div>

                    <div className="card-qr-preview-box">
                      <QrPreview value={url} design={link.design || {}} size={160} />
                    </div>

                    <div className="card-body-content">
                      <h4 className="card-title-text" title={link.label}>
                        {link.label || "Untitled QR"}
                      </h4>
                      <p className="card-dest-text truncate" title={isStatic ? link.payload : link.destination}>
                        {isStatic ? link.payload : link.destination || url}
                      </p>
                      <div className="card-meta-line">
                        <span>Scans: <b>{link.scans || 0}</b></span>
                        <span>{formatDate(link.createdAt)}</span>
                      </div>
                    </div>

                    <div className="card-action-bar">
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => setEditing(link)}
                      >
                        <IconEdit size={13} /> Edit
                      </button>
                      {!isStatic && (
                        <button
                          type="button"
                          className="card-action-btn"
                          onClick={() => setViewing(link)}
                        >
                          <IconChart size={13} /> Analytics
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* -------------------- SUB-VIEW: ANALYTICS -------------------- */}
      {currentTab === "analytics" && (
        <div className="view-analytics-wrap">
          <div className="analytics-summary-card">
            <h3>Global Analytics Dashboard</h3>
            <p>Aggregated scan performance across all active dynamic QR campaigns.</p>
            <div className="kpi-grid" style={{ marginTop: "16px" }}>
              <div className="kpi-card">
                <span className="kpi-title">Total Tracked Scans</span>
                <span className="kpi-val">{totalScans}</span>
                <span className="kpi-sub">Across {editableCount} dynamic links</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-title">Active Dynamic QRs</span>
                <span className="kpi-val">{activeCount}</span>
                <span className="kpi-sub">Receiving traffic</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-title">Top Performing Campaign</span>
                <span className="kpi-val" style={{ fontSize: "17px" }}>{topLink?.label || "None"}</span>
                <span className="kpi-sub">{topLink ? `${topLink.scans || 0} scans` : "No scans yet"}</span>
              </div>
            </div>
          </div>

          <div className="bitly-table-card" style={{ marginTop: "24px" }}>
            <div className="card-inner-header">
              <h4>All Campaigns Ranked by Scans</h4>
            </div>
            <table className="bitly-table">
              <thead>
                <tr>
                  <th>QR Name</th>
                  <th>Destination</th>
                  <th>Total Scans</th>
                  <th>Last Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {links
                  .filter((l) => l.kind !== "static")
                  .sort((a, b) => (b.scans || 0) - (a.scans || 0))
                  .map((link) => (
                    <tr key={link.id}>
                      <td>
                        <b>{link.label || "Untitled"}</b>
                        <div className="qr-row-sub">#{link.id}</div>
                      </td>
                      <td className="truncate" style={{ maxWidth: "260px" }}>{link.destination}</td>
                      <td><b>{link.scans || 0}</b></td>
                      <td>{formatDate(link.lastScannedAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="table-action-icon-btn"
                          onClick={() => setViewing(link)}
                        >
                          <IconChart size={13} /> View Deep Analytics
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -------------------- SUB-VIEW: FOLDERS -------------------- */}
      {currentTab === "folders" && (
        <div className="view-folders-wrap">
          <div className="folders-header-card">
            <div className="head-left">
              <h3>Campaign Folders</h3>
              <p>Organize your QR codes into marketing campaigns, retail branches, or product lines.</p>
            </div>
          </div>

          <div className="folders-grid" style={{ marginTop: "20px" }}>
            <div className="folder-card active-folder">
              <div className="folder-icon"><IconFolder size={24} /></div>
              <div className="folder-name">All QR Codes</div>
              <div className="folder-count">{links.length} total QR codes</div>
            </div>
            <div className="folder-card">
              <div className="folder-icon"><IconFolder size={24} /></div>
              <div className="folder-name">Marketing &amp; Social</div>
              <div className="folder-count">{links.filter((l) => l.type === "url").length} QR codes</div>
            </div>
            <div className="folder-card">
              <div className="folder-icon"><IconFolder size={24} /></div>
              <div className="folder-name">Menus &amp; Documents</div>
              <div className="folder-count">{links.filter((l) => l.type === "pdf").length} QR codes</div>
            </div>
            <div className="folder-card">
              <div className="folder-icon"><IconFolder size={24} /></div>
              <div className="folder-name">Bio &amp; Landing Pages</div>
              <div className="folder-count">{links.filter((l) => l.kind === "bio").length} QR codes</div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- SUB-VIEW: SETTINGS -------------------- */}
      {currentTab === "settings" && (
        <div className="view-settings-wrap">
          <div className="settings-card">
            <h3>Account &amp; Security Settings</h3>
            <p>Your authenticated session and data persistence information.</p>

            <div className="settings-field-group">
              <div className="settings-row">
                <span className="settings-lbl">Signed-in User</span>
                <span className="settings-val">{user.displayName || "Google User"}</span>
              </div>
              <div className="settings-row">
                <span className="settings-lbl">Email Address</span>
                <span className="settings-val">{user.email}</span>
              </div>
              <div className="settings-row">
                <span className="settings-lbl">Permanent Firebase UID</span>
                <span className="settings-val" style={{ fontFamily: "monospace" }}>{user.uid}</span>
              </div>
              <div className="settings-row">
                <span className="settings-lbl">Active Subscription</span>
                <span className="settings-val">
                  <span className={`pill plan-${me?.isAdmin ? "admin" : me?.plan || "free"}`}>
                    {me?.isAdmin ? "👑 Admin Unlimited" : `${me?.plan?.toUpperCase()} Plan`}
                  </span>
                </span>
              </div>
              <div className="settings-row">
                <span className="settings-lbl">QR Ownership Isolation</span>
                <span className="settings-val text-success">
                  ✓ Verified: All {links.length} QR codes are linked to your permanent UID
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- SUB-VIEW: HELP -------------------- */}
      {currentTab === "help" && (
        <div className="view-help-wrap">
          <div className="help-card">
            <h3>QR Pro Kit Knowledge Base &amp; FAQ</h3>
            <p>Best practices for designing, printing, and managing your QR codes.</p>

            <div className="faq-list" style={{ marginTop: "18px" }}>
              <div className="faq-item">
                <div className="faq-q">What is the difference between Static and Dynamic QR codes?</div>
                <div className="faq-a">
                  <b>Static QR codes</b> directly encode the content into the matrix. They never expire and don't require an internet lookup, but their destination cannot be modified once printed.
                  <br /><br />
                  <b>Dynamic QR codes</b> route through a short link (e.g. <code>{dynamicUrlFor("...")}</code>). You can change their target URL anytime over the air without reprinting, pause them, protect them with passwords, and track real-time scan analytics.
                </div>
              </div>

              <div className="faq-item">
                <div className="faq-q">Can I change the destination of a printed Dynamic QR code?</div>
                <div className="faq-a">
                  <b>Yes!</b> Click the <b>Edit</b> button on any dynamic QR code, enter the new destination URL, and click Save. The QR code and printed materials immediately redirect to the new target.
                </div>
              </div>

              <div className="faq-item">
                <div className="faq-q">How do I change the destination of a Static QR code?</div>
                <div className="faq-a">
                  Because a static QR's data is embedded directly in its printed black-and-white modules, an existing physical static QR cannot be redirected over the air. However, inside the <b>Edit</b> modal, you can use the <i>"Create Replacement QR"</i> button to generate a new static QR with your new URL while keeping the existing record intact.
                </div>
              </div>

              <div className="faq-item">
                <div className="faq-q">What are the recommended printing sizes for QR codes?</div>
                <div className="faq-a">
                  We recommend a minimum size of 2 × 2 cm (0.8 × 0.8 inches) for close-range scanning (business cards, menus) and larger sizes for posters or billboards (scan distance ÷ 10 rule). Always test scanning with both iOS and Android before mass printing!
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <EditQrModal
          link={editing}
          uid={user.uid}
          features={me?.features}
          onClose={() => setEditing(null)}
          onCreatedNew={(newId) => {
            // New static QR created
          }}
        />
      )}

      {/* Analytics Modal */}
      {viewing && (
        <AnalyticsModal link={viewing} onClose={() => setViewing(null)} />
      )}
    </AppShell>
  );
}
