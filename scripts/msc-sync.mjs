// Sincroniza os B/Ls da MSC com o WORLD SCENTZ TRACKING.
//
// Uso:
//   npm run msc:sync                  -> consulta todos os B/Ls ativos (banco + data/trackers.txt)
//   npm run msc:sync -- MEDUADJ56199  -> consulta só os números informados
//   npm run msc:sync -- --todos       -> inclui também os que já chegaram (histórico)
//   npm run msc:sync -- --visivel     -> abre a janela do Chrome (para ver o que está acontecendo)
//   node scripts/msc-sync.mjs --raw arquivo.json -> só converte um resultado bruto já baixado
//
// Como funciona:
//   1. Abre o Google Chrome instalado, sem janela, no site da MSC (o site bloqueia consultas sem navegador).
//   2. Faz a primeira consulta pelo formulário, como uma pessoa faria.
//   3. As demais vão direto pela mesma página (≈1 s cada), 3 por vez, com até 3 tentativas cada.
//   4. Se o site bloquear o modo sem janela, tenta de novo com a janela aberta. Se a consulta direta falhar, usa o formulário.
//   5. Grava em src/msc-data.json e no banco, registrando tudo o que mudou.
//
// Saída para o servidor (uma linha por evento): "@@ {json}"

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'src/msc-data.json')
const URL_TRACK = 'https://www.msc.com/en/track-a-shipment'
const API = 'https://www.msc.com/api/feature/tools/TrackingInfo'

const POD_CODES = { 'CAACUPEMI ASUNCION, PY': 'PYBCM', 'TERPORT VILLETA, PY': 'PYTVT' }
const iso = (d) => { if (!d) return ''; const [dd, mm, yy] = d.slice(0, 10).split('/'); return `${yy}-${mm}-${dd}` }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const emit = (o) => console.log('@@ ' + JSON.stringify(o))

/** Converte a resposta da MSC no formato do WORLD SCENTZ. Devolve { bl, error } quando não há resultado. */
function normalize(bl, body) {
  const data = JSON.parse(body)
  if (!data.IsSuccess || !data.Data?.BillOfLadings?.length) return { bl, error: 'Sem resultado na MSC' }
  const b = data.Data.BillOfLadings[0]
  const g = b.GeneralTrackingInfo
  const podCode = POD_CODES[g.PortOfDischarge] || /\b(PY|BR)[A-Z]{3}\b/.exec(JSON.stringify(b.ContainersInfo?.[0]?.Events?.slice(-1) ?? ''))?.[0] || ''
  return {
    bl,
    fetchedAt: new Date().toISOString(),
    from: g.ShippedFrom,
    to: g.ShippedTo,
    pod: g.PortOfDischarge,
    podCode,
    podEta: iso(g.FinalPodEtaDate),
    transshipments: g.Transshipments || [],
    delivered: !!b.Delivered,
    units: b.ContainersInfo.map((c) => ({
      n: c.ContainerNumber,
      type: c.ContainerType,
      podEta: iso(c.PodEtaDate),
      delivered: !!c.Delivered,
      events: [...c.Events].sort((a, z) => a.Order - z.Order).map((e) => ({
        o: e.Order,
        d: iso(e.Date),
        loc: e.UnLocationCode,
        name: e.Location,
        desc: e.Description,
        vessel: e.Detail?.[0] && !['LADEN', 'EMPTY'].includes(e.Detail[0]) ? e.Detail[0] : '',
        voyage: e.Detail?.[1] || '',
        terminal: e.EquipmentHandling?.Name || '',
      })),
    })),
  }
}

/* ---------- navegador ---------- */
async function openBrowser(headless) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless, args: ['--disable-blink-features=AutomationControlled'] })
  // sem janela o Chrome se identifica como "HeadlessChrome"; usa a identificação normal da mesma versão
  const v = browser.version()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 }, locale: 'pt-BR',
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
  })
  const page = await ctx.newPage()
  return { browser, page }
}

