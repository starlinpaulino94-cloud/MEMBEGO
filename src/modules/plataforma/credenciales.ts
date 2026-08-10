import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { SCOPES } from '@/modules/plataforma/conceptos'

/**
 * PLATAFORMA · Fase 2 — CREDENCIALES Y TOKEN DE ACCESO (núcleo puro).
 *
 * Sin Prisma y sin red: todo lo que decide si una petición entra se puede
 * probar aquí, con vectores fijos y sin base de datos. El envoltorio que lee la
 * credencial vive en `api.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SECRETO NO SE GUARDA
 *
 * Se enseña UNA vez al crear la credencial y después solo queda
 * `scrypt$N$r$p$sal$hash`. Si se pierde, se rota — y eso es la propiedad que se
 * busca, no un inconveniente: un secreto recuperable es un secreto que alguien
 * puede recuperar.
 *
 * `scrypt` y no SHA-256 a secas porque un secreto es material que se puede
 * probar por fuerza bruta. Con SHA-256, una GPU prueba miles de millones por
 * segundo; con scrypt y N=16384 el coste en memoria hace que el mismo ataque
 * sea inviable. El parámetro va DENTRO del hash para poder subirlo mañana sin
 * invalidar los de hoy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOKEN NO ES UN JWT
 *
 * No hace falta: aquí el emisor y el verificador son el mismo servidor. Un JWT
 * traería una librería, un `alg` que hay que acordarse de fijar y un formato
 * que invita a que otros lo verifiquen por su cuenta. El token es
 * `base64url(JSON).hmacHex` — el mismo formato que ya usa el SSO, así que hay
 * una sola forma de firmar en todo el proyecto.
 *
 * Y es OPACO A PROPÓSITO para quien lo recibe: el satélite lo guarda y lo
 * manda, no lo interpreta.
 */

// ── Secretos ────────────────────────────────────────────────────────────────

/** Coste de scrypt. Va escrito en el hash para poder subirlo sin migrar. */
const SCRYPT = { N: 16384, r: 8, p: 1, largoHash: 32, largoSal: 16 } as const

/** `mgc_` = MembeGo client. Reconocible de un vistazo en un `.env` ajeno. */
export function nuevoClientId(): string {
  return `mgc_${randomBytes(12).toString('hex')}`
}

/**
 * 32 bytes de aleatoriedad criptográfica. `mgs_` para que un secreto pegado por
 * error en un chat se identifique al instante como algo que hay que rotar.
 */
export function nuevoClientSecret(): string {
  return `mgs_${randomBytes(32).toString('base64url')}`
}

export function hashearSecreto(secreto: string): string {
  const sal = randomBytes(SCRYPT.largoSal)
  const hash = scryptSync(secreto, sal, SCRYPT.largoHash, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString('base64'), hash.toString('base64')].join('$')
}

/**
 * Comprobación en tiempo constante. Un `===` sobre el hash filtra por tiempo
 * cuántos bytes iniciales acertó quien prueba, y con eso se descubre un secreto
 * byte a byte en vez de por fuerza bruta.
 *
 * Cualquier formato que no reconozcamos devuelve `false` sin lanzar: un hash
 * corrupto es una credencial que no entra, no un 500.
 */
export function secretoValido(secreto: string, almacenado: string): boolean {
  const partes = almacenado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false
  const [, n, r, p, salB64, hashB64] = partes
  const N = Number(n)
  const R = Number(r)
  const P = Number(p)
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false
  // Tope defensivo: un N absurdo en la fila haría que una petición bloqueara el
  // proceso durante minutos. Es un denegación de servicio escrita en la base.
  if (N > 1 << 20 || R > 32 || P > 16) return false

  try {
    const sal = Buffer.from(salB64, 'base64')
    const esperado = Buffer.from(hashB64, 'base64')
    const calculado = scryptSync(secreto, sal, esperado.length, { N, r: R, p: P })
    return esperado.length === calculado.length && timingSafeEqual(esperado, calculado)
  } catch {
    return false
  }
}

// ── Scopes ──────────────────────────────────────────────────────────────────

/**
 * Scopes efectivos de una petición: los que el token pidió ∩ los que la
 * credencial tiene concedidos hoy.
 *
 * La intersección se recalcula EN CADA PETICIÓN, y esa es toda la gracia:
 * recortar los scopes de una credencial surte efecto de inmediato, sin esperar
 * a que caduquen los tokens ya emitidos. Sin esto, quitar `benefits:redeem`
 * sería una intención con quince minutos de retraso.
 */
export function scopesEfectivos(
  delToken: readonly string[],
  deLaCredencial: readonly string[]
): string[] {
  const concedidos = new Set(deLaCredencial)
  return [...new Set(delToken.filter((s) => concedidos.has(s)))].sort()
}

/**
 * Interpreta el `scope` de una petición de token (separado por espacios, RFC
 * 6749). Sin `scope`, se piden TODOS los de la credencial: es lo que hace un
 * cliente que no sabe restringirse, y negarle todo solo produciría una
 * integración rota sin motivo.
 *
 * Los valores desconocidos se descartan en silencio en vez de rechazar la
 * petición entera: un satélite escrito contra una versión más nueva del
 * estándar sigue funcionando con los scopes que sí existen aquí.
 */
export function scopesPedidos(bruto: string | null, deLaCredencial: readonly string[]): string[] {
  if (!bruto || !bruto.trim()) return [...deLaCredencial]
  const conocidos = new Set<string>(SCOPES)
  return [...new Set(bruto.trim().split(/\s+/).filter((s) => conocidos.has(s)))]
}
