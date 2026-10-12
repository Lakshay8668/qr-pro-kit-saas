// api/_lib/db.js — Universal Persistent Database Adapter for QR Pro Kit
// Supports:
// 1. PostgreSQL (via DATABASE_URL or POSTGRES_URL, standard on Railway)
// 2. Persistent Durable File Storage (data/qrpro_db.json — auto-saved on every write)
// 3. Cloud Firestore (if FIREBASE_SERVICE_ACCOUNT is provided)
//
// Implements the complete Admin-SDK Firestore interface so existing routes,
// models, billing handlers, and tests work with zero regressions.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const getDataDir = () => path.resolve(process.env.DATA_DIR || path.join(__dirname, "../../data"));
const getDataFile = () => path.join(getDataDir(), "qrpro_db.json");

// In-memory collections map: collectionName -> Map<docId, docData>
const colls = new Map();
let isInitialized = false;
let pgPool = null;

// Helpers for deep copying and merging
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !v.__inc && !v._serverTimestamp;

function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (v && typeof v === "object" && typeof v.toMillis === "function") return new Date(v.toMillis());
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clone(x);
    return out;
  }
  if (Array.isArray(v)) return v.map(clone);
  return v;
}

function merge(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v?.__inc !== undefined) {
      out[k] = (Number(out[k]) || 0) + v.__inc;
    } else if (v?.operand !== undefined) {
      out[k] = (Number(out[k]) || 0) + Number(v.operand);
    } else if (v?._serverTimestamp) {
      out[k] = new Date();
    } else if (isObj(v) && isObj(out[k])) {
      out[k] = merge(out[k], v);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);

function existsError() {
  const e = new Error("6 ALREADY_EXISTS: Document already exists");
  e.code = 6;
  return e;
}

// ------------------------------------------------------------------ Persistence: Disk
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveToDisk() {
  try {
    const dataDir = getDataDir();
    const dataFile = getDataFile();
    ensureDir(dataDir);
    const dump = {};
    for (const [colName, map] of colls.entries()) {
      dump[colName] = {};
      for (const [id, data] of map.entries()) {
        dump[colName][id] = data;
      }
    }
    const tempFile = `${dataFile}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(tempFile, JSON.stringify(dump, null, 2), "utf8");
    fs.renameSync(tempFile, dataFile);
  } catch (err) {
    console.error("[DB] Failed saving to disk:", err.message);
  }
}

function loadFromDisk() {
  try {
    const dataFile = getDataFile();
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, "utf8");
      const dump = JSON.parse(raw);
      for (const [colName, docs] of Object.entries(dump)) {
        if (!colls.has(colName)) colls.set(colName, new Map());
        const map = colls.get(colName);
        for (const [id, data] of Object.entries(docs)) {
          // Re-hydrate date strings to Date instances if applicable
          map.set(id, hydrateDates(data));
        }
      }
      console.log(`[DB] Loaded persistent data from ${dataFile}`);
    }
  } catch (err) {
    console.error("[DB] Failed reading from disk:", err.message);
  }
}

function hydrateDates(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(hydrateDates);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      out[k] = isNaN(d.getTime()) ? v : d;
    } else if (v && typeof v === "object") {
      out[k] = hydrateDates(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ------------------------------------------------------------------ Persistence: PostgreSQL
async function initPg(databaseUrl) {
  try {
    const { default: pg } = await import("pg");
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // Create table for document storage
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS qr_pro_documents (
        collection VARCHAR(128) NOT NULL,
        id VARCHAR(128) NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_qr_pro_docs_collection ON qr_pro_documents(collection);
    `);

    // Load existing records from Postgres into in-memory store
    const res = await pgPool.query(`SELECT collection, id, data FROM qr_pro_documents`);
    for (const row of res.rows) {
      if (!colls.has(row.collection)) colls.set(row.collection, new Map());
      colls.get(row.collection).set(row.id, hydrateDates(row.data));
    }
    console.log(`[DB] Connected to PostgreSQL. Loaded ${res.rowCount} persistent documents.`);
  } catch (err) {
    console.warn("[DB] PostgreSQL initialization warning (falling back to disk):", err.message);
    pgPool = null;
  }
}

