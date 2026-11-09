// Supabase (Postgres) persistence for the in-memory data model.
// Reads everything once at start (ws_dump) and, after each change, sends only the
// rows that changed (ws_sync), applied in a single database transaction.
// Uses the service-role / secret key: keep it on the server, never in the browser.

const { toRows, fromTables, KEYS } = require('./mapping');

class SupabaseStore {
  constructor({ url, key }) {
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    if (key.startsWith('sb_publishable_')) throw new Error('SUPABASE_SERVICE_KEY is the publishable (public) key. Use the Secret key (sb_secret_...) from Project Settings → API Keys.');
    this.url = url.replace(/\/+$/, '');
    this.key = key;
    this.snapshot = new Map(); // table -> Map(keyString -> { json, row })
    this.kind = 'supabase';
  }

  async rpc(fn, body) {
    const headers = { apikey: this.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.key.startsWith('eyJ')) headers.Authorization = `Bearer ${this.key}`; // legacy JWT keys
    let res;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new Error(`Database unreachable (${e.cause?.code || e.name}: ${e.message})`);
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.hint)) || text || res.statusText;
      const err = new Error(`Database error: ${msg}`);
      err.dbStatus = res.status;
      throw err;
    }
    return data;
  }

  snap(rows) {
    const s = new Map();
    for (const [table, list] of Object.entries(rows)) {
      const m = new Map();
      for (const row of list) m.set(KEYS[table].map((k) => String(row[k])).join('\u0001'), { json: JSON.stringify(row), row });
      s.set(table, m);
    }
    return s;
  }

  /** Returns the stored data, or null when the database has no data yet. */
  async load() {
    const tables = await this.rpc('ws_dump');
    // every table the app writes must exist, or ws_sync would skip it and lose data
    const missing = Object.keys(KEYS).filter((t) => !(t in (tables || {})));
    if (missing.length) throw new Error(`The Supabase database is missing table(s): ${missing.join(', ')}. Run the newest file in supabase/migrations/ first.`);
    this.tables = new Set(Object.keys(tables));
    if (!tables || !tables.settings || !tables.settings.some((s) => s.key === 'meta')) {
      this.snapshot = new Map();
      return null;
    }
    const db = fromTables(tables);
    this.snapshot = this.snap(toRows(db));
    return db;
  }

  /** Writes rows that changed since the last load/flush. Returns the number of rows sent. */
  async flush(db) {
    const next = this.snap(toRows(db));
    const upserts = {};
    const deletes = {};
    let count = 0;
    for (const [table, rows] of next) {
      if (this.tables && !this.tables.has(table)) throw new Error(`Database table ${table} does not exist – run the newest migration`);
      const prev = this.snapshot.get(table) || new Map();
      const up = [];
      for (const [k, v] of rows) if (!prev.has(k) || prev.get(k).json !== v.json) up.push(v.row);
      const del = [];
      for (const [k, v] of prev) if (!rows.has(k)) del.push(Object.fromEntries(KEYS[table].map((c) => [c, v.row[c]])));
      if (up.length) upserts[table] = up;
      if (del.length) deletes[table] = del;
      count += up.length + del.length;
    }
    if (!count) return 0;
    await this.rpc('ws_sync', { changes: { upserts, deletes } });
    this.snapshot = next;
    return count;
  }
}

module.exports = SupabaseStore;
