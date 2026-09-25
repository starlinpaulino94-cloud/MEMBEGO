import 'server-only'

import { Prisma } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { registrarMovimientos } from './movimientos'
import { clientePagaAlComercio } from './catalogo'

/**
 * MEMBEGO SUPPLY · REDENCIÓN (Fases 14, 15, 61).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ES EL MOMENTO EN QUE MEMBEGO GASTA DINERO DE VERDAD
 *
 * Hasta aquí no había costo consumido: comprar es invertir, asignar es
 * planificar y emitir es prometer. Cuando el comercio entrega la pizza, y solo
 * entonces, la unidad pasa a REDIMIDO y su costo entra en la economía real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO EN UNA TRANSACCIÓN
 *
 * Voucher → REDIMIDO, derecho → REDIMIDO, sesión de QR consumida, asiento en
 * el ledger de derechos, asiento en el ledger financiero si el proveedor cobra
 * por redención, y la fila de redención con TODO su contexto. O pasa entero o
 * no pasa nada: una redención registrada con el voucher todavía activo es una
 * segunda pizza gratis esperando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE BORRA NUNCA
 *
 * Si el empleado se equivocó, la fila se queda y se marca `reversadaAt` con
 * motivo y actor, y el ledger recibe un REVERSA_REDENCION. Borrar la operación
 * original haría imposible responder «¿por qué este cliente tiene otra vez su
 * beneficio?».
 */

export interface DatosRedencion {
  voucherId: string
  /** Empresa que está entregando. Se compara con la del voucher: es la barrera. */
  proveedorId: string
  sucursalId?: string | null
  empleadoId?: string | null
  /** Sesión de QR que se está consumiendo, si vino por escáner. */
  sesionQrId?: string | null
  /** Extras que el comercio le cobró al cliente aparte (queso, refresco). */
  extrasMonto?: number
  extrasNota?: string | null
  /** En SUBSIDIO: lo que el cliente le pagó al comercio por la unidad base. */
  aporteClienteComercio?: number
  canal?: string
  claveIdempotencia?: string | null
}

export const MOTIVOS_RECHAZO_REDENCION = [
  'VOUCHER_DESCONOCIDO',
  'YA_UTILIZADO',
  'VENCIDO',
  'CANCELADO',
  'OTRO_COMERCIO',
  'OTRA_SUCURSAL',
  'DERECHO_INACTIVO',
  'RESERVA_REQUERIDA',
  'COBRO_INDEBIDO',
] as const
export type MotivoRechazoRedencion = (typeof MOTIVOS_RECHAZO_REDENCION)[number]

export const MOTIVO_RECHAZO_REDENCION_LABELS: Record<MotivoRechazoRedencion, string> = {
  VOUCHER_DESCONOCIDO: 'Este voucher no existe.',
  YA_UTILIZADO: 'Este beneficio YA FUE UTILIZADO.',
  VENCIDO: 'Este beneficio venció.',
  CANCELADO: 'Este beneficio fue cancelado.',
  OTRO_COMERCIO: 'Este voucher es de otra empresa.',
  OTRA_SUCURSAL: 'Este voucher no aplica en esta sucursal.',
  DERECHO_INACTIVO: 'Este beneficio ya no está disponible.',
  RESERVA_REQUERIDA: 'Este beneficio necesita una reserva confirmada.',
  COBRO_INDEBIDO: 'Membego ya pagó esta unidad: no se le puede cobrar al cliente.',
}

export interface RedencionHecha {
  redencionId: string
  costoUnitario: number
  loteId: string
  derechoId: string
  clienteId: string
  reutilizada: boolean
}

export type ResultadoRedencion =
  | { ok: true; redencion: RedencionHecha }
  | {
      ok: false
      motivo: MotivoRechazoRedencion
      mensaje: string
      /** En YA_UTILIZADO: cuándo y dónde, que es lo que el empleado necesita. */
      detalle?: { fecha: Date; sucursal: string | null }
    }

function rechazo(
  motivo: MotivoRechazoRedencion,
  detalle?: { fecha: Date; sucursal: string | null }
): ResultadoRedencion {
  return { ok: false, motivo, mensaje: MOTIVO_RECHAZO_REDENCION_LABELS[motivo], detalle }
}

