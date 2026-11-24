import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, Marker, Tooltip, GeoJSON, useMap, Pane } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { feature } from 'topojson-client'
import type { FeatureCollection } from 'geojson'
import { Plus, Minus, LocateFixed } from 'lucide-react'
import { LOCS, ORIGINS, WAREHOUSES, track, splitPath, STAGE_COLOR, STAGE_LABEL, locName, unitCount, type Container, type LatLng, type Tracking } from './data'
import { containerColor } from './ui'

/* ---------- Mapa-múndi vetorial (carregado sob demanda) ---------- */
let worldCache: FeatureCollection | null = null
function useWorld() {
  const [w, setW] = useState<FeatureCollection | null>(worldCache)
  useEffect(() => {
    if (worldCache) return
    import('world-atlas/countries-50m.json').then((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topo = (m.default ?? m) as any
      worldCache = feature(topo, topo.objects.countries) as unknown as FeatureCollection
      setW(worldCache)
    })
  }, [])
  return w
}

const countryStyle = (f?: { properties?: { name?: string } }): L.PathOptions => {
  const n = f?.properties?.name
  if (n === 'Paraguay') return { fillColor: '#0B50B0', fillOpacity: 0.14, color: '#0B50B0', weight: 1.2, opacity: 0.7 }
  return { fillColor: '#FFFFFF', fillOpacity: 1, color: '#D9DBDE', weight: 0.6, opacity: 1 }
}

/* Linhas de latitude/longitude, bem sutis */
const GRATICULE: LatLng[][] = [
  ...[-60, -40, -20, 0, 20, 40, 60].map((lat) => [[lat, -180], [lat, 180]] as LatLng[]),
  ...Array.from({ length: 13 }, (_, i) => -180 + i * 30).map((lng) => [[-80, lng], [80, lng]] as LatLng[]),
]

/* ---------- Ícones ---------- */
const icon = (html: string, w: number, h: number, cls = '') =>
  L.divIcon({ html, className: `mk ${cls}`, iconSize: [w, h], iconAnchor: [w / 2, h / 2] })

function shipSvg(color: string, flip: boolean) {
  // navio porta-container visto de lado, com os containers no convés
  // duas camadas de containers alinhadas sobre o convés
  const box = (x: number, y: number) => `<rect x="${x}" y="${y}" width="7.4" height="6" rx=".7" fill="${color}" stroke="#fff" stroke-width=".7"/>`
  const stack = [0, 1, 2, 3, 4, 5].map((i) => box(10 + i * 8, 10)).join('') + [1, 2, 3, 4].map((i) => box(10 + i * 8, 4)).join('')
  return `<svg viewBox="0 0 72 30" width="72" height="30" style="transform:scaleX(${flip ? -1 : 1})">
    <path d="M0 29 Q36 33 72 29" stroke="#141414" stroke-opacity=".15" stroke-width="2" fill="none"/>
    ${stack}
    <rect x="61" y="3" width="7" height="13" rx="1" fill="#fff" stroke="#141414" stroke-width="1"/>
    <rect x="62.5" y="5" width="4" height="2.2" fill="#141414"/>
    <path d="M2 16 H70 L64 27 H8 Z" fill="#141414"/>
    <path d="M4.5 19 H68" stroke="#0B50B0" stroke-width="1.6"/>
  </svg>`
}

function truckSvg(color: string, flip: boolean) {
  const ribs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${5 + i * 4.2}" y="5" width="1.4" height="10" fill="#fff" opacity=".22"/>`).join('')
  const wheels = [9, 16, 46].map((x) => `<circle cx="${x}" cy="21" r="3.3" fill="#141414"/><circle cx="${x}" cy="21" r="1.2" fill="#bbb"/>`).join('')
  return `<svg viewBox="0 0 54 26" width="54" height="26" style="transform:scaleX(${flip ? -1 : 1})">
    <rect x="2" y="3" width="36" height="14" rx="1.2" fill="${color}" stroke="#fff" stroke-width=".6"/>${ribs}
    <rect x="2" y="17" width="36" height="2.4" fill="#141414"/>
    <path d="M40 7 H47 L52 13 V19.4 H40 Z" fill="#fff" stroke="#141414" stroke-width="1.2"/>
    <path d="M44 9 H47 L50 13 H44 Z" fill="#141414" opacity=".8"/>${wheels}
  </svg>`
}

