// Deixa o WORLD SCENTZ TRACKING sempre ligado neste Mac (serviço do macOS / LaunchAgent).
//
//   npm run servico:instalar     -> liga agora e sempre que você entrar no Mac; religa sozinho se cair
//   npm run servico:status       -> mostra se está rodando
//   npm run servico:desinstalar  -> desliga e remove
//
// Enquanto o serviço estiver instalado, não rode "npm run dev" ao mesmo tempo (as portas já estarão em uso).
// Registro do serviço: data/logs/servico.log

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = 'com.worldscentz.tracking'
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
const LOG = path.join(root, 'data/logs/servico.log')
const uid = process.getuid()
const node = process.execPath
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return (e.stdout || '') + (e.stderr || '') } }

async function health() {
  try { const r = await fetch('http://localhost:5318/api/health'); return r.ok ? await r.json() : null } catch { return null }
}

if (process.platform !== 'darwin') { console.log('O serviço automático é só para macOS.'); process.exit(1) }
const cmd = process.argv[2]

if (cmd === 'instalar') {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true })
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`
  const args = [
    node, path.join(root, 'node_modules/concurrently/dist/bin/concurrently.js'), '-k', '-n', 'api,web',
    `${q(node)} server/index.mjs`,
    `${q(node)} node_modules/vite/bin/vite.js --port 5317 --strictPort`,
  ]
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(path.dirname(node))}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${esc(LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG)}</string>
</dict>
</plist>
`
  sh('launchctl', ['bootout', `gui/${uid}/${LABEL}`])
  fs.writeFileSync(PLIST, plist)
  const out = sh('launchctl', ['bootstrap', `gui/${uid}`, PLIST])
  if (out.trim()) console.log(out.trim())
  let h = null
  for (let i = 0; i < 30 && !h; i++) { await new Promise((r) => setTimeout(r, 1000)); h = await health() }
  console.log(h ? `✓ WORLD SCENTZ TRACKING ligado como serviço: http://localhost:5317 (${h.active} B/Ls em rota)` : `Serviço instalado, mas ainda não respondeu. Veja ${LOG}`)
  console.log('  Liga sozinho quando você entra no Mac e religa se cair. Para remover: npm run servico:desinstalar')
} else if (cmd === 'desinstalar') {
  sh('launchctl', ['bootout', `gui/${uid}/${LABEL}`])
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST)
  console.log('Serviço removido. Para usar de novo sem o serviço: npm run dev')
} else {
  const installed = fs.existsSync(PLIST)
  const info = installed ? sh('launchctl', ['print', `gui/${uid}/${LABEL}`]) : ''
  const state = /state = (\w+)/.exec(info)?.[1]
  const h = await health()
  console.log(`Serviço: ${installed ? `instalado (${state ?? 'parado'})` : 'não instalado'}`)
  console.log(`Sistema: ${h ? `respondendo — ${h.active} B/Ls em rota, ${h.arrived} no histórico` : 'não está respondendo'}`)
  if (installed) console.log(`Registro: ${LOG}`)
}
