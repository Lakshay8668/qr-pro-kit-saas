// api/_lib/admin.js — JSON API behind the /admin dashboard.
//
// Auth: the browser sends its Firebase ID token (Authorization: Bearer …). We verify it
// and then require the user's UID to be listed in the ADMIN_UIDS env var. There is no
// default admin and no shared password. (UIDs, unlike emails, can't be claimed by
// someone else signing up first.)
//
// GET  ?action=overview | users | links[&q=…]
// POST ?action=user-disable {uid, disabled} | user-plan {uid, plan, days?} | link-active {id, active} | link-delete {id}

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

import { PLANS, PLAN_ORDER, effectivePlanId, entitlementsFor } from "../../shared/plans.js";
import {
  getRazorpayCredentials,
  maskPlanId,
  getSafeCredentialFingerprint,
  getRazorpayPlanEnvConfig,
  cleanPlanId,
} from "./providers.js";

const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : 0);
const DAY = 86400000;
const CAP = 20000; // safety cap per collection scan (fine for thousands of users; see README for scaling)

export function createAdminHandler({ getDb, verify, adminUids, setAuthDisabled, serverTs, now = () => Date.now() }) {
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const lastDays = (days) => Array.from({ length: days }, (_, i) => dayKey(now() - (days - 1 - i) * DAY));

  async function loadAll(db) {
    const [u, l, ev] = await Promise.all([
      db.collection("users").limit(CAP).get(),
      db.collection("links").limit(CAP).get(),
      db.collection("billingEvents").limit(500).get().catch(() => ({ docs: [] })),
    ]);
    const users = u.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const links = l.docs.map((d) => ({ id: d.id, ...d.data() }));
    const events = (ev.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const byUid = new Map(users.map((x) => [x.uid, x]));
    return { users, links, events, byUid };
  }

  const emailOf = (byUid, uid) => byUid.get(uid)?.email || "(not seen since upgrade)";

  async function pauseOrRestoreUserLinks(db, uid, disabled) {
    const snap = await db.collection("links").where("ownerId", "==", uid).get();
    let n = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      const v = d.data();
      let patch = null;
      if (disabled && v.active !== false) patch = { active: false, adminPaused: true };
      if (!disabled && v.adminPaused) patch = { active: true, adminPaused: false };
      if (!patch) continue;
      batch.update(d.ref, patch);
      n++;
      if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    return n;
  }

  async function deleteLinkAndScans(db, id) {
    const ref = db.collection("links").doc(id);
    for (let i = 0; i < 100; i++) {
      const s = await ref.collection("scans").limit(400).get();
      if (s.empty) break;
      const b = db.batch();
      s.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    await ref.delete();
  }

  const log = (db, admin, action, target) =>
    db.collection("adminLog").add({ ts: serverTs(), admin, action, target }).catch(() => {});

  return async function handler(req, res) {
    try {
      const token = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { error: "sign_in_required" });
      let me;
      try {
        me = await verify(token);
      } catch {
        return json(res, 401, { error: "bad_token" });
      }
      if (!adminUids().includes(me.uid)) return json(res, 403, { error: "not_admin", uid: me.uid, email: me.email || "" });

      const db = getDb();
      const action = String(req.query?.action || "");

      // ------------------------------------------------------------ reads
      if (req.method === "GET") {
        const { users, links, byUid } = await loadAll(db);

        if (action === "overview") {
          const t = now();
          const keys = lastDays(14);
          const signups = Object.fromEntries(keys.map((k) => [k, 0]));
          const created = Object.fromEntries(keys.map((k) => [k, 0]));
          users.forEach((u) => { const k = dayKey(ms(u.createdAt)); if (k in signups) signups[k]++; });
          links.forEach((l) => { const k = dayKey(ms(l.createdAt)); if (k in created) created[k]++; });
          const editable = links.filter((l) => l.kind !== "static");
          const payingUsers = users.filter((u) => {
            const p = effectivePlanId(u, t);
            return p === "pro" || p === "business";
          });
          const mrr = payingUsers.reduce((sum, u) => {
            const p = effectivePlanId(u, t);
            const interval = u.planInterval || "monthly";
            const price = interval === "yearly" ? (PLANS[p]?.price?.yearly || 0) / 12 : (PLANS[p]?.price?.monthly || 0);
            return sum + Math.round(price);
          }, 0);

          return json(res, 200, {
            users: users.length,
            newUsers7d: users.filter((u) => ms(u.createdAt) >= t - 7 * DAY).length,
            disabledUsers: users.filter((u) => u.disabled).length,
            qrs: links.length,
            editable: editable.length,
            static: links.length - editable.length,
            bio: links.filter((l) => l.kind === "bio").length,
            files: links.filter((l) => l.type === "pdf").length,
            protectedQrs: links.filter((l) => l.password?.hash).length,
            scans: links.reduce((s, l) => s + (l.scans || 0), 0),
            plans: Object.fromEntries(PLAN_ORDER.map((p) => [p, users.filter((u) => effectivePlanId(u, t) === p).length])),
            payingCount: payingUsers.length,
            mrr,
            signupsByDay: keys.map((k) => ({ label: k.slice(5), count: signups[k] })),
            qrsByDay: keys.map((k) => ({ label: k.slice(5), count: created[k] })),
            topQrs: [...editable].sort((a, b) => (b.scans || 0) - (a.scans || 0)).slice(0, 10)
              .map((l) => ({ id: l.id, label: l.label, owner: emailOf(byUid, l.ownerId), scans: l.scans || 0 })),
          });
        }

        if (action === "users") {
          const agg = new Map();
          links.forEach((l) => {
            const a = agg.get(l.ownerId) || { qrs: 0, static: 0, scans: 0 };
            a.qrs++;
            if (l.kind === "static") a.static++;
            a.scans += l.scans || 0;
            agg.set(l.ownerId, a);
          });
          const rows = users.map((u) => ({
            uid: u.uid, email: u.email || "", name: u.displayName || "", createdAt: ms(u.createdAt),
            disabled: !!u.disabled, plan: effectivePlanId(u, now()), planSource: u.planSource || null,
            planStatus: u.planStatus || null, planEnd: Number(u.currentPeriodEnd) || 0, ...(agg.get(u.uid) || { qrs: 0, static: 0, scans: 0 }),
          }));
          agg.forEach((a, uid) => { if (!byUid.has(uid)) rows.push({ uid, email: "(not seen since upgrade)", name: "", createdAt: 0, disabled: false, ...a }); });
          rows.sort((a, b) => b.createdAt - a.createdAt);
          return json(res, 200, { users: rows });
        }

        if (action === "links") {
          const q = String(req.query?.q || "").trim().toLowerCase();
          const ownerId = String(req.query?.ownerId || "").trim();
          const kind = String(req.query?.kind || "").trim().toLowerCase();
          let rows = links.map((l) => ({
            id: l.id, label: l.label || "", type: l.type || "url", kind: l.kind || "redirect",
            ownerId: l.ownerId, owner: emailOf(byUid, l.ownerId), scans: l.scans || 0,
            active: l.active !== false, adminPaused: !!l.adminPaused, protected: !!l.password?.hash,
            deviceTargeting: !!(l.deviceTargeting && (l.deviceTargeting.ios || l.deviceTargeting.android)),
            createdAt: ms(l.createdAt), expiresAt: ms(l.expiresAt), destination: l.destination || l.payload || "",
          }));
          if (ownerId) rows = rows.filter((r) => r.ownerId === ownerId);
          if (kind && kind !== "all") {
            if (kind === "static") rows = rows.filter((r) => r.kind === "static");
            else if (kind === "editable" || kind === "dynamic") rows = rows.filter((r) => r.kind !== "static" && r.kind !== "bio" && r.type !== "pdf");
            else if (kind === "bio") rows = rows.filter((r) => r.kind === "bio");
            else if (kind === "file" || kind === "pdf") rows = rows.filter((r) => r.type === "pdf" || r.kind === "file");
          }
          if (q) rows = rows.filter((r) => `${r.label} ${r.owner} ${r.id} ${r.destination}`.toLowerCase().includes(q));
          rows.sort((a, b) => b.createdAt - a.createdAt);
          return json(res, 200, { total: rows.length, links: rows.slice(0, 500) });
        }

        if (action === "billing") {
          const t = now();
          const creds = getRazorpayCredentials(process.env);
          const payingUsers = users.filter((u) => {
            const p = effectivePlanId(u, t);
            return p === "pro" || p === "business";
          });
          const mrr = payingUsers.reduce((sum, u) => {
            const p = effectivePlanId(u, t);
            const interval = u.planInterval || "monthly";
            const price = interval === "yearly" ? (PLANS[p]?.price?.yearly || 0) / 12 : (PLANS[p]?.price?.monthly || 0);
            return sum + Math.round(price);
          }, 0);

          const eventRows = (events || [])
            .map((e) => ({
              id: e.id,
              uid: e.uid,
              userEmail: emailOf(byUid, e.uid),
              provider: e.provider || (e.id.startsWith("rzp") ? "razorpay" : e.id.startsWith("stripe") ? "stripe" : "unknown"),
              plan: e.plan || "pro",
              interval: e.interval || "monthly",
              subscriptionId: e.subscriptionId || "",
              paymentId: e.paymentId || "",
              status: e.status || "active",
              mode: (e.id.includes("test") || e.provider === "test" || creds?.keyMode === "test") ? "test" : "live",
              ts: ms(e.ts),
            }))
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 100);

          return json(res, 200, {
            payingCount: payingUsers.length,
            mrr,
            subscribers: payingUsers.map((u) => ({
              uid: u.uid,
              email: u.email || "",
              plan: effectivePlanId(u, t),
              interval: u.planInterval || "monthly",
              status: u.planStatus || "active",
              source: u.planSource || "unknown",
              currentPeriodEnd: Number(u.currentPeriodEnd) || 0,
            })),
            events: eventRows,
          });
        }

        if (action === "diagnostics") {
          const e = process.env;
          const creds = getRazorpayCredentials(e);
          const rzpPlans = {};
          for (const plan of ["pro", "business"]) {
            for (const interval of ["monthly", "yearly"]) {
              const cfg = getRazorpayPlanEnvConfig(e, plan, interval);
              rzpPlans[`${plan}_${interval}`] = {
                envVar: cfg.key,
                configuredId: maskPlanId(cfg.value),
                isSet: !!cfg.value,
              };
            }
          }

          return json(res, 200, {
            timestamp: new Date().toISOString(),
            server: {
              nodeVersion: process.version,
              uptimeSeconds: Math.round(process.uptime()),
            },
            admin: {
              configured: adminUids().length > 0,
              count: adminUids().length,
            },
            razorpay: {
              configured: !!(creds.keyId && creds.keySecret && !creds.modeConflict),
              configuredMode: creds.configuredMode,
              selectedMode: creds.selectedMode,
              keyMode: creds.keyMode,
              keyPrefix: creds.keyPrefix,
              modeConflict: creds.modeConflict,
              modeError: creds.modeError || null,
              keyIdPreview: maskPlanId(creds.keyId),
              keyIdSourceVar: creds.keySourceVar,
              keyIdFingerprint: getSafeCredentialFingerprint(creds.keyId),
              keySecretConfigured: !!creds.keySecret,
              keySecretFingerprint: getSafeCredentialFingerprint(creds.keySecret),
              webhookSecretConfigured: !!creds.webhookSecret,
              configuredPlans: rzpPlans,
            },
            database: {
              totalUsers: users.length,
              totalLinks: links.length,
            },
          });
        }

        return json(res, 400, { error: "unknown_action" });
      }

      // ------------------------------------------------------------ writes
      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

        if (action === "user-disable") {
          const uid = String(body.uid || "");
          const disabled = !!body.disabled;
          if (!uid) return json(res, 400, { error: "uid_required" });
          if (uid === me.uid || adminUids().includes(uid)) return json(res, 400, { error: "cannot_disable_admin" });
          await db.collection("users").doc(uid).set({ disabled }, { merge: true });
          await setAuthDisabled(uid, disabled);
          const changed = await pauseOrRestoreUserLinks(db, uid, disabled);
          await log(db, me.uid, disabled ? "user-disable" : "user-enable", uid);
          return json(res, 200, { ok: true, linksChanged: changed });
        }

        if (action === "user-plan") {
          // Manual grant / comp / override. A later provider webhook for the same customer will overwrite it.
          const uid = String(body.uid || "");
          const plan = String(body.plan || "");
          const days = Number(body.days) > 0 ? Math.floor(Number(body.days)) : 0;
          if (!uid) return json(res, 400, { error: "uid_required" });
          if (!PLANS[plan]) return json(res, 400, { error: "bad_plan" });
          const patch = {
            plan, planStatus: "active", planInterval: null, planSource: "admin",
            currentPeriodEnd: plan !== "free" && days ? now() + days * DAY : 0, cancelAtPeriodEnd: false,
          };
          patch.ent = entitlementsFor(patch, now());
          await db.collection("users").doc(uid).set(patch, { merge: true });
          await log(db, me.uid, `user-plan:${plan}${days ? `:${days}d` : ""}`, uid);
          return json(res, 200, { ok: true });
        }

        if (action === "link-active") {
          const id = String(body.id || "");
          if (!id) return json(res, 400, { error: "id_required" });
          const ref = db.collection("links").doc(id);
          if (!(await ref.get()).exists) return json(res, 404, { error: "not_found" });
          const active = !!body.active;
          await ref.update({ active, adminPaused: !active });
          await log(db, me.uid, active ? "link-resume" : "link-pause", id);
          return json(res, 200, { ok: true });
        }

        if (action === "link-delete") {
          const id = String(body.id || "");
          if (!id) return json(res, 400, { error: "id_required" });
          await deleteLinkAndScans(db, id);
          await log(db, me.uid, "link-delete", id);
          return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: "unknown_action" });
      }

      return json(res, 405, { error: "method_not_allowed" });
    } catch (e) {
      console.error("admin api error", e);
      return json(res, 500, { error: "server_error" });
    }
  };
}
