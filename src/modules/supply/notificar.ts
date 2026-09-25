import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { RESERVA_OCUPA_CUPO } from './estados'
import {
  crearNotificacion,
  notificarAdmins,
  notificarSuperadmins,
} from '@/modules/notificaciones/service'
import { SUPPLY_INCIDENCIA_TIPO_LABELS } from './catalogo'
import { umbralDelDia, type AlertaVencimiento } from './vencimientos'
import type { ReporteConciliacion } from './conciliacion'
import {
  dedupeBeneficio,
  dedupeDescuadre,
  dedupeEntrega,
  dedupeIncidencia,
  dedupeLiquidacion,
  dedupeBeneficioPorVencer,
  dedupeCapacidad,
  dedupeProductoListo,
  dedupeReserva,
  dedupeVencimiento,
  dedupeVoucherProveedor,
  esAvisable,
  textoBeneficioNuevo,
  textoBeneficioPorVencer,
  textoCapacidad,
  textoDescuadre,
  textoEntrega,
  textoIncidenciaMembego,
  textoIncidenciaProveedor,
  textoLiquidacion,
  textoProductoListo,
  textoReserva,
  textoVencimiento,
  textoVencimientoProveedor,
  textoVoucherNuevo,
  UMBRAL_CAPACIDAD,
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

// ════════════════════════════════════════════════════════════════════════════
// AVISOS DE EVENTO
//
// Cada uno recibe SOLO un id y lee lo que necesita. Es una consulta más por
// evento, y se paga a gusto: la alternativa es que `entregar`, `reservar` y
// `redimir` devuelvan campos que solo sirven para redactar un mensaje, y que
// cinco funciones de dominio carguen con la forma del aviso.
//
// TODOS SE LLAMAN DESPUÉS DE QUE LA TRANSACCIÓN CIERRE. Abren la suya, así que
// llamarlos dentro de un `conEmpresa`/`sinEmpresa` sería una transacción
// anidada —el riesgo número uno de este código, y hay un guardia en el CI que
// lo caza—. Y cada uno se traga su error: entregar una pizza no puede fallar
// porque no suene una campanita.
// ════════════════════════════════════════════════════════════════════════════

/**
 * El `User` detrás de un `Cliente`.
 *
 * `SupplyDerecho.clienteId` apunta a `Cliente`, no a `User`, y la campanita es
 * de usuarios. El puente es el `supabaseId`. Devuelve null para el cliente de
 * mostrador sin cuenta —su `supabaseId` lleva prefijo `local:`— y eso NO es un
 * error: a quien no tiene app no se le puede notificar. Mismo camino que
 * `citas/actions.ts`.
 */
async function usuarioDelCliente(clienteId: string): Promise<string | null> {
  return sinEmpresa(
    'Membego Supply: usuario detrás de un cliente para avisarle (cross-tenant)',
    async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { id: clienteId },
        select: { supabaseId: true },
      })
      if (!cliente || cliente.supabaseId.startsWith('local:')) return null
      const user = await tx.user.findUnique({
        where: { supabaseId: cliente.supabaseId },
        select: { id: true },
      })
      return user?.id ?? null
    }
  )
}

/**
 * Nombre del producto tal como se compró.
 *
 * Se lee del LOTE y no del catálogo actual: `snapshotItemNombre` es la foto del
 * momento del contrato, y si el comercio le cambia el nombre al producto en
 * marzo, el aviso de una pizza entregada en octubre tiene que seguir diciendo
 * lo que decía. `SupplyRedencion` y `SupplyIncidencia` guardan `loteId` como
 * escalar y no como relación, así que esto es una consulta aparte y no un
 * `select` anidado.
 */
async function itemDelLote(loteId: string | null): Promise<string> {
  if (!loteId) return 'un beneficio'
  const lote = await sinEmpresa('Membego Supply: nombre del producto de un lote', (tx) =>
    tx.supplyLote.findUnique({ where: { id: loteId }, select: { snapshotItemNombre: true } })
  )
  return lote?.snapshotItemNombre ?? 'un beneficio'
}

