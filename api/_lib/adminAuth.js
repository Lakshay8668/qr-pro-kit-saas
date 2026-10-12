// api/_lib/adminAuth.js — Server-side Admin Allowlist & Authorization Guard
// Centralized server-side allowlist check against ADMIN_UIDS environment variable.

/**
 * Returns array of admin UIDs configured in server environment variables.
 * Handles comma-separated, space-separated, and newline-separated values.
 */
export function getAdminUids(env = process.env) {
  const e = typeof env === "function" ? env() : env || {};
  const raw = String(e.ADMIN_UIDS || process.env.ADMIN_UIDS || "");
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ""))
    .filter(Boolean);
}

/**
 * Validates whether the verified Firebase UID is listed in ADMIN_UIDS allowlist.
 * Never relies on client-editable fields or unverified tokens.
 */
export function isAdminUid(uid, env = process.env) {
  if (!uid || typeof uid !== "string") return false;
  const list = getAdminUids(env);
  return list.includes(uid.trim());
}

/**
 * Returns flat admin entitlements granting unrestricted access across all product features.
 */
export function getAdminEntitlements() {
  const limits = {
    dynamicQrs: 999999999,
    staticQrs: 999999999,
    monthlyScans: 999999999,
  };
  const features = {
    bulk: true,
    password: true,
    deviceTargeting: true,
    customDomain: true,
    whiteLabel: true,
  };
  return {
    plan: "admin",
    isAdmin: true,
    ...limits,
    ...features,
    limits,
    features,
  };
}