/**
 * Entrega la unidad y la registra.
 *
 * El orden de las comprobaciones importa tanto como las comprobaciones: la de
 * DOBLE USO va antes que las demás para poder contestar «ya se utilizó el 12 de
 * octubre en Bávaro» en vez de un genérico «no válido», que es lo que convierte
 * una discusión en el mostrador en una llamada a soporte.
 */
export async function redimir(d: DatosRedencion): Promise<ResultadoRedencion> {
  const res = await redimirEnTx(d)
  // El aviso sale también cuando la redención se reutiliza por idempotencia: el
  // cliente tiene que enterarse UNA vez, y de eso se encarga la clave, no un
  // `if` aquí. Lo que no puede pasar es que un reintento de la red deje al
  // cliente sin su recibo.
  if (res.ok) {
    const { avisarEntregaCompletada } = await import('./notificar')
    await avisarEntregaCompletada(res.redencion.redencionId)
  }
  return res
}

async function redimirEnTx(d: DatosRedencion): Promise<ResultadoRedencion> {
  return sinEmpresa('Membego Supply: el comercio entrega una unidad comprada', async (tx) => {
    if (d.claveIdempotencia) {
      const previa = await tx.supplyRedencion.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: {
          id: true,
          costoUnitario: true,
          loteId: true,
          derechoId: true,
          clienteId: true,
          reversadaAt: true,
        },
      })
      // Solo se reutiliza si sigue viva: una redención reversada y reintentada
      // con la misma clave es una entrega NUEVA, y devolverle la vieja dejaría
      // al comercio sin registro de la segunda.
      if (previa && !previa.reversadaAt) {
        return {
          ok: true,
          redencion: {
            redencionId: previa.id,
            costoUnitario: Number(previa.costoUnitario),
            loteId: previa.loteId,
            derechoId: previa.derechoId,
            clienteId: previa.clienteId,
            reutilizada: true,
          },
        }
      }
    }

    const voucher = await tx.supplyVoucher.findUnique({
      where: { id: d.voucherId },
      select: {
        id: true,
        estado: true,
        proveedorId: true,
        sucursalIds: true,
        vigenteHasta: true,
        derechoId: true,
        derecho: {
          select: {
            id: true,
            estado: true,
            clienteId: true,
            loteId: true,
            asignacionId: true,
            costoUnitario: true,
            moneda: true,
            lote: {
              select: {
                id: true,
                acuerdoId: true,
                snapshotModelo: true,
                snapshotTipo: true,
                acuerdo: { select: { modalidadPago: true } },
              },
            },
            asignacion: { select: { destinoTipo: true, destinoId: true } },
            reservas: {
              where: { estado: 'CONFIRMADA' },
              select: { id: true, sucursalId: true },
              take: 1,
            },
          },
        },
        redenciones: {
          where: { reversadaAt: null },
          select: { createdAt: true, sucursal: { select: { nombre: true } } },
          take: 1,
        },
      },
    })

    if (!voucher) return rechazo('VOUCHER_DESCONOCIDO')

    const previa = voucher.redenciones[0]
    if (previa) {
      return rechazo('YA_UTILIZADO', {
        fecha: previa.createdAt,
        sucursal: previa.sucursal?.nombre ?? null,
      })
    }
    if (voucher.estado === 'REDIMIDO') return rechazo('YA_UTILIZADO')
    if (voucher.estado === 'CANCELADO' || voucher.estado === 'REVOCADO') return rechazo('CANCELADO')
    if (voucher.estado === 'VENCIDO' || voucher.vigenteHasta <= new Date()) return rechazo('VENCIDO')
    if (voucher.derecho.estado !== 'ACTIVO') return rechazo('DERECHO_INACTIVO')

    // AISLAMIENTO: el comercio que escanea tiene que ser el del voucher. Es la
    // comprobación que impide que la sucursal de un proveedor canjee —por
    // error o a propósito— el supply comprometido con otro.
    if (voucher.proveedorId !== d.proveedorId) return rechazo('OTRO_COMERCIO')

    if (d.sucursalId && voucher.sucursalIds.length > 0 && !voucher.sucursalIds.includes(d.sucursalId)) {
      return rechazo('OTRA_SUCURSAL')
    }

    const derecho = voucher.derecho
    const lote = derecho.lote

    // La capacidad agendada EXIGE reserva: entregar sin ella rompe el cupo que
    // el proveedor comprometió y deja a otro cliente sin su asiento.
    if (lote.snapshotTipo === 'CAPACIDAD_AGENDADA' && derecho.reservas.length === 0) {
      return rechazo('RESERVA_REQUERIDA')
    }
    const reserva = derecho.reservas[0]
    if (reserva && d.sucursalId && reserva.sucursalId !== d.sucursalId) {
      return rechazo('OTRA_SUCURSAL')
    }

    // COMPRA COMPLETA: Membego ya pagó la unidad. Cobrarle al cliente la unidad
    // base es exactamente el fraude que la Fase 22 prohíbe. Los EXTRAS sí se
    // cobran, y por eso van en otro campo.
    const aporteCliente = d.aporteClienteComercio ?? 0
    if (aporteCliente > 0 && !clientePagaAlComercio(lote.snapshotModelo)) {
      return rechazo('COBRO_INDEBIDO')
    }

    const redencion = await tx.supplyRedencion.create({
      data: {
        voucherId: voucher.id,
        derechoId: derecho.id,
        clienteId: derecho.clienteId,
        proveedorId: voucher.proveedorId,
        sucursalId: d.sucursalId ?? null,
        loteId: lote.id,
        acuerdoId: lote.acuerdoId,
        asignacionId: derecho.asignacionId,
        destinoTipo: derecho.asignacion?.destinoTipo ?? null,
        destinoId: derecho.asignacion?.destinoId ?? null,
        empleadoId: d.empleadoId ?? null,
        costoUnitario: derecho.costoUnitario,
        moneda: derecho.moneda,
        extrasMonto: new Prisma.Decimal(d.extrasMonto ?? 0),
        extrasNota: d.extrasNota ?? null,
        aporteClienteComercio: new Prisma.Decimal(aporteCliente),
        canal: d.canal ?? 'SCANNER',
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true },
    })

    await registrarMovimientos(
      tx,
      lote.id,
      [
        {
          tipo: 'REDENCION',
          origen: 'EMITIDO',
          destino: 'REDIMIDO',
          cantidad: 1,
          derechoId: derecho.id,
          redencionId: redencion.id,
          asignacionId: derecho.asignacionId,
          motivo: 'Unidad entregada al cliente.',
        },
      ],
      { actorId: d.empleadoId }
    )

    await tx.supplyVoucher.update({
      where: { id: voucher.id },
      data: { estado: 'REDIMIDO', redimidoAt: new Date() },
    })
    await tx.supplyDerecho.update({
      where: { id: derecho.id },
      data: { estado: 'REDIMIDO', redimidoAt: new Date() },
    })
    if (d.sesionQrId) {
      await tx.supplyQrSesion.updateMany({
        where: { id: d.sesionQrId, consumidoAt: null },
        data: { consumidoAt: new Date(), consumidoPorId: d.empleadoId ?? null },
      })
    }
    if (reserva) {
      await tx.supplyReserva.update({ where: { id: reserva.id }, data: { estado: 'CUMPLIDA' } })
    }

    // PAGO_POR_REDENCION: aquí y solo aquí nace la cuenta por pagar. En las
    // demás modalidades el dinero se movió antes y asentarlo otra vez lo
    // contaría dos veces.
    if (lote.acuerdo.modalidadPago === 'PAGO_POR_REDENCION') {
      await tx.supplyAsientoFinanciero.create({
        data: {
          proveedorId: voucher.proveedorId,
          acuerdoId: lote.acuerdoId,
          tipo: 'REDENCION_POR_PAGAR',
          monto: derecho.costoUnitario,
          moneda: derecho.moneda,
          redencionId: redencion.id,
          motivo: 'Unidad redimida bajo la modalidad de pago por redención.',
        },
      })
    }

    return {
      ok: true,
      redencion: {
        redencionId: redencion.id,
        costoUnitario: Number(derecho.costoUnitario),
        loteId: lote.id,
        derechoId: derecho.id,
        clienteId: derecho.clienteId,
        reutilizada: false,
      },
    }
  })
}

