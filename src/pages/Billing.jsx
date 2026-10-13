// src/pages/Billing.jsx — current plan, live usage, and subscription controls.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topbar from "../components/Topbar";
import AuthForm from "../components/AuthForm";
import AppShell from "../components/AppShell";
import UsageMeter from "../components/UsageMeter";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import { api } from "../lib/api";
import { PLANS, FEATURE_LABELS, isPaidPlan } from "../../shared/plans";

const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const nextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime(); };

export default function Billing({ embedded = false }) {
  const { user, loading } = useAuth();
  const { me, refresh, error: loadError } = useBilling(user);
  const [params] = useSearchParams();
  const justPaid = params.get("checkout") === "success";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // The provider's webhook can land a few seconds after the redirect back — poll briefly.
  useEffect(() => {
    if (!user || !justPaid || (me && me.plan !== "free")) return;
    let tries = 0;
    const t = setInterval(() => { if (++tries > 10) clearInterval(t); else refresh(); }, 2500);
    return () => clearInterval(t);
  }, [user, justPaid, me?.plan]);

  if (loading) return <div className="dash-page"><p className="dash-loading">Loading…</p></div>;
  if (!user) return <AuthForm />;

  const run = (key, fn) => async () => {
    setError(""); setNotice(""); setBusy(key);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const portal = run("portal", async () => { const { url } = await api("/api/billing?action=portal", { method: "POST" }); window.location.assign(url); });
  const cancel = run("cancel", async () => {
    if (!window.confirm(`Cancel your ${PLANS[me.plan].name} plan? You keep it until ${fmtDate(me.currentPeriodEnd)}.`)) return;
    await api("/api/billing?action=cancel", { method: "POST" });
    setNotice("Cancelled. You'll keep your plan until the end of the period you've paid for.");
    await refresh();
  });

  const plan = me && me.plan && PLANS[me.plan] ? PLANS[me.plan] : PLANS.free;
  const status = () => {
    if (!me) return "";
    if (me.isAdmin) return "👑 Administrator account with permanent unlimited access across all platform features.";
    if (me.source === "admin") return me.currentPeriodEnd ? `Plan granted by support, valid until ${fmtDate(me.currentPeriodEnd)}.` : "Plan granted by support.";
    if (me.plan === "free") return me.rawPlan !== "free" ? "Your paid plan has ended." : "You're on the free plan.";
    if (me.cancelAtPeriodEnd || me.status === "canceled") return `Cancelled — you keep ${plan.name} until ${fmtDate(me.currentPeriodEnd)}.`;
    if (me.status === "past_due") return "We couldn't charge your last payment. Update your payment method to keep your plan.";
    return me.currentPeriodEnd ? `Renews on ${fmtDate(me.currentPeriodEnd)}${me.interval ? ` (${me.interval})` : ""}.` : "Active.";
  };

  const billingContent = (
    <div className="view-billing-wrap">
      <div className="overview-welcome-card" style={{ marginBottom: "20px" }}>
        <div className="welcome-text-col">
          <h2>Plan &amp; Usage Management</h2>
          <p>View your active subscription details, monitor monthly scan quotas, and manage billing portals.</p>
        </div>
        <div className="welcome-action-col">
          <Link to="/pricing" className="primary-btn">
            Compare All Plans →
          </Link>
        </div>
      </div>

      {justPaid && me?.plan === "free" && <div className="alert warn">Payment received — activating your plan… this usually takes a few seconds.</div>}
      {justPaid && me && me.plan !== "free" && <div className="alert success">You're on {plan.name}. Thank you!</div>}
      {notice && <div className="alert success">{notice}</div>}
      {(error || loadError) && <div className="alert error">{error || loadError}</div>}
      {!me && !loadError && <p className="dash-loading">Loading your plan…</p>}

      {me && (
        <>
          <section className="card bill-card">
            <div className="bill-top">
              <div>
                <span className={`plan-badge plan-${me?.plan || "free"}`}>{plan.name}</span>
                {me?.status === "past_due" && me?.plan !== "free" && <span className="pill pill-expired" style={{ marginLeft: 8 }}>Payment failed</span>}
                <p className="bill-status">{status()}</p>
              </div>
              <div className="bill-actions">
                {me?.isAdmin && <Link className="primary-link" to="/admin">Admin Panel →</Link>}
                {me?.canManage && <button className="dash-btn" disabled={!!busy} onClick={portal}>{busy === "portal" ? "Opening…" : "Manage billing"}</button>}
                {me?.canCancel && <button className="dash-btn dash-btn-danger" disabled={!!busy} onClick={cancel}>{busy === "cancel" ? "Cancelling…" : "Cancel plan"}</button>}
                {!me?.isAdmin && (!isPaidPlan(me?.plan) || me?.cancelAtPeriodEnd || me?.source === "admin") && <Link className="primary-link" to="/pricing">{me?.plan === "free" ? "Upgrade" : "Choose a plan"}</Link>}
                {!me?.isAdmin && me?.plan === "pro" && !me?.cancelAtPeriodEnd && me?.source !== "admin" && !me?.canManage && <Link className="dash-btn" to="/pricing">See plans</Link>}
              </div>
            </div>
          </section>

          <section className="card bill-card">
            <h3 className="bill-h">Usage this month</h3>
            <UsageMeter label="Editable QR codes" used={me?.usage?.dynamicQrs ?? 0} limit={me?.limits?.dynamicQrs ?? PLANS.free.limits.dynamicQrs} />
            <UsageMeter label="Tracked scans" used={me?.usage?.monthlyScans ?? 0} limit={me?.limits?.monthlyScans ?? PLANS.free.limits.monthlyScans} hint={`Resets on ${fmtDate(nextMonth())} (UTC).`} />
            <UsageMeter label="Saved static QR codes" used={me?.usage?.staticQrs ?? 0} limit={me?.limits?.staticQrs ?? PLANS.free.limits.staticQrs} />
            {(me?.usage?.monthlyScans ?? 0) >= (me?.limits?.monthlyScans ?? PLANS.free.limits.monthlyScans) && (
              <div className="alert warn">Monthly scan limit reached — your editable QR codes show a "limit reached" page until the month resets{me?.plan !== "business" && <> or you <Link to="/pricing">upgrade</Link></>}.</div>
            )}
          </section>

          <section className="card bill-card">
            <h3 className="bill-h">Included in {plan.name}</h3>
            <ul className="plan-list">
              {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                <li key={k} className={me?.features?.[k] ? "" : "off"}>{me?.features?.[k] ? "✓" : "—"} {label}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );

  if (embedded) {
    return billingContent;
  }

  return (
    <AppShell currentTab="billing" title="Plan & Billing">
      {billingContent}
    </AppShell>
  );
}
