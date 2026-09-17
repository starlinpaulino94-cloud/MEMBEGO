import 'server-only'
import { randomBytes } from 'node:crypto'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { SOLAPE_ROTACION_MS, rotacionVencidaSinPromover } from '@/modules/plataforma/rotacion-secreto-nucleo'

/**
 * ROTACIÓN DEL SECRETO DE SATÉLITE (auditoría A-7) — ciclo de vida.
 *
 * Tres operaciones, en el orden en que las hace un operador:
 *
 *   1. `rotarSecretoSistema`   genera el secreto NUEVO y abre la ventana de
 *                              solape. Lo saliente sigue firmándose con el de
 *                              siempre; lo entrante empieza a aceptar los dos.
 *                              Devuelve el nuevo secreto UNA vez, para instalarlo
 *                              en el .env del satélite.
 *   2. (el operador lo instala en el satélite y comprueba que entra)
 *   3. `promoverSecretoSistema` mueve el nuevo a primario: lo saliente pasa a
 *                              firmarse con él y el viejo se descarta.
 *
 * `limpiarRotacionesVencidas` recoge las que nadie promovió dentro de la ventana:
 * se DESCARTAN, no se promueven solas —cambiar el secreto saliente a uno que el
 * satélite quizá no instaló sería el corte que esto evita—.
 *
 * Todo `sinEmpresa` con motivo: un `SistemaConectado` es un satélite de la
 * plataforma, no de una empresa; lo administra el superadmin (o el script de
 * registro), y estas escrituras cruzan inquilinos por definición.
 */

/** Mismo formato que el secreto original (`registrar-sistema.ts`). */
function nuevoSecreto(): string {
  return `whs_${randomBytes(24).toString('hex')}`
}

export type ResultadoRotacion =
  | { ok: true; secreto: string; hasta: Date }
  | { ok: false; motivo: 'no_existe' | 'error' }

/**
 * Abre una rotación: guarda el secreto NUEVO como `secretoSiguiente` con su
 * ventana y NO toca el primario. Devuelve el nuevo para enseñarlo una vez.
 *
 * Si ya había una rotación en curso, esta la REEMPLAZA (misma semántica que
 * volver a pulsar «rotar»): el último nuevo es el que vale, y la ventana se
 * reinicia. No se puede promover a ciegas la anterior.
 */
export async function rotarSecretoSistema(sistemaId: string): Promise<ResultadoRotacion> {
  const secreto = nuevoSecreto()
  const hasta = new Date(Date.now() + SOLAPE_ROTACION_MS)
  const r = await sinEmpresa('plataforma: abrir rotación del secreto de un satélite (superadmin)', (tx) =>
    tx.sistemaConectado.updateMany({
      where: { id: sistemaId },
      data: { secretoSiguiente: secreto, secretoSiguienteHasta: hasta },
    })
  ).catch(anotarFallo('plataforma:rotar-secreto', { sistemaId }))
  if (!r) return { ok: false, motivo: 'error' }
  if (r.count === 0) return { ok: false, motivo: 'no_existe' }
  return { ok: true, secreto, hasta }
}

/**
 * Promueve la rotación pendiente: el nuevo pasa a primario y el viejo se
 * descarta. A partir de aquí lo saliente se firma con el nuevo.
 *
 * Se hace en una transacción que lee y escribe: sin la pendiente no hay nada que
 * promover, y prometer que se promovió cuando no había nada sería mentir.
 */
export async function promoverSecretoSistema(
  sistemaId: string
): Promise<{ ok: boolean; motivo?: 'no_existe' | 'sin_pendiente' }> {
  try {
    return await sinEmpresa('plataforma: promover el secreto rotado de un satélite (superadmin)', async (tx) => {
      const s = await tx.sistemaConectado.findUnique({
        where: { id: sistemaId },
        select: { secretoSiguiente: true },
      })
      if (!s) return { ok: false, motivo: 'no_existe' as const }
      if (!s.secretoSiguiente) return { ok: false, motivo: 'sin_pendiente' as const }
      await tx.sistemaConectado.update({
        where: { id: sistemaId },
        data: {
          secreto: s.secretoSiguiente,
          secretoSiguiente: null,
          secretoSiguienteHasta: null,
        },
      })
      return { ok: true }
    })
  } catch (e) {
    anotarFallo('plataforma:promover-secreto', { sistemaId })(e)
    return { ok: false }
  }
}

/**
 * Descarta las rotaciones que nadie promovió dentro de su ventana. Lo llama el
 * cron. DESCARTA, no promueve: un secreto saliente cambiado a uno que el satélite
 * quizá no instaló es el corte que esto existe para evitar. Devuelve cuántas.
 */
export async function limpiarRotacionesVencidas(): Promise<number> {
  const ahora = new Date()
  const r = await sinEmpresa('plataforma: descartar rotaciones de secreto vencidas (cron)', (tx) =>
    tx.sistemaConectado.updateMany({
      where: {
        secretoSiguiente: { not: null },
        secretoSiguienteHasta: { lt: ahora },
      },
      data: { secretoSiguiente: null, secretoSiguienteHasta: null },
    })
  ).catch(anotarFallo('plataforma:limpiar-rotaciones', {}))
  return r?.count ?? 0
}

/**
 * ¿Este sistema tiene una rotación vencida sin promover, según su fila leída?
 * Reexporta la decisión pura para quien ya tenga los campos en mano y no quiera
 * otra consulta.
 */
export { rotacionVencidaSinPromover }
