// Modelo de dados, rotas e regras de rastreamento do WORLD SCENTZ TRACKING.

export type Country = 'PY'
export type LatLng = [number, number]

/* ====================== PRODUTOS ====================== */
export const PRODUCT_CATEGORIES = ['Masculino', 'Feminino', 'Unissex', 'Kit', 'Tester', 'Body splash', 'Creme', 'Desodorante', 'Maquiagem'] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

export interface ProductItem {
  brand: string
  model: string
  size: string // volume, ex: 100 ml
  category: ProductCategory
  qty: number
  unitKg: number
  units?: string[] // containers físicos onde este produto está
}
export const productQty = (c: { products: ProductItem[] }) => c.products.reduce((a, t) => a + t.qty, 0)
export const productKg = (products: ProductItem[]) => products.reduce((a, t) => a + t.qty * t.unitKg, 0)

/* ====================== MSC ====================== */
export interface MscEvent { o: number; d: string; loc: string; name: string; desc: string; vessel: string; voyage: string; terminal: string }
export interface MscUnit { n: string; type: string; podEta: string; delivered: boolean; events: MscEvent[] }
export interface MscBl {
  bl: string; from: string; to: string; pod: string; podCode: string; podEta: string
  transshipments: string[]; delivered: boolean; units: MscUnit[]; error?: string
}

/* ====================== CONTAINER (unidade rastreada) ====================== */
export interface Container {
  id: string
  tracker: string // Nº do tracker (B/L MSC ou nº do container)
  content: string
  products: ProductItem[]
  weightKg: number
  country: Country // país de importação
  origin: string // chave de LOCS
  port: string // porto final / terminal (chave de LOCS)
  destination: string // chave de WAREHOUSES
  departure: string // data de saída (yyyy-mm-dd)
  portEta: string // previsão de chegada no porto final
  eta: string // previsão de chegada no barracão
  released: boolean // liberado no porto (aduana)
  vessel: string
  truck?: string
  notes?: string
  productsSimulated?: boolean // produtos gerados automaticamente (demonstração)
  carrier?: 'MSC'
  units?: MscUnit[] // containers físicos dentro do B/L
  transshipments?: string[]
  syncedAt?: string
  status?: 'active' | 'arrived' // arrived = já chegou (histórico)
  arrivedAt?: string
  releasedAt?: string
  customs?: Customs
  costs?: Costs
  land?: LandInfo
  freeDays?: number
  receipt?: Receipt
  docs?: DocFile[]
  productsSource?: string
}

/* ---------- operação (despacho, custos, caminhão, conferência, documentos) ---------- */
export type CustomsStep = 'port_arrival' | 'docs_delivered' | 'channel' | 'taxes_paid' | 'released' | 'pickup'
export type Customs = Partial<Record<CustomsStep, { at: string; by?: string | null; value?: string }>>
export interface Costs { freight?: number; taxes?: number; broker?: number; truck?: number; storage?: number; other?: number; demurragePaid?: number }
export interface LandInfo { company?: string; plate?: string; driver?: string; phone?: string; eta?: string }
export interface ReceiptUnit { n: string; ok: boolean; missing: number; damaged: number; note?: string }
export interface Receipt { at: string; by?: string | null; notes?: string; units: ReceiptUnit[] }
export interface DocFile { id: number; kind: string; name: string; mime?: string; size: number; by?: string | null; at: string }

/** Linha que vem da API (server/db.mjs) */
export interface ServerShipment {
  tracker: string; country: Country; carrier?: 'MSC'; content: string; origin?: string; port?: string; destination: string
  departure?: string; portEta?: string; eta?: string; released: boolean; releasedAt?: string; vessel: string; truck?: string; notes?: string
  status: 'active' | 'arrived'; arrivedAt?: string; msc?: MscBl; syncedAt?: string; products: ProductItem[]
  customs?: Customs; costs?: Costs; land?: LandInfo; freeDays?: number; receipt?: Receipt; docs?: DocFile[]
}

export interface Place { name: string; code: string; pos: LatLng; country: string }

