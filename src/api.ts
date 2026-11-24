// Comunicação com o servidor/banco (server/index.mjs).
import { fromServer, type Container, type Costs, type Customs, type LandInfo, type Receipt, type ServerShipment } from './data'
import type { LogRow, Role, Settings, SyncRun, SyncStatus, User } from './ops'
import { demoCall } from './demo'

/** Disparado quando a sessão expira, para o app voltar à tela de login. */
export const AUTH_EVENT = 'np-auth-required'

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.VITE_DEMO) return demoCall(url, init) as Promise<T>
  const isForm = init?.body instanceof FormData
  const r = await fetch(url, { ...init, headers: isForm ? init?.headers : { 'content-type': 'application/json', ...init?.headers } })
  const body = await r.json().catch(() => ({}))
  if (r.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_EVENT))
  if (!r.ok) throw new Error(body.error || `Erro ${r.status}`)
  return body as T
}
const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) })
const enc = encodeURIComponent

/** Só os campos que a equipe edita (o resto vem da MSC). */
const payload = (c: Container) => ({
  tracker: c.tracker, country: c.country, content: c.content, origin: c.origin, port: c.port, destination: c.destination,
  departure: c.departure, portEta: c.portEta, eta: c.eta, released: c.released, vessel: c.vessel, truck: c.truck, notes: c.notes,
  products: c.products, productsSimulated: c.productsSimulated, productsSource: c.productsSource,
})

export interface LogEntry { at: string; kind: string; detail: Record<string, unknown> | null; by?: string | null }
export interface OpsPatch { customs?: Partial<Record<keyof Customs, { at?: string; value?: string } | null>>; costs?: Costs; land?: LandInfo; freeDays?: number | '' | null; receipt?: Receipt }
const ship = async (p: Promise<ServerShipment>) => fromServer(await p)

export const api = {
  // login
  authState: () => call<{ needsSetup: boolean; user: User | null }>('/api/auth/state'),
  setup: (d: { username: string; name: string; password: string }) => call<{ user: User }>('/api/auth/setup', json('POST', d)),
  login: (username: string, password: string) => call<{ user: User }>('/api/auth/login', json('POST', { username, password })),
  logout: () => call('/api/auth/logout', json('POST')),
  changePassword: (current: string, password: string) => call('/api/me/password', json('POST', { current, password })),
  users: () => call<{ users: User[]; roles: Role[] }>('/api/users'),
  createUser: (d: { username: string; name: string; role: Role; password: string }) => call<User>('/api/users', json('POST', d)),
  updateUser: (id: number, d: Partial<User> & { password?: string }) => call<User>(`/api/users/${id}`, json('PUT', d)),

  // configurações
  settings: () => call<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => call<Settings>('/api/settings', json('PUT', s)),

  // B/Ls
  list: async () => (await call<ServerShipment[]>('/api/shipments')).map(fromServer),
  create: (c: Container) => ship(call('/api/shipments', json('POST', payload(c)))),
  save: (c: Container) => ship(call(`/api/shipments/${enc(c.tracker)}`, json('PUT', payload(c)))),
  remove: (tracker: string) => call<{ ok: true }>(`/api/shipments/${enc(tracker)}`, json('DELETE')),
  ops: (tracker: string, patch: OpsPatch) => ship(call(`/api/shipments/${enc(tracker)}/ops`, json('PATCH', patch))),
  arrive: (tracker: string, d: { at?: string; receipt?: Receipt } = {}) => ship(call(`/api/shipments/${enc(tracker)}/arrive`, json('POST', d))),
  reopen: (tracker: string) => ship(call(`/api/shipments/${enc(tracker)}/reopen`, json('POST'))),
  log: (tracker: string) => call<LogEntry[]>(`/api/shipments/${enc(tracker)}/log`),
  recentLog: (days = 30) => call<LogRow[]>(`/api/log/recent?days=${days}`),

  // documentos
  uploadDoc: (tracker: string, kind: string, file: File) => {
    const fd = new FormData(); fd.append('kind', kind); fd.append('file', file)
    return ship(call(`/api/shipments/${enc(tracker)}/docs`, { method: 'POST', body: fd }))
  },
  removeDoc: (id: number) => ship(call(`/api/docs/${id}`, json('DELETE'))),

  // MSC
  syncStatus: () => call<SyncStatus>('/api/msc/status'),
  syncNow: (trackers?: string[]) => call<{ started?: boolean; queued?: boolean }>('/api/msc/sync', json('POST', { trackers })),
  syncRuns: (limit = 15) => call<SyncRun[]>(`/api/msc/runs?limit=${limit}`),
}
