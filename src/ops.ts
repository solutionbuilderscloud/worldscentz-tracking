// Regras da operação: free time/demurrage, alertas, despacho, documentos, custos e leitura de packing list.
import {
  DAY, parseDate, isoDay, track, unitCount, productQty, PRODUCT_CATEGORIES,
  type Container, type Country, type CustomsStep, type ProductItem, type ProductCategory, type Costs,
} from './data'

/* ---------- configurações ---------- */
export interface Settings {
  freeDays: Record<Country, number>
  demurrageUsd: Record<Country, number>
  capacity: Record<string, number>
  mscAutoSync: boolean
  mscSyncTimes: number[]
  mscNotify: boolean
}
export const DEFAULT_SETTINGS: Settings = {
  freeDays: { PY: 14 }, demurrageUsd: { PY: 100 }, capacity: { ASU: 700, CDE: 300 }, mscAutoSync: true, mscSyncTimes: [7, 13, 19], mscNotify: true,
}

/* ---------- usuários ---------- */
export type Role = 'admin' | 'despachante' | 'barracao' | 'diretoria'
export interface User { id: number; username: string; name: string; role: Role; active: boolean }
export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', despachante: 'Despachante', barracao: 'Barracão', diretoria: 'Diretoria' }
export const ROLE_HINT: Record<Role, string> = {
  admin: 'Tudo, inclusive usuários, configurações e backup',
  despachante: 'Edita B/Ls, despacho, documentos, custos e caminhões',
  barracao: 'Confirma chegada e faz a conferência no barracão',
  diretoria: 'Só consulta: painel, relatórios e histórico',
}
const CAN = { edit: ['admin', 'despachante'], receive: ['admin', 'despachante', 'barracao'], sync: ['admin', 'despachante'], admin: ['admin'] }
export type Action = keyof typeof CAN
export const can = (u: User | null | undefined, a: Action) => !!u && CAN[a].includes(u.role)

/* ---------- despacho aduaneiro ---------- */
export const CUSTOMS_STEPS: { k: CustomsStep; label: string; hint: string }[] = [
  { k: 'port_arrival', label: 'Chegou ao porto', hint: 'Descarga no porto final — começa o free time' },
  { k: 'docs_delivered', label: 'Documentos com o despachante', hint: 'Fatura, packing list, B/L e certificado entregues' },
  { k: 'channel', label: 'Canal de conferência', hint: 'Verde, amarelo, vermelho ou cinza' },
  { k: 'taxes_paid', label: 'Impostos pagos', hint: 'Tributos de importação quitados' },
  { k: 'released', label: 'Liberado pela aduana', hint: 'Mercadoria desembaraçada' },
  { k: 'pickup', label: 'Retirado do porto', hint: 'Saiu no caminhão — para o free time' },
]
export const CHANNELS: Record<string, string> = { verde: '#1E9E5A', amarelo: '#E8A317', vermelho: '#F00000', cinza: '#8A8A8A' }

export function customsProgress(c: Container) {
  const cu = c.customs ?? {}
  const done = CUSTOMS_STEPS.filter((s) => (s.k === 'released' ? c.released || cu.released : cu[s.k])).length
  const next = CUSTOMS_STEPS.find((s) => !(s.k === 'released' ? c.released || cu.released : cu[s.k]))
  return { done, total: CUSTOMS_STEPS.length, next }
}

/* ---------- documentos ---------- */
export const DOC_KINDS: { k: string; label: string; required: boolean }[] = [
  { k: 'invoice', label: 'Fatura comercial', required: true },
  { k: 'packing', label: 'Packing list', required: true },
  { k: 'bl', label: 'B/L original', required: true },
  { k: 'origin', label: 'Certificado de origem', required: true },
  { k: 'customs', label: 'Despacho / DI', required: true },
  { k: 'photo', label: 'Fotos da conferência', required: false },
  { k: 'other', label: 'Outro', required: false },
]
export const docLabel = (k: string) => DOC_KINDS.find((d) => d.k === k)?.label ?? k
export const missingDocs = (c: Container) => DOC_KINDS.filter((d) => d.required && !(c.docs ?? []).some((x) => x.kind === d.k))

/* ---------- free time / demurrage ---------- */
export type FreeState = 'pending' | 'ok' | 'warn' | 'over' | 'closed'
export interface FreeTime {
  state: FreeState
  days: number          // dias livres combinados
  start: string         // início (descarga no porto)
  end: string           // último dia livre
  estimated: boolean    // início estimado (sem descarga confirmada)
  left: number          // dias livres restantes (negativo = em demurrage)
  over: number          // dias de demurrage
  rate: number          // USD por container por dia
  cost: number          // USD (over × rate × containers)
}