// Pontos de despacho no mundo
export const ORIGINS: Record<string, Place> = {
  JEA: { name: 'Jebel Ali (Dubai)', code: 'AEJEA', country: 'Emirados Árabes', pos: [25.01, 55.06] },
  TAO: { name: 'Qingdao', code: 'CNTAO', country: 'China', pos: [36.07, 120.32] },
  SHA: { name: 'Xangai', code: 'CNSHA', country: 'China', pos: [31.23, 121.49] },
  NGB: { name: 'Ningbo', code: 'CNNGB', country: 'China', pos: [29.87, 121.85] },
  SZX: { name: 'Shenzhen', code: 'CNSZX', country: 'China', pos: [22.48, 113.9] },
  PUS: { name: 'Busan', code: 'KRPUS', country: 'Coreia do Sul', pos: [35.08, 129.05] },
  SIN: { name: 'Singapura', code: 'SGSIN', country: 'Singapura', pos: [1.26, 103.82] },
  HAM: { name: 'Hamburgo', code: 'DEHAM', country: 'Alemanha', pos: [53.54, 9.97] },
  RTM: { name: 'Roterdã', code: 'NLRTM', country: 'Holanda', pos: [51.95, 4.13] },
  VLC: { name: 'Valência', code: 'ESVLC', country: 'Espanha', pos: [39.44, -0.32] },
  MIA: { name: 'Miami', code: 'USMIA', country: 'EUA', pos: [25.77, -80.17] },
}

// Portos e terminais de entrada na América do Sul
export const PORTS: Record<string, Place> = {
  PYBCM: { name: 'Terminal Caacupemí (Assunção)', code: 'PYBCM', country: 'Paraguai', pos: [-25.24, -57.57] },
  PYTVT: { name: 'Terport Villeta', code: 'PYTVT', country: 'Paraguai', pos: [-25.495, -57.555] },
  ITJ: { name: 'Porto de Itajaí', code: 'BRITJ', country: 'Brasil', pos: [-26.9, -48.66] },
  PNG: { name: 'Porto de Paranaguá', code: 'BRPNG', country: 'Brasil', pos: [-25.5, -48.52] },
  SSZ: { name: 'Porto de Santos', code: 'BRSSZ', country: 'Brasil', pos: [-23.96, -46.31] },
  RIO: { name: 'Porto do Rio de Janeiro', code: 'BRRIO', country: 'Brasil', pos: [-22.89, -43.18] },
  MVD: { name: 'Porto de Montevidéu', code: 'UYMVD', country: 'Uruguai', pos: [-34.9, -56.21] },
  BUE: { name: 'Porto de Buenos Aires', code: 'ARBUE', country: 'Argentina', pos: [-34.6, -58.37] },
}
export const LOCS: Record<string, Place> = { ...ORIGINS, ...PORTS }
const UN2KEY: Record<string, string> = Object.fromEntries(Object.entries(LOCS).map(([k, p]) => [p.code, k]))
export const locName = (k: string) => LOCS[k]?.name ?? k

// Barracões WORLD SCENTZ
export const WAREHOUSES: Record<string, Place & { capacity: number }> = {
  ASU: { name: 'Barracão Assunção', code: 'ASU', country: 'Paraguai', pos: [-25.28, -57.6], capacity: 700 },
  CDE: { name: 'Barracão Ciudad del Este', code: 'CDE', country: 'Paraguai', pos: [-25.51, -54.63], capacity: 300 },
}

/* ====================== MALHA MARÍTIMA + HIDROVIA ====================== */
const dist = (a: LatLng, b: LatLng) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180))

