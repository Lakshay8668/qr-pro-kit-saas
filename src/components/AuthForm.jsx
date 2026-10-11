// src/components/AuthForm.jsx
// Sign in / sign up / reset password form with Email/Password & Google provider support.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/useAuth";

export default function AuthForm() {
  const { login, signup, resetPassword, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const mapAuthError = (err) => {
    const code = err?.code || "";
    if (code === "auth/email-already-in-use") return "This email is already registered. Sign in instead.";
    if (code === "auth/invalid-email") return "Invalid email address.";
    if (code === "auth/weak-password") return "Password is too weak (min 6 characters).";
    if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential")
      return "Couldn't sign in. Check your email and password.";
    if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
    if (code === "auth/unauthorized-domain")
      return "This domain (e.g. localhost) is not authorized in Firebase. Add it in Firebase Console → Authentication → Settings → Authorized domains.";
    if (code === "auth/operation-not-allowed")
      return "This sign-in method is not enabled. Enable Email/Password or Google in Firebase Console → Authentication → Sign-in method.";
    if (code === "auth/popup-closed-by-user") return "Sign-in popup was closed before completing.";
    if (code === "auth/popup-blocked") return "Popup blocked by your browser. Please allow popups and try again.";
    if (code === "auth/configuration-not-found")
      return "Firebase Authentication is not enabled for this project. Check Firebase Console → Authentication.";
    return err?.message || "Authentication failed. Please try again.";
  };

  const handleGoogle = async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      if (mode === "reset") {
        if (!email.trim()) {
          setError("Enter your email address.");
          setLoading(false);
          return;
        }
        await resetPassword(email.trim());
        setNotice("Password reset email sent. Check your inbox.");
        setLoading(false);
        return;
      }
      if (mode === "signup") {
        if (password.length < 6) {
          setError("Password must be at least 6 characters.");
          setLoading(false);
          return;
        }
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";

  return (
    <div className="dash-page">
      <form onSubmit={submit} className="dash-login">
        <h2>{title}</h2>
        <p className="dash-auth-hint">
          {mode === "login" && "Sign in to manage your editable QR links."}
          {mode === "signup" && "Create a free account to save and edit dynamic QR codes."}
          {mode === "reset" && "We'll email you a link to set a new password."}
        </p>

        {mode !== "reset" && (
          <button
            type="button"
            className="google-btn"
            onClick={handleGoogle}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 10 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </button>
        )}

        {mode !== "reset" && (
          <div className="auth-divider">
            <span>or with email</span>
          </div>
        )}

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        {mode !== "reset" && (
          <div className="pass-wrap">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
            />
            <button
              type="button"
              className="pass-toggle"
              onClick={() => setShowPass((v) => !v)}
              tabIndex={-1}
            >
              {showPass ? "Hide" : "Show"}
            </button>
          </div>
        )}

        {error && <p className="dash-error">{error}</p>}
        {notice && <p className="dash-notice">{notice}</p>}

        <button type="submit" disabled={loading}>
          {loading
            ? mode === "reset"
              ? "Sending…"
              : mode === "login"
                ? "Signing in…"
                : "Creating…"
            : mode === "reset"
              ? "Send reset link"
              : mode === "login"
                ? "Sign in with Email"
                : "Create account"}
        </button>

        <div className="dash-switch">
          {mode === "login" && (
            <>
              <button
                type="button"
                className="dash-link-btn"
                onClick={() => {
                  setMode("reset");
                  setError("");
                  setNotice("");
                }}
              >
                Forgot password?
              </button>
              <span className="dash-sep">·</span>
              No account?{" "}
              <button
                type="button"
                className="dash-link-btn"
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                }}
              >
                Sign up
              </button>
            </>
          )}
          {mode === "signup" && (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="dash-link-btn"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                Sign in
              </button>
            </>
          )}
          {mode === "reset" && (
            <>
              <button
                type="button"
                className="dash-link-btn"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>

        <p className="dash-back">
          <Link to="/">← Back to generator</Link>
        </p>
      </form>
    </div>
  );
}
