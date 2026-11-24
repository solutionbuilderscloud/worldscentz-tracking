// API do WORLD SCENTZ TRACKING — roda em http://localhost:5318 (o Vite repassa /api para cá).
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { bodyLimit } from 'hono/body-limit'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DB_PATH, db, importMscFile, listShipments, getShipment, saveShipment, setArrived, deleteShipment, getLog, findByUnit, stats,
  getSettings, setSettings, updateOps, recentLog, addDocument, getDocument, removeDocument, listRuns, lastGoodRun,
} from './db.mjs'
import {
  ROLES, can, needsSetup, createUser, updateUser, listUsers, login, logout, userFromCookie, sessionCookie, clearCookie,
} from './auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = new Hono()

app.onError((err, c) => {
  if (!err.status || err.status >= 500) console.error(err)
  return c.json({ error: err.message || 'Erro interno' }, err.status || 500)
})

const clean = (s) => String(s ?? '').trim().toUpperCase()
const deny = (msg = 'Seu perfil não tem permissão para isso.') => Object.assign(new Error(msg), { status: 403 })
const need = (c, action) => { if (!can(c.get('user'), action)) throw deny() }
const who = (c) => c.get('user')?.name

/* ---------- login ---------- */
app.get('/api/health', (c) => c.json({ ok: true, ...stats() }))

app.get('/api/auth/state', (c) => c.json({ needsSetup: needsSetup(), user: userFromCookie(c.req.header('cookie')) }))

// primeiro acesso: cria o administrador (só funciona com o banco sem usuários)
app.post('/api/auth/setup', async (c) => {
  if (!needsSetup()) throw deny('O administrador já foi criado.')
  const b = await c.req.json()
  createUser({ ...b, role: 'admin' })
  const s = login(b.username, b.password)
  c.header('set-cookie', sessionCookie(s.token))
  return c.json({ user: s.user })
})

app.post('/api/auth/login', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const s = login(b.username, b.password)
  if (!s) return c.json({ error: 'Usuário ou senha incorretos.' }, 401)
  c.header('set-cookie', sessionCookie(s.token))
  return c.json({ user: s.user })
})

app.post('/api/auth/logout', (c) => {
  const u = userFromCookie(c.req.header('cookie'))
  if (u) logout(u.token)
  c.header('set-cookie', clearCookie())
  return c.json({ ok: true })
})

// tudo abaixo exige login
app.use('/api/*', async (c, next) => {
  const u = userFromCookie(c.req.header('cookie'))
  if (!u) return c.json({ error: 'Faça login para continuar.' }, 401)
  c.set('user', u)
  await next()
})

/* ---------- usuários (admin) ---------- */
app.get('/api/users', (c) => { need(c, 'admin'); return c.json({ users: listUsers(), roles: ROLES }) })
app.post('/api/users', async (c) => { need(c, 'admin'); return c.json(createUser(await c.req.json()), 201) })
app.put('/api/users/:id', async (c) => {
  need(c, 'admin')
  const b = await c.req.json()
  return c.json(updateUser(Number(c.req.param('id')), { name: b.name, role: b.role, password: b.password, active: b.active }))
})
// trocar a própria senha
app.post('/api/me/password', async (c) => {
  const b = await c.req.json()
  if (!login(c.get('user').username, b.current)) return c.json({ error: 'Senha atual incorreta.' }, 400)
  updateUser(c.get('user').id, { password: b.password })
  const s = login(c.get('user').username, b.password)
  c.header('set-cookie', sessionCookie(s.token))
  return c.json({ ok: true })
})

/* ---------- configurações ---------- */
app.get('/api/settings', (c) => c.json(getSettings()))
app.put('/api/settings', async (c) => { need(c, 'admin'); return c.json(setSettings(await c.req.json())) })

/* ---------- B/Ls ---------- */
// lista: ?status=active | arrived (sem filtro = todos)
app.get('/api/shipments', (c) => c.json(listShipments(c.req.query('status') || undefined)))

app.get('/api/shipments/:tracker', (c) => {
  const s = getShipment(clean(c.req.param('tracker')))
  return s ? c.json(s) : c.json({ error: 'Não encontrado' }, 404)
})

