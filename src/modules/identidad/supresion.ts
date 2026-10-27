import 'server-only'
import { anotarFallo } from '@/lib/prisma-errors'
import { sinEmpresa } from '@/lib/tenant'
import {
  ErrorDeIdentidad,
  anonimizarIdentidadLocal,
  exigirGestionDeIdentidad,
  registrarPurgaDeSesion,
  registrarSolicitudDeSupresion,
  sesionesDeLaPersona,
  type ActorDeIdentidad,
} from '@/modules/identidad/identidad'
import { ErrorDeProveedor } from '@/modules/identidad/proveedor/contrato'
import { proveedorDeIdentidad } from '@/modules/identidad/proveedor/didit'

/**
 * SUPRESIÓN DE LOS DATOS DE IDENTIDAD (Fase 2): el derecho de la persona a que se
 * borre lo que MEMBEGO y el proveedor guardan de su verificación, y la limpieza que
 * hay que hacer ANTES de eliminar una cuenta.
 *
 * Ley 172-13: la supresión se atiende en 10 días hábiles (art. 8). El orden importa:
 *
 *   1. se deja el asiento de la SOLICITUD (el reloj de los 10 días empieza ahí);
 *   2. se borra en el PROVEEDOR: cada sesión con `privacy_erasure` (que además purga
 *      las plantillas biométricas) y las entidades de persona que creó;
 *   3. SOLO si el proveedor confirmó, se borra en MEMBEGO y se deja el asiento de
 *      COMPLETADA. Si el proveedor falla, no se borra nada local: la solicitud queda
 *      abierta y se repite (todo es idempotente).
 *
 * Borrar primero lo local y luego intentar lo del proveedor dejaría datos
 * biométricos en un tercero sin que MEMBEGO conservara ya cómo encontrarlos.
 */

/** Cuántas sesiones se borraron y cuántas intentos se anonimizaron. */
export interface ResultadoSupresion {
  sesionesBorradas: number
  intentosAnonimizados: number
}

/**
 * Borra en el proveedor TODO lo de la persona. Lanza `proveedor_no_disponible` si el
 * proveedor falla (se puede repetir) o `falta_configuracion` si hay sesiones que borrar y
 * el proveedor no está configurado: no se borra «a medias» en silencio.
 */
export async function borrarEnElProveedorLoDeLaPersona(
  userId: string,
  motivo: 'supresion' | 'operacional' = 'supresion'
): Promise<{ sesionesBorradas: number }> {
  const sesiones = await sesionesDeLaPersona(userId)
  if (sesiones.length === 0) return { sesionesBorradas: 0 }

  let proveedor
  try {
    proveedor = proveedorDeIdentidad()
  } catch (e) {
    if (e instanceof ErrorDeProveedor && e.codigo === 'no_configurado') {
      throw new ErrorDeIdentidad('falta_configuracion', 'Hay datos en el proveedor y no está configurado para borrarlos.')
    }
    throw e
  }

  let borradas = 0
  try {
    for (const s of sesiones) {
      // En una supresión se borran TODAS (también las ya purgadas: `privacy_erasure` purga además las
      // plantillas de la persona, que una purga operativa no toca). Una sesión que ya no existe cuenta como borrada.
      if (s.purgada && motivo === 'operacional') continue
      await proveedor.borrarSesion(s.sesionId, { motivo, instruccionId: s.intentoId })
      await registrarPurgaDeSesion(s.intentoId)
      borradas++
    }
    await proveedor.borrarUsuarios(sesiones.map((s) => s.intentoId))
  } catch (e) {
    if (!(e instanceof ErrorDeProveedor)) throw e
    anotarFallo('identidad:suprimir-en-proveedor', { codigo: e.codigo, http: e.estadoHttp })(e)
    throw new ErrorDeIdentidad('proveedor_no_disponible', 'El proveedor no confirmó el borrado. Vuelve a intentarlo.')
  }
  return { sesionesBorradas: borradas }
}

