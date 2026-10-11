// src/pages/Pricing.jsx — public plan comparison + "Upgrade" (hands the customer to Stripe / Razorpay).
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topbar from "../components/Topbar";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import { api } from "../lib/api";
import { PLANS, PLAN_ORDER, FEATURE_LABELS, LIMIT_LABELS, formatPrice, isPaidPlan } from "../../shared/plans";

const PROVIDER_LABEL = {
  razorpay: "UPI · cards · netbanking (India) — Razorpay",
  stripe: "International cards — Stripe",
};

export default function Pricing() {
  const { user } = useAuth();
  const { me } = useBilling(user);
  const [params] = useSearchParams();
  const [interval, setIntervalValue] = useState("yearly");
  const [providers, setProviders] = useState(null);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/billing?action=config", { signedIn: false })
      .then((d) => {
        const provs = d?.providers || {};
        setProviders(provs);
        setProvider(provs.razorpay ? "razorpay" : provs.stripe ? "stripe" : "");
      })
      .catch(() => setProviders({}));
  }, []);

  const enabled = providers ? Object.keys(providers).filter((k) => providers[k]) : [];
  const activeProvider = provider || (enabled[0] || "");
  const subscribed = me && isPaidPlan(me?.plan) && me?.source !== "admin" && !me?.cancelAtPeriodEnd;

  const checkout = async (plan) => {
    setError("");
    const prov = activeProvider;
    if (!prov) {
      setError("Payment gateway is not configured yet. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your server environment variables to enable online checkout.");
      return;
    }
    setBusy(plan);
    try {
      const { url } = await api("/api/billing?action=checkout", { method: "POST", body: { plan, interval, provider: prov } });
      window.location.assign(url);
    } catch (e) {
      setError(e.message || "Failed to start checkout. Please try again.");
      setBusy("");
    }
  };

  const save = (id) => {
    const p = PLANS[id].price;
    return p.monthly ? Math.round((1 - p.yearly / (p.monthly * 12)) * 100) : 0;
  };

  const cta = (id) => {
    const isCurrent = me?.plan === id;
    if (isCurrent) return <button className="dash-btn plan-cta" disabled>Your current plan</button>;
    if (id === "free") return user ? <button className="dash-btn plan-cta" disabled>Included</button> : <Link to="/" className="dash-btn plan-cta">Start free</Link>;
    if (!user) return <Link to="/dashboard" className="primary-link plan-cta">Sign in to upgrade</Link>;
    if (subscribed) return <Link to="/billing" className="primary-link plan-cta">Manage in Billing</Link>;
    if (providers && !enabled.length) {
      return (
        <button
          className="dash-btn plan-cta"
          onClick={() => setError("Payments are not configured yet. Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_PLAN_* environment variables to activate subscriptions.")}
          title="Payment configuration required in environment variables"
        >
          Setup required
        </button>
      );
    }
    return (
      <button className="primary plan-cta" disabled={!!busy} onClick={() => checkout(id)}>
        {busy === id ? "Redirecting…" : `Upgrade to ${PLANS[id].name}`}
      </button>
    );
  };

  return (
    <main className="app-shell">
      <Topbar />
      <section className="pricing">
        <div className="pricing-head">
          <p className="eyebrow">PRICING</p>
          <h1>Simple plans that grow with your QR codes</h1>
          <p className="sub">Static QR codes are free forever. Pay when you need editable codes, more scans, passwords and bulk tools.</p>
          <div className="seg" role="tablist" aria-label="Billing interval">
            {["monthly", "yearly"].map((i) => (
              <button key={i} role="tab" aria-selected={interval === i} className={interval === i ? "on" : ""} onClick={() => setIntervalValue(i)}>
                {i === "monthly" ? "Monthly" : "Yearly"}
                {i === "yearly" && <span className="save">save {save("pro")}%</span>}
              </button>
            ))}
          </div>
        </div>

        {params.get("checkout") === "cancel" && <div className="alert warn pricing-note">Checkout cancelled — you haven't been charged.</div>}
        {providers && !enabled.length && (
          <div className="alert warn pricing-note">
            Online checkout is currently in setup mode. Configure <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in server environment variables to activate subscriptions.
          </div>
        )}
        {error && <div className="alert error pricing-note">{error}</div>}

        <div className="plan-grid">
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            const price = p.price[interval];
            return (
              <article key={id} className={`plan-card ${id === "pro" ? "featured" : ""} ${me?.plan === id ? "current" : ""}`}>
                {id === "pro" && <span className="plan-flag">Most popular</span>}
                <h3>{p.name}</h3>
                <p className="plan-tag">{p.tagline}</p>
                <div className="plan-price">
                  <strong>{price ? formatPrice(price) : "₹0"}</strong>
                  <span>{price ? (interval === "monthly" ? "/ month" : "/ year") : "forever"}</span>
                </div>
                <ul className="plan-list">
                  {Object.entries(p.limits).map(([k, v]) => (
                    <li key={k}><b>{v.toLocaleString("en-IN")}</b> {LIMIT_LABELS[k]}</li>
                  ))}
                  {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                    <li key={k} className={p.features[k] ? "" : "off"}>{p.features[k] ? "✓" : "—"} {label}</li>
                  ))}
                  <li>✓ Pause, expiry &amp; scan caps</li>
                  <li>✓ Device, city &amp; time analytics</li>
                </ul>
                {cta(id)}
              </article>
            );
          })}
        </div>

        {user && enabled.length > 1 && !subscribed && (
          <div className="provider-pick" role="radiogroup" aria-label="Payment method">
            {enabled.map((k) => (
              <label key={k} className={provider === k ? "on" : ""}>
                <input type="radio" name="provider" checked={provider === k} onChange={() => setProvider(k)} /> {PROVIDER_LABEL[k]}
              </label>
            ))}
          </div>
        )}

        <p className="pricing-foot">
          Prices in INR, GST may apply. Cancel any time from <Link to="/billing">Billing</Link> — you keep your plan until the period you paid for ends.
          If a plan's limit is reached, your existing QR codes keep working; you just can't add more until you upgrade or free up space.
        </p>
      </section>
    </main>
  );
}