const SEA_NODES: Record<string, LatLng> = {
  ...Object.fromEntries(Object.entries(LOCS).map(([k, p]) => [k, p.pos])),
  // Ásia
  y0: [35.7, 120.9], y1: [35.2, 123.6], k1: [33.5, 128], e1: [30.6, 123.4], n1: [29.8, 122.6], e2: [25.3, 120.4], e3: [22.2, 116.8],
  z1: [21.8, 114.3], s2: [12, 111.5], s3: [3.2, 105.5],
  // Golfo Pérsico -> canal de Moçambique
  h1: [26.4, 56.5], h2: [24.5, 58.5], h3: [20, 60.5], h4: [-3, 46], h5: [-17, 41.5],
  // Malaca / Índico / Suez
  m1: [2.6, 101.2], m2: [5.8, 97], i1: [5.6, 80.6], a1: [11.3, 54], a2: [12.3, 45.5], bab: [12.6, 43.3], r1: [16, 41.2], r2: [21, 38],
  r3: [27.2, 34.3], suz: [29.9, 32.55], ps: [31.5, 32.35], md1: [33.6, 27], md2: [36.6, 13.5], md3: [37.3, 11.5], md4: [38.3, 4.5], md5: [39.1, 0.6],
  g0: [36.6, -2], gib: [35.95, -5.6], g2: [35.6, -9], g3: [33, -13],
  // Cabo da Boa Esperança
  c2: [-12, 68], c3: [-26, 48], c4: [-34, 31], c5: [-36, 20], c6: [-33, 5], c7: [-29, -18],
  // Atlântico
  eu1: [53.9, 8.4], eu2: [53.8, 6], eu3: [51.6, 2.2], eu4: [50.2, -1.5], eu5: [48.8, -6], eu6: [43, -11], eu7: [36, -14],
  mi1: [25, -79.4], mi2: [23.5, -75], mi3: [20.5, -68], mi4: [18.6, -63.5], mi5: [12, -52], mi6: [3, -40],
  na1: [15, -24], na2: [0, -29], na3: [-8, -32.5], na4: [-16, -36.5], sa0: [-21.5, -39.2], sa1: [-26, -38],
  rio1: [-23.2, -42.9], ss1: [-24.4, -45.6], ss2: [-24.05, -46.3], p1: [-25.9, -47.2], p2: [-25.56, -48.3], it1: [-27.1, -47.4], it2: [-26.92, -48.55],
  so1: [-31, -49], mv1: [-35.1, -53.5], mv2: [-35.05, -56], b1: [-34.75, -57.6],
  // Hidrovia Paraná–Paraguai
  rv1: [-34.3, -58.5], rv2: [-33.75, -59.15], rv3: [-32.95, -60.62], rv4: [-31.72, -60.52], rv5: [-30.7, -59.65], rv6: [-29.2, -59.3],
  rv7: [-28.4, -59.05], rv8: [-27.3, -58.62], rv9: [-26.85, -58.3], rv10: [-26.15, -58.05], rv11: [-25.75, -57.62],
}
const SEA_EDGES: [string, string][] = [
  ['TAO', 'y0'], ['y0', 'y1'], ['y1', 'e1'], ['PUS', 'k1'], ['k1', 'e1'], ['SHA', 'e1'], ['NGB', 'n1'], ['n1', 'e1'], ['n1', 'e2'], ['e1', 'e2'],
  ['e2', 'e3'], ['e3', 'z1'], ['SZX', 'z1'], ['z1', 's2'], ['e3', 's2'], ['s2', 's3'], ['s3', 'SIN'],
  ['SIN', 'm1'], ['m1', 'm2'], ['m2', 'i1'], ['i1', 'a1'], ['a1', 'a2'], ['a2', 'bab'], ['bab', 'r1'], ['r1', 'r2'], ['r2', 'r3'], ['r3', 'suz'],
  ['suz', 'ps'], ['ps', 'md1'], ['md1', 'md2'], ['md2', 'md3'], ['md3', 'md4'], ['md4', 'md5'], ['md5', 'VLC'], ['VLC', 'g0'], ['g0', 'gib'],
  ['gib', 'g2'], ['g2', 'g3'], ['g3', 'na1'],
  ['JEA', 'h1'], ['h1', 'h2'], ['h2', 'h3'], ['h3', 'a1'], ['h3', 'h4'], ['h4', 'h5'], ['h5', 'c4'],
  ['i1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'c6'], ['c6', 'c7'], ['c7', 'sa1'],
  ['HAM', 'eu1'], ['eu1', 'eu2'], ['eu2', 'eu3'], ['RTM', 'eu3'], ['eu3', 'eu4'], ['eu4', 'eu5'], ['eu5', 'eu6'], ['eu6', 'eu7'], ['eu7', 'g3'],
  ['MIA', 'mi1'], ['mi1', 'mi2'], ['mi2', 'mi3'], ['mi3', 'mi4'], ['mi4', 'mi5'], ['mi5', 'mi6'], ['mi6', 'na3'],
  ['na1', 'na2'], ['na2', 'na3'], ['na3', 'na4'], ['na4', 'sa0'], ['sa0', 'rio1'], ['sa0', 'sa1'], ['rio1', 'RIO'], ['rio1', 'ss1'],
  ['ss1', 'ss2'], ['ss2', 'SSZ'], ['ss1', 'p1'], ['p1', 'p2'], ['p2', 'PNG'], ['p1', 'it1'], ['it1', 'it2'], ['it2', 'ITJ'],
  ['sa1', 'ss1'], ['sa1', 'it1'], ['sa1', 'so1'], ['it1', 'so1'], ['so1', 'mv1'], ['mv1', 'mv2'], ['mv2', 'MVD'], ['mv2', 'b1'], ['b1', 'BUE'],
]
const RIVER_EDGES: [string, string][] = [
  ['BUE', 'rv1'], ['MVD', 'rv1'], ['rv1', 'rv2'], ['rv2', 'rv3'], ['rv3', 'rv4'], ['rv4', 'rv5'], ['rv5', 'rv6'], ['rv6', 'rv7'], ['rv7', 'rv8'],
  ['rv8', 'rv9'], ['rv9', 'rv10'], ['rv10', 'rv11'], ['rv11', 'PYTVT'], ['PYTVT', 'PYBCM'],
]

type Graph = Record<string, { to: string; w: number; river: boolean }[]>
function buildGraph(): Graph {
  const g: Graph = {}
  const add = (a: string, b: string, river: boolean) => {
    const w = dist(SEA_NODES[a], SEA_NODES[b]) * (river ? 1 : 1)
    ;(g[a] ||= []).push({ to: b, w, river }); (g[b] ||= []).push({ to: a, w, river })
  }
  SEA_EDGES.forEach(([a, b]) => add(a, b, false))
  RIVER_EDGES.forEach(([a, b]) => add(a, b, true))
  return g
}
const SEA = buildGraph()

function dijkstra(g: Graph, nodes: Record<string, LatLng>, start: string, goal: string): { path: LatLng[]; river: boolean; riverAt: number } | null {
  if (!g[start] || !g[goal]) return null
  const d: Record<string, number> = { [start]: 0 }, prev: Record<string, string> = {}, done = new Set<string>()
  let riverAt = -1 // índice do nó onde o rio começa (-1 = só mar)
  while (true) {
    let u: string | undefined, best = Infinity
    for (const k in d) if (!done.has(k) && d[k] < best) { best = d[k]; u = k }
    if (!u || u === goal) break
    done.add(u)
    for (const e of g[u]) {
      const nd = d[u] + e.w
      if (nd < (d[e.to] ?? Infinity)) { d[e.to] = nd; prev[e.to] = u }
    }
  }
  if (!(goal in d)) return null
  const keys: string[] = []
  for (let n: string | undefined = goal; n; n = prev[n]) keys.unshift(n)
  for (let i = 1; i < keys.length; i++) if (riverAt < 0 && g[keys[i - 1]].find((e) => e.to === keys[i])?.river) riverAt = i - 1
  return { path: keys.map((k) => nodes[k]), river: riverAt >= 0, riverAt }
}

const routeCache = new Map<string, { path: LatLng[]; river: boolean; riverAt: number }>()
export function seaRoute(a: string, b: string) {
  const key = a + '>' + b
  if (!routeCache.has(key)) routeCache.set(key, dijkstra(SEA, SEA_NODES, a, b) ?? { path: [LOCS[a].pos, LOCS[b].pos], river: false, riverAt: -1 })
  return routeCache.get(key)!
}

/* ====================== MALHA RODOVIÁRIA ====================== */
const ROAD_NODES: Record<string, LatLng> = {
  ...Object.fromEntries(Object.entries(PORTS).map(([k, p]) => ['p:' + k, p.pos])),
  'w:ASU': WAREHOUSES.ASU.pos, 'w:CDE': WAREHOUSES.CDE.pos,
  SAO: [-23.55, -46.63], CWB: [-25.43, -49.27], JOI: [-26.3, -48.85], PGZ: [-25.09, -50.16], GPV: [-25.39, -51.46],
  CAC: [-24.96, -53.46], FOZ: [-25.54, -54.58], COV: [-25.45, -56.44], PAY: [-32.32, -58.08], URG: [-29.75, -57.08],
  ENC: [-27.33, -55.87], ROS: [-32.95, -60.65], SFE: [-31.63, -60.7], RES: [-27.46, -58.98], CLO: [-25.29, -57.72], CHA: [-27.1, -52.6],
  VRJ: [-22.5, -44.1],
}
const ROAD_EDGES: [string, string][] = [
  ['p:ITJ', 'JOI'], ['JOI', 'CWB'], ['p:PNG', 'CWB'], ['p:SSZ', 'SAO'], ['SAO', 'CWB'], ['p:RIO', 'VRJ'], ['VRJ', 'SAO'],
  ['CWB', 'PGZ'], ['PGZ', 'GPV'], ['GPV', 'CAC'], ['CAC', 'FOZ'], ['FOZ', 'w:CDE'], ['w:CDE', 'COV'], ['COV', 'w:ASU'],
  ['p:MVD', 'PAY'], ['PAY', 'URG'], ['URG', 'ENC'], ['ENC', 'COV'], ['ENC', 'w:CDE'], ['p:BUE', 'ROS'], ['ROS', 'SFE'],
  ['SFE', 'RES'], ['RES', 'CLO'], ['CLO', 'w:ASU'], ['URG', 'CHA'], ['CHA', 'JOI'],
  ['p:PYBCM', 'w:ASU'], ['p:PYTVT', 'w:ASU'], ['p:PYTVT', 'COV'],
]
const ROAD: Graph = {}
for (const [a, b] of ROAD_EDGES) {
  const w = dist(ROAD_NODES[a], ROAD_NODES[b])
  ;(ROAD[a] ||= []).push({ to: b, w, river: false }); (ROAD[b] ||= []).push({ to: a, w, river: false })
}
export function landPath(portKey: string, whKey: string): LatLng[] {
  return dijkstra(ROAD, ROAD_NODES, 'p:' + portKey, 'w:' + whKey)?.path ?? [LOCS[portKey]?.pos ?? WAREHOUSES[whKey].pos, WAREHOUSES[whKey].pos]
}

/* ====================== DATAS ====================== */
export const DAY = 86400000
export const parseDate = (s: string) => new Date(s + 'T12:00:00').getTime()
export const fmtDate = (s: string) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ de /g, ' ').replace('.', '') : '—')
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/* ====================== ESCALAS (visitas a portos) ====================== */
export interface Visit { loc: string; arr: number; dep: number; arrEst: boolean; depEst: boolean; vesselIn?: string; vesselOut?: string }