export function freeTime(c: Container, s: Settings, now = Date.now()): FreeTime {
  const days = c.freeDays ?? s.freeDays[c.country] ?? 14
  const rate = s.demurrageUsd[c.country] ?? 0
  const actual = c.customs?.port_arrival?.at
  const start = actual ?? c.portEta
  const end = isoDay(parseDate(start) + (days - 1) * DAY)
  const stopAt = c.customs?.pickup?.at ?? (c.status === 'arrived' ? (c.arrivedAt ?? '').slice(0, 10) : '')
  const base = { days, start, end, estimated: !actual, rate }
  if (!actual && now < parseDate(start)) return { ...base, state: 'pending', left: days, over: 0, cost: 0 }
  const until = stopAt ? parseDate(stopAt) : parseDate(isoDay(now))
  const used = Math.floor((until - parseDate(start)) / DAY) + 1
  const left = days - used
  const over = Math.max(0, -left)
  const cost = over * rate * unitCount(c)
  if (stopAt) return { ...base, state: 'closed', left, over, cost }
  return { ...base, state: left < 0 ? 'over' : left <= 3 ? 'warn' : 'ok', left, over, cost }
}

export const FREE_COLOR: Record<FreeState, string> = { pending: '#8A8A8A', ok: '#1E9E5A', warn: '#E8A317', over: '#F00000', closed: '#8A8A8A' }
export function freeText(f: FreeTime) {
  if (f.state === 'pending') return `${f.days} dias livres a partir da chegada`
  if (f.state === 'closed') return f.over ? `Retirado com ${f.over}d de demurrage` : 'Retirado dentro do free time'
  if (f.state === 'over') return `${f.over}d em demurrage`
  return f.left === 0 ? 'Último dia livre hoje' : `${f.left}d livres restantes`
}
export const usd = (n: number) => 'US$ ' + Math.round(n).toLocaleString('pt-BR')

/* ---------- custos ---------- */
export const COST_FIELDS: { k: keyof Costs; label: string }[] = [
  { k: 'freight', label: 'Frete marítimo' }, { k: 'taxes', label: 'Impostos' }, { k: 'broker', label: 'Despachante' },
  { k: 'truck', label: 'Caminhão' }, { k: 'storage', label: 'Armazenagem' }, { k: 'demurragePaid', label: 'Demurrage pago' }, { k: 'other', label: 'Outros' },
]
export const costTotal = (c: Container) => COST_FIELDS.reduce((a, f) => a + (c.costs?.[f.k] ?? 0), 0)

/* ---------- alertas ---------- */
export type AlertLevel = 'danger' | 'warn' | 'info'
export interface Alert { id: string; level: AlertLevel; title: string; text: string; tracker?: string; tab?: string; at?: number }
export interface LogRow { tracker: string; at: string; kind: string; detail: Record<string, unknown> | null; by?: string | null }
export interface SyncStatus {
  running: boolean; ok: boolean | null; message: string; done: number; total: number; trigger: string | null; trackers: string[] | null
  lastSyncAt: string | null; finishedAt: string | null; autoSync: boolean; syncTimes: number[]; nextAt: string | null; retrying: boolean
}
export interface SyncRun {
  id: number; startedAt: string; finishedAt: string | null; trigger: string; total: number; ok: number; status: 'running' | 'ok' | 'partial' | 'error'; error: string | null
  failed: { bl: string; reason: string }[]; changes: { tracker: string; kind: string; text: string }[]
}