/**
 * Un cliente acaba de recibir una unidad · y su proveedor, un voucher en
 * circulación. Los dos salen del mismo hecho y se avisan juntos.
 *
 * `reutilizado` es la puerta: cuando la idempotencia devuelve el derecho que ya
 * existía, no ha pasado nada nuevo y no se avisa de nada. Sin esa comprobación,
 * un doble clic mandaría «tienes un beneficio nuevo» dos veces por un beneficio
 * que solo se entregó una vez.
 */
export async function avisarBeneficioEntregado(
  derechoId: string,
  reutilizado: boolean
): Promise<void> {
  if (reutilizado) return
  try {
    const d = await sinEmpresa('Membego Supply: contexto de un derecho para avisar', (tx) =>
      tx.supplyDerecho.findUnique({
        where: { id: derechoId },
        select: {
          clienteId: true,
          proveedorId: true,
          vencAt: true,
          proveedor: { select: { name: true } },
          lote: { select: { snapshotItemNombre: true } },
          vouchers: { where: { estado: 'ACTIVO' }, select: { codigo: true }, take: 1 },
        },
      })
    )
    if (!d) return
    const item = d.lote.snapshotItemNombre
    const proveedorNombre = d.proveedor.name

    const userId = await usuarioDelCliente(d.clienteId)
    if (userId) {
      await crearNotificacion({
        userId,
        tipo: 'SUPPLY_BENEFICIO_NUEVO',
        ...textoBeneficioNuevo({ item, proveedorNombre, vencAt: d.vencAt }),
        dedupeKey: dedupeBeneficio(derechoId),
      })
    }

    const codigo = d.vouchers[0]?.codigo
    if (codigo) {
      await notificarAdmins(d.proveedorId, {
        tipo: 'SUPPLY_VOUCHER_NUEVO',
        ...textoVoucherNuevo({ item, codigo }),
        dedupeKey: dedupeVoucherProveedor(derechoId),
      })
    }
  } catch (e) {
    console.error('[supply] no se pudo avisar del beneficio', derechoId, e)
  }
}

/** El cliente apartó día, hora y sucursal. */
export async function avisarReservaConfirmada(reservaId: string): Promise<void> {
  try {
    const r = await sinEmpresa('Membego Supply: reserva para avisar al cliente', (tx) =>
      tx.supplyReserva.findUnique({
        where: { id: reservaId },
        select: {
          inicioAt: true,
          dia: true,
          proveedorId: true,
          sucursal: { select: { nombre: true } },
          derecho: {
            select: {
              clienteId: true,
              proveedor: { select: { name: true } },
              lote: {
                select: {
                  snapshotItemNombre: true,
                  acuerdo: { select: { capacidadDiaria: true } },
                },
              },
            },
          },
        },
      })
    )
    if (!r) return

    const userId = await usuarioDelCliente(r.derecho.clienteId)
    if (userId) {
      await crearNotificacion({
        userId,
        tipo: 'SUPPLY_RESERVA_CONFIRMADA',
        ...textoReserva({
          item: r.derecho.lote.snapshotItemNombre,
          proveedorNombre: r.derecho.proveedor.name,
          sucursal: r.sucursal?.nombre ?? null,
          inicioAt: r.inicioAt,
        }),
        dedupeKey: dedupeReserva(reservaId),
      })
    }

    await avisarCupoDelDia(r.proveedorId, r.dia, r.derecho.lote.acuerdo.capacidadDiaria)
  } catch (e) {
    console.error('[supply] no se pudo avisar de la reserva', reservaId, e)
  }
}

/**
 * El cupo comprometido del proveedor para un día pasó del 80%.
 *
 * Va aquí y no en un cron porque el dato solo cambia cuando alguien reserva, y
 * enterarse a las 7 de la mañana siguiente de que ayer se llenó no sirve de
 * nada. La clave es por PROVEEDOR Y DÍA: sin eso, en la hora punta saldría un
 * aviso cada dos minutos.
 *
 * Sin cupo declarado no hay nada que avisar: `null` significa SIN límite, no
 * cero — confundir las dos cosas apagaría las reservas de todo proveedor que no
 * haya pactado capacidad.
 */