function mscVisits(events: MscEvent[], podKey: string, podEta: string): Visit[] {
  const out: (Partial<Visit> & { loc: string })[] = []
  for (const e of events) {
    const loc = UN2KEY[e.loc]
    if (!loc) continue
    let v = out[out.length - 1]
    if (!v || v.loc !== loc) { v = { loc }; out.push(v) }
    const t = parseDate(e.d)
    switch (e.desc) {
      case 'Export Loaded on Vessel': v.dep = t; v.depEst = false; v.vesselOut = e.vessel; break
      case 'Full Transshipment Loaded': v.dep = t; v.depEst = false; v.vesselOut = e.vessel; break
      case 'Full Intended Transshipment': if (v.dep == null) { v.dep = t; v.depEst = true; v.vesselOut = e.vessel } break
      case 'Full Transshipment Discharged': case 'Import Discharged from Vessel': case 'Discharged':
        v.arr = t; v.arrEst = false; v.vesselIn = e.vessel; break
      case 'Estimated Time of Arrival': if (v.arr == null) { v.arr = t; v.arrEst = true; v.vesselIn = e.vessel } break
    }
  }
  // origem só conta a partir do embarque
  while (out.length && out[0].dep == null && out.length > 1 && out[0].loc === out[1]?.loc) out.shift()
  const last = out[out.length - 1]
  if (podKey && (!last || last.loc !== podKey)) out.push({ loc: podKey, arr: parseDate(podEta), arrEst: true })
  else if (last && last.arr == null && podEta) { last.arr = parseDate(podEta); last.arrEst = true }
  return out.map((v, i) => {
    const arr = v.arr ?? v.dep ?? (i ? out[i - 1].dep ?? 0 : 0)
    const dep = v.dep ?? arr
    return { loc: v.loc, arr, dep, arrEst: v.arrEst ?? true, depEst: v.depEst ?? true, vesselIn: v.vesselIn, vesselOut: v.vesselOut }
  })
}