/** Abre o site e faz a primeira consulta pelo formulário (cria os cookies de acesso). */
async function warmUp(page, first) {
  let body = null
  const onResp = async (r) => { if (r.url().includes('TrackingInfo')) { try { body = await r.text() } catch { /* */ } } }
  page.on('response', onResp)
  await page.goto(URL_TRACK, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(4000)
  try { await page.click('#onetrust-accept-btn-handler', { timeout: 2500 }) } catch { /* sem aviso de cookies */ }
  const input = page.locator('input#trackingNumber, input[name="trackingNumber"]').first()
  await input.waitFor({ timeout: 20000 })
  await input.fill(first); await input.press('Enter')
  for (let i = 0; i < 40 && !body; i++) await page.waitForTimeout(500)
  page.off('response', onResp)
  return body
}

/** Consulta direta pela página já aberta. */
async function fetchInPage(page, bl) {
  return page.evaluate(async ({ api, bl }) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000)
    try {
      const r = await fetch(api, {
        method: 'POST', signal: ctl.signal, credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ trackingNumber: bl, trackingMode: '0' }),
      })
      return { status: r.status, body: await r.text() }
    } catch (e) { return { status: 0, body: String(e) } } finally { clearTimeout(t) }
  }, { api: API, bl })
}

/** Consulta pelo formulário (plano B, mais lento). */
async function fetchByForm(page, bl) {
  let body = null
  const onResp = async (r) => { if (r.url().includes('TrackingInfo')) { try { body = await r.text() } catch { /* */ } } }
  page.on('response', onResp)
  const input = page.locator('input#trackingNumber, input[name="trackingNumber"]').first()
  await input.fill(''); await input.fill(bl); await input.press('Enter')
  for (let i = 0; i < 40 && !body; i++) await page.waitForTimeout(500)
  page.off('response', onResp)
  await page.waitForTimeout(1200)
  return body
}

async function fetchAll(numbers, { visible = false } = {}) {
  const results = {}   // bl -> normalizado
  const failed = {}    // bl -> motivo
  let done = 0
  const progress = () => emit({ type: 'progress', done, total: numbers.length })

  for (const headless of visible ? [false] : [true, false]) {
    const pending = numbers.filter((n) => !results[n])
    if (!pending.length) break
    emit({ type: 'info', message: headless ? 'Abrindo o site da MSC (sem janela)…' : 'Abrindo o site da MSC com janela…' })
    let browser
    try {
      const o = await openBrowser(headless); browser = o.browser
      const page = o.page
      const firstBody = await warmUp(page, pending[0])
      let first = null
      try { first = firstBody && normalize(pending[0], firstBody) } catch { /* resposta inválida */ }
      if (!first) { emit({ type: 'info', message: 'O site da MSC não respondeu à primeira consulta.' }); continue }
      if (first.error) failed[pending[0]] = first.error; else { results[pending[0]] = first; delete failed[pending[0]] }
      done = Object.keys(results).length + Object.keys(failed).length; progress()

      // demais: 3 por vez, consulta direta; até 3 tentativas; se a direta não funcionar, formulário
      let direct = true
      let formLock = Promise.resolve(null)
      const byForm = (bl) => (formLock = formLock.catch(() => null).then(() => fetchByForm(page, bl)))
      const queue = pending.slice(1)
      const one = async (bl) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          let body = null, status = 0
          if (direct) { const r = await fetchInPage(page, bl); status = r.status; body = r.status === 200 ? r.body : null }
          else body = await byForm(bl)
          if (body) {
            try {
              const n = normalize(bl, body)
              if (n.error) { failed[bl] = n.error; return }
              results[bl] = n; delete failed[bl]; return
            } catch { /* resposta inválida, tenta de novo */ }
          }
          if (direct && (status === 403 || status === 0) && attempt === 2) {
            // o site recusou a consulta direta: recarrega a página e segue pelo formulário
            direct = false
            emit({ type: 'info', message: 'Consulta direta recusada; seguindo pelo formulário (mais lento).' })
            try { await page.goto(URL_TRACK, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(3000) } catch { /* */ }
          }
          failed[bl] = status ? `Erro ${status} no site da MSC` : 'Sem resposta do site da MSC'
          await sleep(1500 * attempt)
        }
      }
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const bl = queue.shift()
          await one(bl)
          done = Object.keys(results).length + Object.keys(failed).length; progress()
          await sleep(direct ? 350 : 0)
        }
      })
      await Promise.all(workers)
    } catch (e) {
      emit({ type: 'info', message: 'Falha no navegador: ' + (e?.message ?? e) })
    } finally {
      try { await browser?.close() } catch { /* */ }
    }
    if (!numbers.some((n) => !results[n] && !failed[n]) && Object.keys(results).length) break
  }
  for (const n of numbers) if (!results[n] && !failed[n]) failed[n] = 'Sem resposta do site da MSC'
  return { results, failed }
}

