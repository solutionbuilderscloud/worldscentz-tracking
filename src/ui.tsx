import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { STAGE_COLOR, STAGE_LABEL, type Country, type Stage } from './data'

/** Caminho do logo respeitando a base do site (GitHub Pages serve em subpasta). */
export const LOGO = import.meta.env.BASE_URL + 'logo-worldscentz.png'
export const COUNTRY_NAME: Record<Country, string> = { PY: 'Paraguai' }
/** Frota mista: metade azul, metade azul-escuro — fixo por tracker, só para variar o visual. */
export const isNavy = (tracker: string) => [...tracker].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 2 === 1
export const containerColor = (tracker: string) => (isNavy(tracker) ? '#0A2A5E' : '#0B50B0')

export function Flag({ country, size = 22 }: { country: Country; size?: number }) {
  const h = Math.round(size * 0.7)
  return (
    <svg width={size} height={h} viewBox="0 0 30 21" className="flag">
      <rect width="30" height="7" fill="#D52B1E" />
      <rect y="7" width="30" height="7" fill="#fff" />
      <rect y="14" width="30" height="7" fill="#0038A8" />
      <circle cx="15" cy="10.5" r="2.2" fill="none" stroke="#0038A8" strokeWidth=".6" />
      <circle cx="15" cy="10.5" r=".8" fill="#FCD116" />
    </svg>
  )
}

/** Ilustração de container sobre carreta. Azul da marca. */
export function ContainerArt({ country, code, truck = true, className }: { country: Country; code: string; truck?: boolean; className?: string }) {
  const navy = isNavy(code), base = containerColor(code)
  const dark = navy ? '#061B3F' : '#083C86'
  const light = navy ? '#17407F' : '#2B6FD0'
  const ribs = Array.from({ length: 46 })
  const [prefix, num = ''] = code.split(' ')
  return (
    <svg viewBox="0 0 900 330" className={className} role="img" aria-label={`Container ${code}`}>
      <defs>
        <linearGradient id={`shade-${country}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".25" />
        </linearGradient>
        <radialGradient id="floor" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".28" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="450" cy="308" rx="430" ry="16" fill="url(#floor)" />
      {/* corpo do container */}
      <rect x="20" y="20" width="860" height="220" rx="4" fill={base} />
      {ribs.map((_, i) => (
        <g key={i}>
          <rect x={34 + i * 18.4} y="28" width="9" height="204" fill={light} opacity=".55" />
          <rect x={43 + i * 18.4} y="28" width="2.5" height="204" fill={dark} opacity=".6" />
        </g>
      ))}
      <rect x="20" y="20" width="860" height="220" rx="4" fill={`url(#shade-${country})`} />
      <rect x="20" y="20" width="860" height="10" fill={dark} />
      <rect x="20" y="232" width="860" height="10" fill={dark} />
      <rect x="20" y="20" width="14" height="222" fill={dark} />
      <rect x="866" y="20" width="14" height="222" fill={dark} />
      {[20, 866].map((x) => [20, 228].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="14" height="14" rx="2" fill="#0a0a0a" opacity=".7" />))}
      <text x="60" y="82" fill="#fff" fontSize="34" fontWeight="800" fontFamily="Manrope" letterSpacing="2">{prefix}</text>
      <text x="60" y="118" fill="#fff" fontSize="26" fontWeight="700" fontFamily="Manrope" opacity=".9">{num}</text>
      <image href={LOGO} x="700" y="44" width="150" height="172" preserveAspectRatio="xMaxYMid meet" />
      {truck && (
        <g>
          <rect x="30" y="244" width="840" height="14" fill="#1b1b1b" />
          <rect x="560" y="258" width="300" height="10" fill="#2a2a2a" />
          {[110, 190, 270, 640, 720].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="276" r="30" fill="#111" />
              <circle cx={cx} cy="276" r="17" fill="#bdbdbd" />
              <circle cx={cx} cy="276" r="7" fill="#555" />
            </g>
          ))}
          <rect x="380" y="258" width="110" height="34" rx="3" fill="#cfcfcf" />
          <rect x="388" y="264" width="94" height="4" fill="#9a9a9a" />
          <rect x="388" y="274" width="94" height="4" fill="#9a9a9a" />
        </g>
      )}
    </svg>
  )
}

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <span className="pill" style={{ ['--c' as string]: STAGE_COLOR[stage] }}>
      <i />
      {STAGE_LABEL[stage]}
    </span>
  )
}

export function ReleasePill({ released }: { released: boolean }) {
  return (
    <span className="pill" style={{ ['--c' as string]: released ? '#1E9E5A' : '#E8A317' }}>
      <i />
      {released ? 'Liberado' : 'Não liberado'}
    </span>
  )
}

/** Medidor em arco segmentado (estilo da referência). */
export function Gauge({ value, label }: { value: number; label: string }) {
  const segs = 22, on = Math.round(Math.max(0, Math.min(1, value)) * segs)
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 112">
        {Array.from({ length: segs }).map((_, i) => {
          const a = Math.PI + (i / (segs - 1)) * Math.PI
          const r1 = 70, r2 = 94
          const x1 = 100 + r1 * Math.cos(a), y1 = 104 + r1 * Math.sin(a)
          const x2 = 100 + r2 * Math.cos(a), y2 = 104 + r2 * Math.sin(a)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="7.5" strokeLinecap="round" stroke={i < on ? 'var(--red)' : 'var(--line-strong)'} />
        })}
      </svg>
      <div className="gauge-v">
        <b>{Math.round(value * 100)}%</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