async function avisarCupoDelDia(
  proveedorId: string,
  dia: string,
  capacidadDiaria: number | null
): Promise<void> {
  if (!capacidadDiaria || capacidadDiaria <= 0) return
  const usadas = await sinEmpresa('Membego Supply: uso del día de un proveedor', (tx) =>
    tx.supplyReserva.count({ where: { proveedorId, dia, estado: { in: [...RESERVA_OCUPA_CUPO] } } })
  )
  if (usadas / capacidadDiaria < UMBRAL_CAPACIDAD) return
  await notificarAdmins(proveedorId, {
    tipo: 'SUPPLY_CAPACIDAD_AL_LIMITE',
    ...textoCapacidad({ usadas, cupo: capacidadDiaria, dia: new Date(`${dia}T12:00:00Z`) }),
    dedupeKey: dedupeCapacidad(proveedorId, dia),
  })
}

/**
 * BARRIDO · los beneficios que se le vencen al cliente EN LA MANO.
 *
 * Es el aviso que más dinero salva de todo el módulo. Un lote que vence con
 * unidades sin repartir se puede reasignar a una campaña; uno que vence ya
 * entregado, no: esa pizza está pagada y la única forma de que se use es que su
 * dueño se acuerde. Un umbral corto a propósito (7, 3, 1 días): avisar con
 * treinta días de antelación de algo que no se puede hacer hoy es ruido.
 */
export const UMBRALES_CLIENTE = [7, 3, 1] as const

export async function avisarBeneficiosPorVencer(ahora: Date = new Date()): Promise<number> {
  let enviados = 0
  try {
    const limite = new Date(ahora.getTime() + Math.max(...UMBRALES_CLIENTE) * 86_400_000)
    const derechos = await sinEmpresa(
      'Membego Supply: beneficios a punto de vencerse en manos de clientes',
      (tx) =>
        tx.supplyDerecho.findMany({
          where: { estado: 'ACTIVO', vencAt: { gt: ahora, lte: limite } },
          select: {
            id: true,
            clienteId: true,
            vencAt: true,
            proveedor: { select: { name: true } },
            lote: { select: { snapshotItemNombre: true } },
          },
          take: 500,
        })
    )

    for (const d of derechos) {
      const dias = Math.ceil((d.vencAt.getTime() - ahora.getTime()) / 86_400_000)
      const umbral = UMBRALES_CLIENTE.find((u) => u === dias)
      if (umbral === undefined) continue
      const userId = await usuarioDelCliente(d.clienteId)
      if (!userId) continue
      await crearNotificacion({
        userId,
        tipo: 'SUPPLY_BENEFICIO_POR_VENCER',
        ...textoBeneficioPorVencer(
          { item: d.lote.snapshotItemNombre, proveedorNombre: d.proveedor.name },
          umbral
        ),
        dedupeKey: dedupeBeneficioPorVencer(d.id, umbral),
      })
      enviados += 1
    }
  } catch (e) {
    console.error('[supply] no se pudieron avisar los beneficios por vencer', e)
  }
  return enviados
}

/**
 * El comercio registró la entrega.
 *
 * Este aviso es el RECIBO del cliente, no una cortesía: si un comercio marca
 * entregado algo que no entregó, esto se lo enseña el mismo día en vez del mes
 * siguiente, cuando vaya a usar su beneficio y ya no esté.
 */
export async function avisarEntregaCompletada(redencionId: string): Promise<void> {
  try {
    const r = await sinEmpresa('Membego Supply: redención para avisar al cliente', (tx) =>
      tx.supplyRedencion.findUnique({
        where: { id: redencionId },
        select: {
          clienteId: true,
          loteId: true,
          sucursal: { select: { nombre: true } },
          proveedor: { select: { name: true } },
        },
      })
    )
    if (!r) return
    const userId = await usuarioDelCliente(r.clienteId)
    if (!userId) return
    await crearNotificacion({
      userId,
      tipo: 'SUPPLY_ENTREGA_COMPLETADA',
      ...textoEntrega({
        item: await itemDelLote(r.loteId),
        proveedorNombre: r.proveedor.name,
        sucursal: r.sucursal?.nombre ?? null,
      }),
      dedupeKey: dedupeEntrega(redencionId),
    })
  } catch (e) {
    console.error('[supply] no se pudo avisar de la entrega', redencionId, e)
  }
}

