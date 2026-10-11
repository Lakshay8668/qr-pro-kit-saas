// src/pages/Admin.jsx — admin dashboard (platform owner only).
// Talks to /api/admin with the signed-in user's Firebase ID token. Access is granted
// only if the user's UID is listed in the ADMIN_UIDS env var on Vercel.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";
import AuthForm from "../components/AuthForm";
import { Bars } from "../components/Charts";
import { dynamicUrlFor } from "../lib/links";

async function api(action, { method = "GET", body, query = "" } = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/admin?action=${action}${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON (e.g. running without the Vercel function) */
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const fmt = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const Stat = ({ v, l }) => (
  <div className="dash-stat">
    <span className="dash-stat-val">{v ?? "…"}</span>
    <span className="dash-stat-label">{l}</span>
  </div>
);

function NotAdmin({ info }) {
  return (
    <div className="dash-page">
      <h2>Admin access</h2>
      {info?.uid ? (
        <>
          <p>You're signed in, but this account isn't an administrator yet.</p>
          <p>To make it one, add this UID to the <code>ADMIN_UIDS</code> environment variable in Vercel (comma-separate several), then redeploy:</p>
          <p><code style={{ userSelect: "all", fontSize: 14 }}>{info.uid}</code></p>
        </>
      ) : (
        <p>
          Couldn't reach the admin API. It only exists on the deployed site (or <code>npx vercel dev</code>), and needs
          <code> FIREBASE_SERVICE_ACCOUNT</code> + <code>ADMIN_UIDS</code> to be set.
        </p>
      )}
      <p><Link to="/dashboard">← My dashboard</Link></p>
    </div>
  );
}

export default function Admin() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [ov, setOv] = useState(null);
  const [users, setUsers] = useState(null);
  const [links, setLinks] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("");

  const guard = useCallback(async (fn) => {
    try {
      setErr(null);
      return await fn();
    } catch (e) {
      setErr(e);
      return null;
    }
  }, []);

  const loadOverview = useCallback(() => guard(async () => setOv(await api("overview"))), [guard]);
  const loadUsers = useCallback(() => guard(async () => setUsers((await api("users")).users)), [guard]);
  const loadLinks = useCallback(
    (term = "") => guard(async () => setLinks(await api("links", { query: term ? `&q=${encodeURIComponent(term)}` : "" }))),
    [guard]
  );

  useEffect(() => {
    if (!user) return;
    if (tab === "overview") loadOverview();
    if (tab === "users") loadUsers();
    if (tab === "links") loadLinks();
  }, [user, tab, loadOverview, loadUsers, loadLinks]);

  const act = async (key, fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key);
    await guard(fn);
    setBusy("");
  };

  const filteredUsers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users || []).filter((u) => !s || `${u.email} ${u.name}`.toLowerCase().includes(s));
  }, [users, q]);

  if (loading) return <div className="dash-page"><p className="dash-loading">Loading…</p></div>;
  if (!user) return <AuthForm />;
  if (err && (err.status === 403 || err.status === 404 || err.status === 500 || !err.status)) return <NotAdmin info={err.data} />;

  return (
    <div className="dash-page wide">
      <div className="dash-header">
        <div>
          <h2>Admin dashboard</h2>
          <p className="dash-sub">
            <Link to="/dashboard">My dashboard</Link>
            <span className="dash-sep">·</span>
            <Link to="/">Generator</Link>
            <span className="dash-user"> · {user.email}</span>
          </p>
        </div>
        <button type="button" className="dash-btn" onClick={logout}>Sign out</button>
      </div>

      <div className="tabs">
        {[["overview", "Overview"], ["users", "Customers"], ["links", "All QR codes"]].map(([id, label]) => (
          <button key={id} type="button" className={`tab ${tab === id ? "tab-on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {err && <div className="alert error">{err.message}</div>}

      {tab === "overview" && (
        <>
          <div className="dash-stats">
            <Stat v={ov?.users} l="Customers" />
            <Stat v={ov?.newUsers7d} l="New (7 days)" />
            <Stat v={ov?.qrs} l="QR codes created" />
            <Stat v={ov?.scans} l="Total scans" />
          </div>
          <div className="dash-stats">
            <Stat v={ov?.editable} l="Editable QRs" />
            <Stat v={ov?.static} l="Static QRs" />
            <Stat v={ov?.bio} l="Link-in-bio pages" />
            <Stat v={ov?.files} l="File / menu QRs" />
            <Stat v={ov?.protectedQrs} l="Password-protected" />
            <Stat v={ov?.disabledUsers} l="Disabled customers" />
            <Stat v={ov ? ov.plans.pro + ov.plans.business : undefined} l="Paying / granted (Pro+Business)" />
          </div>
          {ov && (
            <div className="admin-charts">
              <div>
                <h4>New customers — last 14 days</h4>
                <Bars items={ov.signupsByDay} />
              </div>
              <div>
                <h4>QR codes created — last 14 days</h4>
                <Bars items={ov.qrsByDay} />
              </div>
            </div>
          )}
          {ov?.topQrs?.length > 0 && (
            <>
              <h4 style={{ marginTop: 22 }}>Top QR codes by scans</h4>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>QR</th><th>Owner</th><th>Scans</th><th></th></tr></thead>
                  <tbody>
                    {ov.topQrs.map((t) => (
                      <tr key={t.id}>
                        <td className="cell-title">{t.label}</td>
                        <td>{t.owner}</td>
                        <td><b>{t.scans}</b></td>
                        <td><a className="dash-link" href={dynamicUrlFor(t.id)} target="_blank" rel="noreferrer">Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "users" && (
        <>
          <div className="dash-toolbar">
            <input type="search" className="dash-input" placeholder="Search email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!users ? <p className="dash-loading">Loading…</p> : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr><th>Customer</th><th>Plan</th><th>Joined</th><th>QR codes</th><th>Static</th><th>Scans</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.uid}>
                      <td><div className="cell-title">{u.email}</div><div className="dash-muted">{u.name}</div></td>
                      <td>
                        <select
                          className="dash-input plan-select"
                          value={u.plan}
                          disabled={busy === u.uid}
                          title={u.planSource ? `Source: ${u.planSource}${u.planEnd ? ` · until ${fmt(u.planEnd)}` : ""}` : "No subscription"}
                          onChange={(e) => {
                            const plan = e.target.value;
                            const days = plan === "free" ? "" : window.prompt(`Grant ${plan} for how many days? (blank = no expiry)`, "30");
                            if (days === null) return;
                            act(u.uid, async () => { await api("user-plan", { method: "POST", body: { uid: u.uid, plan, days: Number(days) || 0 } }); await loadUsers(); });
                          }}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="business">Business</option>
                        </select>
                        {u.planSource && <div className="dash-muted">{u.planSource}</div>}
                      </td>
                      <td>{fmt(u.createdAt)}</td>
                      <td><b>{u.qrs}</b></td>
                      <td>{u.static}</td>
                      <td>{u.scans}</td>
                      <td><span className={`pill ${u.disabled ? "pill-expired" : "pill-active"}`}>{u.disabled ? "Disabled" : "Active"}</span></td>
                      <td className="actions">
                        <button
                          type="button"
                          className={`dash-btn ${u.disabled ? "" : "dash-btn-danger"}`}
                          disabled={busy === u.uid}
                          onClick={() =>
                            act(
                              u.uid,
                              async () => { await api("user-disable", { method: "POST", body: { uid: u.uid, disabled: !u.disabled } }); await loadUsers(); },
                              u.disabled ? `Re-enable ${u.email}?` : `Disable ${u.email}? They won't be able to sign in and all their QR codes will stop redirecting.`
                            )
                          }
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && <p className="dash-empty">No customers found.</p>}
            </div>
          )}
        </>
      )}

      {tab === "links" && (
        <>
          <div className="dash-toolbar">
            <input
              type="search"
              className="dash-input"
              placeholder="Search label, owner email or id… (press Enter)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadLinks(q.trim())}
            />
          </div>
          {!links ? <p className="dash-loading">Loading…</p> : (
            <div className="dash-table-wrap">
              <p className="dash-muted">Showing {links.links.length} of {links.total}</p>
              <table className="dash-table">
                <thead><tr><th>Label</th><th>Owner</th><th>Type</th><th>Scans</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {links.links.map((l) => (
                    <tr key={l.id}>
                      <td><div className="cell-title">{l.label}</div><div className="dash-muted">{l.id} · {fmt(l.createdAt)}{l.protected ? " · 🔒" : ""}</div></td>
                      <td>{l.owner}</td>
                      <td>{l.kind === "static" ? "static" : l.kind === "bio" ? "bio page" : l.type}</td>
                      <td>{l.kind === "static" ? "—" : <b>{l.scans}</b>}</td>
                      <td>
                        <span className={`pill ${l.kind === "static" ? "pill-static" : l.active ? "pill-active" : "pill-paused"}`}>
                          {l.kind === "static" ? "Static" : l.active ? "Active" : l.adminPaused ? "Paused (admin)" : "Paused"}
                        </span>
                      </td>
                      <td className="actions">
                        {l.kind !== "static" && (
                          <>
                            <a className="dash-btn" style={{ textDecoration: "none", color: "inherit" }} href={dynamicUrlFor(l.id)} target="_blank" rel="noreferrer">Open</a>
                            <button type="button" className="dash-btn" disabled={busy === l.id}
                              onClick={() => act(l.id, async () => { await api("link-active", { method: "POST", body: { id: l.id, active: !l.active } }); await loadLinks(q.trim()); })}>
                              {l.active ? "Pause" : "Resume"}
                            </button>
                          </>
                        )}
                        <button type="button" className="dash-btn dash-btn-danger" disabled={busy === l.id}
                          onClick={() => act(l.id, async () => { await api("link-delete", { method: "POST", body: { id: l.id } }); await loadLinks(q.trim()); },
                            `Permanently delete "${l.label}" (${l.owner}) and its scan history?`)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