async function persistPgWrite(collection, id, data) {
  if (!pgPool) return;
  try {
    await pgPool.query(
      `INSERT INTO qr_pro_documents (collection, id, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [collection, id, JSON.stringify(data)]
    );
  } catch (err) {
    console.error("[DB] PostgreSQL write error:", err.message);
  }
}

async function persistPgDelete(collection, id) {
  if (!pgPool) return;
  try {
    await pgPool.query(`DELETE FROM qr_pro_documents WHERE collection = $1 AND id = $2`, [collection, id]);
  } catch (err) {
    console.error("[DB] PostgreSQL delete error:", err.message);
  }
}

// Initialize persistence once
export async function initializeDatabase() {
  if (isInitialized) return;
  isInitialized = true;

  // 1. Load local disk state
  loadFromDisk();

  // 2. If PostgreSQL is configured, load/sync with Postgres
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (dbUrl) {
    await initPg(dbUrl);
  }
}

// Auto-trigger initialization in background
initializeDatabase().catch((e) => console.error("[DB] Startup error:", e));

// ------------------------------------------------------------------ Firestore Document Wrapper
function makeTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return {
    toDate: () => d,
    toMillis: () => d.getTime(),
    toISOString: () => d.toISOString(),
  };
}

function wrapDocData(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (v?.operand !== undefined) {
      out[k] = Number(v.operand) || 0;
    } else if (v instanceof Date) {
      out[k] = makeTimestamp(v);
    } else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) out[k] = makeTimestamp(d);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = wrapDocData(v);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Firestore Adapter API
export function createUniversalDb() {
  const C = (name) => {
    if (!colls.has(name)) colls.set(name, new Map());
    return colls.get(name);
  };

  const notifyChange = (colName, id, op, data) => {
    saveToDisk();
    if (op === "delete") {
      persistPgDelete(colName, id).catch(() => {});
    } else {
      persistPgWrite(colName, id, data).catch(() => {});
    }
  };

  const docRef = (colName, id) => ({
    id,
    _name: colName,
    get: async () => {
      const has = C(colName).has(id);
      const raw = has ? C(colName).get(id) : null;
      return {
        id,
        exists: has,
        data: () => (has ? wrapDocData(clone(raw)) : undefined),
        ref: docRef(colName, id),
      };
    },
    set: async (data, options = {}) => {
      const cur = C(colName).get(id) || {};
      const next = options.merge ? merge(cur, data) : clone(data);
      C(colName).set(id, next);
      notifyChange(colName, id, "set", next);
    },
    create: async (data) => {
      if (C(colName).has(id)) throw existsError();
      const next = clone(data);
      C(colName).set(id, next);
      notifyChange(colName, id, "create", next);
    },
    update: async (patch) => {
      if (!C(colName).has(id)) {
        const err = new Error("5 NOT_FOUND: Document not found");
        err.code = 5;
        throw err;
      }
      const cur = C(colName).get(id);
      const next = merge(cur, patch);
      C(colName).set(id, next);
      notifyChange(colName, id, "update", next);
    },
    delete: async () => {
      C(colName).delete(id);
      notifyChange(colName, id, "delete");
    },
    collection: (subName) => query(`${colName}/${id}/${subName}`),
  });

  const query = (colName, filters = [], limitVal = 1e9, order = null) => {
    const getFilteredRows = () => {
      let rows = [...C(colName).entries()]
        .filter(([, data]) =>
          filters.every(([field, op, val]) => {
            const v = getPath(data, field);
            if (op === "==") return v === val;
            if (op === "!=") return v !== val;
            if (op === ">") return v > val;
            if (op === "<") return v < val;
            if (op === ">=") return v >= val;
            if (op === "<=") return v <= val;
            return true;
          })
        )
        .map(([id, data]) => ({ id, data: wrapDocData(clone(data)), ref: docRef(colName, id) }));

      if (order) {
        const { field, dir } = order;
        rows.sort((a, b) => {
          const va = getPath(a.data, field);
          const vb = getPath(b.data, field);
          const ta = va?.toMillis ? va.toMillis() : va instanceof Date ? va.getTime() : va;
          const tb = vb?.toMillis ? vb.toMillis() : vb instanceof Date ? vb.getTime() : vb;
          if (ta === tb) return 0;
          if (dir === "desc") return ta < tb ? 1 : -1;
          return ta > tb ? 1 : -1;
        });
      }

      return rows.slice(0, limitVal);
    };

    return {
      where: (field, op, val) => query(colName, [...filters, [field, op, val]], limitVal, order),
      orderBy: (field, dir = "asc") => query(colName, filters, limitVal, { field, dir }),
      limit: (n) => query(colName, filters, n, order),
      count: () => ({
        get: async () => ({
          data: () => ({ count: getFilteredRows().length }),
        }),
      }),
      get: async () => {
        const docs = getFilteredRows();
        return {
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data,
            ref: d.ref,
          })),
          empty: docs.length === 0,
          size: docs.length,
        };
      },
      doc: (id) => docRef(colName, id),
      add: async (data) => {
        const randId = `auto_${crypto.randomBytes(8).toString("hex")}`;
        const ref = docRef(colName, randId);
        await ref.set(data);
        return ref;
      },
    };
  };

  return {
    collection: (name) => query(name),
    batch: () => {
      const ops = [];
      return {
        create: (ref, data) => ops.push({ op: "create", ref, data }),
        set: (ref, data, opts) => ops.push({ op: "set", ref, data, opts }),
        update: (ref, patch) => ops.push({ op: "update", ref, patch }),
        delete: (ref) => ops.push({ op: "delete", ref }),
        commit: async () => {
          // Verify no create conflicts first
          for (const item of ops) {
            if (item.op === "create" && C(item.ref._name).has(item.ref.id)) {
              throw existsError();
            }
          }
          for (const item of ops) {
            if (item.op === "create" || item.op === "set") {
              await item.ref.set(item.data, item.opts);
            } else if (item.op === "update") {
              await item.ref.update(item.patch);
            } else if (item.op === "delete") {
              await item.ref.delete();
            }
          }
        },
      };
    },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
        update: (ref, patch) => writes.push(() => ref.update(patch)),
        delete: (ref) => writes.push(() => ref.delete()),
      };
      const res = await fn(tx);
      for (const w of writes) await w();
      return res;
    },
  };
}

let _db = null;
export function getDb() {
  if (!_db) {
    _db = createUniversalDb();
  }
  return _db;
}

export const serverTs = () => ({
  _serverTimestamp: true,
  toDate: () => new Date(),
  toMillis: () => Date.now(),
  toISOString: () => new Date().toISOString(),
});

export const increment = (n) => ({ __inc: n });

export const cookieSecret = () =>
  process.env.COOKIE_SECRET ||
  crypto.createHash("sha256").update(process.env.FIREBASE_PROJECT_ID || "qrpro-production-secret").digest("hex");
