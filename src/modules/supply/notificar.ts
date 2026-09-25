import 'server-only'

import { notificarAdmins, notificarSuperadmins } from '@/modules/notificaciones/service'
import { umbralDelDia, type AlertaVencimiento } from './vencimientos'
import type { ReporteConciliacion } from './conciliacion'
import {
  dedupeDescuadre,
  dedupeVencimiento,
  esAvisable,
  textoDescuadre,
  textoVencimiento,
  textoVencimientoProveedor,
} from './avisos'

/**
 * MEMBEGO SUPPLY · ENVÍO DE LOS AVISOS (Fase 40).
 *
 * Lo que decide QUÉ se dice vive en `avisos.ts`, que es puro y se prueba sin
 * base. Aquí solo se escribe. La separación no es estética: las claves de
 * deduplicación son la parte que se puede romper en silencio, y tienen que
 * poder probarse sin levantar Postgres.
 *
 * FAIL-OPEN, COMO TODO AVISO. Si un aviso no se puede escribir, el cron sigue:
 * soltar holds caducados y cerrar lo vencido son trabajos que mueven el ledger
 * y no pueden quedarse a medias porque la campanita falle.
 */

export interface ResultadoAvisos {
  vencimientos: number
  vencimientosProveedor: number
  descuadres: number
}

/**
 * Avisa de los lotes que HOY cruzan un umbral (30, 14, 7, 3, 1 días).
 *
 * Dos destinatarios y dos mensajes distintos para el mismo hecho:
 *
 *  · MEMBEGO ve dinero. «RD$51.000 en 170 unidades» es lo que hay que decidir
 *    si se reparte, se extiende o se da por perdido.
 *  · EL PROVEEDOR ve su compromiso, sin el costo unitario: eso es información
 *    de contrato y su portal no la enseña.
 */
export async function avisarVencimientos(
  alertas: readonly AlertaVencimiento[]
): Promise<{ membego: number; proveedor: number }> {
  let membego = 0
  let proveedor = 0

  for (const a of alertas) {
    const umbral = umbralDelDia(a.diasRestantes)
    if (umbral === null) continue

    const clave = dedupeVencimiento(a.loteId, umbral)

    const paraMembego = textoVencimiento(a, umbral)
    const escritas = await notificarSuperadmins({
      tipo: 'SUPPLY_POR_VENCER',
      ...paraMembego,
      dedupeKey: clave,
    })
    if (escritas > 0) membego += escritas

    // El proveedor solo se avisa si todavía queda algo que entregar. Un lote
    // agotado que vence no es su problema: ya cumplió.
    if (a.enRiesgo + a.expuestas > 0) {
      // `proveedorId` ES el id de la empresa: un proveedor de supply es una
      // `Company` normal con la capacidad MEMBEGO_SUPPLIER encendida (Fase 1,
      // no se duplica la identidad). No hay nada que resolver.
      await notificarAdmins(a.proveedorId, {
        tipo: 'SUPPLY_POR_VENCER',
        ...textoVencimientoProveedor(a, umbral),
        // Clave distinta de la de Membego: el proveedor recibe SU mensaje, y si
        // compartieran clave el segundo `createMany` se saltaría por duplicado
        // en quien fuera las dos cosas a la vez.
        dedupeKey: `${clave}|proveedor`,
      })
      proveedor += 1
    }
  }

  return { membego, proveedor }
}

/**
 * Avisa de los descuadres que invalidan cifras (CRÍTICA y ALTA).
 *
 * Los MEDIA no llegan a la campanita a propósito: están en la pantalla de
 * conciliación y avisar de todo es la forma más segura de que no se lea nada.
 */
export async function avisarDescuadres(
  reporte: Pick<ReporteConciliacion, 'hallazgos'>,
  ahora: Date = new Date()
): Promise<number> {
  let enviados = 0
  for (const h of reporte.hallazgos) {
    if (!esAvisable(h.gravedad)) continue
    const escritas = await notificarSuperadmins({
      tipo: 'SUPPLY_DESCUADRE',
      ...textoDescuadre(h),
      dedupeKey: dedupeDescuadre(h, ahora),
    })
    if (escritas > 0) enviados += escritas
  }
  return enviados
}
