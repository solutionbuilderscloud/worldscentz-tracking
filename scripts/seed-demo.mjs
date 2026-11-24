// Dados de DEMONSTRAÇÃO: containers de perfumes saindo da China, Dubai e Miami.
//   npm run demo:seed   -> cria os B/Ls de exemplo (pula os que já existem)
// As datas são relativas a hoje, para sempre haver carga no mar, no porto, na estrada e no histórico.
import { saveShipment, setArrived, stats } from '../server/db.mjs'

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const p = (brand, model, size, category, qty, unitKg) => ({ brand, model, size, category, qty, unitKg })

// [tracker, origem, porto, destino, saída, chegada porto, chegada barracão, liberado, navio, chegou?, produtos]
const DEMO = [
  ['WSCU2600011', 'JEA', 'PNG', 'CDE', -20, 15, 20, false, 'MSC AURORA', false, [
    p('Lattafa', 'Asad', '100 ml', 'Masculino', 14400, 0.38), p('Lattafa', 'Yara', '100 ml', 'Feminino', 16800, 0.38), p('Lattafa', 'Khamrah', '100 ml', 'Unissex', 9600, 0.4)]],
  ['WSCU2600012', 'JEA', 'PYBCM', 'ASU', -35, 8, 10, false, 'MSC ORION', false, [
    p('Armaf', 'Club de Nuit Intense Man', '105 ml', 'Masculino', 18000, 0.42), p('Armaf', 'Club de Nuit Woman', '105 ml', 'Feminino', 12000, 0.42), p('Rasasi', 'Hawas', '100 ml', 'Masculino', 9000, 0.4)]],
  ['WSCU2600013', 'JEA', 'PYTVT', 'ASU', 4, 40, 46, false, 'MSC LEVANTE', false, [
    p('Afnan', '9PM', '100 ml', 'Masculino', 15000, 0.39), p('Afnan', '9AM Pour Femme', '100 ml', 'Feminino', 10000, 0.39), p('Lattafa', 'Yara Collection', '3 x 30 ml', 'Kit', 6000, 0.55)]],
  ['WSCU2600021', 'SHA', 'PYBCM', 'ASU', -30, 18, 23, false, 'MSC PACIFICO', false, [
    p('Maison Alhambra', 'Jean Lowe Immortal', '100 ml', 'Masculino', 20000, 0.36), p('Maison Alhambra', 'Delilah', '100 ml', 'Feminino', 18000, 0.36), p('Fragrance World', 'Liquid Brun', '100 ml', 'Unissex', 8000, 0.37)]],
  ['WSCU2600022', 'NGB', 'PYTVT', 'ASU', -50, 3, 5, false, 'MSC CORAL', false, [
    p('Paris Corner', 'Emir Voux de Paris', '100 ml', 'Unissex', 12000, 0.38), p('Paris Corner', 'Body Mist Vanilla', '250 ml', 'Body splash', 30000, 0.3), p('Paris Corner', 'Deo Spray Oud', '200 ml', 'Desodorante', 24000, 0.22)]],
  ['WSCU2600023', 'SZX', 'PNG', 'CDE', -45, -3, 4, false, 'MSC JADE', false, [
    p('Fragrance World', 'Intense Wood', '80 ml', 'Masculino', 22000, 0.33), p('Fragrance World', 'Barakkat Rouge 540', '100 ml', 'Unissex', 16000, 0.38), p('Fragrance World', 'Tester Sortido', '100 ml', 'Tester', 4000, 0.33)]],
  ['WSCU2600024', 'TAO', 'PNG', 'CDE', -5, 40, 45, false, 'MSC BOREAL', false, [
    p('Maison Alhambra', 'Body Lotion Rose', '200 ml', 'Creme', 26000, 0.28), p('Maison Alhambra', 'Matte Lipstick', '4 g', 'Maquiagem', 60000, 0.04)]],
  ['WSCU2600031', 'MIA', 'PNG', 'CDE', -22, -4, 2, true, 'MSC ATLANTICO', false, [
    p('Calvin Klein', 'CK One', '200 ml', 'Unissex', 9000, 0.52), p('Carolina Herrera', '212 VIP Men', '100 ml', 'Masculino', 7200, 0.45), p('Carolina Herrera', 'Good Girl', '80 ml', 'Feminino', 6000, 0.5)]],
  ['WSCU2600032', 'MIA', 'PYBCM', 'ASU', -10, 20, 22, false, 'MSC CARIBE', false, [
    p('Paco Rabanne', '1 Million', '100 ml', 'Masculino', 8400, 0.46), p('Paco Rabanne', 'Lady Million', '80 ml', 'Feminino', 6000, 0.44), p('Victoria\'s Secret', 'Bombshell Mist', '250 ml', 'Body splash', 20000, 0.31)]],
  // histórico (já recebidos)
  ['WSCU2500091', 'JEA', 'PNG', 'CDE', -70, -30, -25, true, 'MSC AURORA', true, [
    p('Lattafa', 'Asad', '100 ml', 'Masculino', 16800, 0.38), p('Lattafa', 'Ana Abiyedh', '60 ml', 'Unissex', 12000, 0.26)]],
  ['WSCU2500092', 'SHA', 'PYBCM', 'ASU', -90, -40, -38, true, 'MSC PACIFICO', true, [
    p('Maison Alhambra', 'Jean Lowe Immortal', '100 ml', 'Masculino', 19000, 0.36), p('Maison Alhambra', 'Delilah', '100 ml', 'Feminino', 19000, 0.36)]],
  ['WSCU2500093', 'MIA', 'PNG', 'CDE', -50, -22, -18, true, 'MSC ATLANTICO', true, [
    p('Calvin Klein', 'Eternity', '100 ml', 'Feminino', 7000, 0.48), p('Carolina Herrera', '212 Men', '100 ml', 'Masculino', 8000, 0.45)]],
]

let added = 0
for (const [tracker, origin, port, destination, dep, pod, eta, released, vessel, arrived, products] of DEMO) {
  try {
    saveShipment({ tracker, country: 'PY', content: 'Perfumes e cosméticos', origin, port, destination, departure: day(dep), portEta: day(pod), eta: day(eta),
      released, vessel, notes: 'Dado de demonstração', products, productsSimulated: false, productsSource: 'demonstração' }, { create: true, by: 'demo' })
    if (arrived) setArrived(tracker, true, day(eta) + ' 12:00:00', 'demo')
    added++
  } catch (e) { if (e.status !== 409) throw e } // 409 = já existe
}
const s = stats()
console.log(`Demonstração: ${added} B/Ls criados · banco agora com ${s.active} em rota e ${s.arrived} no histórico.`)