export function buildAlerts(list: Container[], s: Settings, log: LogRow[], sync: SyncStatus | null, now = Date.now()): Alert[] {
  const out: Alert[] = []
  for (const c of list) {
    if (c.status === 'arrived') continue
    const f = freeTime(c, s, now)
    const t = track(c, now)
    const n = unitCount(c)
    if (f.state === 'over') out.push({ id: 'dem-' + c.tracker, level: 'danger', tracker: c.tracker, tab: 'ops', title: `Demurrage correndo · ${c.tracker}`, text: `${f.over} dia(s) após o free time · ${n} ctr · ${usd(f.cost)} até hoje (${usd(f.rate * n)}/dia)` })
    else if (f.state === 'warn') out.push({ id: 'ft-' + c.tracker, level: 'warn', tracker: c.tracker, tab: 'ops', title: `Free time acabando · ${c.tracker}`, text: `${f.left === 0 ? 'Hoje é o último dia livre' : `Faltam ${f.left} dia(s)`} · depois ${usd(f.rate * n)}/dia` })
    else if (t.stage === 'held' && !c.released) out.push({ id: 'held-' + c.tracker, level: 'warn', tracker: c.tracker, tab: 'ops', title: `No porto sem liberação · ${c.tracker}`, text: `${n} ctr aguardando a aduana · ${f.left}d de free time` })
    const daysToPort = Math.ceil((parseDate(c.portEta) - now) / DAY)
    const miss = missingDocs(c)
    if (miss.length && daysToPort <= 7) out.push({ id: 'doc-' + c.tracker, level: daysToPort <= 0 ? 'warn' : 'info', tracker: c.tracker, tab: 'docs', title: `Documentos faltando · ${c.tracker}`, text: `${miss.map((d) => d.label).join(', ')}${daysToPort > 0 ? ` · chega em ${daysToPort}d` : ''}` })
    if (daysToPort > 0 && daysToPort <= 2) out.push({ id: 'arr-' + c.tracker, level: 'info', tracker: c.tracker, tab: 'hist', title: `Chegando ao porto · ${c.tracker}`, text: `${n} ctr em ${daysToPort} dia(s)` })
  }
  for (const l of log) {
    if (l.kind !== 'eta_changed' || !l.detail) continue
    const at = new Date(l.at.replace(' ', 'T') + 'Z').getTime()
    if (now - at > 7 * DAY) continue
    const from = String(l.detail.from), to = String(l.detail.to)
    const diff = Math.round((parseDate(to) - parseDate(from)) / DAY)
    out.push({ id: `eta-${l.tracker}-${l.at}`, level: diff > 0 ? 'warn' : 'info', tracker: l.tracker, tab: 'hist', at,
      title: `MSC ${diff > 0 ? 'atrasou' : 'adiantou'} a chegada · ${l.tracker}`, text: `${fmtShort(from)} → ${fmtShort(to)} (${diff > 0 ? '+' : ''}${diff}d)` })
  }
  for (const l of log) {
    if (l.kind !== 'msc_event' && l.kind !== 'msc_delivered') continue
    const at = new Date(l.at.replace(' ', 'T') + 'Z').getTime()
    if (now - at > 36 * 3600e3) continue
    const d = l.detail ?? {}
    out.push({ id: `ev-${l.tracker}-${l.at}-${String(d.desc ?? l.kind)}`, level: 'info', tracker: l.tracker, tab: 'hist', at,
      title: `Novidade da MSC · ${l.tracker}`, text: l.kind === 'msc_delivered' ? 'MSC marcou como entregue' : `${d.text} — ${d.place} · ${d.units} ctr` })
  }
  if (sync && !sync.running) {
    if (sync.ok === false) out.push({ id: 'sync-fail', level: 'danger', title: 'A atualização da MSC falhou', text: sync.message })
    else if (sync.lastSyncAt && now - new Date(sync.lastSyncAt).getTime() > 36 * 3600e3)
      out.push({ id: 'sync-old', level: 'warn', title: 'Dados da MSC desatualizados', text: `Última atualização ${new Date(sync.lastSyncAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` })
  }
  // muitos avisos iguais viram um só (ex.: 20 B/Ls chegando no mesmo dia)
  const grouped: Alert[] = []
  const GROUPS: Record<string, (n: number) => string> = {
    'doc-': (n) => `Documentos faltando em ${n} B/Ls`,
    'arr-': (n) => `${n} B/Ls chegando ao porto em até 2 dias`,
    'ev-': (n) => `${n} novidades da MSC nas últimas horas`,
  }
  for (const a of out) {
    const g = Object.keys(GROUPS).find((k) => a.id.startsWith(k))
    const same = g ? out.filter((x) => x.id.startsWith(g) && x.level === a.level) : []
    if (!g || same.length <= 3) { grouped.push(a); continue }
    if (grouped.some((x) => x.id === `${g}group-${a.level}`)) continue
    const ctr = same.map((x) => x.tracker!).filter(Boolean)
    grouped.push({ id: `${g}group-${a.level}`, level: a.level, tracker: ctr[0], tab: a.tab, title: GROUPS[g](same.length),
      text: ctr.slice(0, 4).join(', ') + (ctr.length > 4 ? ` e mais ${ctr.length - 4}` : '') })
  }
  const rank = { danger: 0, warn: 1, info: 2 }
  return grouped.sort((a, b) => rank[a.level] - rank[b.level])
}
const fmtShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

/* ---------- packing list (colar do Excel ou abrir .xlsx/.csv) ---------- */
const COLS: Record<string, RegExp> = {
  brand: /^(marca|brand|fabricante|maker)/i,
  model: /^(modelo|model|nome|name|descri|produto|product|fragr|item)/i,
  size: /^(volume|vol\b|ml|medida|size|tamanho|conte[uú]do|capacidade)/i,
  category: /^(categoria|category|tipo|type)/i,
  qty: /^(qtd|quant|qty|pcs|pieces|unid|cantidad|pzs)/i,
  kg: /(peso|weight|kg|n\.?w|g\.?w)/i,
  unit: /^(container|cntr|ctr|contenedor|conteiner)/i,
}
export interface PackingResult { products: ProductItem[]; rows: number; skipped: number; columns: string[]; error?: string }