function vehicleIcon(c: Container, t: Tracking, active: boolean, count = 1, units = 0) {
  const color = containerColor(c.tracker)
  const flip = t.heading > 180 && t.heading < 360 // indo para oeste
  const onLand = t.stage === 'land'
  const body = onLand ? truckSvg(color, flip) : shipSvg(color, flip)
  const anchored = t.stage === 'held' || t.stage === 'port' || t.stage === 'scheduled'
  const [w, h] = onLand ? [54, 26] : [72, 30]
  return icon(
    `<div class="veh ${active ? 'on' : ''} ${anchored ? 'anch' : ''}" style="--ring:${STAGE_COLOR[t.stage]};--s:${active ? 1.3 : 0.85}">
       ${body}
       <span class="veh-dot"></span>
       ${active ? `<span class="veh-tag">${c.tracker}</span>` : ''}
       ${!active && count > 1 ? `<span class="veh-count">${count} B/L · ${units} ctr</span>` : ''}
     </div>`,
    w, h,
  )
}

const originIcon = icon('<span class="mk-origin"></span>', 14, 14)
const tsIcon = icon('<span class="mk-ts"></span>', 12, 12)
const portIcon = icon('<span class="mk-port"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="5" r="2.4"/><path d="M12 7.5V21M5 13a7 7 0 0 0 14 0M8 11h8"/></svg></span>', 20, 20)
const whIcon = icon('<span class="mk-wh"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M2.5 10 12 4l9.5 6v10.5h-19z" fill="#fff"/><path d="M6.5 12.5h11v8h-11z" fill="#0B50B0"/><path d="M6.5 15h11M6.5 17.5h11" stroke="#fff" stroke-width="1"/></svg></span>', 30, 30)

const WH_DIR: Record<string, 'left' | 'top' | 'right'> = { ASU: 'left', CDE: 'top' }
const WH_OFF: Record<string, [number, number]> = { ASU: [-16, 0], CDE: [0, -16] }

function Controls({ points, focus }: { points: LatLng[]; focus?: LatLng[] }) {
  const map = useMap()
  const fit = () => {
    const pts = focus && focus.length ? focus : points
    if (pts.length) map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [50, 50], paddingBottomRight: [map.getSize().x > 900 ? 380 : 50, 50], duration: 0.9, maxZoom: 6 })
  }
  useEffect(fit, [map, points, focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const stop = (el: HTMLDivElement | null) => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el) } }
  return (
    <div className="map-ctrl" ref={stop}>
      <button onClick={() => map.zoomIn()} aria-label="Aproximar"><Plus size={16} /></button>
      <button onClick={() => map.zoomOut()} aria-label="Afastar"><Minus size={16} /></button>
      <button onClick={fit} aria-label="Centralizar"><LocateFixed size={16} /></button>
    </div>
  )
}

