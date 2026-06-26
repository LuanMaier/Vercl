const SESSION_KEY = 'explorer-admin-session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 horas

type AdminSession = {
  exp: number
  nonce: string
  user: string
}

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function expectedPasswordHash(): string | null {
  const hash = import.meta.env.VITE_ADMIN_PASSWORD_HASH?.trim().toLowerCase()
  return hash || null
}

function expectedUsername(): string | null {
  const user = import.meta.env.VITE_ADMIN_USER?.trim()
  return user || null
}

export function isAdminConfigured(): boolean {
  return Boolean(expectedUsername() && expectedPasswordHash())
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = expectedUsername()
  const expectedHash = expectedPasswordHash()
  if (!expectedUser || !expectedHash) return false
  if (username.trim().toLowerCase() !== expectedUser.toLowerCase()) return false
  const got = await hashPassword(password)
  return got === expectedHash
}

export function createSession(username: string): void {
  const payload: AdminSession = {
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomUUID(),
    user: username.trim().toLowerCase(),
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload))
}

export function isAuthenticated(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return false
    const { exp, user } = JSON.parse(raw) as AdminSession
    const expectedUser = expectedUsername()?.toLowerCase()
    if (!expectedUser || user !== expectedUser) {
      clearSession()
      return false
    }
    if (Date.now() > exp) {
      clearSession()
      return false
    }
    return true
  } catch {
    return false
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function getSessionUsername(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return (JSON.parse(raw) as AdminSession).user
  } catch {
    return null
  }
}

/** Redireciona para login se não autenticado. Retorna false se redirecionou. */
export function requireAuth(loginPath = '/admin.html'): boolean {
  if (isAuthenticated()) return true
  const next = encodeURIComponent(location.pathname + location.search)
  location.replace(`${loginPath}?next=${next}`)
  return false
}

export function getSafeRedirectNext(fallback = '/edit.html'): string {
  const params = new URLSearchParams(location.search)
  const next = params.get('next')
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback
  if (!next.startsWith('/edit')) return fallback
  return next
}
