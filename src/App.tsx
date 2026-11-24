import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, Container as BoxIcon, Map as MapIcon, Warehouse, Search, Bell, Plus, Ship, Truck, Anchor,
  ShieldCheck, ShieldAlert, ChevronLeft, ChevronRight, Pencil, Trash2, MapPin, CalendarDays, Package, Download,
  Clock, ArrowRight, Weight, MoreHorizontal, RotateCcw, SprayCan, X, PanelRightOpen, ExternalLink, Boxes, History, Waves,
  Archive, CheckCircle2, Database, ArchiveRestore, BarChart3, RefreshCw, Settings as Cog, LogOut, FileSpreadsheet, FileText, Landmark, DollarSign, Siren,
} from 'lucide-react'
import {
  ORIGINS, PORTS, LOCS, WAREHOUSES, STAGE_LABEL, PRODUCT_CATEGORIES, track, fmtDate, parseDate, productsInUnit, productQty, productKg, unitCount, locName, mscLink,
  mscDelivered, isoDay, DAY,
  type Container, type Country, type Stage, type ProductItem, type Tracking, type MscUnit, type Receipt,
} from './data'
import { ContainerArt, Flag, Gauge, Modal, ReleasePill, StagePill, COUNTRY_NAME, LOGO, containerColor } from './ui'
import MapView from './MapView'
import { api, AUTH_EVENT, type LogEntry } from './api'
import {
  DEFAULT_SETTINGS, ROLE_LABEL, buildAlerts, can, freeTime, customsProgress, missingDocs, usd, FREE_COLOR,
  type Alert, type LogRow, type Settings, type SyncStatus, type User,
} from './ops'
import {
  AlertsMenu, BellButton, CostsTab, DocsTab, FreeBadge, LoginScreen, OpsTab, PackingImport, ReceiveModal, ReportsPage, SettingsPage, SyncButton,
} from './extra'

type Page = 'dash' | 'containers' | 'map' | 'wh' | 'hist' | 'reports' | 'settings'

/** Usuário logado e regras do sistema, disponíveis em todas as telas. */
const Ctx = createContext<{ user: User; s: Settings }>({ user: { id: 0, username: '', name: '', role: 'diretoria', active: true }, s: DEFAULT_SETTINGS })
const useApp = () => useContext(Ctx)

export default function App() {
  const [auth, setAuth] = useState<{ checked: boolean; needsSetup: boolean; user: User | null }>({ checked: false, needsSetup: false, user: null })
  useEffect(() => {
    api.authState().then((r) => setAuth({ checked: true, ...r })).catch(() => setAuth({ checked: true, needsSetup: false, user: null }))
    const off = () => setAuth((a) => ({ ...a, user: null }))
    window.addEventListener(AUTH_EVENT, off); return () => window.removeEventListener(AUTH_EVENT, off)
  }, [])
  if (!auth.checked) return <div className="shell boot"><img src={LOGO} alt="WORLD SCENTZ" /><p>Carregando…</p></div>
  if (!auth.user) return <LoginScreen needsSetup={auth.needsSetup} onDone={(user) => setAuth({ checked: true, needsSetup: false, user })} />
  return <Main user={auth.user} onLogout={async () => { await api.logout().catch(() => {}); setAuth({ checked: true, needsSetup: false, user: null }) }} />
}
const OLD_KEY = 'worldscentz.containers.v3' // dados antigos do navegador (migrados para o banco uma vez)