export function visitsOf(c: Container): Visit[] {
  const ev = c.units?.[0]?.events
  if (ev?.length) return mscVisits(ev, c.port, c.portEta)
  const t0 = parseDate(c.departure), t1 = parseDate(c.portEta)
  return [
    { loc: c.origin, arr: t0, dep: t0, arrEst: false, depEst: false, vesselOut: c.vessel },
    { loc: c.port, arr: t1, dep: t1, arrEst: true, depEst: true, vesselIn: c.vessel },
  ]
}

/* ====================== RASTREAMENTO ====================== */
export type Stage = 'scheduled' | 'sea' | 'transship' | 'river' | 'port' | 'held' | 'land' | 'delivered'

export const STAGE_LABEL: Record<Stage, string> = {
  scheduled: 'Na origem', sea: 'Em trânsito marítimo', transship: 'Em transbordo', river: 'Hidrovia (barcaça)',
  port: 'No porto', held: 'Retido no porto', land: 'Em trânsito terrestre', delivered: 'Entregue no barracão',
}
export const STAGE_COLOR: Record<Stage, string> = {
  scheduled: '#8A8A8A', sea: '#2F6FED', transship: '#E8A317', river: '#0EA5A4', port: '#E8A317', held: '#E8A317', land: '#7B4DDB', delivered: '#1E9E5A',
}