export default function MapView({ containers, selectedId, onSelect, height = 420 }: {
  containers: Container[]; selectedId?: string; onSelect: (id: string) => void; height?: number | string
}) {
  const world = useWorld()
  const tracked = useMemo(() => containers.map((c) => ({ c, t: track(c) })), [containers])
  const sel = tracked.find((x) => x.c.id === selectedId)
  const all: LatLng[] = useMemo(() => tracked.flatMap(({ t }) => [t.sea[0], t.land[t.land.length - 1]]), [tracked])
  const focus = useMemo(() => (sel ? [...sel.t.sea, ...sel.t.land] : undefined), [sel])
  // só mostra os portos que fazem parte das rotas
  const usedLocs = useMemo(() => new Set(tracked.flatMap(({ t }) => t.visits.map((v) => v.loc))), [tracked])
  // agrupa B/Ls que estão no mesmo navio / mesmo lugar
  const groups = useMemo(() => {
    const m = new Map<string, { c: Container; t: Tracking }[]>()
    for (const x of tracked) {
      if (x.t.stage === 'delivered' || x.c.id === selectedId) continue
      const k = `${x.t.pos[0].toFixed(1)},${x.t.pos[1].toFixed(1)}|${x.t.stage}|${x.t.vessel ?? ''}`
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(x)
    }
    return [...m.values()]
  }, [tracked, selectedId])

  return (
    <div className="map" style={{ height }}>
      <MapContainer center={[-10, -20]} zoom={2} minZoom={2} maxZoom={9} worldCopyJump zoomControl={false} attributionControl={false}
        style={{ height: '100%', width: '100%' }}>
        <Polyline positions={GRATICULE} pathOptions={{ color: '#C4C8CE', weight: 0.6, opacity: 0.7, dashArray: '2 5', interactive: false }} />
        {world && <GeoJSON data={world} style={countryStyle as L.StyleFunction} interactive={false} />}
        <Controls points={all} focus={focus} />

        <Pane name="routes" style={{ zIndex: 450 }}>
          {tracked.map(({ c, t }) => {
            const active = c.id === selectedId
            const col = containerColor(c.tracker)
            const dim = selectedId && !active
            const [landDone, landLeft] = splitPath(t.land, t.landF)
            const w = active ? 3.2 : 1.6
            const op = dim ? 0.08 : active ? 1 : 0.3
            return (
              <span key={c.id}>
                <Polyline positions={t.seaLeft} pathOptions={{ color: col, weight: w, opacity: op * 0.9, dashArray: '1 7', lineCap: 'round', interactive: false }} />
                <Polyline positions={t.seaDone} pathOptions={{ color: col, weight: w, opacity: op, interactive: false }} />
                <Polyline positions={landLeft} pathOptions={{ color: col, weight: w, opacity: op * 0.9, dashArray: '1 6', lineCap: 'round', interactive: false }} />
                <Polyline positions={landDone} pathOptions={{ color: col, weight: w + 0.6, opacity: op, interactive: false }} />
              </span>
            )
          })}
        </Pane>

        {[...usedLocs].map((k) => {
          const p = LOCS[k]
          if (!p) return null
          const isOrigin = k in ORIGINS && !['SIN', 'VLC'].includes(k)
          const isFinal = k.startsWith('PY') || ['ITJ', 'PNG'].includes(k)
          return (
            <Marker key={k} position={p.pos} icon={isOrigin ? originIcon : isFinal ? portIcon : tsIcon}>
              <Tooltip direction="top" offset={[0, -8]}><b>{p.name}</b> · {p.country}<br />{isOrigin ? 'Origem' : isFinal ? 'Porto final' : 'Transbordo'} · {p.code}</Tooltip>
            </Marker>
          )
        })}
        {Object.entries(WAREHOUSES).map(([k, w]) => (
          <Marker key={k} position={w.pos} icon={whIcon} zIndexOffset={500}>
            <Tooltip direction={WH_DIR[k]} offset={WH_OFF[k]} permanent className="wh-label">{w.name.replace('Barracão ', '').replace('Ciudad del Este', 'C. del Este')}</Tooltip>
          </Marker>
        ))}

        {groups.map((g) => {
          const { c, t } = g[0]
          const units = g.reduce((a, x) => a + unitCount(x.c), 0)
          return (
            <Marker key={'g' + c.id} position={t.pos} icon={vehicleIcon(c, t, false, g.length, units)} zIndexOffset={800}
              eventHandlers={{ click: () => onSelect(c.id) }}>
              <Tooltip direction="top" offset={[0, -16]}>
                <b>{t.vessel || STAGE_LABEL[t.stage]}</b> · {STAGE_LABEL[t.stage]}<br />
                {t.at ? `Em ${locName(t.at)}` : t.next ? `Rumo a ${locName(t.next)}` : ''}<br />
                {g.length > 1 ? `${g.length} B/Ls · ${units} containers` : `${c.tracker} · ${units} containers`}
              </Tooltip>
            </Marker>
          )
        })}
        {sel && sel.t.stage !== 'delivered' && (
          <Marker key={'sel' + sel.c.id} position={sel.t.pos} icon={vehicleIcon(sel.c, sel.t, true)} zIndexOffset={2000} />
        )}
      </MapContainer>
    </div>
  )
}
