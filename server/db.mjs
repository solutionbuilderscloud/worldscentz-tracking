// Banco de dados do WORLD SCENTZ TRACKING (SQLite embutido no Node, arquivo em data/worldscentz.db).
//
// Tabelas:
//   shipments  -> cada B/L / tracker, com os campos editados pela equipe e o retorno bruto da MSC
//   units      -> containers físicos de cada B/L (permite achar um B/L pelo nº do container)
//   products      -> produtos lançados pela equipe (simulados não são gravados)
//   log        -> registro de tudo que acontece (cadastro, edição, liberação, chegada, sincronização)
//
// status: 'active' = em rota · 'arrived' = já chegou no barracão (histórico)

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DB_PATH = process.env.WORLDSCENTZ_DB || path.join(root, 'data/worldscentz.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS shipments (
    tracker        TEXT PRIMARY KEY,
    country        TEXT NOT NULL DEFAULT 'PY',
    carrier        TEXT,
    content        TEXT NOT NULL DEFAULT 'Produtos',
    origin         TEXT,
    port           TEXT,
    destination    TEXT NOT NULL DEFAULT 'ASU',
    departure      TEXT,
    port_eta       TEXT,
    eta            TEXT,
    released       INTEGER NOT NULL DEFAULT 0,
    released_at    TEXT,
    vessel         TEXT,
    truck          TEXT,
    notes          TEXT,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'arrived')),
    arrived_at     TEXT,
    msc            TEXT,              -- JSON bruto da MSC (MscBl)
    synced_at      TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ship_status ON shipments(status, arrived_at);

  CREATE TABLE IF NOT EXISTS units (
    number    TEXT NOT NULL,
    tracker   TEXT NOT NULL REFERENCES shipments(tracker) ON DELETE CASCADE ON UPDATE CASCADE,
    type      TEXT,
    pod_eta   TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (number, tracker)
  );
  CREATE INDEX IF NOT EXISTS idx_units_number ON units(number);

  CREATE TABLE IF NOT EXISTS products (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker  TEXT NOT NULL REFERENCES shipments(tracker) ON DELETE CASCADE ON UPDATE CASCADE,
    brand    TEXT, model TEXT, size TEXT, category TEXT,
    qty      INTEGER NOT NULL DEFAULT 0,
    unit_kg  REAL NOT NULL DEFAULT 0,
    units    TEXT                      -- JSON: containers onde está
  );
  CREATE INDEX IF NOT EXISTS idx_products_tracker ON products(tracker);

  CREATE TABLE IF NOT EXISTS log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker TEXT NOT NULL,
    at      TEXT NOT NULL DEFAULT (datetime('now')),
    kind    TEXT NOT NULL,
    detail  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_log_tracker ON log(tracker, at);
