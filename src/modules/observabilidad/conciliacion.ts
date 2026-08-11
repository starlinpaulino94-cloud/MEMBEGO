import 'server-only'

import { conEmpresa } from '@/lib/tenant'

/**
 * CONCILIACIÓN DIARIA — que el descuadre lo encuentre el sistema, no el cliente.
 *
 * El panel tiene tres registros de la misma realidad: **Membresías** dice quién
 * pagó, **Transacciones** es el libro oficial de operaciones y **Caja** es el
 * arqueo del turno. Nada comprobaba que contaran lo mismo. Un cobro que entra en
 * uno y no en otro no produce ningún error: produce un informe que no cuadra
 * dentro de tres meses, cuando ya nadie recuerda el día.
 *
 * Esto no arregla nada por su cuenta a propósito. Cada hallazgo es un caso que
 * una persona tiene que mirar: corregir en automático un descuadre de dinero es
 * la forma más rápida de convertir un error visible en uno invisible.
 *
 * TODO SE DEDUCE de las tablas: sin columnas nuevas y sin escribir nada.
 */

export type Severidad = 'ALTA' | 'MEDIA'

export interface Hallazgo {
  clave: string
  titulo: string
  /** Qué significa y por qué importa, en una frase que se enseña tal cual. */
  explicacion: string
  cantidad: number
  severidad: Severidad
  /** Importe implicado, cuando el descuadre es de dinero. */
  monto: number | null
  /** A dónde ir a resolverlo. */
  href: string | null
}

export interface Conciliacion {
  hallazgos: Hallazgo[]
  /** Días analizados hacia atrás. */
  ventanaDias: number
  /** true = ninguna comprobación encontró nada. */
  cuadra: boolean
}

/**
 * Ventana por defecto. Una semana: lo bastante corta para que el descuadre se
 * pueda reconstruir de memoria, y lo bastante larga para que un fin de semana
 * largo no se escape.
 */
const VENTANA = 7

export async function conciliar(
  companyId: string,
  ventanaDias = VENTANA,
  ahora: Date = new Date()
): Promise<Conciliacion> {
  const desde = new Date(ahora.getTime() - ventanaDias * 86_400_000)
  const hallazgos: Hallazgo[] = []

  try {
    await conEmpresa(companyId, async (tx) => {
      const [cobrosSinTransaccion, visitasSinTransaccion, atascadas, cajasAbiertas, descuadres] =
        await Promise.all([
          // 1 · Dinero en Membresías que no llegó al libro de transacciones.
          tx.membership.findMany({
            where: {
              companyId,
              pagoConfirmado: true,
              montoPagado: { gt: 0 },
              fechaPago: { gte: desde },
              transacciones: { none: {} },
            },
            select: { id: true, montoPagado: true },
          }),

          // 2 · Servicio prestado que no dejó rastro contable.
          tx.visit.count({
            where: {
              cliente: { companyId },
              fechaVisita: { gte: desde },
              transaccion: { is: null },
            },
          }),

          // 3 · Operaciones que se empezaron y nunca se cerraron. No son un
          // descuadre todavía: son el descuadre de mañana.
          tx.transaction.count({
            where: {
              companyId,
              estado: { in: ['PENDING', 'VALIDATING'] },
              createdAt: { lt: new Date(ahora.getTime() - 86_400_000) },
            },
          }),

          // 4 · Cajas que nadie cerró. El arqueo de un turno que sigue abierto
          // dos días después no compara nada con nada.
          tx.cajaSesion.count({
            where: {
              companyId,
              estado: 'ABIERTA',
              abiertaAt: { lt: new Date(ahora.getTime() - 86_400_000) },
            },
          }),

          // 5 · Turnos cerrados con faltante o sobrante de efectivo.
          tx.cajaSesion.findMany({
            where: {
              companyId,
              estado: { not: 'ABIERTA' },
              cerradaAt: { gte: desde },
              NOT: { diferencia: 0 },
              diferencia: { not: null },
            },
            select: { id: true, diferencia: true },
          }),
        ])

      if (cobrosSinTransaccion.length > 0) {
        const monto = cobrosSinTransaccion.reduce((s, m) => s + Number(m.montoPagado ?? 0), 0)
        hallazgos.push({
          clave: 'cobro-sin-transaccion',
          titulo: 'Cobros sin transacción registrada',
          explicacion:
            'La membresía dice que se pagó, pero no hay ninguna operación en el libro. El dinero existe en un sitio y no en el otro: los reportes de caja y los de membresías no van a cuadrar.',
          cantidad: cobrosSinTransaccion.length,
          severidad: 'ALTA',
          monto,
          href: '/admin/pagos',
        })
      }

      if (visitasSinTransaccion > 0) {
        hallazgos.push({
          clave: 'visita-sin-transaccion',
          titulo: 'Visitas sin transacción',
          explicacion:
            'Se prestó el servicio y no quedó comprobante. No hay dinero perdido, pero sí un uso que no se puede reimprimir ni reclamar si el cliente lo discute.',
          cantidad: visitasSinTransaccion,
          severidad: 'MEDIA',
          monto: null,
          href: '/admin/registros',
        })
      }

      if (atascadas > 0) {
        hallazgos.push({
          clave: 'transaccion-atascada',
          titulo: 'Operaciones sin cerrar de más de un día',
          explicacion:
            'Alguien empezó una operación y nunca la terminó. Todavía no descuadran nada; si se quedan así, mañana sí.',
          cantidad: atascadas,
          severidad: 'MEDIA',
          monto: null,
          href: '/admin/registros',
        })
      }

      if (cajasAbiertas > 0) {
        hallazgos.push({
          clave: 'caja-abierta',
          titulo: 'Cajas abiertas de días anteriores',
          explicacion:
            'Un turno que sigue abierto no se ha arqueado, así que su efectivo no se ha comparado con nada. Cuanto más tarde se cierre, menos se recuerda.',
          cantidad: cajasAbiertas,
          severidad: 'ALTA',
          monto: null,
          href: '/admin/app/carwash/turnos',
        })
      }

      if (descuadres.length > 0) {
        const monto = descuadres.reduce((s, c) => s + Number(c.diferencia ?? 0), 0)
        hallazgos.push({
          clave: 'caja-descuadrada',
          titulo: 'Turnos cerrados con faltante o sobrante',
          explicacion:
            'El efectivo contado no coincidió con el esperado. Un sobrante importa tanto como un faltante: los dos significan que algo no se registró como pasó.',
          cantidad: descuadres.length,
          severidad: 'ALTA',
          monto,
          href: '/admin/reportes',
        })
      }
    })
  } catch (e) {
    console.error('[conciliacion]', e)
    // Sin datos no se afirma que todo cuadra: eso sería el peor resultado
    // posible de una comprobación —un visto bueno que nadie ha comprobado—.
    return { hallazgos: [], ventanaDias, cuadra: false }
  }

  return { hallazgos, ventanaDias, cuadra: hallazgos.length === 0 }
}