const num = (v: unknown) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim().replace(/\s/g, '')
  if (!s) return 0
  // 1.234,5 -> 1234.5 · 1,234.5 -> 1234.5
  const n = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  return parseFloat(n) || 0
}
export function guessCategory(text: string): ProductCategory {
  const z = text.toLowerCase()
  if (/\b(kit|set|coffret|estojo)\b/.test(z)) return 'Kit'
  if (/tester/.test(z)) return 'Tester'
  if (/body|splash|mist/.test(z)) return 'Body splash'
  if (/deo|antitransp/.test(z)) return 'Desodorante'
  if (/creme|cream|lotion|lo[cç][aã]o|hidratante/.test(z)) return 'Creme'
  if (/batom|lipstick|gloss|r[ií]mel|mascara|base\b|sombra|maquiagem|makeup/.test(z)) return 'Maquiagem'
  if (/women|woman|femme|fem\b|feminin|\bher\b|pour elle|donna/.test(z)) return 'Feminino'
  if (/\bmen\b|\bman\b|homme|masc|\bhim\b|uomo/.test(z)) return 'Masculino'
  return 'Unissex'
}

/** Converte linhas de planilha (com cabeçalho) em itens de produto agrupados. */
export function parsePacking(rows: unknown[][]): PackingResult {
  const clean = rows.map((r) => r.map((x) => (x instanceof Date ? isoDay(x.getTime()) : x)))
  const hi = clean.findIndex((r) => r.filter((x) => Object.values(COLS).some((re) => re.test(String(x ?? '').trim()))).length >= 2)
  if (hi < 0) return { products: [], rows: 0, skipped: 0, columns: [], error: 'Não achei o cabeçalho. A planilha precisa ter colunas como Volume e Quantidade.' }
  const head = clean[hi].map((x) => String(x ?? '').trim())
  const col: Partial<Record<keyof typeof COLS, number>> = {}
  head.forEach((h, i) => {
    for (const [k, re] of Object.entries(COLS) as [keyof typeof COLS, RegExp][]) if (col[k] == null && re.test(h)) { col[k] = i; break }
  })
  if (col.size == null || col.qty == null) return { products: [], rows: 0, skipped: 0, columns: head, error: 'A planilha precisa ter as colunas Volume e Quantidade.' }
  const kgIsTotal = col.kg != null && /total|g\.?w|n\.?w/i.test(head[col.kg])
  const map = new Map<string, ProductItem>()
  let n = 0, skipped = 0
  for (const r of clean.slice(hi + 1)) {
    const size = String(r[col.size] ?? '').trim()
    const qty = Math.round(num(r[col.qty]))
    if (!size || qty <= 0 || /total/i.test(size)) { if (r.some((x) => String(x ?? '').trim())) skipped++; continue }
    n++
    const brand = col.brand != null ? String(r[col.brand] ?? '').trim() : ''
    const model = col.model != null ? String(r[col.model] ?? '').trim() : ''
    const rawCat = col.category != null ? String(r[col.category] ?? '').trim() : ''
    const category = (PRODUCT_CATEGORIES.find((c) => c.toLowerCase().startsWith(rawCat.toLowerCase().slice(0, 4)) && rawCat) ?? guessCategory(`${model} ${size}`)) as ProductCategory
    const kg = col.kg != null ? num(r[col.kg]) : 0
    const unitKg = kgIsTotal ? kg / qty : kg
    const unit = col.unit != null ? String(r[col.unit] ?? '').trim().toUpperCase().replace(/[\s-]/g, '') : ''
    const key = [brand, model, size].join('|').toUpperCase()
    const cur = map.get(key)
    if (cur) {
      cur.unitKg = (cur.unitKg * cur.qty + unitKg * qty) / (cur.qty + qty)
      cur.qty += qty
      if (unit && !cur.units!.includes(unit)) cur.units!.push(unit)
    } else map.set(key, { brand, model, size, category, qty, unitKg: Math.round(unitKg * 10) / 10, units: unit ? [unit] : [] })
  }
  const products = [...map.values()].map((t) => ({ ...t, unitKg: Math.round(t.unitKg * 10) / 10, units: t.units?.length ? t.units : undefined }))
  return { products, rows: n, skipped, columns: head }
}

/** Texto colado do Excel/Sheets (separado por tab) ou CSV (; ou ,). */
export function parsePastedText(text: string): unknown[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : ','
  return lines.map((l) => l.split(sep).map((x) => x.replace(/^"|"$/g, '').trim()))
}

export const productTotals = (list: Container[]) => list.reduce((a, c) => a + productQty(c), 0)
