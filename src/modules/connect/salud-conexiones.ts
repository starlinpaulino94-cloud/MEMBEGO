import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  conexionNecesitaReautorizar,
  credencialVencePronto,
  transicionSalud,
  type CredencialSalud,
} from '@/modules/connect/salud-conexiones-nucleo'

/**
 * SALUD ACTIVA DE LAS CONEXIONES (auditoría B-3) — servidor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CIERRA
 *
 * `meta/salud.ts` sabía inspeccionar un token, pero ningún cron lo llamaba: el
 * estado de una conexión solo cambiaba cuando un envío fallaba —salud pasiva—.
 * Una empresa descubría que su acceso a Meta había caducado cuando un mensaje no
 * salía. Esto lo mira ANTES, un chequeo al día, y marca la conexión para que la
 * UI pida reconectar mientras todavía funciona.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOCAL Y BARATO: NI ABRE SELLOS NI LLAMA A NADIE
 *
 * La caducidad de la credencial y si tiene refresco ya se guardan en COLUMNAS NO
 * SECRETAS (`expiresAt`, `metadata.tieneRefresh`) al conectar. Así que este
 * chequeo es una consulta y una comparación de fechas: no descifra tokens ni
 * gasta llamadas al proveedor. La decisión de QUÉ cuenta como «hay que
 * reautorizar» vive en el núcleo puro, probada caso por caso.
 *
 * Best-effort y acotado, como todo cron: nunca lanza, y un tope de conexiones
 * por pasada evita que un día con muchas se coma el minuto de la función.
 */

/** `metadata.tieneRefresh === true` sin arriesgar un throw sobre un Json. */
function tieneRefresh(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as { tieneRefresh?: unknown }).tieneRefresh === true
  )
}

export async function comprobarSaludConexiones(
  opciones: { limite?: number } = {}
): Promise<{ revisadas: number; marcadas: number; limpiadas: number }> {
  const limite = opciones.limite ?? 500
  const ahora = Date.now()

  try {
    // Solo las CONNECTED: una en PENDING está a medio conectar, una en ERROR ya
    // avisa de un problema, y una DISCONNECTED está apagada. El aviso proactivo
    // es para las que funcionan HOY y dejarán de hacerlo pronto.
    const conexiones = await sinEmpresa(
      'connect: salud activa de conexiones (cron diario, cruza inquilinos)',
      (tx) =>
        tx.conexionEmpresa.findMany({
          where: { estado: 'CONNECTED' },
          select: {
            id: true,
            companyId: true,
            reautorizarAt: true,
            conector: { select: { slug: true } },
            credenciales: { select: { expiresAt: true, metadata: true } },
          },
          take: limite,
        })
    )

    let marcadas = 0
    let limpiadas = 0

    for (const c of conexiones) {
      const credenciales: CredencialSalud[] = c.credenciales.map((cr) => ({
        expiresAt: cr.expiresAt,
        tieneRefresh: tieneRefresh(cr.metadata),
      }))

      const necesita = conexionNecesitaReautorizar(credenciales, ahora)
      const accion = transicionSalud(necesita, c.reautorizarAt !== null)
      if (accion === 'nada') continue

      const valor = accion === 'marcar' ? new Date() : null
      // Acotado por empresa: el aviso es de UNA conexión de UNA empresa. RLS es
      // la segunda barrera; el `companyId` en el where, la primera.
      await conEmpresa(c.companyId, (tx) =>
        tx.conexionEmpresa.update({
          where: { id: c.id },
          data: { reautorizarAt: valor },
        })
      ).catch(anotarFallo('connect:salud:marcar', { id: c.id }))

      if (accion === 'marcar') {
        marcadas++
        // La fecha más cercana entre las credenciales terminales: es lo que se
        // le cuenta a la persona («caduca el …»). Nunca un secreto.
        const vence = credenciales
          .filter((cr) => credencialVencePronto(cr, ahora))
          .map((cr) => cr.expiresAt!.getTime())
          .sort((a, b) => a - b)[0]
        await anotarConector({
          companyId: c.companyId,
          origen: 'CONEXION',
          origenId: c.id,
          nivel: 'WARN',
          evento: 'conexion.reautorizar_proximo',
          detalle: {
            proveedor: c.conector.slug,
            venceAt: vence ? new Date(vence).toISOString() : null,
          },
        })
      } else {
        limpiadas++
        await anotarConector({
          companyId: c.companyId,
          origen: 'CONEXION',
          origenId: c.id,
          evento: 'conexion.reautorizar_resuelto',
          detalle: { proveedor: c.conector.slug },
        })
      }
    }

    return { revisadas: conexiones.length, marcadas, limpiadas }
  } catch (e) {
    // Un cron nunca lanza: degrada a consola y devuelve lo que se sepa.
    console.error('[connect] salud activa de conexiones falló', e)
    return { revisadas: 0, marcadas: 0, limpiadas: 0 }
  }
}
