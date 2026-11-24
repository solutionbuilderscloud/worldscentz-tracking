// Telas e painéis da operação: login, alertas, despacho/free time, documentos, custos,
// conferência no barracão, importação de packing list, relatórios e configurações.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, CheckCircle2, Circle, Clock, Download, FileText, FileUp, Info, Lock, LogIn, Printer, RefreshCw, Save,
  ShieldCheck, Trash2, Truck, Upload, UserPlus, X, Siren, Settings as Cog, Users, SprayCan, Anchor, Ship,
} from 'lucide-react'
import {
  DAY, LOCS, WAREHOUSES, fmtDate, isoDay, parseDate, productQty, unitCount, locName,
  type Container, type Country, type CustomsStep, type Receipt, type ProductItem,
} from './data'
import {
  CHANNELS, COST_FIELDS, CUSTOMS_STEPS, DOC_KINDS, FREE_COLOR, ROLE_HINT, ROLE_LABEL, can, costTotal, docLabel, freeText, freeTime,
  missingDocs, parsePacking, parsePastedText, usd,
  type Alert, type LogRow, type Role, type Settings, type SyncRun, type SyncStatus, type User,
} from './ops'
import { api, type OpsPatch } from './api'
import { Flag, Modal, COUNTRY_NAME, LOGO, containerColor } from './ui'

const today = () => isoDay(Date.now())
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/* ====================== LOGIN ====================== */

