import { ROLE_HOME, type AppRole } from '@/types'

/**
 * El estado de sesión, tal como lo necesita la LANDING para decidir qué enlace
 * ofrecer. No es autorización: es solo qué mostrar. Lo que cada persona puede
 * hacer lo siguen decidiendo el proxy, `requireRole` y las acciones.
 *
 * Módulo puro (sin React ni servidor): lo usan el endpoint, el hook y las pruebas.
 */

export type SesionLigera =
  | { estado: 'cargando' }
  | { estado: 'visitante' }
  /** Una persona con rol CLIENTE: puede entrar directo a la ficha dentro de `/cliente`. */
  | { estado: 'cliente'; casa: string }
  /** Administrador, empleado, vendedor o superadmin: tiene su propio espacio y NO compra como cliente. */
  | { estado: 'equipo'; rol: AppRole; casa: string }

/** Lo que responde `GET /api/v1/auth/sesion`: ni correo, ni nombre, ni ids. */
export type RespuestaSesion = { autenticado: false } | { autenticado: true; rol: AppRole; casa: string }

export function respuestaDeSesion(rol: AppRole | null | undefined): RespuestaSesion {
  if (!rol) return { autenticado: false }
  return { autenticado: true, rol, casa: ROLE_HOME[rol] ?? '/cliente/inicio' }
}

/** Interpreta lo que llegó de la red sin fiarse de su forma: ante la duda, visitante. */
export function interpretarSesion(crudo: unknown): SesionLigera {
  if (typeof crudo !== 'object' || crudo === null) return { estado: 'visitante' }
  const r = crudo as Record<string, unknown>
  if (r.autenticado !== true) return { estado: 'visitante' }
  const rol = r.rol
  if (typeof rol !== 'string' || !(rol in ROLE_HOME)) return { estado: 'visitante' }
  const casa = ROLE_HOME[rol as AppRole]
  return rol === 'CLIENTE' ? { estado: 'cliente', casa } : { estado: 'equipo', rol: rol as AppRole, casa }
}
