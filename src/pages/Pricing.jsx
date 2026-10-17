// src/pages/Pricing.jsx — public plan comparison + "Upgrade" (hands the customer to Stripe / Razorpay).
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import { api } from "../lib/api";
import { PLANS, PLAN_ORDER, FEATURE_LABELS, LIMIT_LABELS, formatLimitLabel, formatPrice, isPaidPlan } from "../../shared/plans";

const PROVIDER_LABEL = {
  razorpay: "UPI · cards · netbanking (India) — Razorpay",
  stripe: "International cards — Stripe",
};

export default function Pricing() {
  const { user } = useAuth();
  const { me } = useBilling(user);
  const [params] = useSearchParams();
  const [interval, setIntervalValue] = useState("monthly");
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

  const [phoneModal, setPhoneModal] = useState(null); // { plan, phone }
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || "");

  useEffect(() => {
    if (user?.phoneNumber) {
      setPhoneNumber(user.phoneNumber);
    }
  }, [user]);

  const initiateCheckout = async (plan, contactNumber) => {
    setError("");
    const prov = activeProvider;
    if (!prov) {
      setError("Payment gateway is not configured yet. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your server environment variables to enable online checkout.");
      return;
    }
    setBusy(plan);
    try {
      const data = await api("/api/billing?action=checkout", {
        method: "POST",
        body: {
          plan,
          interval,
          provider: prov,
          phone: contactNumber || phoneNumber || user?.phoneNumber || "",
        },
      });

      // If Razorpay credentials returned, support native modal with instant payment verification
      if (prov === "razorpay" && data.subscriptionId && data.keyId) {
        const triggerModal = () => {
          if (!window.Razorpay) return false;
          const cleanPhone = (contactNumber || phoneNumber || user?.phoneNumber || "").replace(/[^0-9]/g, "");
          const formattedContact = cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone ? `+${cleanPhone}` : "";
          const rzp = new window.Razorpay({
            key: data.keyId,
            subscription_id: data.subscriptionId,
            name: "TypQR — Smart QR Management",
            description: `${PLANS[plan].name} Plan (${interval})`,
            image: `${window.location.origin}/typqr-logo.png`,
            prefill: {
              email: user?.email || "",
              name: user?.displayName || user?.email?.split("@")[0] || "Customer",
              contact: formattedContact,
            },
            notes: {
              plan,
              interval,
              uid: user?.uid || "",
            },
            theme: {
              color: "#4f46e5",
            },
            handler: async (response) => {
              setBusy(plan);
              try {
                await api("/api/billing?action=verify-razorpay", {
                  method: "POST",
                  body: {
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_subscription_id: response.razorpay_subscription_id,
                    razorpay_signature: response.razorpay_signature,
                    plan,
                    interval,
                  },
                });
                window.location.assign("/billing?checkout=success");
              } catch (verifyErr) {
                console.warn("[Billing] Immediate verification fallback:", verifyErr);
                window.location.assign("/billing?checkout=success");
              }
            },
            modal: {
              ondismiss: () => {
                setBusy("");
              },
            },
          });
          rzp.on("payment.failed", (response) => {
            console.error("[Billing] Payment failed:", response.error);
            const desc = response.error?.description || response.error?.reason || "Payment was not authorized.";
            setError(`Payment unsuccessful: ${desc}. If paying via UPI AutoPay, ensure recurring mandates are authorized in your UPI banking app.`);
            setBusy("");
          });
          rzp.open();
          return true;
        };

        if (window.Razorpay && triggerModal()) {
          return;
        }

        if (!document.getElementById("razorpay-checkout-script")) {
          const script = document.createElement("script");
          script.id = "razorpay-checkout-script";
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.async = true;
          script.onload = () => {
            if (!triggerModal() && data.url) window.location.assign(data.url);
          };
          script.onerror = () => {
            if (data.url) window.location.assign(data.url);
            else {
              setError("Could not load payment checkout window.");
              setBusy("");
            }
          };
          document.body.appendChild(script);
          return;
        }
      }

      if (data.url) {
        window.location.assign(data.url);
      } else {
        throw new Error("No checkout URL returned from payment provider.");
      }
    } catch (e) {
      setError(e.message || "Failed to start checkout. Please try again.");
      setBusy("");
    }
  };

  const save = (id) => {
    const p = PLANS[id].price;
    return p.monthly ? Math.round((1 - p.yearly / (p.monthly * 12)) * 100) : 0;
  };

  const checkout = (plan) => {
    // If provider is razorpay and user doesn't have a phone number, prompt for phone
    if (activeProvider === "razorpay" && !(phoneNumber || user?.phoneNumber)) {
      setPhoneModal({ plan, phone: "" });
      return;
    }
    initiateCheckout(plan, phoneNumber || user?.phoneNumber || "");
  };

  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    if (!phoneModal) return;
    const clean = phoneModal.phone.replace(/[^0-9]/g, "");
    if (clean.length < 10) {
      setError("Please enter a valid 10-digit mobile number for UPI mandate notifications.");
      return;
    }
    setPhoneNumber(clean);
    const planToUpgrade = phoneModal.plan;
    setPhoneModal(null);
    initiateCheckout(planToUpgrade, clean);
  };

  const cta = (id) => {
    if (me?.isAdmin) return <button className="dash-btn plan-cta" disabled>👑 Admin Unlimited Active</button>;
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

        {me?.isAdmin && (
          <div className="alert success pricing-note">
            👑 <strong>Admin Unlimited Access Active:</strong> This account has unrestricted platform-wide privileges. All dynamic and static QR codes, password protection, and bulk creation are permanently unlocked.
          </div>
        )}
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
                    <li key={k}><b>{v.toLocaleString("en-IN")}</b> {formatLimitLabel(k, v)}</li>
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
        <p className="field-hint" style={{ textAlign: "center", marginTop: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
          💳 <b>Payment Note:</b> Subscriptions in India use RBI-mandated recurring e-mandates (UPI AutoPay or cards).
          Need invoicing or corporate purchase assistance? Contact our team at <a href="mailto:support@engagiumtechnologies.com" style={{ color: "var(--qp-brand)" }}>support@engagiumtechnologies.com</a>.
        </p>

        {phoneModal && (
          <Modal title="Contact Mobile Number Required" onClose={() => setPhoneModal(null)}>
            <form onSubmit={handlePhoneSubmit} className="edit-grid">
              <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--qp-muted)", lineHeight: 1.5 }}>
                Under Reserve Bank of India (RBI) e-mandate guidelines, a 10-digit mobile number is mandatory to register and authenticate UPI AutoPay and card recurring mandates.
              </p>
              <label>
                Mobile Number (10 digits)
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ padding: "10px 12px", background: "#f3f4f6", borderRadius: "10px", fontWeight: 700, fontSize: "14px", border: "1px solid #d1d5db" }}>
                    +91
                  </span>
                  <input
                    type="tel"
                    placeholder="9876543210"
                    maxLength={10}
                    value={phoneModal.phone}
                    onChange={(e) => setPhoneModal({ ...phoneModal, phone: e.target.value.replace(/[^0-9]/g, "") })}
                    autoFocus
                    required
                  />
                </div>
              </label>
              <div className="modal-foot">
                <button type="button" className="dash-btn" onClick={() => setPhoneModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary" style={{ marginTop: 0, width: "auto" }}>
                  Continue to Razorpay Checkout →
                </button>
              </div>
            </form>
          </Modal>
        )}
      </section>
    </main>
  );
}