function Main({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [all, setAll] = useState<Container[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [page, setPage] = useState<Page>('dash')
  const [sel, setSel] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Container | 'new' | null>(null)
  const [flagPanel, setFlagPanel] = useState<Country | null>(null)
  const [contentId, setContentId] = useState<string | null>(null)
  const [contentTab, setContentTab] = useState<Tab>('products')
  const [receiving, setReceiving] = useState<Container | null>(null)
  const [packing, setPacking] = useState<Container | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [recent, setRecent] = useState<LogRow[]>([])
  const [bell, setBell] = useState(false)
  const [menu, setMenu] = useState(false)
  const [, tick] = useState(0)

  const list = useMemo(() => all.filter((c) => c.status !== 'arrived'), [all])
  const history = useMemo(() => all.filter((c) => c.status === 'arrived'), [all])
  const contentOf = all.find((c) => c.id === contentId)
  const openContent = (c: Container, tab: Tab = 'products') => { setContentTab(tab); setContentId(c.id) }
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }
  const upsert = (c: Container) => setAll((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]))
  const fail = (e: unknown) => notify(`Erro ao salvar: ${e instanceof Error ? e.message : e}`)

  const load = useCallback(async () => {
    try {
      setError('')
      const [list0, st, sy, rl] = await Promise.all([api.list(), api.settings(), api.syncStatus().catch(() => null), api.recentLog(30).catch(() => [])])
      setSettings(st); setSync(sy); setRecent(rl)
      let rows = can(user, 'edit') ? await migrateOldBrowserData(list0) : list0
      // a MSC marcou como entregue -> vai para o histórico automaticamente
      if (can(user, 'receive')) for (const c of rows.filter((x) => x.status !== 'arrived' && mscDelivered(x))) {
        try { const u = await api.arrive(c.tracker); rows = rows.map((x) => (x.id === u.id ? u : x)) } catch { /* segue */ }
      }
      setAll(rows)
      setSel((s) => s ?? rows.find((x) => x.status !== 'arrived')?.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t) }, [])

  // acompanha a atualização da MSC (rápido enquanto roda; senão a cada 2 min) e recarrega quando termina
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const st = await api.syncStatus()
        if (sync?.running && !st.running) { await load(); notify(st.ok ? `MSC: ${st.message}` : 'A atualização da MSC falhou. O sistema tenta de novo sozinho.') }
        setSync(st)
      } catch { /* */ }
    }, sync?.running ? 2500 : 60000)
    return () => clearTimeout(t)
  }, [sync, load]) // eslint-disable-line react-hooks/exhaustive-deps
  const runSync = async (trackers?: string[]) => {
    try {
      const r = await api.syncNow(trackers)
      setSync(await api.syncStatus())
      notify(r.queued ? 'Entrou na fila: consulta logo depois da atualização em andamento.' : trackers?.length ? `Consultando ${trackers.join(', ')} na MSC…` : 'Atualizando todos os B/Ls com a MSC…')
    } catch (e) { fail(e) }
  }
  const alerts = useMemo(() => buildAlerts(all, settings, recent, sync), [all, settings, recent, sync]) // eslint-disable-line react-hooks/exhaustive-deps
  const openAlert = (a: Alert) => { const c = all.find((x) => x.tracker === a.tracker); if (c) { openContent(c, (a.tab as Tab) ?? 'products'); setBell(false) } }

  const match = useCallback((c: Container) => {
    const s = q.trim().toLowerCase()
    return (!s || [c.tracker, c.content, c.vessel, locName(c.origin), WAREHOUSES[c.destination]?.name, ...(c.units ?? []).map((u) => u.n)].join(' ').toLowerCase().includes(s))
  }, [q])
  const visible = useMemo(() => list.filter(match), [list, match])
  const histVisible = useMemo(() => history.filter(match), [history, match])

  const selected = list.find((c) => c.id === sel) ?? visible[0]

  const save = async (c: Container, isNew: boolean) => {
    try {
      const saved = isNew ? await api.create(c) : await api.save(c)
      upsert(saved); setSel(saved.id); setEditing(null); notify('Salvo no banco de dados.')
    } catch (e) { fail(e) }
  }
  const remove = async (id: string) => {
    if (!confirm('Excluir este B/L do banco de dados? Essa ação não pode ser desfeita.')) return
    try { await api.remove(id); setAll((l) => l.filter((x) => x.id !== id)); notify('Excluído.') } catch (e) { fail(e) }
  }
  const toggleRelease = async (id: string) => {
    const c = all.find((x) => x.id === id); if (!c) return
    try { upsert(await api.save({ ...c, released: !c.released })) } catch (e) { fail(e) }
  }
  const arrive = (c: Container) => setReceiving(c)
  const confirmArrive = async (c: Container, receipt: Receipt, at: string) => {
    try {
      upsert(await api.arrive(c.tracker, { at, receipt })); setReceiving(null); setContentId(null); if (sel === c.id) setSel(undefined)
      const bad = receipt.units.filter((u) => !u.ok).length
      notify(`${c.tracker} recebido${bad ? ` com ${bad} container(s) com problema` : ''} e movido para o Histórico.`)
    } catch (e) { fail(e) }
  }
  const savePacking = async (c: Container, products: ProductItem[]) => {
    try { upsert(await api.save({ ...c, products, productsSimulated: false, productsSource: 'packing list' })); setPacking(null); notify('Packing list importado.') } catch (e) { fail(e) }
  }
  const reopen = async (c: Container) => {
    try { upsert(await api.reopen(c.tracker)); notify(`${c.tracker} voltou para os ativos.`) } catch (e) { fail(e) }
  }

  const openFlag = (c: Country) => { setFlagPanel(c); const first = list.find((x) => x.country === c); if (first) setSel(first.id) }

  const nav: [Page, string, typeof LayoutDashboard][] = [
    ['dash', 'Dashboard', LayoutDashboard], ['containers', 'Containers', BoxIcon], ['map', 'Mapa', MapIcon], ['wh', 'Barracões', Warehouse], ['hist', 'Histórico', Archive],
    ['reports', 'Relatórios', BarChart3], ['settings', 'Configurações', Cog],
  ]
  const ed = can(user, 'edit')

  if (loading) return <div className="shell boot"><img src={LOGO} alt="WORLD SCENTZ" /><p>Carregando banco de dados…</p></div>
  if (error) return (
    <div className="shell boot">
      <img src={LOGO} alt="WORLD SCENTZ" />
      <h2>Servidor do banco de dados desligado</h2>
      <p>Abra o terminal na pasta do projeto e rode <code>npm run dev</code>. Depois clique em tentar de novo.</p>
      <small>{error}</small>
      <button className="btn dark" onClick={() => { setLoading(true); load() }}>Tentar de novo</button>
    </div>
  )

  return (
    <Ctx.Provider value={{ user, s: settings }}>
    <div className="shell">
      <header className="top">
        <div className="brand">
          <img src={LOGO} alt="WORLD SCENTZ" />
          <span className="brand-sep" />
          <span className="brand-sub">TRACKING</span>
        </div>
        <nav className="nav">
          {nav.map(([k, label, Icon]) => (
            <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)} title={label}>
              <Icon size={17} />{page === k && <span>{label}</span>}
            </button>
          ))}
        </nav>
        <div className="top-r">
          <label className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar B/L, nº do container, navio…" />
          </label>
          <SyncButton sync={sync} user={user} onSync={() => runSync()} />
          <div className="bell-wrap">
            <BellButton alerts={alerts} open={bell} setOpen={setBell} />
            {bell && <AlertsMenu alerts={alerts} onOpen={openAlert} onClose={() => setBell(false)} />}
          </div>
          <div className="bell-wrap">
            <button className="avatar" onClick={() => setMenu(!menu)} title={user.name}>{user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</button>
            {menu && (
              <div className="user-menu" onMouseLeave={() => setMenu(false)}>
                <b>{user.name}</b><small>{ROLE_LABEL[user.role]} · {user.username}</small>
                <button onClick={() => { setPage('settings'); setMenu(false) }}><Cog size={15} /> Configurações</button>
                <button onClick={onLogout}><LogOut size={15} /> Sair</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {page === 'dash' && (
        <Dashboard list={list} visible={visible} selected={selected} setSel={setSel}
          openFlag={openFlag} onNew={ed ? () => setEditing('new') : undefined} onEdit={(c) => ed && setEditing(c)} toggleRelease={toggleRelease} goMap={() => setPage('map')} onProducts={openContent} />
      )}
      {page === 'containers' && (
        <ContainersPage visible={visible} onNew={ed ? () => setEditing('new') : undefined}
          onEdit={(c) => ed && setEditing(c)} onRemove={remove} toggleRelease={toggleRelease} onOpen={(id) => { setSel(id); setPage('map') }} onProducts={openContent} />
      )}
      {page === 'map' && <MapPage visible={visible} selected={selected} setSel={setSel} onContent={openContent} />}
      {page === 'wh' && <WarehousesPage list={list} history={history} onOpen={(id) => { setSel(id); setPage('map') }} />}
      {page === 'hist' && <HistoryPage rows={histVisible} total={history.length} onOpen={openContent} onReopen={reopen} />}
      {page === 'reports' && <ReportsPage all={all} s={settings} onOpen={(c) => openContent(c, 'costs')} />}
      {page === 'settings' && <SettingsPage user={user} s={settings} setS={setSettings} sync={sync} onSync={() => runSync()} notify={notify} />}

      {contentOf && <ContentPanel key={contentOf.id} c={contentOf} initialTab={contentTab} onClose={() => setContentId(null)} onEdit={() => setEditing(contentOf)} onArrive={() => arrive(contentOf)}
        onReopen={() => reopen(contentOf)} onPacking={() => setPacking(contentOf)} onChange={upsert} notify={notify}
        syncing={!!sync?.running && (!sync.trackers || sync.trackers.includes(contentOf.tracker))} onSync={() => runSync([contentOf.tracker])} />}
      {receiving && <ReceiveModal c={receiving} onClose={() => setReceiving(null)} onConfirm={(r, at) => confirmArrive(receiving, r, at)} />}
      {packing && <PackingImport c={packing} onClose={() => setPacking(null)} onSave={(t) => savePacking(packing, t)} />}
      {editing && <ContainerForm initial={editing === 'new' ? undefined : editing} onSave={(c) => save(c, editing === 'new')} onClose={() => setEditing(null)} />}
      {flagPanel && (
        <CountryPanel country={flagPanel} list={list.filter((c) => c.country === flagPanel)} onClose={() => setFlagPanel(null)}
          onPick={(id) => { setSel(id); setFlagPanel(null) }} />
      )}
      {toast && <div className="toast"><Database size={15} /> {toast}</div>}
    </div>
    </Ctx.Provider>
  )
}

/** Leva para o banco o que foi editado antes, quando os dados ficavam só no navegador (roda uma vez). */
async function migrateOldBrowserData(rows: Container[]): Promise<Container[]> {
  let old: Container[] = []
  try { const s = localStorage.getItem(OLD_KEY); if (!s) return rows; old = JSON.parse(s) } catch { return rows }
  const byId = new Map(rows.map((r) => [r.tracker, r]))
  for (const o of old) {
    const cur = byId.get(o.tracker)
    const realProducts = o.products?.length && !o.productsSimulated
    if (!cur) continue
    if (realProducts || o.released || o.destination !== cur.destination || o.truck || o.notes) {
      try {
        const saved = await api.save({ ...cur, released: !!o.released, destination: o.destination || cur.destination, truck: o.truck, notes: o.notes,
          products: realProducts ? o.products : cur.products, productsSimulated: realProducts ? false : cur.productsSimulated })
        byId.set(saved.tracker, saved)
      } catch { /* segue */ }
    }
  }
  try { localStorage.removeItem(OLD_KEY) } catch { /* */ }
  return rows.map((r) => byId.get(r.tracker) ?? r)
}

/* ====================== DASHBOARD ====================== */

function Dashboard({ list, visible, selected, setSel, openFlag, onNew, onEdit, toggleRelease, goMap, onProducts }: {
  list: Container[]; visible: Container[]; selected?: Container; setSel: (id: string) => void
  openFlag: (c: Country) => void; onNew?: () => void; onEdit: (c: Container) => void
  toggleRelease: (id: string) => void; goMap: () => void; onProducts: (c: Container, tab?: Tab) => void
}) {
  const { user, s } = useApp()
  const T = useMemo(() => list.map((c) => ({ c, t: track(c) })), [list])
  const count = (s: Stage[]) => T.filter((x) => s.includes(x.t.stage)).length
  const units = (s?: Stage[]) => T.filter((x) => !s || s.includes(x.t.stage)).reduce((a, x) => a + unitCount(x.c), 0)
  const idx = Math.max(0, visible.findIndex((c) => c.id === selected?.id))
  const step = (d: number) => visible.length && setSel(visible[(idx + d + visible.length) % visible.length].id)
  const t = selected ? track(selected) : undefined
  const kpis = [
    { icon: BoxIcon, label: 'Containers em rota', v: units() - units(['delivered']), sub: `${list.length} B/L` },
    { icon: Ship, label: 'Trânsito marítimo', v: units(['sea', 'scheduled']), sub: `${count(['sea', 'scheduled'])} B/L` },
    { icon: Waves, label: 'Transbordo / hidrovia', v: units(['transship', 'river']), sub: `${count(['transship', 'river'])} B/L` },
    { icon: ShieldAlert, label: 'Aguardando liberação', v: units(['held']), sub: `${count(['held'])} B/L`, warn: true },
  ]
  const upcoming = T.filter((x) => x.t.stage !== 'delivered').sort((a, b) => parseDate(a.c.eta) - parseDate(b.c.eta)).slice(0, 5)
  const totalCap = Object.entries(WAREHOUSES).reduce((a, [k, w]) => a + (s.capacity[k] ?? w.capacity), 0)
  const risky = list.map((c) => freeTime(c, s)).filter((f) => f.state === 'warn' || f.state === 'over')
  const occ = units(['delivered']) / totalCap
  const inbound = units() - units(['delivered'])

  return (
    <main className="page">
      <section className="head">
        <div>
          <h1>Painel de Operações</h1>
          <p>Importações WORLD SCENTZ para o Paraguai — marítimo e terrestre em tempo real.</p>
        </div>
        <div className="kpis">
          {kpis.map((k) => (
            <div className="kpi" key={k.label}>
              <div className="kpi-i"><k.icon size={20} /></div>
              <div>
                <small>{k.label}</small>
                <b>{k.v}<em className="kpi-sub">{k.sub}</em></b>
                {k.warn && k.v > 0 && <em className="tag warn">atenção</em>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="hero-grid">
        <div className={`hero ${selected?.country === 'PY' ? 'py' : 'br'}`}>
          <div className="hero-top">
            <div className="seg"><button className="on" onClick={() => openFlag('PY')} title="Importação Paraguai"><Flag country="PY" size={20} /> <span>Paraguai</span></button></div>
            {onNew && <button className="btn dark" onClick={onNew}><Plus size={16} /> Cadastrar container</button>}
          </div>
          <div className="stage">
          {selected && t ? (
            <>
              <div className="hero-art-wrap"><ContainerArt country={selected.country} code={selected.tracker} className="hero-art" /></div>
              <div className="detail glass">
                <div className="detail-h">
                  <span className="ic"><BoxIcon size={16} /></span> Detalhes do container
                  {can(user, 'edit') && <button className="icon-btn sm" onClick={() => onEdit(selected)}><MoreHorizontal size={16} /></button>}
                </div>
                <small>Nº Tracker</small>
                <div className="detail-id"><Flag country={selected.country} size={18} /> #{selected.tracker}</div>
                <ContainerArt country={selected.country} code={selected.tracker} className="detail-art" />
                <Row icon={Boxes} k="Containers" v={`${unitCount(selected)} × ${shortType(selected.units?.[0]?.type)}`} />
                <Row icon={Clock} k="Status" v={<StagePill stage={t.stage} />} />
                <Row icon={MapPin} k="Onde está" v={whereText(t)} />
                <Row icon={ShieldCheck} k="Porto" v={<ReleasePill released={selected.released} />} />
                <Row icon={Clock} k="Free time" v={<button className="pill-btn" onClick={() => onProducts(selected, 'ops')}><FreeBadge c={selected} s={s} /></button>} />
                <button className="btn red full content-btn" onClick={() => onProducts(selected)}>
                  <PanelRightOpen size={16} /> Ver conteúdo
                </button>
              </div>
              <div className="hero-ctrl">
                <button className="icon-btn" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
                <button className="icon-btn" onClick={() => step(1)}><ChevronRight size={18} /></button>
              </div>
            </>
          ) : <div className="empty">Nenhum container. Cadastre o primeiro.</div>}
          </div>
        </div>

        <aside className="side">
          {selected && t && (
            <div className="card">
              <div className="card-h"><h3>Rastreamento</h3><StagePill stage={t.stage} /></div>
              <div className="track-grid">
                <div><small>Navio / barcaça</small><b>{t.vessel || '—'}</b></div>
                <div><small>Porto final</small><b>{LOCS[selected.port]?.code}</b></div>
                <div><small>Armador</small><b>{selected.carrier || '—'}</b></div>
              </div>
              <Journey c={selected} t={t} />
              <ul className="mini-route">
                {t.visits.map((v, i) => {
                  const done = Date.now() >= (i === 0 ? v.dep : v.arr)
                  const when = new Date(i === 0 ? v.dep : v.arr).toISOString().slice(0, 10)
                  return (
                    <li key={i} className={done ? 'done' : ''}>
                      <span className="dot" />
                      <b>{locName(v.loc)}</b>
                      <small>{i === 0 ? 'embarque' : done ? 'chegou' : 'previsto'} · {fmtDate(when)}</small>
                    </li>
                  )
                })}
              </ul>
              <div className="dates">
                <div><small>Saída</small><b>{fmtDate(selected.departure)}</b></div>
                <div><small>Chegada {LOCS[selected.port]?.code}</small><b>{fmtDate(selected.portEta)}</b></div>
                <div><small>Previsão barracão</small><b>{fmtDate(selected.eta)}</b></div>
              </div>
              <CustomsMini c={selected} onOpen={() => onProducts(selected, 'ops')} />
              <div className="btns">
                {can(user, 'edit') ? <>
                  <button className="btn" onClick={() => onEdit(selected)}><Pencil size={15} /> Editar</button>
                  <button className={`btn ${selected.released ? '' : 'red'}`} onClick={() => toggleRelease(selected.id)}>
                    {selected.released ? <><RotateCcw size={15} /> Revogar liberação</> : <><ShieldCheck size={15} /> Liberar no porto</>}
                  </button>
                </> : null}
                <button className="btn dark full" onClick={() => onProducts(selected)}><PanelRightOpen size={15} /> Ver conteúdo do container</button>
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="strip-row">
      <div className="strip">
        {visible.map((c) => {
          const tt = track(c)
          return (
            <button key={c.id} className={`chip ${c.id === selected?.id ? 'on' : ''}`} onClick={() => setSel(c.id)}>
              <div>
                <b>#{c.tracker}</b>
                <span>{unitCount(c)} containers · {tt.next ? `→ ${locName(tt.next)}` : locName(c.port)}</span>
                <StagePill stage={tt.stage} />
              </div>
              <ContainerArt country={c.country} code={c.tracker} truck={false} className="chip-art" />
            </button>
          )
        })}
      </div>
      </section>

      <section className="bottom-grid">
        <div className="bottom-left">
        <div className="mini-grid">
          <Mini label="B/L liberados no porto" v={list.filter((c) => c.released).length} sub={`/${list.length}`} icon={ShieldCheck} />
          <Mini label="Free time em risco" v={risky.length} sub={risky.some((f) => f.state === 'over') ? ` B/L · ${usd(risky.reduce((a, f) => a + f.cost, 0))}` : ' B/L'} icon={Siren} />
          <Mini label="Importação Paraguai" v={list.filter((c) => c.country === 'PY').reduce((a, c) => a + unitCount(c), 0)} sub=" ctr" icon={() => <Flag country="PY" size={18} />} onClick={() => openFlag('PY')} />
        </div>
            <div className="card cap-card">
              <div className="card-h"><h3>Capacidade dos barracões</h3></div>
              <div className="cap">
                <Gauge value={occ} label="Ocupação" />
                <div className="cap-r">
                  <div><small>A caminho</small><b>{inbound} <em>ctr</em></b></div>
                  <div><small>Capacidade</small><b>{totalCap} <em>ctr</em></b></div>
                </div>
              </div>
            </div>
        </div>
        <div className="card map-card">
          <div className="card-h">
            <h3>Mapa de transporte marítimo</h3>
            <button className="btn sm" onClick={goMap}>Abrir mapa <ArrowRight size={14} /></button>
          </div>
          <MapView containers={visible} selectedId={selected?.id} onSelect={setSel} height={300} />
        </div>
        <div className="card">
          <div className="card-h"><h3>Próximas chegadas</h3></div>
          <ul className="arrivals">
            {upcoming.map(({ c, t }) => (
              <li key={c.id} onClick={() => setSel(c.id)}>
                <span className="sq" style={{ background: containerColor(c.tracker) }} />
                <div><b>{c.tracker}</b><small>{unitCount(c)} ctr · {WAREHOUSES[c.destination].code} · {fmtDate(c.eta)}</small></div>
                <em className={t.daysLeft < 0 ? 'late' : ''}>{t.daysLeft < 0 ? `${-t.daysLeft}d atraso` : `${t.daysLeft}d`}</em>
                {missingDocs(c).length > 0 && t.daysLeft <= 10 && <FileText size={14} className="doc-warn" aria-label="documentos faltando" />}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}

const shortType = (t?: string) => (t ? t.replace("40' HIGH CUBE", "40' HC").replace("20' DRY VAN", "20' DV") : '—')
const whereText = (t: Tracking) => (t.at ? locName(t.at) : t.next ? `rumo a ${locName(t.next)}` : STAGE_LABEL[t.stage])

function CustomsMini({ c, onOpen }: { c: Container; onOpen: () => void }) {
  const p = customsProgress(c)
  return (
    <button className="customs-mini" onClick={onOpen} title="Abrir despacho">
      <span><Landmark size={14} /> Despacho {p.done}/{p.total}</span>
      <span className="cm-bar">{Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.done ? 'on' : ''} />)}</span>
      <small>{p.next ? `Próximo: ${p.next.label}` : 'Concluído'}</small>
    </button>
  )
}

function Row({ icon: Icon, k, v }: { icon: typeof Package; k: string; v: React.ReactNode }) {
  return <div className="row"><span><Icon size={14} /> {k}</span><b>{v}</b></div>
}

function Mini({ label, v, sub, icon: Icon, onClick }: { label: string; v: number; sub?: string; icon: React.ComponentType<{ size?: number }>; onClick?: () => void }) {
  return (
    <button className={`card mini ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="mini-h"><small>{label}</small><span className="ic"><Icon size={15} /></span></div>
      <b>{v}{sub && <em>{sub}</em>}</b>
    </button>
  )
}

function Journey({ c, t }: { c: Container; t: Tracking }) {
  const o = LOCS[c.origin], w = WAREHOUSES[c.destination]
  const t0 = t.visits[0].dep, tEnd = Math.max(parseDate(c.eta), t.visits[t.visits.length - 1].arr)
  const at = (x: number) => Math.max(0, Math.min(100, ((x - t0) / Math.max(1, tEnd - t0)) * 100))
  const onWater = !['land', 'delivered', 'port', 'held'].includes(t.stage)
  return (
    <div className="journey">
      <div className="j-end"><b>{o?.code.slice(2)}</b><small>{o?.name}</small></div>
      <div className="j-bar">
        <div className="j-ticks" />
        <div className="j-fill" style={{ width: `${t.progress * 100}%` }} />
        {t.visits.slice(1).map((v) => (
          <span key={v.loc + v.arr} className={`j-port ${v.arrEst ? 'est' : ''}`} style={{ left: `${at(v.arr)}%` }} title={`${locName(v.loc)} · ${fmtDate(new Date(v.arr).toISOString().slice(0, 10))}`}>
            <Anchor size={10} />
          </span>
        ))}
        <span className="j-now" style={{ left: `${t.progress * 100}%` }}>{onWater ? <Ship size={14} /> : <Truck size={14} />}</span>
      </div>
      <div className="j-end r"><b>{w.code}</b><small>{w.name.replace('Barracão ', '')}</small></div>
    </div>
  )
}

/* ====================== CONTAINERS ====================== */

function ContainersPage({ visible, onNew, onEdit, onRemove, toggleRelease, onOpen, onProducts }: {
  visible: Container[]; onNew?: () => void
  onEdit: (c: Container) => void; onRemove: (id: string) => void; toggleRelease: (id: string) => void; onOpen: (id: string) => void
  onProducts: (c: Container, tab?: Tab) => void
}) {
  const { user, s } = useApp()
  const [stage, setStage] = useState<Stage | 'ALL'>('ALL')
  const [rel, setRel] = useState<'ALL' | 'Y' | 'N'>('ALL')
  const rows = visible.map((c) => ({ c, t: track(c) }))
    .filter(({ c, t }) => (stage === 'ALL' || t.stage === stage) && (rel === 'ALL' || c.released === (rel === 'Y')))

  const exportCsv = () => {
    const head = ['B/L / Tracker', 'País', 'Qtd containers', 'Containers', 'Produtos', 'Qtd produtos', 'Peso kg', 'Origem', 'Transbordos', 'Porto final', 'Destino', 'Saída', 'Chegada porto', 'Previsão barracão', 'Liberado', 'Status', 'Onde está', 'Navio', 'Free time', 'Último dia livre', 'Demurrage até hoje (US$)', 'Despacho', 'Documentos faltando']
    const lines = rows.map(({ c, t }) => { const f = freeTime(c, s); const p = customsProgress(c); return [c.tracker, COUNTRY_NAME[c.country], unitCount(c), (c.units ?? []).map((u) => u.n).join(' '), c.products.map((x) => `${x.qty}x ${x.brand} ${x.model} ${x.size}`).join(' | '), productQty(c), c.weightKg,
      locName(c.origin), (c.transshipments ?? []).join(' > '), locName(c.port), WAREHOUSES[c.destination].name, c.departure, c.portEta, c.eta, c.released ? 'Sim' : 'Não', STAGE_LABEL[t.stage], whereText(t), t.vessel || '',
      `${f.days} dias`, f.end, f.cost, `${p.done}/${p.total}${p.next ? ' · ' + p.next.label : ''}`, missingDocs(c).map((d) => d.label).join(', ')] })
    const csv = [head, ...lines].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    a.download = `worldscentz-containers-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  return (
    <main className="page">
      <section className="head">
        <div><h1>Containers</h1><p>{rows.length} B/Ls · {rows.reduce((a, x) => a + unitCount(x.c), 0)} containers · MSC sincronizado em {visible[0]?.syncedAt ? new Date(visible[0].syncedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</p></div>
        <div className="head-actions">
          <button className="btn" onClick={exportCsv}><Download size={15} /> Exportar CSV</button>
          {onNew && <button className="btn dark" onClick={onNew}><Plus size={16} /> Cadastrar container</button>}
        </div>
      </section>
      <div className="filters">
        <select value={stage} onChange={(e) => setStage(e.target.value as Stage | 'ALL')}>
          <option value="ALL">Todos os status</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={rel} onChange={(e) => setRel(e.target.value as 'ALL' | 'Y' | 'N')}>
          <option value="ALL">Liberação: todos</option><option value="Y">Liberados</option><option value="N">Não liberados</option>
        </select>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr><th>B/L</th><th>Conteúdo</th><th>Rota</th><th>Saída</th><th>Previsão</th><th>Progresso</th><th>Status</th><th>Porto / free time</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ c, t }) => (
              <tr key={c.id}>
                <td>
                  <div className="cell-id" onClick={() => onOpen(c.id)}>
                    <span className="sq" style={{ background: containerColor(c.tracker) }} />
                    <div><b>{c.tracker}</b><small><Flag country={c.country} size={14} /> {COUNTRY_NAME[c.country]}</small></div>
                  </div>
                </td>
                <td>
                  <button className="product-link" onClick={() => onProducts(c)}>
                    <PanelRightOpen size={15} /><span className="clip">{unitCount(c)} containers · {productQty(c) ? `${productQty(c).toLocaleString('pt-BR')} produtos` : 'produtos a informar'}</span>
                  </button>
                  <small>{t.vessel || c.vessel} · {whereText(t)}</small>
                </td>
                <td><span className="route">{t.visits.map((v, i) => <span key={i}>{i > 0 && <ArrowRight size={12} />}{LOCS[v.loc]?.code.slice(2) ?? v.loc}</span>)}<ArrowRight size={12} />{WAREHOUSES[c.destination].code}</span></td>
                <td>{fmtDate(c.departure)}</td>
                <td>{fmtDate(c.eta)}<small className={t.daysLeft < 0 && t.stage !== 'delivered' ? 'late' : ''}>{t.stage === 'delivered' ? 'entregue' : t.daysLeft < 0 ? `${-t.daysLeft}d atraso` : `em ${t.daysLeft}d`}</small></td>
                <td><div className="bar"><i style={{ width: `${t.progress * 100}%` }} /></div><small>{Math.round(t.progress * 100)}%</small></td>
                <td><StagePill stage={t.stage} /></td>
                <td>
                  <button className="pill-btn" onClick={() => can(user, 'edit') && toggleRelease(c.id)} title={can(user, 'edit') ? 'Alternar liberação' : ''}><ReleasePill released={c.released} /></button>
                  <button className="pill-btn ft" onClick={() => onProducts(c, 'ops')}><FreeBadge c={c} s={s} /></button>
                </td>
                <td className="acts">
                  <button className="icon-btn sm" onClick={() => onProducts(c)} title="Ver conteúdo"><PanelRightOpen size={15} /></button>
                  <button className="icon-btn sm" onClick={() => onOpen(c.id)} title="Ver no mapa"><MapIcon size={15} /></button>
                  {can(user, 'edit') && <button className="icon-btn sm" onClick={() => onEdit(c)} title="Editar"><Pencil size={15} /></button>}
                  {can(user, 'admin') && <button className="icon-btn sm" onClick={() => onRemove(c.id)} title="Excluir"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="empty">Nenhum container encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  )
}

/* ====================== MAPA ====================== */

function MapPage({ visible, selected, setSel, onContent }: {
  visible: Container[]; selected?: Container; setSel: (id: string) => void
  onContent: (c: Container) => void
}) {
  const t = selected ? track(selected) : undefined
  return (
    <main className="page map-page">
      <div className="map-full card">
        <MapView containers={visible} selectedId={selected?.id} onSelect={setSel} height="100%" />
        <div className="map-legend glass">
          <span><i className="sq" style={{ background: 'linear-gradient(90deg, #0B50B0 50%, #0A2A5E 50%)' }} /> Container</span>
          <span><i className="ln dash" /> A percorrer</span>
          <span><i className="ln" /> Percorrido</span>
          <span><i className="hs" /> Barracão</span>
        </div>
        {selected && t && (
          <div className="map-detail glass">
            <div className="detail-id"><Flag country={selected.country} size={18} /> #{selected.tracker}</div>
            <small>{unitCount(selected)} containers · {t.vessel || '—'}</small>
            <Journey c={selected} t={t} />
            <div className="row"><span>Status</span><b><StagePill stage={t.stage} /></b></div>
            <div className="row"><span>Onde está</span><b>{whereText(t)}</b></div>
            <div className="row"><span>Porto</span><b><ReleasePill released={selected.released} /></b></div>
            <div className="row"><span>Chegada {LOCS[selected.port]?.code}</span><b>{fmtDate(selected.portEta)}</b></div>
            <button className="btn red full content-btn" onClick={() => onContent(selected)}><PanelRightOpen size={16} /> Ver conteúdo</button>
          </div>
        )}
      </div>
      <aside className="map-list card">
        <div className="card-h"><h3>Frota em rota</h3></div>
        <ul className="arrivals">
          {visible.map((c) => {
            const tt = track(c)
            return (
              <li key={c.id} className={c.id === selected?.id ? 'on' : ''} onClick={() => setSel(c.id)}>
                <span className="sq" style={{ background: containerColor(c.tracker) }} />
                <div><b>{c.tracker}</b><small>{unitCount(c)} ctr · {whereText(tt)}</small></div>
                <StagePill stage={tt.stage} />
              </li>
            )
          })}
        </ul>
      </aside>
    </main>
  )
}

/* ====================== BARRACÕES ====================== */

function WarehousesPage({ list, history, onOpen }: { list: Container[]; history: Container[]; onOpen: (id: string) => void }) {
  const { s } = useApp()
  return (
    <main className="page">
      <section className="head"><div><h1>Barracões</h1><p>Assunção · Ciudad del Este</p></div></section>
      <div className="wh-grid">
        {Object.entries(WAREHOUSES).map(([k, w]) => {
          const mine = list.filter((c) => c.destination === k).map((c) => ({ c, t: track(c) }))
          const delivered = history.filter((c) => c.destination === k).reduce((a, c) => a + unitCount(c), 0)
          const inbound = mine.filter((x) => x.t.stage !== 'delivered')
          const cap = s.capacity[k] ?? w.capacity
          // estoque recebido: produtos dos B/Ls que chegaram aqui, menos faltas e avarias da conferência
          const stock = new Map<string, number>()
          let lost = 0
          for (const c of history.filter((x) => x.destination === k)) {
            for (const t of c.products) { const k = `${t.brand} ${t.model} ${t.size}`.trim(); stock.set(k, (stock.get(k) ?? 0) + t.qty) }
            lost += (c.receipt?.units ?? []).reduce((a, u) => a + u.missing + u.damaged, 0)
          }
          const top = [...stock.entries()].sort((a, b) => b[1] - a[1])
          const totalStock = top.reduce((a, x) => a + x[1], 0) - lost
          return (
            <div className="card wh" key={k}>
              <div className="card-h">
                <div><h3>{w.name}</h3><small>{w.country}</small></div>
                <span className="ic big"><Warehouse size={20} /></span>
              </div>
              <div className="cap">
                <Gauge value={delivered / cap} label="Ocupação" />
                <div className="cap-r">
                  <div><small>A caminho</small><b>{inbound.reduce((a, x) => a + unitCount(x.c), 0)} <em>ctr</em></b></div>
                  <div><small>Já recebidos</small><b>{delivered} <em>/ {cap} ctr</em></b></div>
                </div>
              </div>
              <div className="stock">
                <div className="stock-h"><b><SprayCan size={14} /> Estoque recebido</b><span>{totalStock > 0 ? `${totalStock.toLocaleString('pt-BR')} produtos` : '—'}</span></div>
                {top.length ? (
                  <ul>{top.slice(0, 6).map(([size, q]) => <li key={size}><span className="size">{size}</span><div className="bar"><i style={{ width: `${(q / top[0][1]) * 100}%` }} /></div><b>{q.toLocaleString('pt-BR')}</b></li>)}</ul>
                ) : <small>Os produtos entram aqui quando um B/L é conferido e recebido neste barracão.</small>}
                {lost > 0 && <small className="late">{lost} produtos com falta/avaria na conferência</small>}
              </div>
              <ul className="arrivals">
                {inbound.sort((a, b) => parseDate(a.c.eta) - parseDate(b.c.eta)).map(({ c, t }) => (
                  <li key={c.id} onClick={() => onOpen(c.id)}>
                    <span className="sq" style={{ background: containerColor(c.tracker) }} />
                    <div><b>{c.tracker}</b><small>{unitCount(c)} ctr · {fmtDate(c.eta)}</small></div>
                    <StagePill stage={t.stage} />
                  </li>
                ))}
                {!inbound.length && <li className="empty">Nada a caminho.</li>}
              </ul>
            </div>
          )
        })}
      </div>
    </main>
  )
}


/* ====================== HISTÓRICO ====================== */

function HistoryPage({ rows, total, onOpen, onReopen }: {
  rows: Container[]; total: number
  onOpen: (c: Container) => void; onReopen: (c: Container) => void
}) {
  const { user } = useApp()
  const [month, setMonth] = useState('ALL')
  const months = [...new Set(rows.map((c) => (c.arrivedAt ?? '').slice(0, 7)).filter(Boolean))].sort().reverse()
  const shown = rows.filter((c) => month === 'ALL' || (c.arrivedAt ?? '').startsWith(month))
  const days = (c: Container) => Math.max(0, Math.round((parseDate((c.arrivedAt ?? isoDay(Date.now())).slice(0, 10)) - parseDate(c.departure)) / DAY))
  const totUnits = shown.reduce((a, c) => a + unitCount(c), 0)
  const totProducts = shown.reduce((a, c) => a + productQty(c), 0)
  const avgDays = shown.length ? Math.round(shown.reduce((a, c) => a + days(c), 0) / shown.length) : 0
  const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const exportCsv = () => {
    const head = ['B/L', 'País', 'Containers', 'Nº containers', 'Produtos', 'Qtd produtos', 'Origem', 'Transbordos', 'Porto final', 'Barracão', 'Saída', 'Chegada no barracão', 'Dias de trânsito', 'Liberado em']
    const lines = shown.map((c) => [c.tracker, COUNTRY_NAME[c.country], unitCount(c), (c.units ?? []).map((u) => u.n).join(' '),
      c.products.map((x) => `${x.qty}x ${x.brand} ${x.model} ${x.size}`).join(' | ') + (c.productsSimulated ? ' (simulado)' : ''), productQty(c),
      locName(c.origin), (c.transshipments ?? []).join(' > '), locName(c.port), WAREHOUSES[c.destination].name, c.departure,
      (c.arrivedAt ?? '').slice(0, 10), days(c), (c.releasedAt ?? '').slice(0, 10)])
    const csv = [head, ...lines].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }))
    a.download = `worldscentz-historico-${month === 'ALL' ? 'completo' : month}.csv`; a.click()
  }

  return (
    <main className="page">
      <section className="head">
        <div><h1>Histórico</h1><p>B/Ls que já chegaram nos barracões — salvos no banco de dados para consulta.</p></div>
        <div className="head-actions">
          <button className="btn" onClick={exportCsv} disabled={!shown.length}><Download size={15} /> Exportar CSV</button>
          {can(user, 'admin') && <a className="btn" href="/api/backup"><Database size={15} /> Backup do banco</a>}
        </div>
      </section>
      <div className="kpis hist-kpis">
        <div className="kpi"><div className="kpi-i"><Archive size={20} /></div><div><small>B/Ls recebidos</small><b>{shown.length}</b></div></div>
        <div className="kpi"><div className="kpi-i"><Boxes size={20} /></div><div><small>Containers</small><b>{totUnits}</b></div></div>
        <div className="kpi"><div className="kpi-i"><SprayCan size={20} /></div><div><small>Produtos</small><b>{totProducts.toLocaleString('pt-BR')}</b></div></div>
        <div className="kpi"><div className="kpi-i"><CalendarDays size={20} /></div><div><small>Trânsito médio</small><b>{avgDays}<em className="kpi-sub">dias</em></b></div></div>
      </div>
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="ALL">Todos os meses</option>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
      </div>
      <div className="card table-card">
        {!total ? (
          <div className="hist-empty">
            <Archive size={36} />
            <b>Nenhum B/L chegou ainda</b>
            <p>Quando um B/L chegar no barracão, ele vem para cá automaticamente (quando a MSC marcar como entregue) ou quando alguém clicar em <b>Confirmar chegada</b> no painel “Ver conteúdo”. Os primeiros estão previstos para o fim de outubro.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>B/L</th><th>Carga</th><th>Rota</th><th>Saída</th><th>Chegada</th><th>Trânsito</th><th>Barracão</th><th /></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td><div className="cell-id" onClick={() => onOpen(c)}><span className="sq" style={{ background: containerColor(c.tracker) }} />
                    <div><b>{c.tracker}</b><small><Flag country={c.country} size={14} /> {COUNTRY_NAME[c.country]}</small></div></div></td>
                  <td><b>{unitCount(c)} containers</b><small>{productQty(c).toLocaleString('pt-BR')} produtos{c.productsSimulated ? ' (sim.)' : ''}</small></td>
                  <td><span className="route">{locName(c.origin)} <ArrowRight size={12} /> {LOCS[c.port]?.code.slice(2)}</span><small>{(c.transshipments ?? []).map((x) => x.split(',')[0]).join(' · ')}</small></td>
                  <td>{fmtDate(c.departure)}</td>
                  <td><b>{fmtDate((c.arrivedAt ?? '').slice(0, 10))}</b></td>
                  <td>{days(c)} dias</td>
                  <td>{WAREHOUSES[c.destination].code}</td>
                  <td className="acts">
                    <button className="icon-btn sm" onClick={() => onOpen(c)} title="Ver conteúdo"><PanelRightOpen size={15} /></button>
                    {can(user, 'receive') && <button className="icon-btn sm" onClick={() => onReopen(c)} title="Reabrir"><ArchiveRestore size={15} /></button>}
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={8} className="empty">Nada neste filtro.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}

/* ====================== PAINEL DA BANDEIRA ====================== */

function CountryPanel({ country, list, onClose, onPick }: { country: Country; list: Container[]; onClose: () => void; onPick: (id: string) => void }) {
  const T = list.map((c) => ({ c, t: track(c) }))
  const by = (s: Stage[]) => T.filter((x) => s.includes(x.t.stage)).length
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`drawer ${country === 'PY' ? 'py' : 'br'}`}>
        <div className="drawer-h">
          <Flag country={country} size={34} />
          <div><small>Importação</small><h2>{COUNTRY_NAME[country]}</h2></div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <ContainerArt country={country} code={list[0]?.tracker || 'WSCZ 000000'} className="drawer-art" />
        <div className="drawer-stats">
          <div><b>{list.reduce((a, c) => a + unitCount(c), 0)}</b><small>Containers</small></div>
          <div><b>{by(['sea', 'scheduled'])}</b><small>B/L no mar</small></div>
          <div><b>{by(['transship', 'river'])}</b><small>Transb./rio</small></div>
          <div><b>{by(['held'])}</b><small>Retidos</small></div>
        </div>
        <ul className="arrivals">
          {T.map(({ c, t }) => (
            <li key={c.id} onClick={() => onPick(c.id)}>
              <span className="sq" style={{ background: containerColor(c.tracker) }} />
              <div><b>{c.tracker}</b><small>{unitCount(c)} ctr · {whereText(t)}</small></div>
              <StagePill stage={t.stage} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ====================== LISTA DE PRODUTOS ====================== */

const EMPTY_PRODUCT: ProductItem = { brand: '', model: '', size: '', category: 'Unissex', qty: 0, unitKg: 0 }

type Tab = 'ctr' | 'products' | 'hist' | 'log' | 'ops' | 'docs' | 'costs'

const LOG_PT: Record<string, string> = {
  created: 'Cadastrado', updated: 'Dados editados', released: 'Liberado no porto', release_revoked: 'Liberação revogada',
  products_updated: 'Produtos lançados/alterados', arrived: 'Chegou no barracão (histórico)', reopened: 'Reaberto', deleted: 'Excluído',
  eta_changed: 'MSC mudou a previsão de chegada', customs: 'Despacho', costs_updated: 'Custos atualizados', truck_updated: 'Caminhão atualizado',
  received: 'Conferência no barracão', doc_added: 'Documento anexado', doc_removed: 'Documento removido',
  msc_event: 'Novidade da MSC', msc_delivered: 'MSC marcou como entregue',
}
const STEP_PT: Record<string, string> = {
  port_arrival: 'chegou ao porto', docs_delivered: 'documentos com o despachante', channel: 'canal', taxes_paid: 'impostos pagos', released: 'liberado pela aduana', pickup: 'retirado do porto',
}
function logText(l: LogEntry) {
  const d = l.detail ?? {}
  const parts: string[] = []
  if ('qty' in d) parts.push(`${Number(d.qty).toLocaleString('pt-BR')} produtos${d.source ? ` (${d.source})` : ''}`)
  else if ('source' in d && d.source) parts.push(`origem ${String(d.source)}`)
  if (Array.isArray(d.fields)) parts.push((d.fields as string[]).join(', '))
  if (l.kind === 'msc_event') parts.push(`${d.text} — ${d.place} · ${d.units} ctr${d.vessel ? ` · ${d.vessel}` : ''} · ${fmtDate(String(d.at))}`)
  if (l.kind === 'eta_changed') parts.push(`${fmtDate(String(d.from))} → ${fmtDate(String(d.to))}`)
  if (l.kind === 'customs') parts.push(`${STEP_PT[String(d.step)] ?? d.step}${d.value ? ` ${d.value}` : ''}${d.cleared ? ' (desfeito)' : d.at ? ` · ${fmtDate(String(d.at))}` : ''}`)
  if (l.kind === 'costs_updated') parts.push(usd(Number(d.total)))
  if (l.kind === 'truck_updated' && d.plate) parts.push(`placa ${d.plate}${d.company ? ` · ${d.company}` : ''}`)
  if (l.kind === 'received') parts.push(`${d.units} ctr${Number(d.missing) ? ` · ${d.missing} faltando` : ''}${Number(d.damaged) ? ` · ${d.damaged} avariados` : ''}`)
  if (l.kind === 'doc_added' || l.kind === 'doc_removed') parts.push(String(d.name))
  if (l.by) parts.push(l.by)
  return parts.join(' · ')
}

function lastActual(u: MscUnit) {
  const today = new Date().toISOString().slice(0, 10)
  const done = u.events.filter((e) => e.d <= today && e.desc !== 'Estimated Time of Arrival' && e.desc !== 'Full Intended Transshipment')
  return done[done.length - 1]
}
const EVENT_PT: Record<string, string> = {
  'Empty to Shipper': 'Vazio entregue ao embarcador', 'Export received at CY': 'Recebido no terminal (cheio)',
  'Export Loaded on Vessel': 'Embarcado no navio', 'Full Transshipment Discharged': 'Descarregado p/ transbordo',
  'Full Transshipment Loaded': 'Embarcado no transbordo', 'Full Intended Transshipment': 'Transbordo previsto',
  'Estimated Time of Arrival': 'Chegada prevista', 'Empty received at rail ramp': 'Vazio recebido (ferrovia)',
}
const evPt = (d: string) => EVENT_PT[d] ?? d

/** Painel lateral com tudo o que está dentro do B/L: containers, produtos e histórico. */
function ContentPanel({ c, initialTab, onClose, onEdit, onArrive, onReopen, onPacking, onChange, notify, syncing, onSync }: {
  c: Container; initialTab: Tab; onClose: () => void; onEdit: () => void; onArrive: () => void; onReopen: () => void
  onPacking: () => void; onChange: (c: Container) => void; notify: (m: string) => void; syncing: boolean; onSync: () => void
}) {
  const { user, s } = useApp()
  const arrived = c.status === 'arrived'
  const [log, setLog] = useState<LogEntry[] | null>(null)
  const [tab, setTabState] = useState<Tab>(initialTab)
  const setTab = (t: Tab) => { setTabState(t); if (t === 'log') api.log(c.tracker).then(setLog).catch(() => setLog([])) }
  useEffect(() => { if (initialTab === 'log') setTab('log') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ft = freeTime(c, s)
  const cp = customsProgress(c)
  const miss = missingDocs(c).length
  const [q, setQ] = useState('')
  const t = track(c)
  const qty = productQty(c)
  const units = c.units ?? []
  const shown = units.filter((u) => !q || u.n.toLowerCase().includes(q.toLowerCase()))
  const byCat = PRODUCT_CATEGORIES.map((k) => ({ k, n: c.products.filter((x) => x.category === k).reduce((a, x) => a + x.qty, 0) })).filter((x) => x.n)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="side-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`side-panel ${c.country === 'PY' ? 'py' : 'br'}`}>
        <div className="sp-h">
          <div>
            <small>Conteúdo do {c.carrier ? 'B/L' : 'container'}</small>
            <h2><Flag country={c.country} size={22} /> {c.tracker}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="sp-status">
          {arrived ? <span className="pill" style={{ ['--c' as string]: '#1E9E5A' }}><i />Recebido em {fmtDate((c.arrivedAt ?? '').slice(0, 10))}</span> : <StagePill stage={t.stage} />}
          <span>{whereText(t)}{t.vessel ? ` · ${t.vessel}` : ''}</span>
          {c.carrier === 'MSC' && <span className="sp-links">
            {can(user, 'sync') && <button className={`sp-link ${syncing ? 'run' : ''}`} onClick={onSync} disabled={syncing} title="Consultar este B/L na MSC agora"><RefreshCw size={12} /> {syncing ? 'Consultando…' : 'Atualizar'}</button>}
            <a className="sp-link" href={mscLink(c.tracker)} target="_blank" rel="noreferrer">MSC <ExternalLink size={12} /></a>
          </span>}
          {c.syncedAt && <small className="sp-synced">MSC consultada em {new Date(c.syncedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>}
        </div>
        <div className="tl-sum">
          <div><small>Containers</small><b>{unitCount(c)}</b></div>
          <div><small>Produtos{c.productsSimulated ? ' (sim.)' : ''}</small><b>{qty ? qty.toLocaleString('pt-BR') : '—'}</b></div>
          <div><small>Chegada {LOCS[c.port]?.code}</small><b className="sm">{fmtDate(c.portEta)}</b></div>
          <div><small>Destino</small><b>{WAREHOUSES[c.destination].code}</b></div>
        </div>
        <div className="seg tabs">
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}><SprayCan size={15} /> Produtos</button>
          <button className={tab === 'ctr' ? 'on' : ''} onClick={() => setTab('ctr')}><Boxes size={15} /> Containers <em>{unitCount(c)}</em></button>
          <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}><Ship size={15} /> Rota</button>
          <button className={tab === 'ops' ? 'on' : ''} onClick={() => setTab('ops')}><Landmark size={15} /> Despacho <em style={{ background: ft.state === 'over' || ft.state === 'warn' ? FREE_COLOR[ft.state] : undefined, color: ft.state === 'over' || ft.state === 'warn' ? '#fff' : undefined }}>{cp.done}/{cp.total}</em></button>
          <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}><FileText size={15} /> Docs {miss > 0 && <em className="em-warn">{miss}</em>}</button>
          <button className={tab === 'costs' ? 'on' : ''} onClick={() => setTab('costs')}><DollarSign size={15} /> Custos</button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}><History size={15} /> Registro</button>
        </div>

        <div className="sp-body">
          {tab === 'ctr' && (
            units.length ? (
              <>
                <label className="search sp-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nº do container…" /></label>
                <ul className="unit-list">
                  {shown.map((u, i) => {
                    const ev = lastActual(u)
                    return (
                      <li key={u.n}>
                        <span className="unit-ix">{String(i + 1).padStart(2, '0')}</span>
                        <span className="sq big" style={{ background: containerColor(c.tracker) }} />
                        <div className="unit-main">
                          <b>{u.n}</b>
                          <small>{shortType(u.type)} · {ev ? `${evPt(ev.desc)} — ${ev.name.split(',')[0]} · ${fmtDate(ev.d)}` : 'sem movimento'}</small>
                          {productsInUnit(c, u.n).map((x) => (
                            <span key={x.brand + x.model + x.size} className="unit-product"><SprayCan size={12} /> {x.qty.toLocaleString('pt-BR')} × {x.brand} {x.model} <span className="size">{x.size}</span></span>
                          ))}
                        </div>
                        <div className="unit-eta"><small>ETA</small><b>{fmtDate(u.podEta)}</b></div>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : <div className="empty">Container cadastrado manualmente — sem lista de unidades.</div>
          )}

          {tab === 'products' && (
            c.products.length ? (
              <>
                {c.productsSimulated && (
                  <div className="sim-note"><b>Dados simulados</b> Carga gerada para demonstração. Use “Importar packing list” para trocar pela carga real deste B/L.</div>
                )}
                <div className="tl-cats">
                  {byCat.map(({ k, n }) => (
                    <div key={k} className="tl-cat"><span>{k}</span><div className="bar"><i style={{ width: `${(n / qty) * 100}%` }} /></div><b>{n.toLocaleString('pt-BR')}</b></div>
                  ))}
                </div>
                <ul className="product-list">
                  {c.products.map((x, i) => (
                    <li key={i}>
                      <ProductIcon />
                      <div><b>{x.brand} {x.model}</b><small><span className="size">{x.size}</span> {x.category}</small></div>
                      <div className="num"><b>{x.qty.toLocaleString('pt-BR')}</b><small>{x.units?.length ? `${x.units.length} ctr · ` : ''}{((x.qty * x.unitKg) / 1000).toFixed(1)} t</small></div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="empty-products">
                <ProductIcon />
                <b>Produtos ainda não informados</b>
                <p>A MSC não informa a carga. Importe o packing list ou cadastre marca, produto, volume e quantidade.</p>
                {can(user, 'edit') && <button className="btn dark" onClick={onPacking}><FileSpreadsheet size={15} /> Importar packing list</button>}
              </div>
            )
          )}

          {tab === 'hist' && (
            <ol className="route-tl">
              {t.visits.map((v, i) => {
                const reached = Date.now() >= v.arr
                const leg = t.legs[i]
                return (
                  <li key={i} className={reached ? 'done' : ''}>
                    <span className="dot" />
                    <div>
                      <b>{locName(v.loc)}</b>
                      <small>
                        {i === 0 ? `Embarque ${fmtDate(new Date(v.dep).toISOString().slice(0, 10))}` :
                          `${v.arrEst ? 'Chegada prevista' : 'Chegou'} ${fmtDate(new Date(v.arr).toISOString().slice(0, 10))}` +
                          (i < t.visits.length - 1 && v.dep !== v.arr ? ` · ${v.depEst ? 'saída prevista' : 'saiu'} ${fmtDate(new Date(v.dep).toISOString().slice(0, 10))}` : '')}
                      </small>
                      {leg && <em className="leg">{leg.river ? <Waves size={12} /> : <Ship size={12} />} {leg.vessel || 'a definir'}</em>}
                    </div>
                  </li>
                )
              })}
              <li className={t.stage === 'delivered' ? 'done' : ''}>
                <span className="dot wh" />
                <div><b>{WAREHOUSES[c.destination].name}</b><small>Previsão {fmtDate(c.eta)} · {c.released ? 'liberado no porto' : 'aguardando liberação'}</small></div>
              </li>
            </ol>
          )}
          {tab === 'ops' && <OpsTab c={c} s={s} user={user} onChange={onChange} notify={notify} />}
          {tab === 'docs' && <DocsTab c={c} user={user} onChange={onChange} notify={notify} />}
          {tab === 'costs' && <CostsTab c={c} s={s} user={user} onChange={onChange} notify={notify} />}
          {arrived && c.receipt && tab === 'ctr' && (
            <div className="sim-note recv-note"><b>Conferência em {fmtDate(c.receipt.at)}{c.receipt.by ? ` · ${c.receipt.by}` : ''}</b>
              {c.receipt.units.filter((u) => !u.ok).length ? c.receipt.units.filter((u) => !u.ok).map((u) => `${u.n}: ${u.missing} faltando, ${u.damaged} avariados${u.note ? ` (${u.note})` : ''}`).join(' · ') : 'Todos os containers OK.'}
              {c.receipt.notes ? ` · ${c.receipt.notes}` : ''}</div>
          )}
          {tab === 'log' && (
            !log ? <div className="empty">Carregando…</div> : !log.length ? <div className="empty">Sem registros.</div> : (
              <ol className="route-tl log-tl">
                {log.map((l, i) => (
                  <li key={i} className="done">
                    <span className="dot" />
                    <div>
                      <b>{LOG_PT[l.kind] ?? l.kind}</b>
                      <small>{new Date(l.at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        {logText(l) ? ` · ${logText(l)}` : ''}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )
          )}
        </div>

        {can(user, 'receive') && <div className={`sp-f ${can(user, 'edit') ? 'three' : ''}`}>
          {can(user, 'edit') && <button className="btn" onClick={onPacking}><FileSpreadsheet size={15} /> Packing list</button>}
          {can(user, 'edit') && <button className="btn" onClick={onEdit}><SprayCan size={15} /> {c.productsSimulated || !c.products.length ? 'Informar produtos' : 'Editar produtos'}</button>}
          {can(user, 'receive') && (arrived
            ? <button className="btn" onClick={onReopen}><ArchiveRestore size={15} /> Reabrir</button>
            : <button className="btn dark" onClick={onArrive}><CheckCircle2 size={15} /> Confirmar chegada</button>)}
        </div>}
      </aside>
    </div>
  )
}

function ProductIcon() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" className="product-ic">
      <rect x="16" y="3" width="8" height="5" rx="1.2" fill="#C5CAD1" />
      <rect x="17.5" y="8" width="5" height="4" fill="#9aa1ab" />
      <rect x="8" y="12" width="24" height="25" rx="5" fill="#0B50B0" />
      <rect x="12" y="20" width="16" height="10" rx="1.5" fill="#fff" />
    </svg>
  )
}

/* ====================== FORMULÁRIO ====================== */

function ContainerForm({ initial, onSave, onClose }: { initial?: Container; onSave: (c: Container) => void; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState<Container>(initial ?? {
    id: 'c' + Date.now(), tracker: '', content: 'Perfumes e cosméticos', products: [{ ...EMPTY_PRODUCT }], weightKg: 0, country: 'PY', origin: 'JEA', port: 'PNG', destination: 'CDE',
    departure: today, portEta: today, eta: today, released: false, vessel: '', truck: '', notes: '',
  })
  const [err, setErr] = useState('')
  const set = <K extends keyof Container>(k: K, v: Container[K]) => setF((x) => ({ ...x, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.tracker.trim()) return setErr('Informe o Nº do tracker.')
    const products = f.products.filter((t) => t.size.trim() && t.qty > 0)
    if (!products.length) return setErr('Adicione pelo menos um produto com volume e quantidade.')
    if (f.portEta < f.departure) return setErr('A chegada no porto não pode ser antes da saída.')
    if (f.eta < f.portEta) return setErr('A previsão no barracão não pode ser antes da chegada no porto.')
    const changed = JSON.stringify(products.map(({ units: _u, ...x }) => x)) !== JSON.stringify((initial?.products ?? []).map(({ units: _u, ...x }) => x))
    onSave({ ...f, products, weightKg: productKg(products), productsSimulated: changed ? false : f.productsSimulated, content: f.content.trim() || 'Produtos', tracker: f.tracker.trim().toUpperCase() })
  }

  return (
    <Modal title={initial ? 'Editar container' : 'Cadastrar container'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-preview">
          <ContainerArt country={f.country} code={f.tracker || 'WSCZ 000000'} />
        </div>
        <div className="fgrid">
          <label>Nº Tracker<input value={f.tracker} onChange={(e) => set('tracker', e.target.value)} placeholder="MSCU 123456-7" required readOnly={!!initial} /></label>
          <label>Navio<input value={f.vessel} onChange={(e) => set('vessel', e.target.value)} placeholder="MSC Aurora" /></label>
          <label>Descrição da carga<input value={f.content} onChange={(e) => set('content', e.target.value)} placeholder="Perfumes e cosméticos" /></label>
          <label>Caminhão / placa<input value={f.truck || ''} onChange={(e) => set('truck', e.target.value)} placeholder="NPR-0000" /></label>
          <label>De onde saiu
            <select value={f.origin} onChange={(e) => set('origin', e.target.value)}>
              {Object.entries(ORIGINS).map(([k, o]) => <option key={k} value={k}>{o.name} ({o.country})</option>)}
            </select>
          </label>
          <label>Porto de entrada
            <select value={f.port} onChange={(e) => set('port', e.target.value)}>
              {Object.entries(PORTS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            </select>
          </label>
          <label>Para onde vai
            <select value={f.destination} onChange={(e) => set('destination', e.target.value)}>
              {Object.entries(WAREHOUSES).map(([k, w]) => <option key={k} value={k}>{w.name}</option>)}
            </select>
          </label>
          <div className="full product-editor">
            <div className="te-h">
              <b><SprayCan size={15} /> Produtos no container</b>
              <button type="button" className="btn sm" onClick={() => set('products', [...f.products, { ...EMPTY_PRODUCT }])}><Plus size={14} /> Adicionar produto</button>
            </div>
            <div className="te-row te-head"><span>Marca</span><span>Produto</span><span>Volume</span><span>Categoria</span><span>Qtd</span><span>kg/un</span><span /></div>
            {f.products.map((t, i) => {
              const up = (patch: Partial<ProductItem>) => set('products', f.products.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <div className="te-row" key={i}>
                  <input value={t.brand} onChange={(e) => up({ brand: e.target.value })} placeholder="Lattafa" />
                  <input value={t.model} onChange={(e) => up({ model: e.target.value })} placeholder="Asad" />
                  <input value={t.size} onChange={(e) => up({ size: e.target.value })} placeholder="100 ml" />
                  <select value={t.category} onChange={(e) => up({ category: e.target.value as ProductItem['category'] })}>
                    {PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" min={0} value={t.qty} onChange={(e) => up({ qty: +e.target.value })} />
                  <input type="number" min={0} step={0.1} value={t.unitKg} onChange={(e) => up({ unitKg: +e.target.value })} />
                  <button type="button" className="icon-btn sm" onClick={() => set('products', f.products.filter((_, j) => j !== i))} aria-label="Remover"><X size={14} /></button>
                </div>
              )
            })}
          </div>
          <label>Dia que saiu<input type="date" value={f.departure} onChange={(e) => set('departure', e.target.value)} /></label>
          <label>Previsão chegada no porto<input type="date" value={f.portEta} onChange={(e) => set('portEta', e.target.value)} /></label>
          <label>Previsão chegada no barracão<input type="date" value={f.eta} onChange={(e) => set('eta', e.target.value)} /></label>
          <label className="full switch">
            <input type="checkbox" checked={f.released} onChange={(e) => set('released', e.target.checked)} />
            <span className="sw" /> Liberado no porto (aduana)
          </label>
          <label className="full">Observações<textarea rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="form-f">
          <span><SprayCan size={14} /> {productQty(f).toLocaleString('pt-BR')} produtos · <Weight size={14} /> {(productKg(f.products) / 1000).toFixed(1)} t</span>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn dark">{initial ? 'Salvar alterações' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  )
}