/**
 * Una incidencia va a DOS sitios con DOS mensajes.
 *
 * Membego recibe el detalle: es quien media. El proveedor recibe el tipo y el
 * producto, sin el texto que escribió el cliente — ese texto lo escribe una
 * persona enfadada en un campo libre, puede llevar nombres o números de
 * teléfono, y esto entra en la campanita de un tercero.
 */
export async function avisarIncidencia(incidenciaId: string): Promise<void> {
  try {
    const i = await sinEmpresa('Membego Supply: incidencia para avisar', (tx) =>
      tx.supplyIncidencia.findUnique({
        where: { id: incidenciaId },
        select: {
          tipo: true,
          loteId: true,
          proveedorId: true,
          proveedor: { select: { name: true } },
        },
      })
    )
    if (!i) return
    const tipo = SUPPLY_INCIDENCIA_TIPO_LABELS[i.tipo] ?? i.tipo
    const item = await itemDelLote(i.loteId)

    await notificarSuperadmins({
      tipo: 'SUPPLY_INCIDENCIA',
      ...textoIncidenciaMembego({ tipo, item, proveedorNombre: i.proveedor.name }),
      dedupeKey: dedupeIncidencia(incidenciaId, 'membego'),
    })
    await notificarAdmins(i.proveedorId, {
      tipo: 'SUPPLY_INCIDENCIA',
      ...textoIncidenciaProveedor({ tipo, item }),
      dedupeKey: dedupeIncidencia(incidenciaId, 'proveedor'),
    })
  } catch (e) {
    console.error('[supply] no se pudo avisar de la incidencia', incidenciaId, e)
  }
}

/** Membego confirmó un pago: el proveedor tiene que poder verlo sin preguntar. */
export async function avisarLiquidacion(pagoId: string): Promise<void> {
  try {
    const p = await sinEmpresa('Membego Supply: pago confirmado para avisar al proveedor', (tx) =>
      tx.supplyPago.findUnique({
        where: { id: pagoId },
        select: { proveedorId: true, monto: true, referencia: true },
      })
    )
    if (!p) return
    await notificarAdmins(p.proveedorId, {
      tipo: 'SUPPLY_LIQUIDACION',
      ...textoLiquidacion({ monto: Number(p.monto), referencia: p.referencia ?? null }),
      dedupeKey: dedupeLiquidacion(pagoId),
    })
  } catch (e) {
    console.error('[supply] no se pudo avisar de la liquidación', pagoId, e)
  }
}

/**
 * El comercio preparó el pedido y el cliente lo está esperando.
 *
 * Es el único aviso de la Fase 40 que no se pudo hacer en su día: el modelo
 * guardaba la hora acordada, pero nadie en el comercio marcaba «ya está hecho».
 * Ahora existe el estado LISTA y esto lo cuenta.
 */
export async function avisarProductoListo(reservaId: string): Promise<void> {
  try {
    const r = await sinEmpresa('Membego Supply: reserva lista para avisar al cliente', (tx) =>
      tx.supplyReserva.findUnique({
        where: { id: reservaId },
        select: {
          sucursal: { select: { nombre: true } },
          derecho: {
            select: {
              clienteId: true,
              proveedor: { select: { name: true } },
              lote: { select: { snapshotItemNombre: true } },
            },
          },
        },
      })
    )
    if (!r) return
    const userId = await usuarioDelCliente(r.derecho.clienteId)
    if (!userId) return
    await crearNotificacion({
      userId,
      tipo: 'SUPPLY_PRODUCTO_LISTO',
      ...textoProductoListo({
        item: r.derecho.lote.snapshotItemNombre,
        proveedorNombre: r.derecho.proveedor.name,
        sucursal: r.sucursal?.nombre ?? null,
      }),
      dedupeKey: dedupeProductoListo(reservaId),
    })
  } catch (e) {
    console.error('[supply] no se pudo avisar de que el pedido está listo', reservaId, e)
  }
}