/** Divide um caminho no ponto f (0..1): [percorrido, restante] */
export function splitPath(path: LatLng[], f: number): [LatLng[], LatLng[]] {
  const segs = path.slice(1).map((p, i) => dist(path[i], p))
  const total = segs.reduce((a, b) => a + b, 0)
  let target = Math.max(0, Math.min(1, f)) * total
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = segs[i] ? target / segs[i] : 0, a = path[i], b = path[i + 1]
      const p: LatLng = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      return [[...path.slice(0, i + 1), p], [p, ...path.slice(i + 1)]]
    }
    target -= segs[i]
  }
  return [path, [path[path.length - 1]]]
}

function along(path: LatLng[], f: number): { pos: LatLng; heading: number } {
  const [done, rest] = splitPath(path, f)
  const a = done.length > 1 ? done[done.length - 2] : done[0]
  const b = rest.length > 1 ? rest[1] : rest[0]
  const pos = done[done.length - 1]
  const heading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 360
  return { pos, heading }
}

export interface Leg { from: string; to: string; path: LatLng[]; river: boolean; riverAt: number; dep: number; arr: number; vessel?: string }

export interface Tracking {
  stage: Stage
  progress: number // 0..1 de toda a jornada
  pos: LatLng
  heading: number // 0 = norte, 90 = leste
  at?: string // porto onde está agora (se parado)
  next?: string // próximo porto
  vessel?: string // navio/barcaça atual
  legs: Leg[]
  visits: Visit[]
  seaDone: LatLng[][]
  seaLeft: LatLng[][]
  land: LatLng[]
  landF: number
  sea: LatLng[] // trajeto marítimo completo
  daysLeft: number
  daysInTransit: number
}

export function track(c: Container, now = Date.now()): Tracking {
  const visits = visitsOf(c)
  const legs: Leg[] = visits.slice(1).map((v, i) => {
    const a = visits[i], r = seaRoute(a.loc, v.loc)
    return { from: a.loc, to: v.loc, path: r.path, river: r.river, riverAt: r.riverAt, dep: a.dep, arr: v.arr, vessel: a.vesselOut || v.vesselIn }
  })
  const pod = visits[visits.length - 1]
  const land = landPath(c.port, c.destination)
  const t0 = visits[0].dep, tPod = pod.arr, tEnd = Math.max(parseDate(c.eta), tPod)
  const seaDone: LatLng[][] = [], seaLeft: LatLng[][] = []
  let stage: Stage = 'delivered', pos: LatLng = land[land.length - 1], heading = 90, landF = 0
  let at: string | undefined, next: string | undefined, vessel: string | undefined

  if (now < t0) {
    stage = 'scheduled'; pos = LOCS[visits[0].loc].pos; at = visits[0].loc; next = visits[1]?.loc; vessel = legs[0]?.vessel
    heading = legs[0] ? along(legs[0].path, 0).heading : 90
    legs.forEach((l) => seaLeft.push(l.path))
  } else if (now < tPod) {
    let placed = false
    legs.forEach((l, i) => {
      if (placed) { seaLeft.push(l.path); return }
      const vFrom = visits[i]
      if (now < vFrom.dep) { // parado em transbordo
        stage = 'transship'; pos = LOCS[vFrom.loc].pos; at = vFrom.loc; next = l.to; vessel = l.vessel
        heading = along(l.path, 0).heading; seaLeft.push(l.path); placed = true; return
      }
      if (now < l.arr) {
        const f = (now - l.dep) / Math.max(1, l.arr - l.dep)
        const [d, r] = splitPath(l.path, f); seaDone.push(d); seaLeft.push(r)
        const a = along(l.path, f); pos = a.pos; heading = a.heading
        stage = l.river && d.length - 2 >= l.riverAt ? 'river' : 'sea'; next = l.to; vessel = l.vessel; placed = true; return
      }
      seaDone.push(l.path)
    })
    if (!placed) { stage = 'transship'; pos = LOCS[pod.loc].pos; at = pod.loc }
  } else {
    legs.forEach((l) => seaDone.push(l.path))
    const lastLeg = legs[legs.length - 1]
    heading = lastLeg ? along(lastLeg.path, 1).heading : 90
    if (!c.released && !(c.units?.length && c.units.every((u) => u.delivered))) { stage = 'held'; pos = LOCS[pod.loc].pos; at = pod.loc }
    else if (now < tEnd) {
      const landStart = Math.min(tPod + DAY, tEnd - 1)
      if (now < landStart) { stage = 'port'; pos = LOCS[pod.loc].pos; at = pod.loc }
      else { stage = 'land'; landF = (now - landStart) / (tEnd - landStart); const a = along(land, landF); pos = a.pos; heading = a.heading }
    } else { stage = 'delivered'; landF = 1 }
  }
  return {
    stage, pos, heading, at, next, vessel, legs, visits, seaDone, seaLeft, land, landF,
    sea: legs.flatMap((l) => l.path),
    progress: Math.max(0, Math.min(1, (now - t0) / Math.max(1, tEnd - t0))),
    daysLeft: Math.ceil((tEnd - now) / DAY),
    daysInTransit: Math.max(0, Math.floor((now - t0) / DAY)),
  }
}

