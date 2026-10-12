// src/components/Topbar.jsx
import { Link } from "react-router-dom";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import { PLANS } from "../../shared/plans";

export default function Topbar() {
  const { user } = useAuth();
  const { me } = useBilling(user);
  return (
    <header className="topbar">
      <Link className="brand" to="/">
        QR<span>Pro</span>
      </Link>
      <nav className="topbar-nav">
        <Link to="/bulk">Bulk</Link>
        <Link to="/pricing">Pricing</Link>
        {user ? (
          <>
            <span className="nav-user">{user.displayName || user.email}</span>
            {me?.isAdmin ? (
              <>
                <span className="plan-badge plan-admin" title="Administrator account">
                  👑 Admin Unlimited
                </span>
                <Link to="/admin" style={{ fontWeight: 700, color: "var(--qp-brand)" }}>
                  Admin Panel
                </Link>
              </>
            ) : me && me.plan && PLANS[me.plan] ? (
              <Link to="/billing" className={`plan-badge plan-${me.plan}`} title="Plan & usage">
                {PLANS[me.plan]?.name}
              </Link>
            ) : null}
            <Link to="/dashboard">Dashboard</Link>
          </>
        ) : (
          <Link to="/dashboard">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
