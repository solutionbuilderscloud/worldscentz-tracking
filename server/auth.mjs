// Login e permissões do WORLD SCENTZ TRACKING.
//
// Perfis:
//   admin       -> tudo, inclusive usuários, configurações, exclusão e backup
//   despachante -> edita B/Ls, despacho, documentos, custos, caminhão, produtos
//   barracao    -> confirma chegada e faz a conferência no barracão
//   diretoria   -> só consulta (painel, relatórios, histórico)

import crypto from 'node:crypto'
import { db } from './db.mjs'

export const ROLES = ['admin', 'despachante', 'barracao', 'diretoria']
const CAN = {
  edit: ['admin', 'despachante'],
  receive: ['admin', 'despachante', 'barracao'],
  sync: ['admin', 'despachante'],
  admin: ['admin'],
}
export const can = (user, action) => !!user && CAN[action].includes(user.role)

const COOKIE = 'np_sess'
const DAYS = 30

const hash = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex')
const publicUser = (u) => u && { id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active }

export const needsSetup = () => db.prepare('SELECT COUNT(*) n FROM users').get().n === 0

export function createUser({ username, name, role, password }) {
  username = String(username ?? '').trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw Object.assign(new Error('Usuário: 3 a 32 letras, números, ponto ou traço.'), { status: 400 })
  if (!ROLES.includes(role)) throw Object.assign(new Error('Perfil inválido.'), { status: 400 })
  if (String(password ?? '').length < 6) throw Object.assign(new Error('A senha precisa ter pelo menos 6 caracteres.'), { status: 400 })
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw Object.assign(new Error('Esse usuário já existe.'), { status: 409 })
  const salt = crypto.randomBytes(16).toString('hex')
  const r = db.prepare('INSERT INTO users (username, name, role, pass_hash, salt) VALUES (?, ?, ?, ?, ?)')
    .run(username, String(name || username).trim().slice(0, 60), role, hash(password, salt), salt)
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid))
}

export function updateUser(id, { name, role, password, active }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!u) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 })
  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n
  const losingAdmin = u.role === 'admin' && u.active && ((role && role !== 'admin') || active === false)
  if (losingAdmin && admins <= 1) throw Object.assign(new Error('Precisa existir pelo menos um administrador ativo.'), { status: 400 })
  if (role && !ROLES.includes(role)) throw Object.assign(new Error('Perfil inválido.'), { status: 400 })
  if (password != null && password !== '') {
    if (String(password).length < 6) throw Object.assign(new Error('A senha precisa ter pelo menos 6 caracteres.'), { status: 400 })
    const salt = crypto.randomBytes(16).toString('hex')
    db.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').run(hash(password, salt), salt, id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  }
  db.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?')
    .run(name ?? null, role ?? null, active == null ? null : active ? 1 : 0, id)
  if (active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

export const listUsers = () => db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser)

export function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username ?? '').trim().toLowerCase())
  if (!u) { hash(password, 'x'); return null } // mesmo tempo de resposta
  const ok = crypto.timingSafeEqual(Buffer.from(hash(password, u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex'))
  if (!ok) return null
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))").run(token, u.id, `+${DAYS} days`)
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()
  return { token, user: publicUser(u) }
}

export function userFromCookie(header) {
  const token = /(?:^|;\s*)np_sess=([a-f0-9]{64})/.exec(header ?? '')?.[1]
  if (!token) return null
  const u = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).get(token)
  return u ? { ...publicUser(u), token } : null
}

export const logout = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token)

export const sessionCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}`
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
