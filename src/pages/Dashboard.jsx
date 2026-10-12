// src/pages/Dashboard.jsx
// Multi-tenant dashboard. Each signed-in user only sees and edits their own links.
// v5: QR thumbnails + re-download, pause/expiry/scan limit, per-OS redirects,
//     search/filter, and a scan analytics modal with CSV export.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import UsageMeter from "../components/UsageMeter";
import AuthForm from "../components/AuthForm";
import Modal from "../components/Modal";
import BioEditor from "../components/BioEditor";
import { Bars, Breakdown } from "../components/Charts";
import { hashPassword } from "../lib/password";
import { uploadUserFile } from "../lib/storage";
import { isStorageConfigured } from "../lib/firebase";
import {
  subscribeToMyLinks,
  subscribeToScans,
  updateLink,
  deleteLink,
  dynamicUrlFor,
  linkStatus,
} from "../lib/links";
import { isValidHttpUrl } from "../lib/qrPayloads";
import { buildQrSvg, svgToDataUrl, svgToPngBlob, downloadBlob, downloadSvgString } from "../lib/qrRender";
import { summarize, scansToCsv } from "../lib/analytics";

function formatDate(ts) {
  const d = ts?.toDate?.();
  if (!d) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const toDateInput = (ts) => {
  const d = ts?.toDate?.();
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- analytics modal
function AnalyticsModal({ link, onClose }) {
  const [scans, setScans] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const unsub = subscribeToScans(link.id, setScans, () =>
      setErr("Couldn't load scan details. Make sure you published the latest firestore.rules.")
    );
    return unsub;
  }, [link.id]);

  const s = useMemo(() => (scans ? summarize(scans) : null), [scans]);

  const exportCsv = () => {
    downloadBlob(new Blob([scansToCsv(scans)], { type: "text/csv;charset=utf-8" }), `scans-${link.id}.csv`);
  };

  return (
    <Modal title={`Analytics — ${link.label}`} onClose={onClose} wide>
      {err && <div className="alert error">{err}</div>}
      {!scans && !err && <p className="dash-loading">Loading…</p>}
      {s && (
        <>
          <div className="dash-stats">
            <div className="dash-stat">
              <span className="dash-stat-val">{link.scans || 0}</span>
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

          <h4>Scans — last 14 days</h4>
          <Bars items={s.byDay} />
          <div className="bar-axis">
            <span>{s.byDay[0].label}</span>
            <span>{s.byDay[s.byDay.length - 1].label}</span>
          </div>

          <h4 style={{ marginTop: 18 }}>Scans by hour of day</h4>
          <Bars items={s.byHour} height={60} />
          <div className="bar-axis">
            <span>12 am</span>
            <span>12 pm</span>
            <span>11 pm</span>
          </div>

          <div className="break-grid">
            <Breakdown title="Country" rows={s.byCountry} />
            <Breakdown title="City" rows={s.byCity} />
            {link.kind === "bio" && <Breakdown title="Top clicked buttons" rows={s.topLinks} />}
            <Breakdown title="Device" rows={s.byDevice} />
            <Breakdown title="Operating system" rows={s.byOS} />
            <Breakdown title="Browser / app" rows={s.byBrowser} />
            <Breakdown title="Language" rows={s.byLang} />
          </div>

          <div className="modal-foot">
            <span className="dash-muted">Showing the latest {scans.length} logged scans (max 2000).</span>
            <button type="button" className="dash-btn" onClick={exportCsv} disabled={!scans.length}>
              Export CSV
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- edit modal
function EditModal({ link, uid, features, onClose }) {
  const isStatic = link.kind === "static";
  const isBio = link.kind === "bio";
  const isFile = link.type === "pdf";
  const canPw = !features || features?.password || !!link.password?.hash; // keep managing an existing password even after a downgrade
  const canOs = !features || features?.deviceTargeting || !!(link.destinations?.ios || link.destinations?.android);
  const [label, setLabel] = useState(link.label || "");
  const [destination, setDestination] = useState(link.destination || "");
  const [ios, setIos] = useState(link.destinations?.ios || "");
  const [android, setAndroid] = useState(link.destinations?.android || "");
  const [bio, setBio] = useState(link.bio || null);
  const [expiry, setExpiry] = useState(toDateInput(link.expiresAt));
  const [maxScans, setMaxScans] = useState(link.maxScans || "");
  const [active, setActive] = useState(link.active !== false);
  const [newPw, setNewPw] = useState("");
  const [removePw, setRemovePw] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError("");
    if (isStatic) {
      setSaving(true);
      try {
        await updateLink(link.id, { label });
        onClose();
      } catch (e) {
        setError(e?.message || "Save failed");
        setSaving(false);
      }
      return;
    }
    if (!isBio) {
      if (!newFile && !isValidHttpUrl(destination)) return setError("Destination must be a valid http/https URL.");
      if (ios && !isValidHttpUrl(ios)) return setError("iPhone URL must be a valid http/https URL.");
      if (android && !isValidHttpUrl(android)) return setError("Android URL must be a valid http/https URL.");
    }
    setSaving(true);
    try {
      const patch = {
        label,
        active,
        expiresAt: expiry ? new Date(`${expiry}T23:59:59`) : null,
        maxScans: maxScans || null,
      };
      if (isBio) patch.bio = bio;
      else {
        patch.destination = newFile ? await uploadUserFile(uid, newFile, setProgress) : destination;
        if (canOs) patch.destinations = { ios, android };
      }
      if (removePw) patch.password = null;
      else if (newPw && canPw) patch.password = await hashPassword(newPw);
      await updateLink(link.id, patch);
      onClose();
    } catch (e) {
      setError(e?.message || "Save failed");
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit QR link" onClose={onClose} wide={isBio}>
      <div className="edit-grid">
        <label>
          Label
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>

        {isStatic ? (
          <p className="field-hint">Static QR codes can't change after printing — only the label is editable. Want to change the destination later? Create an "editable" QR instead.</p>
        ) : isBio ? (
          <BioEditor value={bio} onChange={setBio} />
        ) : (
          <>
            <label>
              Destination URL
              <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={!!newFile} />
            </label>
            {isFile && (
              <label>
                Replace file (keeps the same QR){!isStorageConfigured() && <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "6px" }}>(Cloud Storage not enabled; edit Destination URL above)</span>}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  disabled={!isStorageConfigured()}
                  onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                />
              </label>
            )}
            <div className="row2">
              <label>
                iPhone URL (optional){!canOs && <Link to="/pricing" className="lock-badge">Pro</Link>}
                <input type="text" placeholder="App Store link" value={ios} disabled={!canOs} onChange={(e) => setIos(e.target.value)} />
              </label>
              <label>
                Android URL (optional){!canOs && <Link to="/pricing" className="lock-badge">Pro</Link>}
                <input type="text" placeholder="Play Store link" value={android} disabled={!canOs} onChange={(e) => setAndroid(e.target.value)} />
              </label>
            </div>
          </>
        )}

        {!isStatic && (<>
        <div className="row2">
          <label>
            Expires on
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          <label>
            Max scans
            <input type="number" min="1" value={maxScans} onChange={(e) => setMaxScans(e.target.value)} />
          </label>
        </div>

        <label>
          {link.password?.hash ? "Password is ON — set a new one (leave blank to keep)" : "Password protect (optional)"}{!canPw && <Link to="/pricing" className="lock-badge">Pro</Link>}
          <input type="text" autoComplete="off" placeholder={canPw ? "min 4 characters" : "Upgrade to Pro to password-protect"} value={newPw} disabled={removePw || !canPw} onChange={(e) => setNewPw(e.target.value)} />
        </label>
        {link.password?.hash && (
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={removePw} onChange={(e) => setRemovePw(e.target.checked)} />
            Remove password protection
          </label>
        )}

        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (untick to pause this QR)
        </label>
        </>)}
        {error && <div className="alert error">{error}</div>}
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? (progress > 0 && progress < 100 ? `Uploading ${progress}%…` : "Saving…") : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- row
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
    const msg = isStatic ? `Delete "${link.label || "this QR"}" from your dashboard?` : `Delete "${link.label || "this link"}" and its scan history? This cannot be undone.`;
    if (window.confirm(msg)) {
      deleteLink(link.id).catch((e) => alert(e?.message || "Delete failed"));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this:", url);
    }
  };

  const handleDownload = async (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (!v) return;
    try {
      if (v === "svg") {
        downloadSvgString(buildQrSvg(url, link.design || {}, { size: 1024 }), `qr-${link.label ? link.label.replace(/[^\w-]+/g, "-").slice(0, 30) : link.id}.svg`);
      } else {
        const px = Number(v);
        downloadBlob(await svgToPngBlob(buildQrSvg(url, link.design || {}, { size: px })), `qr-${link.id}-${px}.png`);
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
    link.destinations?.ios || link.destinations?.android ? "Per-OS redirect" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr>
      <td>{thumb && <img className="thumb" src={thumb} alt="QR" width="56" height="56" />}</td>
      <td>
        <div className="cell-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span>{link.label}</span>
          <span className="pill" style={{ fontSize: "11px", padding: "1px 6px", fontFamily: "monospace", background: "var(--bg-elevated, #f1f5f9)" }}>#{link.id}</span>
        </div>
        <div className="dash-muted">{link.kind === "static" ? "Static direct" : "Dynamic redirect"} · {link.type || "url"} · created {formatDate(link.createdAt)}{link.adminPaused ? " · paused by admin" : ""}</div>
      </td>
      <td>
        {isStatic ? (
          <div>
            <span className="dest-link" title={link.payload}>
              {String(link.payload || "").slice(0, 70)}
            </span>
            <div className="dash-muted" style={{ fontSize: "11px" }}>Direct destination (static)</div>
          </div>
        ) : link.kind === "bio" ? (
          <div>
            <a href={url} target="_blank" rel="noreferrer" className="dash-link dest-link">
              {url}
            </a>
            <div className="dash-muted" style={{ fontSize: "11px" }}>Bio page · {link.bio?.links?.length || 0} buttons</div>
          </div>
        ) : (
          <div>
            <a href={url} target="_blank" rel="noreferrer" className="dash-link dest-link" style={{ fontWeight: 600 }}>
              {url}
            </a>
            <div className="dash-muted" style={{ fontSize: "11px" }}>Target: {link.destination}</div>
          </div>
        )}
        {limitText && <div className="dash-muted">{limitText}</div>}
      </td>
      <td style={{ textAlign: "center" }}>
        {isStatic ? (
          <span className="dash-muted" title="Static QR codes can't be tracked">—</span>
        ) : (
          <>
            <b>{link.scans ?? 0}</b>
            <div className="dash-muted">{formatDate(link.lastScannedAt)}</div>
          </>
        )}
      </td>
      <td>
        <span className={`pill pill-${status.id}`}>{status.label}</span>
      </td>
      <td className="actions">
        {!isStatic && (
          <button type="button" className="dash-btn" onClick={() => onAnalytics(link)}>
            Analytics
          </button>
        )}
        <button type="button" className="dash-btn" onClick={() => onEdit(link)}>
          Edit
        </button>
        {!isStatic && (
          <button type="button" className="dash-btn" onClick={toggleActive} disabled={link.adminPaused} title={link.adminPaused ? "Paused by an administrator" : ""}>
            {link.active === false ? "Resume" : "Pause"}
          </button>
        )}
        <button type="button" className="dash-btn" onClick={handleCopy}>
          {copied ? "Copied!" : isStatic ? "Copy data" : "Copy link"}
        </button>
        <select className="dash-btn dl-select" defaultValue="" onChange={handleDownload} aria-label="Download QR">
          <option value="">Download…</option>
          <option value="1024">PNG 1024</option>
          <option value="2048">PNG 2048</option>
          <option value="svg">SVG</option>
        </select>
        <button type="button" className="dash-btn dash-btn-danger" onClick={handleDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- page
export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const { me } = useBilling(user);
  const [links, setLinks] = useState([]);
  const [dbError, setDbError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

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
          setDbError("Cloud Firestore (default) database has not been created in your Firebase project yet.");
        } else {
          setDbError(msg || "Could not load links from database.");
        }
      }
    );
    return unsub;
  }, [user]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return links.filter((l) => {
      if (filter !== "all" && linkStatus(l).id !== filter) return false;
      if (!s) return true;
      return (l.label || "").toLowerCase().includes(s) || (l.destination || "").toLowerCase().includes(s) || (l.bio?.title || "").toLowerCase().includes(s);
    });
  }, [links, q, filter]);

  if (loading) {
    return (
      <div className="dash-page">
        <p className="dash-loading">Loading…</p>
      </div>
    );
  }
  if (!user) return <AuthForm />;

  const displayName = user.displayName || user.email;
  const totalScans = links.reduce((sum, l) => sum + (l.scans || 0), 0);
  const staticCount = links.filter((l) => l.kind === "static").length;
  const editableCount = links.length - staticCount;
  const top = [...links].sort((a, b) => (b.scans || 0) - (a.scans || 0))[0];

  return (
    <div className="dash-page wide">
      <div className="dash-header">
        <div>
          <h2>My QR codes</h2>
          <p className="dash-sub">
            <Link to="/">← Generator</Link>
            <span className="dash-sep">·</span>
            <Link to="/bulk">Bulk create</Link>
            <span className="dash-sep">·</span>
            <Link to="/billing">Plan &amp; billing</Link>
            <span className="dash-user"> · {displayName}</span>
          </p>
        </div>
        <div className="dash-head-actions">
          <Link to="/" className="primary-link">+ New QR</Link>
          <button type="button" className="dash-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

      {dbError && (
        <div className="alert warn" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            ⚠️ Cloud Firestore is not provisioned for project <code>{import.meta.env.VITE_FIREBASE_PROJECT_ID || "delta-abbey-4f38q"}</code>
          </div>
          <p style={{ margin: "4px 0" }}>
            Firebase Authentication succeeded, but Cloud Firestore (which stores your dynamic QR codes and analytics) has not been created yet in the Firebase Console.
          </p>
          <p style={{ margin: "4px 0" }}>
            <b>How to enable (100% Free on Firebase Spark tier):</b>
            <br />
            1. Open <a href={`https://console.firebase.google.com/project/${import.meta.env.VITE_FIREBASE_PROJECT_ID || "delta-abbey-4f38q"}/firestore`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", fontWeight: 600 }}>Firebase Console → Firestore Database</a>
            <br />
            2. Click <b>Create database</b> with default database ID <code>(default)</code>.
            <br />
            3. Deploy the project security rules from <code>firestore.rules</code>.
          </p>
          <p style={{ margin: "4px 0", fontSize: 13, opacity: 0.9 }}>
            Static QR codes generated on the home page do not require a database and work completely in your browser.
          </p>
        </div>
      )}

      {me && (
        <div className="usage-strip">
          <UsageMeter label="Editable QR codes" used={editableCount} limit={me?.limits?.dynamicQrs ?? 3} />
          <UsageMeter label="Scans this month" used={me?.usage?.monthlyScans ?? 0} limit={me?.limits?.monthlyScans ?? 500} />
          {(me?.plan === "free" || editableCount >= (me?.limits?.dynamicQrs ?? 3) || (me?.usage?.monthlyScans ?? 0) >= (me?.limits?.monthlyScans ?? 500)) && me?.plan !== "business" && (
            <Link to="/pricing" className="primary-link usage-cta">{me?.plan === "free" ? "Upgrade" : "Get more"}</Link>
          )}
        </div>
      )}

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-val">{links.length}</span>
          <span className="dash-stat-label">QR codes created</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-val">{editableCount}</span>
          <span className="dash-stat-label">Editable (tracked)</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-val">{staticCount}</span>
          <span className="dash-stat-label">Static (saved)</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-val">{totalScans}</span>
          <span className="dash-stat-label">Total scans</span>
        </div>
        {top && top.scans > 0 && (
          <div className="dash-stat">
            <span className="dash-stat-val small">{top.label}</span>
            <span className="dash-stat-label">Top QR ({top.scans} scans)</span>
          </div>
        )}
      </div>

      {links.length > 0 && (
        <div className="dash-toolbar">
          <input
            type="search"
            className="dash-input"
            placeholder="Search label or URL…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="dash-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active (editable)</option>
            <option value="static">Static</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
            <option value="limit">Limit reached</option>
          </select>
        </div>
      )}

      {links.length === 0 ? (
        <p className="dash-empty">No QR codes yet — create one in the generator and it will be saved here automatically.</p>
      ) : visible.length === 0 ? (
        <p className="dash-empty">Nothing matches your search.</p>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th></th>
                <th>Label</th>
                <th>Destination</th>
                <th>Scans</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((link) => (
                <LinkRow key={link.id} link={link} onEdit={setEditing} onAnalytics={setViewing} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditModal link={editing} uid={user.uid} features={me?.features} onClose={() => setEditing(null)} />}
      {viewing && <AnalyticsModal link={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
