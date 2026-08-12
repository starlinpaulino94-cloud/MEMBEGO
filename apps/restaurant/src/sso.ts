import type { MembegoClient, SsoRedeemResponse } from '@membego/platform-sdk'

/**
 * ENTRADA POR SSO — quién es esta persona y qué puede hacer AQUÍ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SATÉLITE NO TIENE CONTRASEÑAS
 *
 * Y es medio motivo de que exista el SSO. Un restaurante con su propia tabla de
 * usuarios es un sitio más donde se filtran credenciales, un sitio más que
 * olvida revocar a quien se fue, y una persona que tiene que acordarse de dos
 * contraseñas. Aquí se canjea un token de un solo uso y se abre una sesión
 * local; la identidad sigue siendo del Core.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS ROLES QUE NO SON EL MISMO, Y MEZCLARLOS ES EL FALLO CARO
 *
 *  · `membegoRole`  — qué es en MembeGo (ADMIN_EMPRESA, CAJERO…).
 *  · `systemRole`   — qué es AQUÍ (MESERO, COCINA…). Cadena libre que MembeGo
 *                     transporta y NO interpreta.
 *
 * La tentación es usar `membegoRole` para decidir los permisos del restaurante,
 * porque siempre viene y `systemRole` puede ser null. Hacerlo significa que un
 * ADMIN_EMPRESA —que en MembeGo administra clientes y campañas— entra a la
 * cocina con permisos de jefe de sala sin que nadie se lo haya dado.
 *
 * El puesto en este sistema lo asigna este sistema. Si nadie se lo asignó,
 * `null` es la respuesta correcta y el acceso se deniega: es preferible a
 * adivinar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOKEN ES DE UN SOLO USO Y NO SE REINTENTA
 *
 * Un canje fallido no se puede reintentar con el mismo token: el Core ya lo
 * quemó. Reintentar aquí solo produciría un segundo «token ya usado» y taparía
 * el error real. Se falla y se manda a pedir uno nuevo.
 */

export interface SesionRestaurante {
  usuarioId: string
  nombre: string | null
  email: string
  companyId: string
  /** El puesto EN ESTE SISTEMA. Null = nadie se lo asignó. */
  puesto: PuestoRestaurante | null
  returnUrl: string | null
  expiraEn: Date
}

/**
 * Los puestos que este restaurante entiende. La lista vive AQUÍ, no en MembeGo:
 * el Core transporta la cadena y no sabe qué significa — que es lo que permite
 * que el siguiente vertical tenga puestos distintos sin desplegar el Core.
 */
export const PUESTOS = ['MESERO', 'COCINA', 'CAJA', 'ENCARGADO'] as const
export type PuestoRestaurante = (typeof PUESTOS)[number]

function puestoValido(v: string | null): PuestoRestaurante | null {
  if (!v) return null
  const limpio = v.trim().toUpperCase()
  return (PUESTOS as readonly string[]).includes(limpio) ? (limpio as PuestoRestaurante) : null
}

/**
 * Canjea el token y devuelve la sesión local.
 *
 * Un `systemRole` que este sistema no conoce se trata como `null`, no como
 * error: MembeGo transporta cadena libre y alguien puede haber escrito
 * «Mesero jefe». Denegar por no reconocerlo es correcto; caerse, no.
 */
export async function entrarPorSso(
  membego: MembegoClient,
  token: string
): Promise<SesionRestaurante> {
  const r: SsoRedeemResponse = await membego.redeemSso(token)
  return {
    usuarioId: r.sub,
    nombre: r.nombre,
    email: r.email,
    companyId: r.companyId,
    puesto: puestoValido(r.systemRole),
    returnUrl: r.returnUrl,
    expiraEn: new Date(r.expiresAt),
  }
}

/** Qué puede hacer cada puesto. Denegar por defecto: lo que no está, no se puede. */
const PERMISOS: Record<PuestoRestaurante, ReadonlySet<string>> = {
  MESERO: new Set(['mesa.abrir', 'comanda.crear', 'cliente.identificar', 'beneficio.ver']),
  COCINA: new Set(['comanda.ver']),
  CAJA: new Set(['comanda.ver', 'comanda.cobrar', 'beneficio.ver', 'beneficio.canjear']),
  ENCARGADO: new Set([
    'mesa.abrir',
    'comanda.crear',
    'comanda.ver',
    'comanda.cobrar',
    'cliente.identificar',
    'beneficio.ver',
    'beneficio.canjear',
  ]),
}

/**
 * ¿Puede esta sesión hacer esto?
 *
 * Sin puesto no se puede nada. Es deliberado: la alternativa —dejar pasar a
 * quien entró por SSO aunque nadie le haya dado un puesto aquí— convierte el
 * SSO en una puerta abierta para cualquiera de la empresa.
 */
export function puede(sesion: SesionRestaurante, accion: string): boolean {
  if (!sesion.puesto) return false
  return PERMISOS[sesion.puesto].has(accion)
}
