// Gera src/demo-data.json para a demonstração estática (GitHub Pages), a partir de um banco temporário:
//   WORLDSCENTZ_DB=/tmp/demo.db npm run demo:snapshot
import './seed-demo.mjs'
import fs from 'node:fs'
import { listShipments, getSettings, recentLog } from '../server/db.mjs'

fs.writeFileSync(new URL('../src/demo-data.json', import.meta.url), JSON.stringify({
  at: new Date().toISOString().slice(0, 10), shipments: listShipments(), settings: getSettings(), log: recentLog(365),
}))
console.log('src/demo-data.json atualizado.')