app.post('/api/shipments', async (c) => {
  need(c, 'edit')
  const body = await c.req.json()
  if (!clean(body.tracker)) return c.json({ error: 'Informe o Nº do tracker.' }, 400)
  const saved = saveShipment({ ...body, tracker: clean(body.tracker) }, { create: true, by: who(c) })
  // B/L da MSC cadastrado à mão: busca a rota na MSC na hora
  if (/^(MEDU|MSCU|MSDU|MSMU|MSNU|MSBU)[A-Z0-9]{6,}$/.test(saved.tracker) && !process.env.WORLDSCENTZ_NO_AUTOSYNC) runSync('novo-bl', [saved.tracker])
  return c.json(saved, 201)
})

app.put('/api/shipments/:tracker', async (c) => {
  need(c, 'edit')
  const body = await c.req.json()
  return c.json(saveShipment({ ...body, tracker: clean(c.req.param('tracker')) }, { by: who(c) }))
})

app.delete('/api/shipments/:tracker', (c) => {
  need(c, 'admin')
  return deleteShipment(clean(c.req.param('tracker')), who(c)) ? c.json({ ok: true }) : c.json({ error: 'Não encontrado' }, 404)
})

// despacho, custos, caminhão, free time e conferência
app.patch('/api/shipments/:tracker/ops', async (c) => {
  const b = await c.req.json()
  const onlyReceipt = Object.keys(b).every((k) => k === 'receipt')
  need(c, onlyReceipt ? 'receive' : 'edit')
  return c.json(updateOps(clean(c.req.param('tracker')), b, who(c)))
})

// mover para o histórico (chegou no barracão) / reabrir
app.post('/api/shipments/:tracker/arrive', async (c) => {
  need(c, 'receive')
  const body = await c.req.json().catch(() => ({}))
  const t = clean(c.req.param('tracker'))
  if (body.receipt) updateOps(t, { receipt: body.receipt }, who(c))
  return c.json(setArrived(t, true, body.at, who(c)))
})
app.post('/api/shipments/:tracker/reopen', (c) => { need(c, 'receive'); return c.json(setArrived(clean(c.req.param('tracker')), false, undefined, who(c))) })

app.get('/api/shipments/:tracker/log', (c) => c.json(getLog(clean(c.req.param('tracker')))))
app.get('/api/log/recent', (c) => c.json(recentLog(Number(c.req.query('days')) || 30)))

// achar um B/L pelo número do container físico (inclusive no histórico)
app.get('/api/units', (c) => c.json(findByUnit(clean(c.req.query('q')))))