`)

/* ---------- migrações (colunas novas em bancos já existentes) ---------- */
{
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  const add = (t, n, def) => { if (!cols(t).includes(n)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${n} ${def}`) }
  add('shipments', 'customs', 'TEXT')   // JSON: etapas do despacho { etapa: { at, by, value } }
  add('shipments', 'costs', 'TEXT')     // JSON: custos em USD { freight, taxes, broker, truck, other, demurragePaid }
  add('shipments', 'land', 'TEXT')      // JSON: caminhão { company, plate, driver, phone, eta }
  add('shipments', 'free_days', 'INTEGER') // free time específico deste B/L (senão usa o padrão do país)
  add('shipments', 'receipt', 'TEXT')   // JSON: conferência no barracão
  add('log', 'by', 'TEXT')              // quem fez
}
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- cada atualização com a MSC (automática ou manual)
  CREATE TABLE IF NOT EXISTS msc_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    trigger     TEXT NOT NULL,          -- auto | manual | novo-bl | terminal
    total       INTEGER NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 0,
    failed      TEXT,                   -- JSON: [{ bl, reason }]
    changes     TEXT,                   -- JSON: [{ tracker, kind, text }]
    status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker     TEXT NOT NULL REFERENCES shipments(tracker) ON DELETE CASCADE ON UPDATE CASCADE,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    mime        TEXT,
    size        INTEGER,
    file        TEXT NOT NULL,
    by          TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_docs_tracker ON documents(tracker);

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'despachante', 'barracao', 'diretoria')),
    pass_hash  TEXT NOT NULL,
    salt       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`)

/* ---------- configurações ---------- */
export const DEFAULT_SETTINGS = {
  freeDays: { PY: 14 },                 // dias livres no porto (contados da descarga)
  demurrageUsd: { PY: 100 },    // USD por container por dia depois do free time
  capacity: { ASU: 700, CDE: 300 }, // containers por barracão
  mscAutoSync: true,
  mscSyncTimes: [7, 13, 19],             // horários do dia em que atualiza com a MSC
  mscNotify: true,                       // aviso no Mac quando a MSC trouxer novidade
}
export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const out = structuredClone(DEFAULT_SETTINGS)
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value) } catch { /* */ } }
  return out
}
export function setSettings(patch) {
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (let [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue
    if (k === 'mscSyncTimes') v = [...new Set((Array.isArray(v) ? v : []).map((h) => h | 0).filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b)
    ins.run(k, JSON.stringify(v))
  }
  return getSettings()
}

export function tx(fn) {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}

export function addLog(tracker, kind, detail, by) {
  db.prepare('INSERT INTO log (tracker, kind, detail, by) VALUES (?, ?, ?, ?)').run(tracker, kind, detail == null ? null : JSON.stringify(detail), by ?? null)
}

const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }


const EVENT_PT = {
  'Empty to Shipper': 'Vazio entregue ao embarcador', 'Export received at CY': 'Recebido no terminal de origem',
  'Export Loaded on Vessel': 'Embarcado no navio', 'Full Transshipment Discharged': 'Descarregado para transbordo',
  'Full Transshipment Loaded': 'Embarcado no transbordo', 'Import Discharged from Vessel': 'Descarregado no porto final',
  'Discharged': 'Descarregado', 'Import to consignee': 'Entregue ao importador', 'Empty received at CY': 'Vazio devolvido',
  'Gate out': 'Saiu do terminal', 'Empty received at rail ramp': 'Vazio recebido (ferrovia)',
}
const PLANNED = new Set(['Estimated Time of Arrival', 'Full Intended Transshipment'])
const evKey = (u, e) => `${u}|${e.desc}|${e.loc}|${e.d}`

/** O que a MSC trouxe de novo para um B/L (eventos que aconteceram, ETA, navio, entrega). */
export function mscChanges(prev, next) {
  if (!prev?.units) return []
  const today = new Date().toISOString().slice(0, 10)
  const old = new Set(prev.units.flatMap((u) => u.events.map((e) => evKey(u.n, e))))
  const fresh = new Map()
  for (const u of next.units) for (const e of u.events) {
    if (PLANNED.has(e.desc) || e.d > today || old.has(evKey(u.n, e))) continue
    const k = `${e.desc}|${e.loc}`
    const g = fresh.get(k) ?? { desc: e.desc, loc: e.loc, name: e.name, d: e.d, vessel: e.vessel, units: 0 }
    g.units++; if (e.d > g.d) g.d = e.d
    fresh.set(k, g)
  }
  const out = [...fresh.values()].map((g) => ({
    kind: 'msc_event', detail: { desc: g.desc, text: EVENT_PT[g.desc] ?? g.desc, place: String(g.name || g.loc).split(',')[0], at: g.d, units: g.units, vessel: g.vessel || null },
  }))
  if (next.podEta && prev.podEta && next.podEta !== prev.podEta) out.push({ kind: 'eta_changed', detail: { from: prev.podEta, to: next.podEta } })
  if (next.delivered && !prev.delivered) out.push({ kind: 'msc_delivered', detail: null })
  return out
}

/** Grava/atualiza um B/L vindo da MSC sem apagar o que a equipe editou. Devolve o que mudou. */
export function upsertMsc(bl, fetchedAt) {
  if (!bl || bl.error || !bl.units?.length) return null
  const exists = db.prepare('SELECT tracker, status, port_eta, customs, msc FROM shipments WHERE tracker = ?').get(bl.bl)
  const raw = JSON.stringify(bl)
  let changes = []
  if (exists) {
    const prev = parse(exists.msc, null)
    changes = mscChanges(prev ?? { podEta: exists.port_eta, units: [] }, bl).filter((c) => prev || c.kind === 'eta_changed')
    db.prepare('UPDATE shipments SET msc = ?, port_eta = ?, synced_at = ?, carrier = \'MSC\', updated_at = datetime(\'now\') WHERE tracker = ?')
      .run(raw, bl.podEta || null, bl.fetchedAt || fetchedAt, bl.bl)
    for (const c of changes) addLog(bl.bl, c.kind, c.detail, 'MSC')
    // descarga no porto final -> começa a contar o free time
    const dis = bl.units.flatMap((u) => u.events).filter((e) => e.loc === bl.podCode && /Import Discharged|Discharged from Vessel/i.test(e.desc) && e.d <= new Date().toISOString().slice(0, 10))
      .map((e) => e.d).sort()[0]
    const cu = parse(exists.customs, {})
    if (dis && !cu.port_arrival) {
      cu.port_arrival = { at: dis, by: 'MSC' }
      db.prepare('UPDATE shipments SET customs = ? WHERE tracker = ?').run(JSON.stringify(cu), bl.bl)
      addLog(bl.bl, 'customs', { step: 'port_arrival', at: dis }, 'MSC')
    }
  } else {
    db.prepare(`INSERT INTO shipments (tracker, country, carrier, port, port_eta, msc, synced_at, destination)
                VALUES (?, ?, 'MSC', ?, ?, ?, ?, ?)`)
      .run(bl.bl, 'PY', bl.podCode || null, bl.podEta || null, raw, fetchedAt, bl.podCode?.startsWith('PY') ? 'ASU' : 'CDE')
    addLog(bl.bl, 'created', { source: 'MSC', units: bl.units.length })
    changes = [{ kind: 'created', detail: { units: bl.units.length } }]
  }
  db.prepare('DELETE FROM units WHERE tracker = ?').run(bl.bl)
  const ins = db.prepare('INSERT OR REPLACE INTO units (number, tracker, type, pod_eta, delivered) VALUES (?, ?, ?, ?, ?)')
  for (const u of bl.units) ins.run(u.n, bl.bl, u.type, u.podEta || null, u.delivered ? 1 : 0)
  return { added: !exists, changes }
}

/** Importa o arquivo src/msc-data.json (gerado pelo npm run msc:sync). `only` = só estes B/Ls. */
export function importMscFile(file = path.join(root, 'src/msc-data.json'), only) {
  if (!fs.existsSync(file)) return { added: 0, updated: 0, changes: [] }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  let added = 0, updated = 0
  const changes = []
  tx(() => {
    for (const bl of data.bls ?? []) {
      if (only && !only.has(bl.bl)) continue
      const r = upsertMsc(bl, data.fetchedAt)
      if (!r) continue
      if (r.added) added++; else updated++
      for (const c of r.changes) changes.push({ tracker: bl.bl, kind: c.kind, text: changeText(c) })
    }
  })
  return { added, updated, changes, fetchedAt: data.fetchedAt }
}

export function changeText(c) {
  const d = c.detail ?? {}
  const day = (s) => String(s ?? '').split('-').reverse().slice(0, 2).join('/')
  if (c.kind === 'msc_event') return `${d.text} — ${d.place} · ${d.units} ctr · ${day(d.at)}`
  if (c.kind === 'eta_changed') return `Chegada mudou de ${day(d.from)} para ${day(d.to)}`
  if (c.kind === 'msc_delivered') return 'MSC marcou como entregue'
  if (c.kind === 'created') return `Novo B/L com ${d.units} containers`
  return c.kind
}

/* ---------- histórico das atualizações da MSC ---------- */
export function startRun(trigger, total) {
  return db.prepare("INSERT INTO msc_runs (started_at, trigger, total) VALUES (datetime('now'), ?, ?)").run(trigger, total).lastInsertRowid
}
export function finishRun(id, { ok, failed = [], changes = [], error }) {
  const status = error ? 'error' : failed.length ? (ok ? 'partial' : 'error') : 'ok'
  db.prepare("UPDATE msc_runs SET finished_at = datetime('now'), ok = ?, failed = ?, changes = ?, status = ?, error = ? WHERE id = ?")
    .run(ok, JSON.stringify(failed), JSON.stringify(changes.slice(0, 300)), status, error ?? null, id)
}
export function listRuns(limit = 15) {
  // execuções que ficaram "running" por mais de 30 min morreram no meio
  db.prepare("UPDATE msc_runs SET status = 'error', error = COALESCE(error, 'Interrompida'), finished_at = COALESCE(finished_at, datetime('now')) WHERE status = 'running' AND started_at < datetime('now', '-30 minutes')").run()
  return db.prepare('SELECT * FROM msc_runs ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({
    id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, trigger: r.trigger, total: r.total, ok: r.ok,
    failed: parse(r.failed, []), changes: parse(r.changes, []), status: r.status, error: r.error,
  }))
}
export const lastGoodRun = () => db.prepare("SELECT started_at FROM msc_runs WHERE status IN ('ok', 'partial') ORDER BY id DESC LIMIT 1").get()?.started_at ?? null

/** B/Ls que devem ser consultados na MSC: os ativos da MSC + os da lista data/trackers.txt que não chegaram. */
export function trackersToSync({ includeArrived = false } = {}) {
  const rows = db.prepare('SELECT tracker, status, carrier FROM shipments').all()
  const byT = new Map(rows.map((r) => [r.tracker, r]))
  const isMsc = (t) => /^(MEDU|MSCU|MSDU|MSMU|MSNU|MSBU)[A-Z0-9]{6,}$/.test(t)
  const set = new Set(rows.filter((r) => (includeArrived || r.status === 'active') && (r.carrier === 'MSC' || isMsc(r.tracker))).map((r) => r.tracker))
  const list = path.join(root, 'data/trackers.txt')
  if (fs.existsSync(list)) for (const t of fs.readFileSync(list, 'utf8').split(/\s+/).map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    const r = byT.get(t)
    if (!r || includeArrived || r.status === 'active') set.add(t)
  }
  return [...set]
}

/* ---------- leitura no formato que o app usa ---------- */

export function rowToShipment(r) {
  const products = db.prepare('SELECT brand, model, size, category, qty, unit_kg, units FROM products WHERE tracker = ? ORDER BY id').all(r.tracker)
    .map((t) => ({ brand: t.brand ?? '', model: t.model ?? '', size: t.size ?? '', category: t.category ?? 'Carga', qty: t.qty, unitKg: t.unit_kg, units: parse(t.units, undefined) }))
  return {
    id: r.tracker,
    tracker: r.tracker,
    country: r.country,
    carrier: r.carrier || undefined,
    content: r.content,
    origin: r.origin || undefined,
    port: r.port || undefined,
    destination: r.destination,
    departure: r.departure || undefined,
    portEta: r.port_eta || undefined,
    eta: r.eta || undefined,
    released: !!r.released,
    releasedAt: r.released_at || undefined,
    vessel: r.vessel || '',
    truck: r.truck || undefined,
    notes: r.notes || undefined,
    status: r.status,
    arrivedAt: r.arrived_at || undefined,
    msc: parse(r.msc, undefined),
    syncedAt: r.synced_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    products,
    customs: parse(r.customs, {}),
    costs: parse(r.costs, {}),
    land: parse(r.land, {}),
    freeDays: r.free_days ?? undefined,
    receipt: parse(r.receipt, undefined),
    docs: db.prepare('SELECT id, kind, name, mime, size, by, uploaded_at FROM documents WHERE tracker = ? ORDER BY id').all(r.tracker)
      .map((d) => ({ id: d.id, kind: d.kind, name: d.name, mime: d.mime, size: d.size, by: d.by, at: d.uploaded_at })),
  }
}

export function getShipment(tracker) {
  const r = db.prepare('SELECT * FROM shipments WHERE tracker = ?').get(tracker)
  return r ? rowToShipment(r) : null
}

export function listShipments(status) {
  const rows = status
    ? db.prepare(`SELECT * FROM shipments WHERE status = ? ORDER BY ${status === 'arrived' ? 'arrived_at DESC' : 'port_eta ASC, tracker'}`).all(status)
    : db.prepare('SELECT * FROM shipments ORDER BY port_eta, tracker').all()
  return rows.map(rowToShipment)
}

/** Salva os campos editáveis + produtos de um B/L (cria se não existir). */
export function saveShipment(s, { create = false, by } = {}) {
  const prev = db.prepare('SELECT * FROM shipments WHERE tracker = ?').get(s.tracker)
  if (create && prev) throw Object.assign(new Error('Já existe um container com esse tracker.'), { status: 409 })
  if (!create && !prev) throw Object.assign(new Error('Tracker não encontrado.'), { status: 404 })
  tx(() => {
    if (!prev) {
      db.prepare('INSERT INTO shipments (tracker, country) VALUES (?, ?)').run(s.tracker, s.country || 'PY')
      addLog(s.tracker, 'created', { source: 'manual' }, by)
    }
    const releasedNow = !!s.released && !(prev?.released)
    db.prepare(`UPDATE shipments SET country = ?, content = ?, origin = ?, port = ?, destination = ?, departure = ?, port_eta = ?, eta = ?,
                released = ?, released_at = CASE WHEN ? THEN datetime('now') WHEN ? = 0 THEN NULL ELSE released_at END,
                vessel = ?, truck = ?, notes = ?, updated_at = datetime('now') WHERE tracker = ?`)
      .run(s.country || 'PY', s.content || 'Produtos', s.origin ?? null, s.port ?? null, s.destination || 'ASU', s.departure ?? null,
        s.portEta ?? null, s.eta ?? null, s.released ? 1 : 0, releasedNow ? 1 : 0, s.released ? 1 : 0,
        s.vessel ?? null, s.truck ?? null, s.notes ?? null, s.tracker)
    if (prev && !!prev.released !== !!s.released) addLog(s.tracker, s.released ? 'released' : 'release_revoked', null, by)
    if (Array.isArray(s.products) && !s.productsSimulated) {
      const before = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty),0) q FROM products WHERE tracker = ?').get(s.tracker)
      db.prepare('DELETE FROM products WHERE tracker = ?').run(s.tracker)
      const ins = db.prepare('INSERT INTO products (tracker, brand, model, size, category, qty, unit_kg, units) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      let q = 0
      for (const t of s.products) { ins.run(s.tracker, t.brand, t.model, t.size, t.category, t.qty | 0, +t.unitKg || 0, t.units ? JSON.stringify(t.units) : null); q += t.qty | 0 }
      if (before.q !== q || before.n !== s.products.length) addLog(s.tracker, 'products_updated', { items: s.products.length, qty: q, source: s.productsSource }, by)
    }
    if (prev) {
      const changed = ['destination', 'eta', 'truck', 'notes', 'content'].filter((k) => (prev[k === 'eta' ? 'eta' : k] ?? null) !== (s[k] ?? null))
      if (changed.length) addLog(s.tracker, 'updated', { fields: changed }, by)
    }
  })
  return getShipment(s.tracker)
}

export function setArrived(tracker, arrived, at, by) {
  const prev = db.prepare('SELECT status FROM shipments WHERE tracker = ?').get(tracker)
  if (!prev) throw Object.assign(new Error('Tracker não encontrado.'), { status: 404 })
  if (arrived) {
    db.prepare("UPDATE shipments SET status = 'arrived', arrived_at = COALESCE(?, datetime('now')), updated_at = datetime('now') WHERE tracker = ?").run(at ?? null, tracker)
    if (prev.status !== 'arrived') addLog(tracker, 'arrived', { at: at ?? null }, by)
  } else {
    db.prepare("UPDATE shipments SET status = 'active', arrived_at = NULL, updated_at = datetime('now') WHERE tracker = ?").run(tracker)
    if (prev.status !== 'active') addLog(tracker, 'reopened', null, by)
  }
  return getShipment(tracker)
}

export function deleteShipment(tracker, by) {
  const r = db.prepare('DELETE FROM shipments WHERE tracker = ?').run(tracker)
  if (r.changes) addLog(tracker, 'deleted', null, by)
  return r.changes > 0
}

export function getLog(tracker) {
  return db.prepare('SELECT at, kind, detail, by FROM log WHERE tracker = ? ORDER BY id DESC').all(tracker).map((l) => ({ ...l, detail: parse(l.detail) }))
}

/** Últimos acontecimentos de todos os B/Ls (para alertas e relatórios). */
export function recentLog(days = 30) {
  return db.prepare(`SELECT tracker, at, kind, detail, by FROM log WHERE at >= datetime('now', ?) ORDER BY id DESC LIMIT 500`).all(`-${days | 0} days`)
    .map((l) => ({ ...l, detail: parse(l.detail) }))
}

/* ---------- operação: despacho, custos, caminhão, free time, recebimento ---------- */
export const CUSTOMS_STEPS = ['port_arrival', 'docs_delivered', 'channel', 'taxes_paid', 'released', 'pickup']

export function updateOps(tracker, patch, by) {
  const prev = db.prepare('SELECT * FROM shipments WHERE tracker = ?').get(tracker)
  if (!prev) throw Object.assign(new Error('Tracker não encontrado.'), { status: 404 })
  tx(() => {
    if (patch.customs) {
      const cu = parse(prev.customs, {})
      for (const [step, v] of Object.entries(patch.customs)) {
        if (!CUSTOMS_STEPS.includes(step)) continue
        if (v == null) delete cu[step]
        else cu[step] = { at: String(v.at || new Date().toISOString().slice(0, 10)).slice(0, 10), by: by ?? null, ...(v.value ? { value: String(v.value) } : {}) }
        addLog(tracker, 'customs', { step, at: cu[step]?.at ?? null, value: cu[step]?.value ?? null, cleared: v == null }, by)
        if (step === 'released') {
          db.prepare(`UPDATE shipments SET released = ?, released_at = ? WHERE tracker = ?`).run(v ? 1 : 0, v ? cu[step].at : null, tracker)
        }
      }
      db.prepare('UPDATE shipments SET customs = ? WHERE tracker = ?').run(JSON.stringify(cu), tracker)
    }
    if (patch.costs) {
      const co = { ...parse(prev.costs, {}) }
      for (const k of ['freight', 'taxes', 'broker', 'truck', 'storage', 'other', 'demurragePaid']) if (k in patch.costs) co[k] = Math.max(0, +patch.costs[k] || 0)
      db.prepare('UPDATE shipments SET costs = ? WHERE tracker = ?').run(JSON.stringify(co), tracker)
      addLog(tracker, 'costs_updated', { total: Object.values(co).reduce((a, x) => a + x, 0) }, by)
    }
    if (patch.land) {
      const la = { ...parse(prev.land, {}) }
      for (const k of ['company', 'plate', 'driver', 'phone', 'eta']) if (k in patch.land) la[k] = String(patch.land[k] ?? '').slice(0, 120)
      db.prepare('UPDATE shipments SET land = ?, truck = COALESCE(NULLIF(?, \'\'), truck), eta = COALESCE(NULLIF(?, \'\'), eta) WHERE tracker = ?')
        .run(JSON.stringify(la), la.plate ?? '', la.eta ?? '', tracker)
      addLog(tracker, 'truck_updated', { plate: la.plate || null, company: la.company || null }, by)
    }
    if ('freeDays' in patch) {
      const v = patch.freeDays === '' || patch.freeDays == null ? null : Math.max(0, patch.freeDays | 0)
      db.prepare('UPDATE shipments SET free_days = ? WHERE tracker = ?').run(v, tracker)
      addLog(tracker, 'updated', { fields: ['free time'] }, by)
    }
    if (patch.receipt) {
      const r = patch.receipt
      const receipt = { at: String(r.at || new Date().toISOString().slice(0, 10)).slice(0, 10), by: by ?? null, notes: String(r.notes ?? '').slice(0, 2000),
        units: (r.units ?? []).map((u) => ({ n: String(u.n), ok: !!u.ok, missing: Math.max(0, u.missing | 0), damaged: Math.max(0, u.damaged | 0), note: String(u.note ?? '').slice(0, 300) })) }
      db.prepare('UPDATE shipments SET receipt = ? WHERE tracker = ?').run(JSON.stringify(receipt), tracker)
      const miss = receipt.units.reduce((a, u) => a + u.missing, 0), dmg = receipt.units.reduce((a, u) => a + u.damaged, 0)
      addLog(tracker, 'received', { units: receipt.units.length, missing: miss, damaged: dmg }, by)
    }
    db.prepare("UPDATE shipments SET updated_at = datetime('now') WHERE tracker = ?").run(tracker)
  })
  return getShipment(tracker)
}

/* ---------- documentos ---------- */
export const DOCS_DIR = path.join(path.dirname(DB_PATH), 'docs')
export function addDocument(tracker, { kind, name, mime, data }, by) {
  if (!db.prepare('SELECT 1 FROM shipments WHERE tracker = ?').get(tracker)) throw Object.assign(new Error('Tracker não encontrado.'), { status: 404 })
  const dir = path.join(DOCS_DIR, tracker.replace(/[^A-Z0-9_-]/gi, '_'))
  fs.mkdirSync(dir, { recursive: true })
  const safe = String(name).replace(/[^\w.\- ]+/g, '_').slice(-120) || 'arquivo'
  const file = path.join(dir, `${Date.now()}_${safe}`)
  fs.writeFileSync(file, data)
  const r = db.prepare('INSERT INTO documents (tracker, kind, name, mime, size, file, by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(tracker, kind, safe, mime || 'application/octet-stream', data.length, path.relative(DOCS_DIR, file), by ?? null)
  addLog(tracker, 'doc_added', { kind, name: safe }, by)
  return r.lastInsertRowid
}
export function getDocument(id) {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(id)
  if (!d) return null
  const file = path.resolve(DOCS_DIR, d.file)
  if (!file.startsWith(path.resolve(DOCS_DIR) + path.sep)) return null
  return { ...d, path: file }
}
export function removeDocument(id, by) {
  const d = getDocument(id)
  if (!d) return false
  db.prepare('DELETE FROM documents WHERE id = ?').run(id)
  try { fs.unlinkSync(d.path) } catch { /* */ }
  addLog(d.tracker, 'doc_removed', { kind: d.kind, name: d.name }, by)
  return true
}

export function findByUnit(number) {
  return db.prepare('SELECT u.tracker, u.number, s.status FROM units u JOIN shipments s USING (tracker) WHERE u.number LIKE ? LIMIT 20').all(`%${number}%`)
}

export function stats() {
  return {
    active: db.prepare("SELECT COUNT(*) n FROM shipments WHERE status = 'active'").get().n,
    arrived: db.prepare("SELECT COUNT(*) n FROM shipments WHERE status = 'arrived'").get().n,
    units: db.prepare('SELECT COUNT(*) n FROM units').get().n,
  }
}
