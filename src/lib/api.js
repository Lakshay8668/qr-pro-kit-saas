// src/lib/api.js — calls our own Vercel functions with the signed-in user's Firebase ID token.
import { auth } from "./firebase.js";

export class ApiError extends Error {
  constructor(data = {}, status = 0) {
    super(data.message || data.error || "Request failed");
    this.code = data.error || "error";
    this.status = status;
    this.data = data;
    this.upgrade = !!data.upgrade; // true => show an "Upgrade" prompt next to the message
  }
}

const API_BASE = ((typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "").replace(/\/+$/, "");

export async function api(path, { method = "GET", body, signedIn = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (signedIn) {
    const user = auth?.currentUser;
    if (!user) throw new ApiError({ error: "sign_in_required", message: "Please sign in first." }, 401);
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      throw new ApiError({ error: "token_failed", message: "Failed to retrieve authentication token. Sign in again." }, 401);
    }
  }

  const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError({ error: "network", message: "Couldn't reach the server. Check your connection." });
  }

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    // Non-JSON response (e.g. Vite SPA fallback index.html or 404/502 HTML)
    if (!res.ok) {
      throw new ApiError({ error: "http_error", message: `Request failed with HTTP status ${res.status}` }, res.status);
    }
    // If status is 200 but content is HTML, Vite or a proxy intercepted the API request
    throw new ApiError(
      {
        error: "api_unavailable",
        message: `API endpoint ${path} returned a non-JSON response. Ensure backend API functions are running (e.g. npx vercel dev).`,
      },
      503
    );
  }

  if (!res.ok) {
    throw new ApiError(data || { error: `http_${res.status}`, message: `Request failed with status ${res.status}` }, res.status);
  }

  return data || {};
}