export function LoginScreen({ needsSetup, onDone }: { needsSetup: boolean; onDone: (u: User) => void }) {
  const [f, setF] = useState({ username: '', name: '', password: '', confirm: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (needsSetup && f.password !== f.confirm) return setErr('As senhas não conferem.')
    setBusy(true)
    try {
      const r = needsSetup ? await api.setup({ username: f.username, name: f.name, password: f.password }) : await api.login(f.username, f.password)
      onDone(r.user)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="shell boot login">
      <form className="login-card" onSubmit={submit}>
        <img src={LOGO} alt="WORLD SCENTZ" />
        <span className="brand-sub">TRACKING</span>
        {needsSetup ? (
          <>
            <h2>Primeiro acesso</h2>
            <p>Crie o usuário administrador. Depois você cadastra a equipe em Configurações.</p>
            <label>Seu nome<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Gabriel Silvério" required autoFocus /></label>
            <label>Usuário<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="gabriel" required autoComplete="username" /></label>
            <label>Senha<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={6} autoComplete="new-password" /></label>
            <label>Repita a senha<input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required minLength={6} autoComplete="new-password" /></label>
          </>
        ) : (
          <>
            <h2>Entrar</h2>
            <label>Usuário<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required autoFocus autoComplete="username" /></label>
            <label>Senha<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="current-password" /></label>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <button className="btn red full" disabled={busy}>{needsSetup ? <><UserPlus size={16} /> Criar administrador</> : <><LogIn size={16} /> Entrar</>}</button>
      </form>
    </div>
  )
}

/* ====================== ALERTAS ====================== */

const ALERT_ICON = { danger: Siren, warn: AlertTriangle, info: Info }

export function AlertsMenu({ alerts, onOpen, onClose }: { alerts: Alert[]; onOpen: (a: Alert) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.bell-btn')) onClose() }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', h); window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [onClose])
  const urgent = alerts.filter((a) => a.level !== 'info').length
  return (
    <div className="alerts" ref={ref}>
      <div className="alerts-h"><b>Central de alertas</b><small>{urgent ? `${urgent} pedem ação` : 'Nada urgente'}</small></div>
      {!alerts.length ? <div className="empty"><CheckCircle2 size={22} /><br />Tudo em dia.</div> : (
        <ul>
          {alerts.map((a) => {
            const Icon = ALERT_ICON[a.level]
            return (
              <li key={a.id} className={a.level} onClick={() => a.tracker && onOpen(a)}>
                <span className="al-ic"><Icon size={16} /></span>
                <div><b>{a.title}</b><small>{a.text}</small></div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function BellButton({ alerts, open, setOpen }: { alerts: Alert[]; open: boolean; setOpen: (v: boolean) => void }) {
  const danger = alerts.some((a) => a.level === 'danger')
  const n = alerts.filter((a) => a.level !== 'info').length
  return (
    <button className={`icon-btn bell-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Alertas">
      <Bell size={17} />
      {n > 0 && <i className={`badge ${danger ? 'red' : ''}`}>{n}</i>}
    </button>
  )
}

/* ====================== MSC ====================== */

const dt = (s?: string | null, withDay = true) => (s ? new Date(s).toLocaleString('pt-BR', withDay ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }) : '—')
const ago = (s?: string | null) => {
  if (!s) return 'nunca'
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000)
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 48 * 60 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`
}

export function SyncButton({ sync, user, onSync }: { sync: SyncStatus | null; user: User; onSync: () => void }) {
  const pct = sync?.running && sync.total ? Math.round((sync.done / sync.total) * 100) : 0
  const label = sync?.running ? (sync.total ? `MSC ${pct}%` : 'MSC…') : `MSC ${ago(sync?.lastSyncAt)}`
  const tip = sync?.running ? sync.message
    : `Última atualização: ${dt(sync?.lastSyncAt)}${sync?.nextAt ? ` · próxima: ${dt(sync.nextAt)}${sync.retrying ? ' (nova tentativa)' : ''}` : ''}${can(user, 'sync') ? ' · clique para atualizar agora' : ''}`
  return (
    <button className={`sync-btn ${sync?.running ? 'run' : ''} ${sync?.ok === false ? 'fail' : ''}`} onClick={onSync} disabled={!can(user, 'sync') || sync?.running} title={tip}>
      <RefreshCw size={14} /> <span>{label}</span>
      {sync?.running && <i className="sync-prog" style={{ width: `${pct}%` }} />}
    </button>
  )
}

const TRIGGER_PT: Record<string, string> = { auto: 'Automática', manual: 'Manual', 'novo-bl': 'B/L novo', terminal: 'Terminal' }
const STATUS_PT: Record<SyncRun['status'], [string, string]> = {
  ok: ['OK', '#1E9E5A'], partial: ['Parcial', '#E8A317'], error: ['Falhou', '#F00000'], running: ['Rodando', '#2F6FED'],
}

function MscCard({ f, setF, admin, user, sync, onSync }: {
  f: Settings; setF: (s: Settings) => void; admin: boolean; user: User; sync: SyncStatus | null; onSync: () => void
}) {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { api.syncRuns(12).then(setRuns).catch(() => {}) }, [sync?.running, sync?.finishedAt])
  const toggleHour = (h: number) => setF({ ...f, mscSyncTimes: f.mscSyncTimes.includes(h) ? f.mscSyncTimes.filter((x) => x !== h) : [...f.mscSyncTimes, h].sort((a, b) => a - b) })
  const pct = sync?.running && sync.total ? (sync.done / sync.total) * 100 : 0
  return (
    <div className="card msc-card">
      <div className="card-h"><h3><RefreshCw size={17} /> Atualização automática da MSC</h3>
        {sync?.running ? <span className="pill" style={{ ['--c' as string]: '#2F6FED' }}><i />Atualizando</span>
          : f.mscAutoSync ? <span className="pill" style={{ ['--c' as string]: '#1E9E5A' }}><i />Ligada</span>
          : <span className="pill" style={{ ['--c' as string]: '#8A8A8A' }}><i />Desligada</span>}
      </div>
      <div className="msc-grid">
        <div className="msc-left">
          <p className="set-hint">O sistema consulta no site da MSC todos os B/Ls em rota, <b>sem abrir janela</b> (≈1 minuto para 50 B/Ls), e registra cada novidade: embarque, transbordo, descarga, mudança de chegada e entrega. Se falhar, tenta de novo sozinho. Se o Mac estava desligado no horário, atualiza assim que ligar.</p>
          <label className="switch"><input type="checkbox" checked={f.mscAutoSync} disabled={!admin} onChange={(e) => setF({ ...f, mscAutoSync: e.target.checked })} /><span className="sw" /> Atualizar automaticamente</label>
          <div className="hours">
            <small>Horários (clique para ligar/desligar)</small>
            <div className="hour-grid">
              {Array.from({ length: 24 }, (_, h) => (
                <button key={h} type="button" disabled={!admin || !f.mscAutoSync} className={f.mscSyncTimes.includes(h) ? 'on' : ''} onClick={() => toggleHour(h)}>{String(h).padStart(2, '0')}h</button>
              ))}
            </div>
          </div>
          <label className="switch"><input type="checkbox" checked={f.mscNotify} disabled={!admin} onChange={(e) => setF({ ...f, mscNotify: e.target.checked })} /><span className="sw" /> Avisar no Mac quando a MSC trouxer novidade</label>
          <div className="sync-box">
            <div>
              <small>Última atualização</small>
              <b>{dt(sync?.lastSyncAt)} <em className="muted">({ago(sync?.lastSyncAt)})</em></b>
              {sync?.running ? <small>{sync.message}</small>
                : sync?.nextAt ? <small>Próxima: {dt(sync.nextAt)}{sync.retrying ? ' — nova tentativa' : ''}</small> : null}
              {sync?.running && <div className="ft-bar"><i style={{ width: `${pct}%`, background: 'var(--black)' }} /></div>}
            </div>
            <button className="btn dark" onClick={onSync} disabled={!can(user, 'sync') || sync?.running}><RefreshCw size={15} /> {sync?.running ? 'Atualizando…' : 'Atualizar agora'}</button>
          </div>
        </div>
        <div className="msc-runs">
          <small>Últimas atualizações</small>
          {!runs.length ? <div className="empty">Nenhuma atualização registrada ainda.</div> : (
            <ul>
              {runs.map((r) => {
                const [label, color] = STATUS_PT[r.status]
                const news = r.changes.filter((c) => c.kind !== 'created')
                const secs = r.finishedAt ? Math.max(1, Math.round((new Date(r.finishedAt.replace(' ', 'T') + 'Z').getTime() - new Date(r.startedAt.replace(' ', 'T') + 'Z').getTime()) / 1000)) : 0
                return (
                  <li key={r.id} className={open === r.id ? 'open' : ''} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <div className="run-h">
                      <span className="pill" style={{ ['--c' as string]: color }}><i />{label}</span>
                      <b>{new Date(r.startedAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b>
                      <small>{TRIGGER_PT[r.trigger] ?? r.trigger} · {r.ok}/{r.total} B/L{secs ? ` · ${secs < 90 ? `${secs}s` : `${Math.round(secs / 60)} min`}` : ''}</small>
                      <em className={news.length ? 'news' : ''}>{news.length ? `${news.length} novidade${news.length > 1 ? 's' : ''}` : 'sem novidade'}</em>
                    </div>
                    {open === r.id && (
                      <div className="run-body">
                        {r.error && <div className="late">{r.error}</div>}
                        {news.map((c, i) => <div key={i}><b>{c.tracker}</b> {c.text}</div>)}
                        {r.failed.map((x) => <div key={x.bl} className="late"><b>{x.bl}</b> {x.reason}</div>)}
                        {!news.length && !r.failed.length && !r.error && <div className="muted">Nenhuma mudança nos B/Ls consultados.</div>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/* ====================== FREE TIME ====================== */

export function FreeBadge({ c, s }: { c: Container; s: Settings }) {
  const f = freeTime(c, s)
  return <span className="pill" style={{ ['--c' as string]: FREE_COLOR[f.state] }}><i />{freeText(f)}</span>
}

/* ====================== ABA DESPACHO (free time + etapas + caminhão) ====================== */

export function OpsTab({ c, s, user, onChange, notify }: { c: Container; s: Settings; user: User; onChange: (c: Container) => void; notify: (m: string) => void }) {
  const f = freeTime(c, s)
  const n = unitCount(c)
  const editable = can(user, 'edit')
  const [busy, setBusy] = useState(false)
  const [land, setLand] = useState(c.land ?? {})
  const [fd, setFd] = useState<string>(c.freeDays != null ? String(c.freeDays) : '')
  useEffect(() => { setLand(c.land ?? {}); setFd(c.freeDays != null ? String(c.freeDays) : '') }, [c.tracker]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (p: OpsPatch, msg = 'Salvo.') => {
    setBusy(true)
    try { onChange(await api.ops(c.tracker, p)); notify(msg) } catch (e) { notify('Erro: ' + errMsg(e)) } finally { setBusy(false) }
  }
  const stepDone = (k: CustomsStep) => (k === 'released' ? (c.customs?.released ?? (c.released ? { at: (c.releasedAt ?? '').slice(0, 10) } : undefined)) : c.customs?.[k])
  const pct = f.state === 'pending' ? 0 : Math.min(1, (f.days - Math.max(0, f.left)) / f.days)

  return (
    <div className="ops">
      <div className={`ft-card ${f.state}`}>
        <div className="ft-top">
          <div><small>Free time no porto</small><b style={{ color: FREE_COLOR[f.state] }}>{freeText(f)}</b></div>
          <Clock size={22} />
        </div>
        <div className="ft-bar"><i style={{ width: `${pct * 100}%`, background: FREE_COLOR[f.state] }} /></div>
        <div className="ft-grid">
          <div><small>Início {f.estimated ? '(previsto)' : ''}</small><b>{fmtDate(f.start)}</b></div>
          <div><small>Último dia livre</small><b>{fmtDate(f.end)}</b></div>
          <div><small>Diária após</small><b>{usd(f.rate * n)}</b></div>
          <div><small>{f.state === 'closed' ? 'Demurrage' : 'Demurrage até hoje'}</small><b className={f.cost ? 'late' : ''}>{usd(f.cost)}</b></div>
        </div>
        {editable && (
          <div className="ft-edit">
            <label>Dias livres deste B/L
              <input type="number" min={0} value={fd} placeholder={`padrão ${s.freeDays[c.country]}`} onChange={(e) => setFd(e.target.value)} />
            </label>
            <button className="btn sm" disabled={busy || fd === (c.freeDays != null ? String(c.freeDays) : '')} onClick={() => patch({ freeDays: fd === '' ? null : +fd }, 'Free time atualizado.')}>Salvar</button>
          </div>
        )}
      </div>

      <h4 className="ops-h"><ShieldCheck size={16} /> Despacho aduaneiro</h4>
      <ol className="steps">
        {CUSTOMS_STEPS.map((st, i) => {
          const d = stepDone(st.k)
          return (
            <li key={st.k} className={d ? 'done' : ''}>
              <span className="st-dot">{d ? <CheckCircle2 size={18} /> : <Circle size={18} />}</span>
              <div className="st-main">
                <b>{i + 1}. {st.label}</b>
                <small>{d ? `${fmtDate(d.at)}${d.by ? ` · ${d.by}` : ''}` : st.hint}</small>
                {st.k === 'channel' && d?.value && <span className="pill" style={{ ['--c' as string]: CHANNELS[d.value] ?? '#8A8A8A' }}><i />Canal {d.value}</span>}
              </div>
              {editable && (
                <div className="st-act">
                  {st.k === 'channel' && !d ? (
                    <select defaultValue="" disabled={busy} onChange={(e) => e.target.value && patch({ customs: { channel: { at: today(), value: e.target.value } } }, `Canal ${e.target.value} registrado.`)}>
                      <option value="" disabled>Canal…</option>
                      {Object.keys(CHANNELS).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  ) : d ? (
                    <button className="icon-btn sm" title="Desfazer" disabled={busy} onClick={() => confirm(`Desfazer "${st.label}"?`) && patch({ customs: { [st.k]: null } }, 'Etapa desfeita.')}><X size={14} /></button>
                  ) : (
                    <StepDate busy={busy} onPick={(at) => patch({ customs: { [st.k]: { at } } }, `${st.label}: registrado.`)} />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <h4 className="ops-h"><Truck size={16} /> Caminhão (porto → barracão)</h4>
      <div className="land-form">
        <label>Transportadora<input value={land.company ?? ''} onChange={(e) => setLand({ ...land, company: e.target.value })} disabled={!editable} /></label>
        <label>Placa<input value={land.plate ?? ''} onChange={(e) => setLand({ ...land, plate: e.target.value.toUpperCase() })} disabled={!editable} /></label>
        <label>Motorista<input value={land.driver ?? ''} onChange={(e) => setLand({ ...land, driver: e.target.value })} disabled={!editable} /></label>
        <label>Telefone<input value={land.phone ?? ''} onChange={(e) => setLand({ ...land, phone: e.target.value })} disabled={!editable} /></label>
        <label>Previsão no barracão<input type="date" value={land.eta ?? c.eta} onChange={(e) => setLand({ ...land, eta: e.target.value })} disabled={!editable} /></label>
        {editable && <button className="btn dark" disabled={busy} onClick={() => patch({ land }, 'Caminhão salvo.')}><Save size={15} /> Salvar caminhão</button>}
      </div>
      {land.phone && <a className="btn sm wa" href={`https://wa.me/${land.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">Chamar motorista no WhatsApp</a>}
    </div>
  )
}

function StepDate({ onPick, busy }: { onPick: (d: string) => void; busy: boolean }) {
  const [d, setD] = useState(today())
  return (
    <span className="step-date">
      <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
      <button className="btn sm dark" disabled={busy} onClick={() => onPick(d)}>OK</button>
    </span>
  )
}

/* ====================== ABA DOCUMENTOS ====================== */

export function DocsTab({ c, user, onChange, notify }: { c: Container; user: User; onChange: (c: Container) => void; notify: (m: string) => void }) {
  const [kind, setKind] = useState('invoice')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const editable = can(user, 'edit')
  const docs = c.docs ?? []
  const miss = missingDocs(c)
  const upload = async (files: FileList | null, k = kind) => {
    if (!files?.length) return
    setBusy(true)
    try { let last = c; for (const f of Array.from(files)) last = await api.uploadDoc(c.tracker, k, f); onChange(last); notify(`${files.length} arquivo(s) anexado(s).`) }
    catch (e) { notify('Erro: ' + errMsg(e)) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async (id: number, name: string) => {
    if (!confirm(`Remover o documento ${name}?`)) return
    try { onChange(await api.removeDoc(id)); notify('Documento removido.') } catch (e) { notify('Erro: ' + errMsg(e)) }
  }
  const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
  return (
    <div className="docs">
      <ul className="doc-check">
        {DOC_KINDS.filter((d) => d.required).map((d) => {
          const has = docs.some((x) => x.kind === d.k)
          return <li key={d.k} className={has ? 'ok' : ''}>{has ? <CheckCircle2 size={15} /> : <Circle size={15} />} {d.label}</li>
        })}
      </ul>
      {!!miss.length && <div className="sim-note"><b>Faltam {miss.length} documento(s)</b>{miss.map((d) => d.label).join(', ')}</div>}
      {editable && (
        <div className="doc-up">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOC_KINDS.map((d) => <option key={d.k} value={d.k}>{d.label}</option>)}
          </select>
          <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button className="btn dark" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} /> {busy ? 'Enviando…' : 'Anexar arquivo'}</button>
        </div>
      )}
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.id}>
            <FileText size={20} />
            <a href={`/api/docs/${d.id}`} target="_blank" rel="noreferrer"><b>{d.name}</b><small>{docLabel(d.kind)} · {size(d.size)} · {new Date(d.at.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')}{d.by ? ` · ${d.by}` : ''}</small></a>
            {editable && <button className="icon-btn sm" onClick={() => remove(d.id, d.name)} title="Remover"><Trash2 size={14} /></button>}
          </li>
        ))}
        {!docs.length && <li className="empty">Nenhum documento anexado.</li>}
      </ul>
    </div>
  )
}

/* ====================== ABA CUSTOS ====================== */

export function CostsTab({ c, s, user, onChange, notify }: { c: Container; s: Settings; user: User; onChange: (c: Container) => void; notify: (m: string) => void }) {
  const [v, setV] = useState<Record<string, string>>({})
  useEffect(() => setV(Object.fromEntries(COST_FIELDS.map((f) => [f.k, c.costs?.[f.k] ? String(c.costs[f.k]) : '']))), [c.tracker, c.costs])
  const editable = can(user, 'edit')
  const f = freeTime(c, s)
  const total = COST_FIELDS.reduce((a, x) => a + (+v[x.k] || 0), 0)
  const n = unitCount(c), q = productQty(c)
  const save = async () => {
    try { onChange(await api.ops(c.tracker, { costs: Object.fromEntries(COST_FIELDS.map((x) => [x.k, +v[x.k] || 0])) })); notify('Custos salvos.') }
    catch (e) { notify('Erro: ' + errMsg(e)) }
  }
  return (
    <div className="costs">
      <div className="cost-grid">
        {COST_FIELDS.map((x) => (
          <label key={x.k}>{x.label}
            <span className="money"><em>US$</em><input type="number" min={0} step="0.01" value={v[x.k] ?? ''} disabled={!editable} onChange={(e) => setV({ ...v, [x.k]: e.target.value })} /></span>
          </label>
        ))}
      </div>
      {f.cost > 0 && !(+v.demurragePaid) && <div className="sim-note"><b>Demurrage previsto: {usd(f.cost)}</b>{f.over} dia(s) × {n} ctr × {usd(f.rate)}. Lance em “Demurrage pago” quando a MSC cobrar.</div>}
      <div className="tl-sum cost-sum">
        <div><small>Total</small><b>{usd(total)}</b></div>
        <div><small>Por container</small><b>{usd(total / n)}</b></div>
        <div><small>Por produto{c.productsSimulated ? ' (sim.)' : ''}</small><b>{q ? `US$ ${(total / q).toFixed(2).replace('.', ',')}` : '—'}</b></div>
      </div>
      {editable && <button className="btn dark full" onClick={save}><Save size={15} /> Salvar custos</button>}
    </div>
  )
}

/* ====================== CONFERÊNCIA NO BARRACÃO ====================== */

export function ReceiveModal({ c, onConfirm, onClose }: { c: Container; onConfirm: (r: Receipt, at: string) => void; onClose: () => void }) {
  const units = c.units?.length ? c.units.map((u) => u.n) : [c.tracker]
  const [at, setAt] = useState(today())
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState(units.map((n) => ({ n, ok: true, missing: 0, damaged: 0, note: '' })))
  const up = (i: number, p: Partial<(typeof rows)[0]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p, ok: p.ok ?? ((p.missing ?? r.missing) === 0 && (p.damaged ?? r.damaged) === 0 && r.ok) } : r)))
  const miss = rows.reduce((a, r) => a + r.missing, 0), dmg = rows.reduce((a, r) => a + r.damaged, 0)
  return (
    <Modal title={<>Conferência no barracão · {c.tracker}</>} onClose={onClose} wide>
      <div className="recv">
        <div className="recv-top">
          <label>Data da chegada<input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <div className="recv-sum"><b>{rows.filter((r) => r.ok).length}/{rows.length}</b><small>containers OK</small></div>
          <div className="recv-sum"><b className={miss ? 'late' : ''}>{miss}</b><small>produtos faltando</small></div>
          <div className="recv-sum"><b className={dmg ? 'late' : ''}>{dmg}</b><small>produtos avariados</small></div>
          <button className="btn sm" onClick={() => setRows(rows.map((r) => ({ ...r, ok: true, missing: 0, damaged: 0 })))}>Marcar todos OK</button>
        </div>
        <div className="recv-list">
          <div className="recv-row head"><span>Container</span><span>OK</span><span>Faltam</span><span>Avaria</span><span>Observação</span></div>
          {rows.map((r, i) => (
            <div className={`recv-row ${r.ok ? '' : 'bad'}`} key={r.n}>
              <b><span className="sq" style={{ background: containerColor(c.tracker) }} /> {r.n}</b>
              <input type="checkbox" checked={r.ok} onChange={(e) => up(i, { ok: e.target.checked })} />
              <input type="number" min={0} value={r.missing} onChange={(e) => up(i, { missing: Math.max(0, +e.target.value) })} />
              <input type="number" min={0} value={r.damaged} onChange={(e) => up(i, { damaged: Math.max(0, +e.target.value) })} />
              <input value={r.note} onChange={(e) => up(i, { note: e.target.value })} placeholder="lacre, avaria…" />
            </div>
          ))}
        </div>
        <label className="full">Observações gerais<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="form-f">
          <span>O B/L vai para o Histórico e os produtos entram no estoque do {WAREHOUSES[c.destination].name}.</span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn dark" onClick={() => onConfirm({ at, notes, units: rows }, at)}><CheckCircle2 size={15} /> Confirmar chegada</button>
        </div>
      </div>
    </Modal>
  )
}

/* ====================== IMPORTAR PACKING LIST ====================== */

export function PackingImport({ c, onSave, onClose }: { c: Container; onSave: (products: ProductItem[]) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [res, setRes] = useState<ReturnType<typeof parsePacking> | null>(null)
  const [fileName, setFileName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const fromText = (t: string) => { setText(t); setRes(t.trim() ? parsePacking(parsePastedText(t)) : null) }
  const fromFile = async (file?: File) => {
    if (!file) return
    setFileName(file.name)
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser')
        setRes(parsePacking(await readSheet(file) as unknown[][]))
      } else if (/\.(csv|txt|tsv)$/i.test(file.name)) fromText(await file.text())
      else setRes({ products: [], rows: 0, skipped: 0, columns: [], error: 'Use planilha .xlsx ou .csv. Para PDF, copie a tabela e cole aqui.' })
    } catch (e) { setRes({ products: [], rows: 0, skipped: 0, columns: [], error: 'Não consegui ler o arquivo: ' + errMsg(e) }) }
  }
  const units = new Set((c.units ?? []).map((u) => u.n))
  const unknownUnits = res ? [...new Set(res.products.flatMap((t) => t.units ?? []))].filter((u) => units.size && !units.has(u)) : []
  const q = res?.products.reduce((a, t) => a + t.qty, 0) ?? 0
  return (
    <Modal title={<>Importar packing list · {c.tracker}</>} onClose={onClose} wide>
      <div className="pk">
        <p className="pk-hint">Abra a planilha do fornecedor (.xlsx ou .csv) <b>ou</b> copie as linhas no Excel e cole abaixo. Precisa ter as colunas <b>Volume</b> e <b>Quantidade</b>. Marca, Produto, Categoria, Peso e Container são opcionais.</p>
        <div className="pk-actions">
          <input ref={input} type="file" accept=".xlsx,.csv,.txt,.tsv" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
          <button className="btn dark" onClick={() => input.current?.click()}><FileUp size={15} /> Abrir planilha</button>
          {fileName && <small>{fileName}</small>}
        </div>
        <textarea className="pk-paste" rows={5} value={text} onChange={(e) => fromText(e.target.value)}
          placeholder={'Marca\tProduto\tVolume\tQuantidade\tPeso kg\tContainer\nLattafa\tAsad\t100 ml\t4800\t0,38\tMSDU1234567'} />
        {res?.error && <div className="err">{res.error}</div>}
        {res && !res.error && (
          <>
            <div className="pk-sum"><b>{res.products.length}</b> itens · <b>{q.toLocaleString('pt-BR')}</b> produtos · {res.rows} linhas lidas{res.skipped ? ` · ${res.skipped} ignoradas` : ''}</div>
            {!!unknownUnits.length && <div className="sim-note"><b>Containers que não estão neste B/L</b>{unknownUnits.slice(0, 6).join(', ')}{unknownUnits.length > 6 ? '…' : ''}</div>}
            <div className="pk-table">
              <table>
                <thead><tr><th>Marca</th><th>Produto</th><th>Volume</th><th>Categoria</th><th className="num">Qtd</th><th className="num">kg/un</th><th className="num">Ctr</th></tr></thead>
                <tbody>
                  {res.products.map((t, i) => (
                    <tr key={i}><td>{t.brand || '—'}</td><td>{t.model || '—'}</td><td><span className="size">{t.size}</span></td><td>{t.category}</td>
                      <td className="num">{t.qty.toLocaleString('pt-BR')}</td><td className="num">{t.unitKg || '—'}</td><td className="num">{t.units?.length ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="form-f">
          <span>{c.productsSimulated ? 'Os produtos simulados serão substituídos.' : 'A lista atual de produtos será substituída.'}</span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn dark" disabled={!res?.products.length} onClick={() => res && onSave(res.products)}><SprayCan size={15} /> Usar estes produtos</button>
        </div>
      </div>
    </Modal>
  )
}

/* ====================== RELATÓRIOS ====================== */

export function ReportsPage({ all, s, onOpen }: {
  all: Container[]; s: Settings
  onOpen: (c: Container) => void
}) {
  const [log, setLog] = useState<LogRow[]>([])
  useEffect(() => { api.recentLog(365).then(setLog).catch(() => setLog([])) }, [])
  const rows = all

  const withCost = rows.filter((c) => costTotal(c) > 0)
  const total = withCost.reduce((a, c) => a + costTotal(c), 0)
  const ctrs = withCost.reduce((a, c) => a + unitCount(c), 0)
  const products = withCost.filter((c) => !c.productsSimulated).reduce((a, c) => a + productQty(c), 0)
  const demPaid = rows.reduce((a, c) => a + (c.costs?.demurragePaid ?? 0), 0)
  const demRunning = rows.filter((c) => c.status !== 'arrived').reduce((a, c) => a + freeTime(c, s).cost, 0)
  const byField = COST_FIELDS.map((f) => ({ ...f, v: withCost.reduce((a, c) => a + (c.costs?.[f.k] ?? 0), 0) })).filter((x) => x.v)

  // trânsito por rota (origem → transbordos → porto final)
  const routes = useMemo(() => {
    const m = new Map<string, { route: string; n: number; days: number; done: number }>()
    for (const c of rows) {
      const title = (x: string) => x.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())
      const key = [locName(c.origin), ...(c.transshipments ?? []).map((x) => title(x.split(',')[0])), LOCS[c.port]?.name.split('(')[0].trim() ?? c.port].join(' → ')
      const end = c.status === 'arrived' && c.arrivedAt ? parseDate(c.arrivedAt.slice(0, 10)) : parseDate(c.portEta)
      const d = Math.round((end - parseDate(c.departure)) / DAY)
      const r = m.get(key) ?? { route: key, n: 0, days: 0, done: 0 }
      r.n++; r.days += d; if (c.status === 'arrived') r.done++
      m.set(key, r)
    }
    return [...m.values()].map((r) => ({ ...r, avg: Math.round(r.days / r.n) })).sort((a, b) => b.n - a.n)
  }, [rows])
  const maxAvg = Math.max(1, ...routes.map((r) => r.avg))

  // pontualidade: mudanças de ETA informadas pela MSC por navio
  const vessels = useMemo(() => {
    const byT = new Map(rows.map((c) => [c.tracker, c]))
    const m = new Map<string, { vessel: string; changes: number; delay: number; bls: Set<string> }>()
    for (const l of log) {
      if (l.kind !== 'eta_changed' || !l.detail || !byT.has(l.tracker)) continue
      const c = byT.get(l.tracker)!
      const v = c.vessel || '—'
      const d = Math.round((parseDate(String(l.detail.to)) - parseDate(String(l.detail.from))) / DAY)
      const r = m.get(v) ?? { vessel: v, changes: 0, delay: 0, bls: new Set() }
      r.changes++; r.delay += d; r.bls.add(l.tracker); m.set(v, r)
    }
    return [...m.values()].sort((a, b) => b.delay - a.delay)
  }, [log, rows])

  const exportCsv = () => {
    const head = ['B/L', 'País', 'Status', 'Containers', 'Produtos', ...COST_FIELDS.map((f) => f.label + ' (US$)'), 'Total (US$)', 'Por container (US$)', 'Demurrage previsto (US$)', 'Free time']
    const lines = rows.map((c) => {
      const f = freeTime(c, s)
      return [c.tracker, COUNTRY_NAME[c.country], c.status === 'arrived' ? 'Recebido' : 'Em rota', unitCount(c), productQty(c) + (c.productsSimulated ? ' (sim.)' : ''),
        ...COST_FIELDS.map((x) => c.costs?.[x.k] ?? 0), costTotal(c), Math.round(costTotal(c) / unitCount(c)), f.cost, freeText(f)]
    })
    const csv = [head, ...lines].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    a.download = `worldscentz-relatorio-${today()}.csv`; a.click()
  }

  return (
    <main className="page reports">
      <section className="head">
        <div><h1>Relatórios</h1><p>Custos, demurrage, tempo de trânsito e pontualidade · {new Date().toLocaleDateString('pt-BR')}</p></div>
        <div className="head-actions no-print">
          <button className="btn" onClick={exportCsv}><Download size={15} /> Excel (CSV)</button>
          <button className="btn dark" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
        </div>
      </section>
      <div className="kpis hist-kpis">
        <div className="kpi"><div><small>Custo lançado</small><b>{usd(total)}</b><em className="kpi-sub">{withCost.length} B/L</em></div></div>
        <div className="kpi"><div><small>Custo por container</small><b>{ctrs ? usd(total / ctrs) : '—'}</b></div></div>
        <div className="kpi"><div><small>Custo por produto</small><b>{products ? `US$ ${(total / products).toFixed(2).replace('.', ',')}` : '—'}</b></div></div>
        <div className="kpi"><div><small>Demurrage pago · correndo</small><b>{usd(demPaid)}<em className="kpi-sub">{usd(demRunning)}</em></b></div></div>
      </div>
      <div className="rep-grid">
        <div className="card">
          <div className="card-h"><h3>Composição do custo</h3></div>
          {!byField.length ? <div className="empty">Nenhum custo lançado ainda. Lance na aba <b>Custos</b> de cada B/L.</div> : (
            <ul className="hbars">
              {byField.map((x) => (
                <li key={x.k}><span>{x.label}</span><div className="bar"><i style={{ width: `${(x.v / total) * 100}%` }} /></div><b>{usd(x.v)}</b></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>Trânsito médio por rota</h3><small>porto de origem → porto final</small></div>
          <ul className="hbars routes">
            {routes.map((r) => (
              <li key={r.route}><span title={r.route}>{r.route}<small>{r.n} B/L{r.done ? ` · ${r.done} recebidos` : ' · previsão'}</small></span><div className="bar"><i style={{ width: `${(r.avg / maxAvg) * 100}%` }} /></div><b>{r.avg} dias</b></li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-h"><h3>Pontualidade por navio</h3><small>mudanças de chegada informadas pela MSC</small></div>
          {!vessels.length ? <div className="empty">Nenhuma mudança de chegada registrada ainda. A cada atualização da MSC o sistema anota os atrasos aqui.</div> : (
            <table className="mini-table">
              <thead><tr><th>Navio</th><th className="num">B/Ls</th><th className="num">Mudanças</th><th className="num">Atraso total</th></tr></thead>
              <tbody>{vessels.map((v) => <tr key={v.vessel}><td><Ship size={13} /> {v.vessel}</td><td className="num">{v.bls.size}</td><td className="num">{v.changes}</td><td className={`num ${v.delay > 0 ? 'late' : ''}`}>{v.delay > 0 ? '+' : ''}{v.delay}d</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>Custo por B/L</h3></div>
          {!withCost.length ? <div className="empty">Sem custos lançados.</div> : (
            <table className="mini-table">
              <thead><tr><th>B/L</th><th className="num">Ctr</th><th className="num">Total</th><th className="num">Por ctr</th></tr></thead>
              <tbody>{withCost.sort((a, b) => costTotal(b) - costTotal(a)).map((c) => (
                <tr key={c.id} className="click" onClick={() => onOpen(c)}><td><span className="flag-cell"><Flag country={c.country} size={14} /> {c.tracker}</span></td><td className="num">{unitCount(c)}</td><td className="num">{usd(costTotal(c))}</td><td className="num">{usd(costTotal(c) / unitCount(c))}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  )
}

/* ====================== CONFIGURAÇÕES ====================== */

export function SettingsPage({ user, s, setS, sync, onSync, notify }: {
  user: User; s: Settings; setS: (s: Settings) => void; sync: SyncStatus | null; onSync: () => void; notify: (m: string) => void
}) {
  const admin = can(user, 'admin')
  const [f, setF] = useState(s)
  useEffect(() => setF(s), [s])
  const save = async () => { try { setS(await api.saveSettings(f)); notify('Configurações salvas.') } catch (e) { notify('Erro: ' + errMsg(e)) } }
  const numIn = (get: number, put: (n: number) => void) => <input type="number" min={0} value={get} disabled={!admin} onChange={(e) => put(+e.target.value)} />
  return (
    <main className="page settings">
      <section className="head"><div><h1>Configurações</h1><p>Regras de free time, barracões, atualização da MSC e equipe.</p></div></section>
      <div className="set-grid">
        <div className="card">
          <div className="card-h"><h3><Clock size={17} /> Free time e demurrage</h3></div>
          <p className="set-hint">Conforme o contrato com a MSC. Cada B/L pode ter um valor próprio na aba Despacho.</p>
          <div className="set-table">
            <span /><b><Flag country="PY" size={16} /> Paraguai</b>
            <span>Dias livres no porto</span>
            {numIn(f.freeDays.PY, (n) => setF({ ...f, freeDays: { ...f.freeDays, PY: n } }))}
            <span>Demurrage (US$ por container/dia)</span>
            {numIn(f.demurrageUsd.PY, (n) => setF({ ...f, demurrageUsd: { ...f.demurrageUsd, PY: n } }))}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3><Anchor size={17} /> Capacidade dos barracões</h3></div>
          <p className="set-hint">Quantos containers cabem em cada barracão.</p>
          <div className="set-list">
            {Object.entries(WAREHOUSES).map(([k, w]) => (
              <label key={k}>{w.name}{numIn(f.capacity[k] ?? w.capacity, (n) => setF({ ...f, capacity: { ...f.capacity, [k]: n } }))}</label>
            ))}
          </div>
        </div>
        <MscCard f={f} setF={setF} admin={admin} user={user} sync={sync} onSync={onSync} />
        {admin && <div className="set-save"><button className="btn red" onClick={save}><Save size={15} /> Salvar configurações</button></div>}
        {admin ? <UsersCard me={user} notify={notify} /> : null}
        <PasswordCard notify={notify} />
        {admin && (
          <div className="card">
            <div className="card-h"><h3><Download size={17} /> Backup</h3></div>
            <p className="set-hint">Baixa uma cópia completa do banco (B/Ls, histórico, custos, usuários). Os documentos anexados ficam em <code>data/docs</code> — copie essa pasta junto.</p>
            <a className="btn dark" href="/api/backup"><Download size={15} /> Baixar backup do banco</a>
          </div>
        )}
      </div>
    </main>
  )
}

function UsersCard({ me, notify }: { me: User; notify: (m: string) => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [nu, setNu] = useState({ name: '', username: '', role: 'despachante' as Role, password: '' })
  const load = () => api.users().then((r) => setUsers(r.users)).catch((e) => notify('Erro: ' + errMsg(e)))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.createUser(nu); setNu({ name: '', username: '', role: 'despachante', password: '' }); load(); notify('Usuário criado.') } catch (e) { notify('Erro: ' + errMsg(e)) }
  }
  const upd = async (u: User, p: Partial<User> & { password?: string }) => {
    try { await api.updateUser(u.id, p); load(); notify('Usuário atualizado.') } catch (e) { notify('Erro: ' + errMsg(e)) }
  }
  return (
    <div className="card users-card">
      <div className="card-h"><h3><Users size={17} /> Equipe e permissões</h3></div>
      <table className="mini-table">
        <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Ativo</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'off'}>
              <td><b>{u.name}</b>{u.id === me.id && <small>você</small>}</td>
              <td>{u.username}</td>
              <td><select value={u.role} onChange={(e) => upd(u, { role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
              <td><input type="checkbox" checked={u.active} onChange={(e) => upd(u, { active: e.target.checked })} /></td>
              <td><button className="btn sm" onClick={() => { const p = prompt(`Nova senha para ${u.name} (mínimo 6 caracteres):`); if (p) upd(u, { password: p }) }}><Lock size={13} /> Senha</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="user-add" onSubmit={add}>
        <input placeholder="Nome" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required />
        <input placeholder="Usuário" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} required />
        <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <input type="password" placeholder="Senha inicial" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} required minLength={6} autoComplete="new-password" />
        <button className="btn dark"><UserPlus size={15} /> Adicionar</button>
      </form>
      <ul className="role-hints">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <li key={r}><b>{ROLE_LABEL[r]}</b> {ROLE_HINT[r]}</li>)}</ul>
    </div>
  )
}

function PasswordCard({ notify }: { notify: (m: string) => void }) {
  const [p, setP] = useState({ current: '', password: '' })
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.changePassword(p.current, p.password); setP({ current: '', password: '' }); notify('Senha alterada.') } catch (e) { notify('Erro: ' + errMsg(e)) }
  }
  return (
    <form className="card" onSubmit={go}>
      <div className="card-h"><h3><Cog size={17} /> Minha senha</h3></div>
      <div className="set-list">
        <label>Senha atual<input type="password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} required autoComplete="current-password" /></label>
        <label>Nova senha<input type="password" value={p.password} onChange={(e) => setP({ ...p, password: e.target.value })} required minLength={6} autoComplete="new-password" /></label>
      </div>
      <button className="btn dark"><Lock size={15} /> Trocar senha</button>
    </form>
  )
}