/**
 * Atiende una solicitud de supresión de la persona. La ejecuta el equipo autorizado
 * (o, más adelante, el flujo de la propia persona con `actor` = null). Repetirla es
 * seguro: lo ya borrado cuenta como borrado.
 */
export async function suprimirIdentidadDePersona(
  actor: ActorDeIdentidad | null,
  userId: string,
  motivo: string
): Promise<ResultadoSupresion> {
  if (actor) exigirGestionDeIdentidad(actor)
  const razon = motivo?.trim()
  if (!razon) throw new ErrorDeIdentidad('motivo_requerido', 'Indica el motivo.')
  const existe = await sinEmpresa('identidad: la supresión comprueba que la persona existe', (tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { id: true } })
  )
  if (!existe) throw new ErrorDeIdentidad('persona_no_encontrada', 'La persona no existe.')

  await registrarSolicitudDeSupresion(userId, actor, razon)
  const { sesionesBorradas } = await borrarEnElProveedorLoDeLaPersona(userId, 'supresion')
  const { intentos } = await anonimizarIdentidadLocal(userId, actor)
  return { sesionesBorradas, intentosAnonimizados: intentos }
}

/**
 * Lo que hay que hacer ANTES de eliminar la cuenta de una persona: borrar sus datos en
 * el proveedor. Al eliminar el usuario se borran en cascada los intentos y con ellos el
 * único rastro de dónde están esas sesiones, así que si el proveedor falla NO se debe
 * eliminar: quien llama aborta y le dice a la persona que lo intente en un momento.
 *
 * Sin sesiones en el proveedor (lo normal: se purgan al terminar cada verificación, y
 * con la verificación apagada no hay ninguna) no hace nada y no pide que el proveedor
 * esté configurado.
 */
export async function purgarProveedorAntesDeEliminarCuenta(userId: string): Promise<void> {
  await borrarEnElProveedorLoDeLaPersona(userId, 'supresion')
}

/** Lo que se le dice a quien elimina una cuenta cuando el proveedor no pudo borrar los datos de identidad. */
export const MENSAJE_BORRADO_DE_IDENTIDAD_PENDIENTE =
  'No pudimos borrar los datos de verificación de identidad en el proveedor. No se eliminó nada: vuelve a intentarlo en unos minutos.'

/**
 * Lo mismo que `purgarProveedorAntesDeEliminarCuenta`, pensado para quien elimina: devuelve
 * el mensaje que hay que mostrar (y abortar) si el proveedor no pudo, o `null` si se puede
 * seguir eliminando. Cualquier otro fallo se propaga: no se elimina «a ciegas».
 *
 * Se llama ANTES de borrar nada de la persona (fichas, usuario, cuenta de acceso): una vez
 * eliminado el usuario ya no hay manera de saber qué sesiones quedaban en el proveedor.
 */
export async function bloqueoPorIdentidadPendiente(userId: string): Promise<string | null> {
  try {
    await purgarProveedorAntesDeEliminarCuenta(userId)
    return null
  } catch (e) {
    if (e instanceof ErrorDeIdentidad && (e.codigo === 'proveedor_no_disponible' || e.codigo === 'falta_configuracion')) {
      anotarFallo('identidad:bloqueo-al-eliminar', { codigo: e.codigo })(e)
      return MENSAJE_BORRADO_DE_IDENTIDAD_PENDIENTE
    }
    throw e
  }
}

/** Igual que `bloqueoPorIdentidadPendiente`, a partir del id de la cuenta de acceso (`supabaseId`). Sin usuario, no hay nada que borrar. */
export async function bloqueoPorIdentidadPendientePorSupabaseId(supabaseId: string): Promise<string | null> {
  const fila = await sinEmpresa('identidad: localizar a la persona al eliminar su cuenta', (tx) =>
    tx.user.findUnique({ where: { supabaseId }, select: { id: true } })
  )
  return fila ? bloqueoPorIdentidadPendiente(fila.id) : null
}