/* ====================== PRODUTOS SIMULADOS ====================== */
// Catálogo de demonstração. perCtr = quantas unidades cabem num container 40' HC.
const CATALOG: { size: string; category: ProductCategory; kg: number; perCtr: number; models: Record<string, string> }[] = [
  { size: '100 ml', category: 'Masculino', kg: 0.38, perCtr: 48000, models: { Lattafa: 'Asad', Armaf: 'Club de Nuit Intense Man', Afnan: '9PM', Rasasi: 'Hawas' } },
  { size: '100 ml', category: 'Feminino', kg: 0.38, perCtr: 48000, models: { Lattafa: 'Yara', Armaf: 'Club de Nuit Woman', Afnan: '9AM Pour Femme', Rasasi: 'Hawas for Her' } },
  { size: '100 ml', category: 'Unissex', kg: 0.4, perCtr: 46000, models: { Lattafa: 'Khamrah', Armaf: 'Club de Nuit Untold', Afnan: 'Supremacy Not Only Intense' } },
  { size: '60 ml', category: 'Unissex', kg: 0.26, perCtr: 70000, models: { Lattafa: 'Ana Abiyedh', Afnan: 'Turathi Blue' } },
  { size: '3 x 30 ml', category: 'Kit', kg: 0.55, perCtr: 30000, models: { Lattafa: 'Yara Collection', Armaf: 'Club de Nuit Set' } },
  { size: '100 ml', category: 'Tester', kg: 0.33, perCtr: 55000, models: { Lattafa: 'Asad Tester', Armaf: 'Club de Nuit Tester' } },
  { size: '250 ml', category: 'Body splash', kg: 0.3, perCtr: 60000, models: { Lattafa: 'Yara Body Mist', Armaf: 'Vanity Femme Mist' } },
  { size: '200 ml', category: 'Desodorante', kg: 0.22, perCtr: 80000, models: { Lattafa: 'Asad Deo Spray', Armaf: 'Club de Nuit Deo', Rasasi: 'Hawas Deo' } },
  { size: '200 ml', category: 'Creme', kg: 0.28, perCtr: 65000, models: { Lattafa: 'Yara Body Lotion', Rasasi: 'Hawas Body Lotion' } },
  { size: '4 g', category: 'Maquiagem', kg: 0.04, perCtr: 400000, models: { Lattafa: 'Lip Color', Armaf: 'Matte Lipstick' } },
]

function rng(seed: string) {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
}

/** Gera uma carga de produtos plausível e sempre igual para o mesmo B/L. */
export function simulateProducts(tracker: string, unitNumbers: string[]): ProductItem[] {
  const r = rng(tracker)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  // perfil da carga: maioria perfumes, depois kits/testers, depois cosméticos
  const PERFUME: ProductCategory[] = ['Masculino', 'Feminino', 'Unissex']
  const roll = r()
  const pool = roll < 0.6 ? CATALOG.filter((x) => PERFUME.includes(x.category))
    : roll < 0.8 ? CATALOG.filter((x) => PERFUME.includes(x.category) || x.category === 'Kit' || x.category === 'Tester')
    : CATALOG.filter((x) => !PERFUME.includes(x.category))
  const n = Math.max(1, Math.min(pool.length, unitNumbers.length || 1, 2 + Math.floor(r() * 3)))
  const skus = [...pool].sort(() => r() - 0.5).slice(0, n)
  const brand = pick(Object.keys(skus[0].models).filter((b) => skus.every((s) => b in s.models)).concat(Object.keys(skus[0].models)))
  const items = skus.map((s) => {
    const b = brand in s.models ? brand : pick(Object.keys(s.models))
    return { brand: b, model: s.models[b], size: s.size, category: s.category, qty: 0, unitKg: s.kg, units: [] as string[] }
  })
  const units = unitNumbers.length ? unitNumbers : [tracker]
  units.forEach((u, i) => {
    const it = items[i % items.length]
    const sku = skus[i % skus.length]
    it.units.push(u)
    it.qty += Math.round(sku.perCtr * (0.92 + r() * 0.08)) // 92–100% de ocupação
  })
  return items
}

