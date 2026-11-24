// Modo demonstração (build com VITE_DEMO=1, publicado no GitHub Pages): sem servidor, dados de src/demo-data.json, só leitura.
import snap from './demo-data.json'

const days = Math.round((Date.now() - Date.parse(snap.at)) / 864e5)
/** As datas do snapshot andam junto com o calendário, para a demonstração não envelhecer. */
const shift = (v: unknown): unknown =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(Date.parse(v.slice(0, 10)) + days * 864e5).toISOString().slice(0, 10) + v.slice(10)
  : Array.isArray(v) ? v.map(shift)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]))
  : v
const data = shift(snap) as typeof snap

// perfil "diretoria" = só consulta, então a tela não oferece edição
const user = { id: 1, username: 'demo', name: 'Demonstração', role: 'diretoria', active: true }
const SYNC = { running: false, ok: null, message: '', done: 0, total: 0, trigger: null, trackers: null, lastSyncAt: null, finishedAt: null, autoSync: false, syncTimes: [], nextAt: null, retrying: false }

export async function demoCall(url: string, init?: RequestInit): Promise<unknown> {
  const path = url.split('?')[0]
  if (path.startsWith('/api/auth/')) return { needsSetup: false, user }
  if (init?.method && init.method !== 'GET') throw new Error('Demonstração: alterações desativadas.')
  if (path === '/api/shipments') return data.shipments
  if (path === '/api/settings') return data.settings
  if (path === '/api/log/recent') return data.log
  if (path === '/api/msc/status') return SYNC
  if (path === '/api/msc/runs') return []
  const log = path.match(/^\/api\/shipments\/(.+)\/log$/)
  if (log) return data.log.filter((l) => l.tracker === decodeURIComponent(log[1]))
  throw new Error('Demonstração: recurso indisponível.')
}