/**
 * Revierte una redención. La fila original NO se toca.
 *
 * Devuelve la unidad a EMITIDO (no a DISPONIBLE): el cliente vuelve a tener su
 * derecho, que es lo que significa «esto no se entregó». Mandarla a DISPONIBLE
 * le quitaría el beneficio a la persona por un error del comercio.
 */
export async function reversarRedencion(
  redencionId: string,
  motivo: string,
  actorId?: string | null
): Promise<void> {
  if (!motivo.trim()) throw new Error('Reversar una redención exige un motivo.')

  await sinEmpresa('Membego Supply: reversa de una entrega mal registrada', async (tx) => {
    const r = await tx.supplyRedencion.findUnique({
      where: { id: redencionId },
      select: {
        id: true,
        reversadaAt: true,
        loteId: true,
        derechoId: true,
        voucherId: true,
        asignacionId: true,
        acuerdoId: true,
        proveedorId: true,
        costoUnitario: true,
        moneda: true,
      },
    })
    if (!r) throw new Error('Redención no encontrada.')
    if (r.reversadaAt) throw new Error('Esta redención ya está reversada.')

    await registrarMovimientos(
      tx,
      r.loteId,
      [
        {
          tipo: 'REVERSA_REDENCION',
          origen: 'REDIMIDO',
          destino: 'EMITIDO',
          cantidad: 1,
          derechoId: r.derechoId,
          redencionId: r.id,
          asignacionId: r.asignacionId,
          motivo: motivo.trim(),
        },
      ],
      { actorId }
    )

    await tx.supplyRedencion.update({
      where: { id: redencionId },
      data: { reversadaAt: new Date(), reversadaPorId: actorId ?? null, reversadaMotivo: motivo.trim() },
    })
    await tx.supplyVoucher.update({
      where: { id: r.voucherId },
      data: { estado: 'ACTIVO', redimidoAt: null },
    })
    await tx.supplyDerecho.update({
      where: { id: r.derechoId },
      data: { estado: 'ACTIVO', redimidoAt: null },
    })

    // Si la redención había generado una cuenta por pagar, se contrarresta con
    // un asiento de signo opuesto. El original se queda: el ledger financiero
    // tampoco borra.
    const porPagar = await tx.supplyAsientoFinanciero.findFirst({
      where: { redencionId: r.id, tipo: 'REDENCION_POR_PAGAR' },
      select: { id: true, monto: true },
    })
    if (porPagar) {
      await tx.supplyAsientoFinanciero.create({
        data: {
          proveedorId: r.proveedorId,
          acuerdoId: r.acuerdoId,
          tipo: 'REVERSA',
          monto: porPagar.monto.negated(),
          moneda: r.moneda,
          redencionId: r.id,
          motivo: `Reversa de redención: ${motivo.trim()}`,
          actorId: actorId ?? null,
        },
      })
    }
  })
}