/** Produtos que estão dentro de um container físico específico */
export function productsInUnit(c: Container, unit: string) {
  return c.products.filter((t) => t.units?.includes(unit)).map((t) => ({ ...t, qty: Math.round(t.qty / (t.units?.length || 1)) }))
}

/* ====================== IMPORTAÇÃO MSC ====================== */
export function fromMsc(b: MscBl, prev?: Container): Container {
  const u0 = b.units[0]
  const load = u0?.events.find((e) => e.desc === 'Export Loaded on Vessel')
  const originKey = UN2KEY[load?.loc ?? ''] ?? UN2KEY[u0?.events[0]?.loc ?? ''] ?? 'JEA'
  const podKey = b.podCode || UN2KEY[b.podCode] || 'PYTVT'
  const podEta = b.podEta || u0?.podEta || isoDay(Date.now())
  const base: Container = {
    id: prev?.id ?? 'msc-' + b.bl,
    tracker: b.bl,
    content: prev?.content ?? 'Produtos',
    // produtos lançados pelo usuário são mantidos; os simulados são sempre regenerados
    products: prev?.products?.length && !prev.productsSimulated ? prev.products : simulateProducts(b.bl, b.units.map((u) => u.n)),
    productsSimulated: !(prev?.products?.length && !prev.productsSimulated),
    weightKg: 0,
    country: 'PY',
    origin: originKey,
    port: podKey,
    destination: prev?.destination ?? (podKey.startsWith('PY') ? 'ASU' : 'CDE'),
    departure: load?.d ?? u0?.events[0]?.d ?? podEta,
    portEta: podEta,
    eta: prev?.eta && prev.eta >= podEta ? prev.eta : isoDay(parseDate(podEta) + 2 * DAY),
    released: prev?.released ?? false,
    vessel: '',
    truck: prev?.truck,
    notes: prev?.notes,
    carrier: 'MSC',
    units: b.units,
    transshipments: b.transshipments,
    syncedAt: prev?.syncedAt,
    status: prev?.status,
    arrivedAt: prev?.arrivedAt,
    releasedAt: prev?.releasedAt,
  }
  base.vessel = track(base).vessel ?? load?.vessel ?? ''
  base.weightKg = productKg(base.products)
  return base
}

/** Converte a linha do banco no formato usado pela tela. */
export function fromServer(r: ServerShipment): Container {
  const prev: Container = {
    id: r.tracker, tracker: r.tracker, content: r.content, products: r.products, productsSimulated: !r.products.length, weightKg: productKg(r.products),
    country: r.country, origin: r.origin ?? 'JEA', port: r.port ?? 'PNG', destination: r.destination,
    departure: r.departure ?? isoDay(Date.now()), portEta: r.portEta ?? isoDay(Date.now()), eta: r.eta ?? r.portEta ?? isoDay(Date.now()),
    released: r.released, vessel: r.vessel, truck: r.truck, notes: r.notes, carrier: r.carrier,
    syncedAt: r.syncedAt, status: r.status, arrivedAt: r.arrivedAt, releasedAt: r.releasedAt,
    customs: r.customs ?? {}, costs: r.costs ?? {}, land: r.land ?? {}, freeDays: r.freeDays, receipt: r.receipt, docs: r.docs ?? [],
  }
  if (r.msc?.units?.length) {
    const c = { ...fromMsc(r.msc, { ...prev, eta: r.eta ?? '' }), customs: prev.customs, costs: prev.costs, land: prev.land, freeDays: prev.freeDays, receipt: prev.receipt, docs: prev.docs }
    if (!r.products.length) { c.products = simulateProducts(r.tracker, r.msc.units.map((u) => u.n)); c.productsSimulated = true; c.weightKg = productKg(c.products) }
    return c
  }
  if (!prev.products.length) { prev.productsSimulated = false }
  return prev
}

/** A MSC já marcou o B/L como entregue? */
export const mscDelivered = (c: Container) => !!c.units?.length && c.units.every((u) => u.delivered)

export const unitCount = (c: Container) => c.units?.length ?? 1
export const mscLink = (n: string) => `https://www.msc.com/en/track-a-shipment?agencyPath=pry&trackingNumber=${encodeURIComponent(n)}`