/* ---------- execução ---------- */
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const trigger = (args.find((a) => a.startsWith('--origem=')) ?? '--origem=terminal').split('=')[1]
const db = await import('../server/db.mjs')

let results = {}, failed = {}
let numbers = []
if (args[0] === '--raw') {
  const j = JSON.parse(fs.readFileSync(args[1], 'utf8'))
  for (const [k, v] of Object.entries(j)) { const body = v?.body ?? v; if (body) try { const n = normalize(k, body); if (n.error) failed[k] = n.error; else results[k] = n } catch { failed[k] = 'inválido' } }
  numbers = Object.keys(j)
} else {
  const asked = args.filter((a) => !a.startsWith('--')).map((x) => x.trim().toUpperCase())
  numbers = [...new Set(asked.length ? asked : db.trackersToSync({ includeArrived: flags.has('--todos') }))]
  if (!numbers.length) { emit({ type: 'done', ok: 0, failed: [], changes: [] }); console.log('Nenhum B/L para consultar.'); process.exit(0) }
}

const runId = db.startRun(trigger, numbers.length)
emit({ type: 'start', runId, total: numbers.length })
try {
  if (args[0] !== '--raw') ({ results, failed } = await fetchAll(numbers, { visible: flags.has('--visivel') }))

  // junta com o arquivo anterior (mantém quem não foi consultado agora)
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { bls: [] }
  const byBl = new Map(prev.bls.map((x) => [x.bl, x]))
  for (const [bl, n] of Object.entries(results)) byBl.set(bl, n)
  const order = db.trackersToSync({ includeArrived: true })
  const bls = [...byBl.values()].sort((a, b) => (order.indexOf(a.bl) + 1 || 1e9) - (order.indexOf(b.bl) + 1 || 1e9))
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), carrier: 'MSC', bls }))

  const r = db.importMscFile(OUT, new Set(Object.keys(results)))
  const failList = Object.entries(failed).map(([bl, reason]) => ({ bl, reason }))
  db.finishRun(runId, { ok: Object.keys(results).length, failed: failList, changes: r.changes })
  emit({ type: 'done', runId, ok: Object.keys(results).length, failed: failList, changes: r.changes })
  console.log(`\n${Object.keys(results).length}/${numbers.length} B/Ls atualizados · ${r.changes.length} novidades · ${failList.length} falharam`)
  for (const c of r.changes) console.log(`  ${c.tracker}: ${c.text}`)
  for (const f of failList) console.log(`  ✗ ${f.bl}: ${f.reason}`)
  process.exit(Object.keys(results).length || !numbers.length ? 0 : 1)
} catch (e) {
  db.finishRun(runId, { ok: 0, error: String(e?.message ?? e) })
  emit({ type: 'done', runId, ok: 0, failed: [], changes: [], error: String(e?.message ?? e) })
  console.error(e)
  process.exit(1)
}
