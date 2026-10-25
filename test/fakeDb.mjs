// test/fakeDb.mjs — tiny in-memory Firestore (Admin-SDK shaped) for the billing/limit tests.
// Supports: doc get/set(merge)/create/update/delete, where(==, dotted paths), limit, count(), get(),
// batch().create/commit (atomic, fails if a doc exists) and runTransaction (writes applied after fn resolves).
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !v.__inc;
const clone = (v) => (v instanceof Date ? new Date(v) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : Array.isArray(v) ? v.map(clone) : v);
const merge = (target, patch) => {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v?.__inc) out[k] = (Number(out[k]) || 0) + v.__inc;
    else if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
};
const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const exists = () => { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; return e; };

export function makeDb(initial = {}) {
  const colls = new Map();
  const C = (n) => (colls.has(n) ? colls.get(n) : (colls.set(n, new Map()), colls.get(n)));
  Object.entries(initial).forEach(([n, docs]) => Object.entries(docs).forEach(([id, d]) => C(n).set(id, clone(d))));

  const ref = (name, id) => ({
    id, _name: name,
    get: async () => ({ id, exists: C(name).has(id), data: () => clone(C(name).get(id)), ref: ref(name, id) }),
    set: async (d, o) => { C(name).set(id, o?.merge ? merge(C(name).get(id) || {}, d) : merge({}, d)); },
    create: async (d) => { if (C(name).has(id)) throw exists(); C(name).set(id, merge({}, d)); },
    update: async (p) => { if (!C(name).has(id)) throw new Error("NOT_FOUND"); C(name).set(id, merge(C(name).get(id), p)); },
    delete: async () => { C(name).delete(id); },
    collection: (sub) => query(`${name}/${id}/${sub}`),
  });
  const query = (name, filters = [], lim = 1e9) => {
    const rows = () => [...C(name).entries()].filter(([, d]) => filters.every(([f, v]) => getPath(d, f) === v)).slice(0, lim);
    return {
      where: (f, op, v) => { if (op !== "==") throw new Error("fake db: only == supported"); return query(name, [...filters, [f, v]], lim); },
      limit: (n) => query(name, filters, n),
      count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
      get: async () => { const docs = rows().map(([id, d]) => ({ id, data: () => clone(d), ref: ref(name, id) })); return { docs, empty: !docs.length }; },
      doc: (id) => ref(name, id),
      add: async (d) => { const id = `auto${C(name).size}`; C(name).set(id, merge({}, d)); return ref(name, id); },
    };
  };
  const db = {
    collection: (n) => query(n),
    batch: () => {
      const ops = [];
      return {
        create: (r, d) => ops.push({ r, d }), set: (r, d) => ops.push({ r, d }),
        commit: async () => { if (ops.some(({ r }) => C(r._name).has(r.id))) throw exists(); ops.forEach(({ r, d }) => C(r._name).set(r.id, merge({}, d))); },
      };
    },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: (r) => r.get(), set: (r, d, o) => writes.push(() => r.set(d, o)), update: (r, p) => writes.push(() => r.update(p)) };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
    // test helpers
    _get: (n, id) => (C(n).has(id) ? clone(C(n).get(id)) : undefined),
    _all: (n) => [...C(n).entries()].map(([id, d]) => ({ id, ...clone(d) })),
  };
  return db;
}
export const inc = (n) => ({ __inc: n });

export function callJson(handler, { method = "GET", headers = {}, query = {}, body } = {}) {
  return new Promise(async (resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { let j = b; try { j = JSON.parse(b); } catch { /* text */ } resolve({ code: this.statusCode, body: j, raw: b, headers: this.headers }); } };
    await handler({ method, headers, query, body }, res);
  });
}
