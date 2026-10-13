// src/pages/Admin.jsx — enterprise admin observability & management panel.
// Authenticates against /api/admin with Firebase ID tokens.
// Platform owner privileges are granted only if the caller UID is in ADMIN_UIDS.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";
import AuthForm from "../components/AuthForm";
import { Bars } from "../components/Charts";
import { dynamicUrlFor } from "../lib/links";

async function api(action, { method = "GET", body, query = "" } = {}) {
  if (!auth?.currentUser) {
    const err = new Error("Authentication required. Please sign in as an admin.");
    err.status = 401;
    throw err;
  }
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
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const fmt = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const Stat = ({ v, l }) => (
  <div className="dash-stat">
    <span className="dash-stat-val">{v ?? "…"}</span>
    <span className="dash-stat-label">{l}</span>
  </div>
);

function NotAdmin({ info }) {
  return (
    <div className="dash-page">
      <h2>Admin access required</h2>
      {info?.uid ? (
        <>
          <p>You are signed in, but this account is not registered in the administrator allowlist.</p>
          <p>To grant admin privileges, add this UID to the <code>ADMIN_UIDS</code> environment variable in Railway / server config, then redeploy:</p>
          <p><code style={{ userSelect: "all", fontSize: 14, background: "#f1f5f9", padding: "6px 10px", borderRadius: 6 }}>{info.uid}</code></p>
        </>
      ) : (
        <p>
          Could not verify administrator access. Ensure <code>FIREBASE_SERVICE_ACCOUNT</code> and <code>ADMIN_UIDS</code> are set in your server environment.
        </p>
      )}
      <p style={{ marginTop: 20 }}><Link to="/dashboard" className="primary-link" style={{ padding: "8px 16px", textDecoration: "none" }}>← Go to My Dashboard</Link></p>
    </div>
  );
}

export default function Admin() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [ov, setOv] = useState(null);
  const [users, setUsers] = useState(null);
  const [links, setLinks] = useState(null);
  const [billingData, setBillingData] = useState(null);
  const [diag, setDiag] = useState(null);

  const [q, setQ] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");

  const [selectedUser, setSelectedUser] = useState(null);
  const [userLinks, setUserLinks] = useState(null);
  const [loadingUserLinks, setLoadingUserLinks] = useState(false);
  const [copiedText, setCopiedText] = useState("");

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
    (term = "", kind = "all") =>
      guard(async () => {
        const query = `${term ? `&q=${encodeURIComponent(term)}` : ""}${kind !== "all" ? `&kind=${encodeURIComponent(kind)}` : ""}`;
        setLinks(await api("links", { query }));
      }),
    [guard]
  );
  const loadBilling = useCallback(() => guard(async () => setBillingData(await api("billing"))), [guard]);
  const loadDiag = useCallback(() => guard(async () => setDiag(await api("diagnostics"))), [guard]);

  useEffect(() => {
    if (!user) return;
    if (tab === "overview") loadOverview();
    if (tab === "users") loadUsers();
    if (tab === "links") loadLinks(q, kindFilter);
    if (tab === "billing") loadBilling();
    if (tab === "diagnostics") loadDiag();
  }, [user, tab, loadOverview, loadUsers, loadLinks, loadBilling, loadDiag]);

  const act = async (key, fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key);
    await guard(fn);
    setBusy("");
  };

  const copy = (val) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(val);
      setCopiedText(val);
      setTimeout(() => setCopiedText(""), 2000);
    }
  };

  const openUserDrawer = async (u) => {
    setSelectedUser(u);
    setLoadingUserLinks(true);
    try {
      const res = await api("links", { query: `&ownerId=${encodeURIComponent(u.uid)}` });
      setUserLinks(res.links || []);
    } catch {
      setUserLinks([]);
    } finally {
      setLoadingUserLinks(false);
    }
  };

  const promptChangePlan = (u, newPlan) => {
    const days = newPlan === "free" ? "" : window.prompt(`Grant ${newPlan.toUpperCase()} to ${u.email} for how many days? (leave blank for permanent)`, "30");
    if (days === null) return;
    act(u.uid, async () => {
      await api("user-plan", { method: "POST", body: { uid: u.uid, plan: newPlan, days: Number(days) || 0 } });
      await loadUsers();
      if (selectedUser?.uid === u.uid) {
        setSelectedUser((prev) => ({ ...prev, plan: newPlan }));
      }
    });
  };

  const toggleUserDisable = (u) => {
    act(
      u.uid,
      async () => {
        await api("user-disable", { method: "POST", body: { uid: u.uid, disabled: !u.disabled } });
        await loadUsers();
        if (selectedUser?.uid === u.uid) {
          setSelectedUser((prev) => ({ ...prev, disabled: !u.disabled }));
        }
      },
      u.disabled ? `Re-enable ${u.email}?` : `Disable ${u.email}? They won't be able to sign in and all their QR codes will stop redirecting.`
    );
  };

  const filteredUsers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users || []).filter((u) => {
      const matchesSearch = !s || `${u.email} ${u.name} ${u.uid}`.toLowerCase().includes(s);
      const matchesPlan = planFilter === "all" || u.plan === planFilter;
      return matchesSearch && matchesPlan;
    });
  }, [users, q, planFilter]);

  if (loading) return <div className="dash-page"><p className="dash-loading">Loading…</p></div>;
  if (!user) return <AuthForm />;
  if (err && (err.status === 403 || err.status === 404 || err.status === 500 || !err.status)) return <NotAdmin info={err.data} />;

  const TABS = [
    ["overview", "Overview"],
    ["users", "Customers"],
    ["links", "All QR codes"],
    ["billing", "Billing & Payments"],
    ["diagnostics", "Gateway Diagnostics"],
  ];

  return (
    <div className="dash-page wide">
      <div className="dash-header">
        <div>
          <h2>Platform Admin Panel</h2>
          <p className="dash-sub">
            <Link to="/dashboard">My dashboard</Link>
            <span className="dash-sep">·</span>
            <Link to="/">Generator</Link>
            <span className="dash-sep">·</span>
            <span className="badge-ready">👑 Verified Admin</span>
            <span className="dash-user"> · {user.email}</span>
          </p>
        </div>
        <button type="button" className="dash-btn" onClick={logout}>Sign out</button>
      </div>

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={`tab ${tab === id ? "tab-on" : ""}`} onClick={() => { setTab(id); setQ(""); }}>
            {label}
          </button>
        ))}
      </div>

      {copiedText && (
        <div className="alert success" style={{ marginBottom: 16 }}>
          Copied <code>{copiedText}</code> to clipboard!
        </div>
      )}
      {err && <div className="alert error">{err.message}</div>}

      {/* ===================== TAB 1: OVERVIEW ===================== */}
      {tab === "overview" && (
        <>
          <div className="dash-stats">
            <Stat v={ov?.users} l="Customers" />
            <Stat v={ov?.newUsers7d} l="New (7 days)" />
            <Stat v={ov?.payingCount} l="Paying Customers" />
            <Stat v={ov ? `₹${(ov.mrr || 0).toLocaleString("en-IN")}` : "…"} l="Estimated MRR" />
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
              <h4 style={{ marginTop: 24, marginBottom: 12 }}>Top QR codes by scans</h4>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>QR Label</th>
                      <th>Owner</th>
                      <th>Scans</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.topQrs.map((t) => (
                      <tr key={t.id}>
                        <td className="cell-title"><b>{t.label || t.id}</b></td>
                        <td>{t.owner}</td>
                        <td><b>{(t.scans || 0).toLocaleString("en-IN")}</b></td>
                        <td>
                          <a className="dash-btn" href={dynamicUrlFor(t.id)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                            Open link
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ===================== TAB 2: CUSTOMERS ===================== */}
      {tab === "users" && (
        <>
          <div className="dash-toolbar" style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
            <input
              type="search"
              className="dash-input"
              placeholder="Search email, name, or UID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--qp-muted)", fontWeight: 600 }}>Plan:</span>
              <select className="dash-input" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
                <option value="all">All Plans</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </div>
          </div>

          {!users ? (
            <p className="dash-loading">Loading customers…</p>
          ) : (
            <div className="dash-table-wrap">
              <p className="dash-muted" style={{ padding: "12px 16px 0", margin: 0 }}>
                Showing {filteredUsers.length} of {users.length} registered customers
              </p>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>UID</th>
                    <th>Plan</th>
                    <th>Joined</th>
                    <th>QR codes</th>
                    <th>Static</th>
                    <th>Scans</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.uid}>
                      <td>
                        <div className="cell-title" style={{ fontWeight: 650 }}>{u.email}</div>
                        <div className="dash-muted">{u.name || "—"}</div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="copy-pill"
                          title="Click to copy UID"
                          onClick={() => copy(u.uid)}
                        >
                          {u.uid.slice(0, 8)}… 📋
                        </button>
                      </td>
                      <td>
                        <select
                          className="dash-input plan-select"
                          value={u.plan}
                          disabled={busy === u.uid}
                          onChange={(e) => promptChangePlan(u, e.target.value)}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="business">Business</option>
                        </select>
                        {u.planSource && <div className="dash-muted" style={{ fontSize: 11 }}>{u.planSource}</div>}
                      </td>
                      <td>{fmt(u.createdAt)}</td>
                      <td><b>{u.qrs}</b></td>
                      <td>{u.static}</td>
                      <td><b>{u.scans}</b></td>
                      <td>
                        <span className={`pill ${u.disabled ? "pill-expired" : "pill-active"}`}>
                          {u.disabled ? "Disabled" : "Active"}
                        </span>
                      </td>
                      <td className="actions" style={{ whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="dash-btn"
                          onClick={() => openUserDrawer(u)}
                          style={{ marginRight: 6 }}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className={`dash-btn ${u.disabled ? "" : "dash-btn-danger"}`}
                          disabled={busy === u.uid}
                          onClick={() => toggleUserDisable(u)}
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && <p className="dash-empty">No customers match your search criteria.</p>}
            </div>
          )}

          {/* Customer Detail Drawer */}
          {selectedUser && (
            <div className="admin-drawer-backdrop" onClick={() => setSelectedUser(null)}>
              <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="admin-drawer-head">
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Customer Profile</h3>
                    <p style={{ margin: "2px 0 0", color: "var(--qp-muted)", fontSize: 12 }}>{selectedUser.email}</p>
                  </div>
                  <button type="button" className="dash-btn" onClick={() => setSelectedUser(null)}>✕ Close</button>
                </div>

                <div className="admin-drawer-body">
                  <div className="card" style={{ padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span className={`plan-badge plan-${selectedUser.plan || "free"}`}>
                        {String(selectedUser.plan || "free").toUpperCase()}
                      </span>
                      <span className={`pill ${selectedUser.disabled ? "pill-expired" : "pill-active"}`}>
                        {selectedUser.disabled ? "Disabled" : "Active"}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
                      <div><b>Name:</b> {selectedUser.name || "None"}</div>
                      <div><b>Email:</b> {selectedUser.email}</div>
                      <div>
                        <b>UID:</b> <code style={{ fontSize: 12, wordBreak: "break-all" }}>{selectedUser.uid}</code>{" "}
                        <button type="button" className="copy-pill" onClick={() => copy(selectedUser.uid)}>Copy</button>
                      </div>
                      <div><b>Created:</b> {fmt(selectedUser.createdAt)}</div>
                      <div><b>Plan source:</b> {selectedUser.planSource || "Free default"}</div>
                      {selectedUser.planEnd ? <div><b>Valid until:</b> {fmt(selectedUser.planEnd)}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={() => promptChangePlan(selectedUser, selectedUser.plan === "pro" ? "business" : "pro")}
                      >
                        Modify Plan
                      </button>
                      <button
                        type="button"
                        className={`dash-btn ${selectedUser.disabled ? "" : "dash-btn-danger"}`}
                        onClick={() => toggleUserDisable(selectedUser)}
                      >
                        {selectedUser.disabled ? "Enable Account" : "Disable Account"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4 style={{ margin: "0 0 10px" }}>Created QR Codes ({userLinks?.length ?? selectedUser.qrs})</h4>
                    {loadingUserLinks ? (
                      <p className="dash-loading">Loading customer's QR codes…</p>
                    ) : userLinks && userLinks.length > 0 ? (
                      <div className="dash-table-wrap">
                        <table className="dash-table">
                          <thead>
                            <tr>
                              <th>Label</th>
                              <th>Type</th>
                              <th>Scans</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userLinks.map((l) => (
                              <tr key={l.id}>
                                <td>
                                  <div className="cell-title">{l.label || l.id}</div>
                                  <div className="dash-muted" style={{ fontSize: 11 }}>{l.id}</div>
                                </td>
                                <td>{l.type || l.kind}</td>
                                <td><b>{l.scans}</b></td>
                                <td className="actions">
                                  {l.kind !== "static" && (
                                    <a className="dash-btn" href={dynamicUrlFor(l.id)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                                      Open
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn-danger"
                                    disabled={busy === l.id}
                                    onClick={() => {
                                      act(l.id, async () => {
                                        await api("link-delete", { method: "POST", body: { id: l.id } });
                                        const res = await api("links", { query: `&ownerId=${encodeURIComponent(selectedUser.uid)}` });
                                        setUserLinks(res.links || []);
                                        await loadUsers();
                                      }, `Delete "${l.label || l.id}"?`);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="dash-empty">No QR codes created by this customer.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===================== TAB 3: ALL QR CODES ===================== */}
      {tab === "links" && (
        <>
          <div className="dash-toolbar" style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
            <input
              type="search"
              className="dash-input"
              placeholder="Search label, owner, destination or ID… (press Enter)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadLinks(q.trim(), kindFilter)}
              style={{ minWidth: 260 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--qp-muted)", fontWeight: 600 }}>Kind:</span>
              <select
                className="dash-input"
                value={kindFilter}
                onChange={(e) => {
                  setKindFilter(e.target.value);
                  loadLinks(q.trim(), e.target.value);
                }}
              >
                <option value="all">All Kinds</option>
                <option value="editable">Editable / Dynamic</option>
                <option value="static">Static</option>
                <option value="bio">Link-in-bio</option>
                <option value="file">File / Menu</option>
              </select>
              <button type="button" className="dash-btn" onClick={() => loadLinks(q.trim(), kindFilter)}>
                Filter
              </button>
            </div>
          </div>

          {!links ? (
            <p className="dash-loading">Loading QR codes…</p>
          ) : (
            <div className="dash-table-wrap">
              <p className="dash-muted" style={{ padding: "12px 16px 0", margin: 0 }}>
                Showing {links.links.length} of {links.total} QR codes
              </p>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Label & ID</th>
                    <th>Destination / Target</th>
                    <th>Owner</th>
                    <th>Type</th>
                    <th>Scans</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.links.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div className="cell-title">
                          <b>{l.label || "(unlabeled)"}</b>
                          {l.protected ? " 🔒" : ""}
                          {l.deviceTargeting ? " 📱" : ""}
                        </div>
                        <div className="dash-muted">{l.id} · {fmt(l.createdAt)}</div>
                      </td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <a href={l.destination} target="_blank" rel="noreferrer" style={{ color: "var(--qp-brand)", fontSize: 12 }}>
                          {l.destination}
                        </a>
                      </td>
                      <td>{l.owner}</td>
                      <td>{l.kind === "static" ? "static" : l.kind === "bio" ? "bio page" : l.type}</td>
                      <td>{l.kind === "static" ? "—" : <b>{(l.scans || 0).toLocaleString("en-IN")}</b>}</td>
                      <td>
                        <span className={`pill ${l.kind === "static" ? "pill-static" : l.active ? "pill-active" : "pill-paused"}`}>
                          {l.kind === "static" ? "Static" : l.active ? "Active" : l.adminPaused ? "Paused (admin)" : "Paused"}
                        </span>
                      </td>
                      <td className="actions" style={{ whiteSpace: "nowrap" }}>
                        {l.kind !== "static" && (
                          <>
                            <a className="dash-btn" style={{ textDecoration: "none", color: "inherit", marginRight: 4 }} href={dynamicUrlFor(l.id)} target="_blank" rel="noreferrer">
                              Open
                            </a>
                            <button
                              type="button"
                              className="dash-btn"
                              style={{ marginRight: 4 }}
                              disabled={busy === l.id}
                              onClick={() => act(l.id, async () => {
                                await api("link-active", { method: "POST", body: { id: l.id, active: !l.active } });
                                await loadLinks(q.trim(), kindFilter);
                              })}
                            >
                              {l.active ? "Pause" : "Resume"}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="dash-btn dash-btn-danger"
                          disabled={busy === l.id}
                          onClick={() => act(l.id, async () => {
                            await api("link-delete", { method: "POST", body: { id: l.id } });
                            await loadLinks(q.trim(), kindFilter);
                          }, `Permanently delete "${l.label || l.id}" (${l.owner}) and its scan history?`)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {links.links.length === 0 && <p className="dash-empty">No QR codes found.</p>}
            </div>
          )}
        </>
      )}

      {/* ===================== TAB 4: BILLING & PAYMENTS ===================== */}
      {tab === "billing" && (
        <>
          <div className="dash-stats">
            <Stat v={`₹${(billingData?.mrr || 0).toLocaleString("en-IN")}`} l="Estimated MRR" />
            <Stat v={billingData?.payingCount} l="Active Subscribers" />
            <Stat v={billingData?.subscribers?.filter((s) => s.plan === "pro")?.length ?? 0} l="Pro Subscribers (₹299/mo)" />
            <Stat v={billingData?.subscribers?.filter((s) => s.plan === "business")?.length ?? 0} l="Business Subscribers (₹999/mo)" />
          </div>

          <h4 style={{ marginTop: 24, marginBottom: 12 }}>Active Subscriptions</h4>
          {!billingData ? (
            <p className="dash-loading">Loading subscribers…</p>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Interval</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Period End / Renews</th>
                    <th>UID</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData.subscribers || []).map((s) => (
                    <tr key={s.uid}>
                      <td className="cell-title"><b>{s.email}</b></td>
                      <td>
                        <span className={`plan-badge plan-${s.plan}`}>
                          {String(s.plan).toUpperCase()}
                        </span>
                      </td>
                      <td>{s.interval}</td>
                      <td><span className="pill pill-active">{s.status}</span></td>
                      <td>{s.source}</td>
                      <td>{fmt(s.currentPeriodEnd)}</td>
                      <td>
                        <button type="button" className="copy-pill" onClick={() => copy(s.uid)}>
                          {s.uid.slice(0, 8)}… 📋
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!billingData.subscribers || billingData.subscribers.length === 0) && (
                <p className="dash-empty">No paying subscribers yet.</p>
              )}
            </div>
          )}

          <h4 style={{ marginTop: 28, marginBottom: 12 }}>Verified Payment & Webhook Events</h4>
          {!billingData ? (
            <p className="dash-loading">Loading event records…</p>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Event ID / Source</th>
                    <th>Date & Time</th>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Interval</th>
                    <th>Subscription ID</th>
                    <th>Mode</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData.events || []).map((e) => (
                    <tr key={e.id}>
                      <td><code style={{ fontSize: 11 }}>{e.id}</code></td>
                      <td>{fmtTime(e.ts)}</td>
                      <td>{e.userEmail}</td>
                      <td><b>{String(e.plan || "pro").toUpperCase()}</b></td>
                      <td>{e.interval || "monthly"}</td>
                      <td><code style={{ fontSize: 11 }}>{e.subscriptionId || "—"}</code></td>
                      <td>
                        <span className={e.mode === "test" ? "badge-test" : "badge-live"}>
                          {String(e.mode || "live").toUpperCase()}
                        </span>
                      </td>
                      <td><span className="pill pill-active">{e.status || "active"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!billingData.events || billingData.events.length === 0) && (
                <p className="dash-empty">No billing webhook events recorded yet.</p>
              )}
            </div>
          )}
        </>
      )}

      {/* ===================== TAB 5: GATEWAY DIAGNOSTICS ===================== */}
      {tab === "diagnostics" && (
        <>
          {!diag ? (
            <p className="dash-loading">Loading gateway diagnostics…</p>
          ) : (
            <div className="diag-grid">
              {/* Card 1: Razorpay Status */}
              <div className="diag-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h4 style={{ margin: 0 }}>Razorpay Gateway</h4>
                  <span className={diag.razorpay?.selectedMode === "test" || diag.razorpay?.keyMode === "test" ? "badge-test" : "badge-live"}>
                    {(diag.razorpay?.selectedMode || diag.razorpay?.keyMode || "LIVE").toUpperCase()} MODE
                  </span>
                </div>
                <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                  <div><b>Status:</b> {diag.razorpay?.configured ? "✓ Configured & Active" : diag.razorpay?.modeConflict ? "⚠ Mode Conflict" : "⚠ Incomplete"}</div>
                  {diag.razorpay?.modeConflict && (
                    <div style={{ color: "#ef4444", fontSize: 12, background: "#fef2f2", padding: "6px 8px", borderRadius: 4, border: "1px solid #fecaca" }}>
                      <b>Warning:</b> {diag.razorpay.modeError}
                    </div>
                  )}
                  <div><b>Configured Mode:</b> <code>{diag.razorpay?.configuredMode || "auto"}</code></div>
                  <div><b>Key Prefix Type:</b> <code>{diag.razorpay?.keyPrefix || "none"}</code></div>
                  <div><b>Key ID Preview:</b> <code>{diag.razorpay?.keyIdPreview || "None"}</code></div>
                  <div><b>Active Variable:</b> <code>{diag.razorpay?.keyIdSourceVar || "None"}</code></div>
                  <div>
                    <b>Key ID Fingerprint:</b> <code style={{ fontSize: 11 }}>{diag.razorpay?.keyIdFingerprint || "None"}</code>
                  </div>
                  <div><b>Key Secret:</b> {diag.razorpay?.keySecretConfigured ? "✓ Configured" : "⚠ Missing"}</div>
                  <div>
                    <b>Secret Fingerprint:</b> <code style={{ fontSize: 11 }}>{diag.razorpay?.keySecretFingerprint || "None"}</code>
                  </div>
                  <div><b>Webhook Secret:</b> {diag.razorpay?.webhookSecretConfigured ? "✓ Configured" : "⚠ Not set"}</div>
                </div>
              </div>

              {/* Card 2: Plan IDs Matrix */}
              <div className="diag-card">
                <h4 style={{ margin: "0 0 12px" }}>Configured Plan IDs</h4>
                <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
                  {[
                    ["Pro (Monthly)", "₹299/mo", "pro_monthly", "RAZORPAY_PLAN_PRO_MONTHLY"],
                    ["Pro (Yearly)", "₹2,990/yr", "pro_yearly", "RAZORPAY_PLAN_PRO_YEARLY"],
                    ["Business (Monthly)", "₹999/mo", "business_monthly", "RAZORPAY_PLAN_BUSINESS_MONTHLY"],
                    ["Business (Yearly)", "₹9,990/yr", "business_yearly", "RAZORPAY_PLAN_BUSINESS_YEARLY"],
                  ].map(([label, price, key, envVar]) => {
                    const info = diag.razorpay?.configuredPlans?.[key];
                    const isSet = info?.isSet;
                    return (
                      <div key={key} style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <b>{label} ({price})</b>
                          <span className={isSet ? "badge-ready" : "badge-missing"}>
                            {isSet ? "READY" : "MISSING"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--qp-muted)", marginTop: 4 }}>
                          Env: <code>{envVar}</code> · ID: <code>{info?.configuredId || "Not configured"}</code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 3: Administrator Configuration */}
              <div className="diag-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h4 style={{ margin: 0 }}>Platform Administration</h4>
                  <span className="badge-ready">ACTIVE</span>
                </div>
                <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                  <div><b>ADMIN_UIDS Status:</b> {diag.admin?.configured ? "✓ Configured in environment" : "⚠ Empty"}</div>
                  <div><b>Configured Admin Accounts:</b> {diag.admin?.count || 0}</div>
                  <div><b>Your Signed-In Account:</b> {user.email}</div>
                  <div>
                    <b>Your UID:</b> <code style={{ fontSize: 11 }}>{user.uid}</code>{" "}
                    <button type="button" className="copy-pill" onClick={() => copy(user.uid)}>Copy</button>
                  </div>
                  <div>
                    <b>Role Entitlement:</b>{" "}
                    <span className="badge-ready">👑 Platform Administrator (Unlimited Access)</span>
                  </div>
                </div>
              </div>

              {/* Card 4: Server & Database Environment */}
              <div className="diag-card">
                <h4 style={{ margin: "0 0 12px" }}>Runtime & Database</h4>
                <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                  <div><b>Node Version:</b> {diag.server?.nodeVersion}</div>
                  <div><b>Server Uptime:</b> {Math.round((diag.server?.uptimeSeconds || 0) / 60)} minutes</div>
                  <div><b>Database Customers:</b> {diag.database?.totalUsers}</div>
                  <div><b>Database QR Codes:</b> {diag.database?.totalLinks}</div>
                  <div><b>Diagnostic Timestamp:</b> {new Date(diag.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