/* ---------- documentos ---------- */
app.post('/api/shipments/:tracker/docs', bodyLimit({ maxSize: 25 * 1024 * 1024, onError: (c) => c.json({ error: 'Arquivo maior que 25 MB.' }, 413) }), async (c) => {
  need(c, 'edit')
  const body = await c.req.parseBody()
  const file = body.file
  if (!file || typeof file === 'string') return c.json({ error: 'Envie um arquivo.' }, 400)
  const data = Buffer.from(await file.arrayBuffer())
  addDocument(clean(c.req.param('tracker')), { kind: String(body.kind || 'outro'), name: file.name, mime: file.type, data }, who(c))
  return c.json(getShipment(clean(c.req.param('tracker'))))
})
app.get('/api/docs/:id', (c) => {
  const d = getDocument(Number(c.req.param('id')))
  if (!d || !fs.existsSync(d.path)) return c.json({ error: 'Documento não encontrado.' }, 404)
  // só abre no navegador formatos seguros (PDF e fotos); o resto é baixado
  const inline = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(d.mime || '')
  return new Response(fs.readFileSync(d.path), {
    headers: {
      'content-type': inline ? d.mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(d.name)}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})
app.delete('/api/docs/:id', (c) => {
  need(c, 'edit')
  const d = getDocument(Number(c.req.param('id')))
  if (!d) return c.json({ error: 'Documento não encontrado.' }, 404)
  removeDocument(d.id, who(c))
  return c.json(getShipment(d.tracker))
})

/* ---------- MSC: atualização automática e manual ---------- */
// O servidor roda scripts/msc-sync.mjs (Chrome sem janela) nos horários configurados,
// recupera horários perdidos (Mac desligado/dormindo), tenta de novo quando falha
// e avisa no Mac quando a MSC traz novidade.
const sync = { running: false, startedAt: null, finishedAt: null, ok: null, done: 0, total: 0, message: '', trigger: null, trackers: null, last: null }
const queue = [] // pedidos que chegaram enquanto outra atualização rodava
let retryAt = 0  // próxima tentativa depois de uma falha

function notifyMac(title, text) {
  if (process.platform !== 'darwin' || !getSettings().mscNotify) return
  const q = (x) => '"' + String(x).replace(/[\\"]/g, ' ').slice(0, 200) + '"'
  spawn('osascript', ['-e', `display notification ${q(text)} with title ${q(title)} sound name "Glass"`], { stdio: 'ignore' }).on('error', () => {})
}

function runSync(trigger = 'manual', trackers = null) {
  if (sync.running) {
    if (trackers?.length) queue.push({ trigger, trackers })
    return false
  }
  Object.assign(sync, { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, done: 0, total: 0, message: 'Abrindo o site da MSC…', trigger, trackers })
  const script = path.join(root, 'scripts/msc-sync.mjs')
  const args = [script, `--origem=${trigger}`, ...(trackers ?? [])]
  // no Mac, "caffeinate" impede que o computador durma no meio da atualização
  const cmd = process.platform === 'darwin' && fs.existsSync('/usr/bin/caffeinate') ? ['/usr/bin/caffeinate', ['-i', process.execPath, ...args]] : [process.execPath, args]
  const p = spawn(cmd[0], cmd[1], { cwd: root, env: process.env })
  let tail = '', result = null
  const onData = (buf) => {
    const text = buf.toString()
    tail = (tail + text).slice(-3000)
    for (const line of text.split('\n')) {
      if (!line.startsWith('@@ ')) continue
      let ev; try { ev = JSON.parse(line.slice(3)) } catch { continue }
      if (ev.type === 'start') sync.total = ev.total
      if (ev.type === 'progress') { sync.done = ev.done; sync.total = ev.total; sync.message = `Consultando ${ev.done} de ${ev.total}…` }
      if (ev.type === 'info') sync.message = ev.message
      if (ev.type === 'done') result = ev
    }
  }
  p.stdout.on('data', onData)
  p.stderr.on('data', onData)
  p.on('close', (code) => {
    sync.running = false
    sync.finishedAt = new Date().toISOString()
    const failed = result?.failed?.length ?? 0
    sync.ok = !!result && !result.error && result.ok > 0
    sync.last = result
    if (!result) sync.message = 'Falhou: ' + (tail.trim().split('\n').filter((l) => !l.startsWith('@@')).pop() || `código ${code}`)
    else if (result.error) sync.message = 'Falhou: ' + result.error
    else sync.message = `${result.ok} de ${result.ok + failed} atualizados · ${result.changes.length} novidade(s)${failed ? ` · ${failed} com falha` : ''}`
    console.log(`[MSC] ${trigger}: ${sync.message}`)
    // nova tentativa: 20 min depois de uma falha total, 60 min se só alguns falharam
    if (trigger !== 'novo-bl') retryAt = !sync.ok ? Date.now() + 20 * 60e3 : failed ? Date.now() + 60 * 60e3 : 0
    if (result?.changes?.length) {
      const c = result.changes.filter((x) => x.kind !== 'created')
      if (c.length) notifyMac('WORLD SCENTZ · novidades da MSC', c.length === 1 ? `${c[0].tracker}: ${c[0].text}` : `${c.length} novidades em ${new Set(c.map((x) => x.tracker)).size} B/Ls — ${c[0].tracker}: ${c[0].text}`)
    } else if (!sync.ok && trigger === 'auto') notifyMac('WORLD SCENTZ · MSC', 'A atualização automática falhou. Vou tentar de novo em 20 minutos.')
    const next = queue.shift()
    if (next) setTimeout(() => runSync(next.trigger, [...new Set(queue.splice(0).flatMap((q) => q.trackers).concat(next.trackers))]), 1000)
  })
  return true
}

/** Último horário programado que já passou (hoje ou ontem). */
function lastSlot(now, times) {
  const hs = [...times].sort((a, b) => a - b)
  for (let d = 0; d <= 1; d++) {
    for (let i = hs.length - 1; i >= 0; i--) {
      const t = new Date(now); t.setDate(t.getDate() - d); t.setHours(hs[i], 0, 0, 0)
      if (t <= now) return t
    }
  }
  return null
}
function nextSlot(now, times) {
  const hs = [...times].sort((a, b) => a - b)
  for (let d = 0; d <= 1; d++) for (const h of hs) {
    const t = new Date(now); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0)
    if (t > now) return t
  }
  return null
}
const utc = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')) : null)

function schedulerTick() {
  const s = getSettings()
  if (!s.mscAutoSync || sync.running || process.env.WORLDSCENTZ_NO_AUTOSYNC || !s.mscSyncTimes?.length) return
  const now = new Date()
  if (retryAt && now.getTime() >= retryAt) { retryAt = 0; console.log('[MSC] nova tentativa…'); runSync('auto'); return }
  const slot = lastSlot(now, s.mscSyncTimes)
  const last = utc(lastGoodRun())
  const lastTry = utc(listRuns(1)[0]?.startedAt)
  // perdeu o horário (ou nunca rodou) e não tentou desde então
  if (slot && (!last || last < slot) && (!lastTry || lastTry < slot)) { console.log(`[MSC] atualização das ${slot.getHours()}h começando…`); runSync('auto') }
}
setInterval(schedulerTick, 60 * 1000)
setTimeout(schedulerTick, 20 * 1000) // logo depois de ligar: recupera o horário perdido

app.get('/api/msc/status', (c) => {
  const s = getSettings()
  const runs = listRuns(1)
  const now = new Date()
  return c.json({
    running: sync.running, ok: sync.running ? null : sync.ok ?? (runs[0] ? runs[0].status !== 'error' : null), message: sync.message, done: sync.done, total: sync.total,
    trigger: sync.trigger, trackers: sync.trackers,
    lastSyncAt: utc(lastGoodRun())?.toISOString() ?? null, finishedAt: sync.finishedAt,
    autoSync: s.mscAutoSync, syncTimes: s.mscSyncTimes,
    nextAt: s.mscAutoSync ? (retryAt ? new Date(retryAt) : nextSlot(now, s.mscSyncTimes))?.toISOString() ?? null : null,
    retrying: !!retryAt,
  })
})
app.get('/api/msc/runs', (c) => c.json(listRuns(Number(c.req.query('limit')) || 15)))
app.post('/api/msc/sync', async (c) => {
  need(c, 'sync')
  const b = await c.req.json().catch(() => ({}))
  const trackers = Array.isArray(b.trackers) ? b.trackers.map(clean).filter((t) => /^[A-Z0-9]{8,20}$/.test(t)) : null
  if (!runSync(trackers?.length ? 'manual' : 'manual', trackers?.length ? trackers : null)) {
    return trackers?.length ? c.json({ queued: true }) : c.json({ error: 'Já existe uma atualização em andamento.' }, 409)
  }
  return c.json({ started: true })
})
// reimporta src/msc-data.json (o npm run msc:sync já faz isso sozinho)
app.post('/api/msc/import', (c) => { need(c, 'sync'); return c.json(importMscFile()) })

/* ---------- backup ---------- */
app.get('/api/backup', (c) => {
  need(c, 'admin')
  const file = path.join(path.dirname(DB_PATH), `worldscentz-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const buf = fs.readFileSync(file)
  fs.unlinkSync(file)
  return new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${path.basename(file)}"` } })
})

// primeira execução: carrega os B/Ls da MSC que já estão no projeto
if (stats().active + stats().arrived === 0) {
  const r = importMscFile()
  console.log(`Banco novo: ${r.added} B/Ls importados da MSC.`)
}

const port = Number(process.env.PORT || 5318)
const hostname = process.env.HOST || 'localhost'
serve({ fetch: app.fetch, port, hostname }, () => console.log(`API WORLD SCENTZ TRACKING em http://${hostname}:${port} · banco: ${DB_PATH}`))