/** Ficha que ve el empleado ANTES de confirmar la entrega. */
export interface FichaEscaneo {
  voucherId: string
  codigo: string
  cliente: string
  producto: string
  variante: string | null
  proveedor: string
  loteCodigo: string
  campana: string | null
  venceAt: Date
  modelo: string
  /** Texto de lo que el comercio SÍ puede cobrar aparte. */
  avisoCobro: string
  reservaSucursalId: string | null
}

/** Lee la ficha del voucher para pintar la pantalla del escáner. */
export async function fichaDeVoucher(tx: Tx, voucherId: string): Promise<FichaEscaneo | null> {
  const v = await tx.supplyVoucher.findUnique({
    where: { id: voucherId },
    select: {
      id: true,
      codigo: true,
      vigenteHasta: true,
      proveedor: { select: { name: true } },
      derecho: {
        select: {
          cliente: { select: { nombre: true } },
          asignacion: { select: { etiqueta: true } },
          reservas: { where: { estado: 'CONFIRMADA' }, select: { sucursalId: true }, take: 1 },
          lote: {
            select: {
              codigo: true,
              snapshotItemNombre: true,
              snapshotVariante: true,
              snapshotModelo: true,
            },
          },
        },
      },
    },
  })
  if (!v) return null

  const modelo = v.derecho.lote.snapshotModelo
  return {
    voucherId: v.id,
    codigo: v.codigo,
    cliente: v.derecho.cliente.nombre,
    producto: v.derecho.lote.snapshotItemNombre,
    variante: v.derecho.lote.snapshotVariante,
    proveedor: v.proveedor.name,
    loteCodigo: v.derecho.lote.codigo,
    campana: v.derecho.asignacion?.etiqueta ?? null,
    venceAt: v.vigenteHasta,
    modelo,
    avisoCobro: clientePagaAlComercio(modelo)
      ? 'El cliente paga al comercio la diferencia acordada más los extras.'
      : 'Membego ya pagó esta unidad. Solo se cobran los extras (bebida, adicionales).',
    reservaSucursalId: v.derecho.reservas[0]?.sucursalId ?? null,
  }
}
