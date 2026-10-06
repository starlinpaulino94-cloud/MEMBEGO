import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyCubeta, SupplyOrigenDerecho } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { nuevoCodigoVoucher } from './codigos'
import { evaluarElegibilidad, reglasPorOrigen, type ReglasEmision, type Veredicto } from './elegibilidad'
import { bloquearLote, registrarMovimientos } from './movimientos'
import { membresiaVigente } from '@/modules/membresia/vigencia'

/**
 * MEMBEGO SUPPLY · emisión de DERECHOS y VOUCHERS (Fases 11, 12, 58).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA TRANSACCIÓN, DE PRINCIPIO A FIN
 *
 * Emitir es: bloquear el lote → comprobar elegibilidad → mover una unidad en
 * el ledger → crear el derecho → crear el voucher → descontar el cupo de la
 * campaña. TODO junto. Partirlo en dos deja el estado más caro posible: una
 * unidad descontada del lote que nadie tiene.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA (Fase 44)
 *
 * `claveIdempotencia` es única en la base. Si la misma petición llega dos
 * veces —doble toque, reintento de red, webhook repetido— la segunda choca con
 * el índice y se devuelve el derecho que ya existe. No se emiten dos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HOLD (Fase 58)
 *
 * Para checkout y reservas: DISPONIBLE → RETENIDO con `expiraAt`. Si el pago
 * no llega, el barrido lo suelta. Es lo único que impide vender dos veces la
 * última unidad mientras una pasarela tarda ocho segundos en contestar.
 */

export interface DatosEmision {
  loteId: string
  clienteId: string
  origen: SupplyOrigenDerecho
  asignacionId?: string | null
  /** Vigencia del derecho. Por defecto, la del lote. */
  vencAt?: Date | null
  /** Lo que el cliente le pagó a Membego. 0 = regalo. */
  precioCliente?: number
  claveIdempotencia?: string | null
  reglas?: ReglasEmision
  actorId?: string | null
  /** Contexto libre para analytics (campaña, canal, referidor…). */
  meta?: Prisma.InputJsonValue
}

export interface DerechoEmitido {
  derechoId: string
  voucherId: string
  codigo: string
  loteId: string
  vencAt: Date
  costoUnitario: number
  /** true = ya existía por idempotencia y no se emitió nada nuevo. */
  reutilizado: boolean
}

export type ResultadoEmision =
  | { ok: true; derecho: DerechoEmitido }
  | { ok: false; veredicto: Extract<Veredicto, { elegible: false }> }

/** Hechos del cliente frente a un lote y una campaña, leídos en la transacción. */
async function hechosDelCliente(
  tx: Tx,
  loteId: string,
  clienteId: string,
  asignacionId?: string | null
) {
  const [delLote, vivos, deLaCampana] = await Promise.all([
    tx.supplyDerecho.count({ where: { loteId, clienteId } }),
    tx.supplyDerecho.count({
      where: { loteId, clienteId, estado: { in: ['ACTIVO', 'RETENIDO'] } },
    }),
    asignacionId
      ? tx.supplyDerecho.count({ where: { asignacionId, clienteId } })
      : Promise.resolve(0),
  ])

  // La membresía se consulta solo cuando alguna regla la exige; preguntarla
  // siempre añadiría una consulta a cada emisión de campaña abierta.
  return {
    derechosDelLote: delLote,
    derechosVivosDelLote: vivos,
    derechosDeLaCampana: deLaCampana,
    tieneMembresia: false,
  }
}

/**
 * ¿Tiene membresía VIGENTE?
 *
 * Con `membresiaVigente()` y no con `estado: 'ACTIVA'` a secas: una membresía
 * puede seguir marcada ACTIVA y estar vencida por fecha. Contarla haría que un
 * beneficio exclusivo de miembros se le entregara a alguien que dejó de serlo.
 */
async function clienteTieneMembresia(tx: Tx, clienteId: string): Promise<boolean> {
  const vigentes = await tx.membership.count({
    where: { clienteId, ...membresiaVigente() },
  })
  return vigentes > 0
}

/**
 * Emite un derecho (y su voucher) a un cliente.
 *
 * @param cubetaOrigen de qué cubeta sale la unidad. Con campaña, ASIGNADO;
 *   sin campaña, DISPONIBLE; al confirmar un hold, RETENIDO. Se guarda en el
 *   derecho para saber a dónde devolverla si hay que cancelar.
 */
export async function emitirDerecho(d: DatosEmision): Promise<ResultadoEmision> {
  return sinEmpresa('Membego Supply: entregar a un cliente una unidad comprada', async (tx) =>
    emitirDerechoEnTx(tx, d)
  )
}

/** Igual, pero dentro de una transacción ya abierta (checkout, recompensas…). */
export async function emitirDerechoEnTx(tx: Tx, d: DatosEmision): Promise<ResultadoEmision> {
  if (d.claveIdempotencia) {
    const previo = await tx.supplyDerecho.findUnique({
      where: { claveIdempotencia: d.claveIdempotencia },
      select: {
        id: true,
        loteId: true,
        vencAt: true,
        costoUnitario: true,
        vouchers: { where: { estado: 'ACTIVO' }, select: { id: true, codigo: true }, take: 1 },
      },
    })
    if (previo) {
      const voucher = previo.vouchers[0]
      return {
        ok: true,
        derecho: {
          derechoId: previo.id,
          voucherId: voucher?.id ?? '',
          codigo: voucher?.codigo ?? '',
          loteId: previo.loteId,
          vencAt: previo.vencAt,
          costoUnitario: Number(previo.costoUnitario),
          reutilizado: true,
        },
      }
    }
  }

  // El bloqueo va ANTES de evaluar: si se evalúa y luego se bloquea, entre las
  // dos cosas cabe otra transacción llevándose la última unidad.
  const lote = await bloquearLote(tx, d.loteId)
  const ficha = await tx.supplyLote.findUniqueOrThrow({
    where: { id: d.loteId },
    select: {
      id: true,
      proveedorId: true,
      inicioAt: true,
      venceAt: true,
      snapshotCostoUnitario: true,
      snapshotMoneda: true,
      snapshotSucursalIds: true,
    },
  })

  const reglas = { ...reglasPorOrigen(d.origen), ...(d.reglas ?? {}) }
  const hechos = await hechosDelCliente(tx, d.loteId, d.clienteId, d.asignacionId)
  if (reglas.exigeMembresia) {
    hechos.tieneMembresia = await clienteTieneMembresia(tx, d.clienteId)
  }

  const asignacion = d.asignacionId
    ? await tx.supplyAsignacion.findUnique({
        where: { id: d.asignacionId },
        select: { activa: true, cantidad: true, emitidas: true, liberadas: true },
      })
    : null

  const veredicto = evaluarElegibilidad(
    {
      estado: lote.estado,
      inicioAt: ficha.inicioAt,
      venceAt: ficha.venceAt,
      disponibles: lote.disponibles,
      asignadas: lote.asignadas,
      snapshotSucursalIds: ficha.snapshotSucursalIds,
    },
    hechos,
    reglas,
    asignacion
      ? {
          activa: asignacion.activa,
          porEmitir: Math.max(0, asignacion.cantidad - asignacion.emitidas - asignacion.liberadas),
        }
      : null
  )
  if (!veredicto.elegible) return { ok: false, veredicto }

  const cubetaOrigen: SupplyCubeta = d.asignacionId ? 'ASIGNADO' : 'DISPONIBLE'
  const vencAt = d.vencAt ?? ficha.venceAt
  const costo = Number(ficha.snapshotCostoUnitario)

  const derecho = await tx.supplyDerecho.create({
    data: {
      loteId: d.loteId,
      asignacionId: d.asignacionId ?? null,
      clienteId: d.clienteId,
      proveedorId: ficha.proveedorId,
      estado: 'ACTIVO',
      origen: d.origen,
      costoUnitario: ficha.snapshotCostoUnitario,
      moneda: ficha.snapshotMoneda,
      precioCliente: new Prisma.Decimal(d.precioCliente ?? 0),
      vencAt,
      cubetaOrigen,
      claveIdempotencia: d.claveIdempotencia ?? null,
      meta: d.meta ?? {},
    },
    select: { id: true },
  })

  await registrarMovimientos(
    tx,
    d.loteId,
    [
      {
        tipo: 'EMISION',
        origen: cubetaOrigen,
        destino: 'EMITIDO',
        cantidad: 1,
        derechoId: derecho.id,
        asignacionId: d.asignacionId ?? null,
        motivo: `Emisión a cliente (${d.origen}).`,
      },
    ],
    { actorId: d.actorId }
  )

  if (d.asignacionId) {
    await tx.supplyAsignacion.update({
      where: { id: d.asignacionId },
      data: { emitidas: { increment: 1 } },
    })
  }

  const voucher = await crearVoucherEnTx(tx, derecho.id, {
    proveedorId: ficha.proveedorId,
    sucursalIds: ficha.snapshotSucursalIds,
    vigenteHasta: vencAt,
  })

  return {
    ok: true,
    derecho: {
      derechoId: derecho.id,
      voucherId: voucher.id,
      codigo: voucher.codigo,
      loteId: d.loteId,
      vencAt,
      costoUnitario: costo,
      reutilizado: false,
    },
  }
}

// ── Vouchers ────────────────────────────────────────────────────────────────

interface DatosVoucher {
  proveedorId: string
  sucursalIds: readonly string[]
  vigenteHasta: Date
}

/**
 * Crea el voucher de un derecho.
 *
 * Un derecho activo tiene como mucho UN voucher activo, y lo garantiza un
 * índice único parcial en la base: reemitir exige cerrar el anterior. Dos
 * códigos vivos del mismo derecho se canjean dos veces contra la misma unidad,
 * porque el escáner valida el código que le enseñan.
 */
export async function crearVoucherEnTx(
  tx: Tx,
  derechoId: string,
  d: DatosVoucher
): Promise<{ id: string; codigo: string }> {
  return tx.supplyVoucher.create({
    data: {
      derechoId,
      codigo: nuevoCodigoVoucher(),
      estado: 'ACTIVO',
      proveedorId: d.proveedorId,
      sucursalIds: [...d.sucursalIds],
      vigenteHasta: d.vigenteHasta,
    },
    select: { id: true, codigo: true },
  })
}

/**
 * Reemite el voucher de un derecho activo (se perdió, se compartió de más).
 *
 * El anterior queda REVOCADO, no borrado: si alguien intenta canjearlo, el
 * escáner puede decir exactamente qué pasó y cuándo.
 */
export async function reemitirVoucher(
  derechoId: string,
  motivo: string,
  actorId?: string | null
): Promise<{ id: string; codigo: string }> {
  if (!motivo.trim()) throw new Error('Reemitir un voucher exige un motivo.')

  return sinEmpresa('Membego Supply: reemitir el voucher de un derecho', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: derechoId },
      select: { id: true, estado: true, proveedorId: true, vencAt: true, loteId: true },
    })
    if (!derecho) throw new Error('Derecho no encontrado.')
    if (derecho.estado !== 'ACTIVO') {
      throw new Error(`Un derecho en estado ${derecho.estado} no puede reemitir su voucher.`)
    }

    await tx.supplyVoucher.updateMany({
      where: { derechoId, estado: 'ACTIVO' },
      data: { estado: 'REVOCADO', cerradoAt: new Date(), cerradoMotivo: motivo.trim() },
    })

    const lote = await tx.supplyLote.findUniqueOrThrow({
      where: { id: derecho.loteId },
      select: { snapshotSucursalIds: true },
    })

    void actorId
    return crearVoucherEnTx(tx, derechoId, {
      proveedorId: derecho.proveedorId,
      sucursalIds: lote.snapshotSucursalIds,
      vigenteHasta: derecho.vencAt,
    })
  })
}

// ── Holds (Fase 58) ─────────────────────────────────────────────────────────

export interface DatosHold {
  loteId: string
  clienteId: string
  origen: SupplyOrigenDerecho
  asignacionId?: string | null
  /** Minutos que dura la retención. */
  minutos?: number
  claveIdempotencia?: string | null
  actorId?: string | null
}

/** Minutos por defecto de un hold: lo que tarda un checkout razonable. */
export const MINUTOS_HOLD = 15

/**
 * Aparta una unidad para una persona concreta mientras paga o elige horario.
 *
 * Crea el derecho en RETENIDO. No genera voucher todavía: un voucher es un
 * derecho utilizable, y esto aún no lo es. Si el pago se confirma,
 * `confirmarHold` lo pasa a ACTIVO y crea el código.
 */
export async function retener(d: DatosHold): Promise<ResultadoEmision> {
  return sinEmpresa('Membego Supply: retener una unidad durante el checkout', async (tx) => {
    const lote = await bloquearLote(tx, d.loteId)
    const ficha = await tx.supplyLote.findUniqueOrThrow({
      where: { id: d.loteId },
      select: {
        proveedorId: true,
        inicioAt: true,
        venceAt: true,
        snapshotCostoUnitario: true,
        snapshotMoneda: true,
        snapshotSucursalIds: true,
      },
    })

    const reglas = reglasPorOrigen(d.origen)
    const hechos = await hechosDelCliente(tx, d.loteId, d.clienteId, d.asignacionId)
    const asignacion = d.asignacionId
      ? await tx.supplyAsignacion.findUnique({
          where: { id: d.asignacionId },
          select: { activa: true, cantidad: true, emitidas: true, liberadas: true },
        })
      : null

    const veredicto = evaluarElegibilidad(
      {
        estado: lote.estado,
        inicioAt: ficha.inicioAt,
        venceAt: ficha.venceAt,
        disponibles: lote.disponibles,
        asignadas: lote.asignadas,
        snapshotSucursalIds: ficha.snapshotSucursalIds,
      },
      hechos,
      reglas,
      asignacion
        ? {
            activa: asignacion.activa,
            porEmitir: Math.max(0, asignacion.cantidad - asignacion.emitidas - asignacion.liberadas),
          }
        : null
    )
    if (!veredicto.elegible) return { ok: false, veredicto }

    const cubetaOrigen: SupplyCubeta = d.asignacionId ? 'ASIGNADO' : 'DISPONIBLE'
    const expira = new Date(Date.now() + (d.minutos ?? MINUTOS_HOLD) * 60_000)

    const derecho = await tx.supplyDerecho.create({
      data: {
        loteId: d.loteId,
        asignacionId: d.asignacionId ?? null,
        clienteId: d.clienteId,
        proveedorId: ficha.proveedorId,
        estado: 'RETENIDO',
        origen: d.origen,
        costoUnitario: ficha.snapshotCostoUnitario,
        moneda: ficha.snapshotMoneda,
        vencAt: ficha.venceAt,
        retencionExpiraAt: expira,
        cubetaOrigen,
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true },
    })

    await registrarMovimientos(
      tx,
      d.loteId,
      [
        {
          tipo: 'RETENCION',
          origen: cubetaOrigen,
          destino: 'RETENIDO',
          cantidad: 1,
          derechoId: derecho.id,
          asignacionId: d.asignacionId ?? null,
          motivo: 'Retención temporal durante el checkout.',
        },
      ],
      { actorId: d.actorId }
    )

    return {
      ok: true,
      derecho: {
        derechoId: derecho.id,
        voucherId: '',
        codigo: '',
        loteId: d.loteId,
        vencAt: ficha.venceAt,
        costoUnitario: Number(ficha.snapshotCostoUnitario),
        reutilizado: false,
      },
    }
  })
}

/** Convierte un hold vivo en un derecho utilizable, con su voucher. */
export async function confirmarHold(
  derechoId: string,
  precioCliente = 0,
  actorId?: string | null
): Promise<DerechoEmitido> {
  return sinEmpresa('Membego Supply: confirmar una retención tras el pago', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: derechoId },
      select: {
        id: true,
        estado: true,
        loteId: true,
        asignacionId: true,
        proveedorId: true,
        vencAt: true,
        retencionExpiraAt: true,
        costoUnitario: true,
      },
    })
    if (!derecho) throw new Error('Derecho no encontrado.')
    if (derecho.estado !== 'RETENIDO') {
      throw new Error(`Solo se confirma una retención viva; este derecho está ${derecho.estado}.`)
    }
    if (derecho.retencionExpiraAt && derecho.retencionExpiraAt <= new Date()) {
      throw new Error('La retención expiró. Vuelve a intentarlo: la unidad regresó al pool.')
    }

    await registrarMovimientos(
      tx,
      derecho.loteId,
      [
        {
          tipo: 'EMISION',
          origen: 'RETENIDO',
          destino: 'EMITIDO',
          cantidad: 1,
          derechoId: derecho.id,
          asignacionId: derecho.asignacionId,
          motivo: 'Retención confirmada: la unidad pasa a manos del cliente.',
        },
      ],
      { actorId }
    )

    await tx.supplyDerecho.update({
      where: { id: derechoId },
      data: {
        estado: 'ACTIVO',
        retencionExpiraAt: null,
        precioCliente: new Prisma.Decimal(precioCliente),
        emitidoAt: new Date(),
      },
    })

    if (derecho.asignacionId) {
      await tx.supplyAsignacion.update({
        where: { id: derecho.asignacionId },
        data: { emitidas: { increment: 1 } },
      })
    }

    const lote = await tx.supplyLote.findUniqueOrThrow({
      where: { id: derecho.loteId },
      select: { snapshotSucursalIds: true },
    })
    const voucher = await crearVoucherEnTx(tx, derechoId, {
      proveedorId: derecho.proveedorId,
      sucursalIds: lote.snapshotSucursalIds,
      vigenteHasta: derecho.vencAt,
    })

    return {
      derechoId,
      voucherId: voucher.id,
      codigo: voucher.codigo,
      loteId: derecho.loteId,
      vencAt: derecho.vencAt,
      costoUnitario: Number(derecho.costoUnitario),
      reutilizado: false,
    }
  })
}

/**
 * Suelta los holds caducados y devuelve las unidades a su cubeta de origen.
 *
 * Barrido PEREZOSO: se llama desde el cron y también antes de emitir en
 * pantallas de alta demanda. Sin él, un carrito abandonado retiene una unidad
 * para siempre y el lote se "agota" sin haber entregado nada.
 */
export async function soltarHoldsVencidos(limite = 200): Promise<number> {
  return sinEmpresa('Membego Supply: barrido de retenciones caducadas', async (tx) => {
    const vencidos = await tx.supplyDerecho.findMany({
      where: { estado: 'RETENIDO', retencionExpiraAt: { lte: new Date() } },
      select: { id: true, loteId: true, asignacionId: true, cubetaOrigen: true },
      take: limite,
    })

    for (const d of vencidos) {
      await registrarMovimientos(tx, d.loteId, [
        {
          tipo: 'LIBERACION_RETENCION',
          origen: 'RETENIDO',
          destino: d.cubetaOrigen === 'ASIGNADO' ? 'ASIGNADO' : 'DISPONIBLE',
          cantidad: 1,
          derechoId: d.id,
          asignacionId: d.asignacionId,
          motivo: 'La retención expiró sin confirmarse.',
        },
      ])
      await tx.supplyDerecho.update({
        where: { id: d.id },
        data: {
          estado: 'CANCELADO',
          retencionExpiraAt: null,
          cerradoAt: new Date(),
          cerradoMotivo: 'Retención expirada.',
        },
      })
    }
    return vencidos.length
  })
}

// ── Cancelación y revocación (Fase 60) ──────────────────────────────────────

/**
 * Cancela un derecho vivo y decide QUÉ pasa con la unidad.
 *
 * `devolverAlPool` distingue los dos casos que el prompt pide no tratar igual:
 *
 *  · el cliente cancela o el comercio no puede cumplir → la unidad VUELVE, que
 *    para eso está pagada;
 *  · el contrato terminó o la unidad venció → la unidad se CIERRA, porque el
 *    proveedor ya no está obligado a nada y devolverla al pool inventaría
 *    supply que no existe.
 */
export async function cancelarDerecho(
  derechoId: string,
  motivo: string,
  devolverAlPool: boolean,
  actorId?: string | null
): Promise<void> {
  if (!motivo.trim()) throw new Error('Cancelar un derecho exige un motivo.')

  await sinEmpresa('Membego Supply: cancelar un derecho de cliente', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: derechoId },
      select: { id: true, estado: true, loteId: true, asignacionId: true, cubetaOrigen: true },
    })
    if (!derecho) throw new Error('Derecho no encontrado.')
    if (derecho.estado !== 'ACTIVO' && derecho.estado !== 'RETENIDO') {
      throw new Error(`Un derecho ${derecho.estado} ya no se puede cancelar.`)
    }

    const desde: SupplyCubeta = derecho.estado === 'RETENIDO' ? 'RETENIDO' : 'EMITIDO'
    const destino: SupplyCubeta = devolverAlPool
      ? derecho.cubetaOrigen === 'ASIGNADO'
        ? 'ASIGNADO'
        : 'DISPONIBLE'
      : 'CERRADO'
    const tipo = devolverAlPool
      ? desde === 'RETENIDO'
        ? 'LIBERACION_RETENCION'
        : 'DEVOLUCION_EMISION'
      : 'CANCELACION'

    await registrarMovimientos(
      tx,
      derecho.loteId,
      [
        {
          tipo,
          origen: desde,
          destino,
          cantidad: 1,
          derechoId: derecho.id,
          asignacionId: derecho.asignacionId,
          motivo: motivo.trim(),
        },
      ],
      { actorId }
    )

    await tx.supplyVoucher.updateMany({
      where: { derechoId, estado: 'ACTIVO' },
      data: { estado: 'CANCELADO', cerradoAt: new Date(), cerradoMotivo: motivo.trim() },
    })
    await tx.supplyDerecho.update({
      where: { id: derechoId },
      data: { estado: 'CANCELADO', cerradoAt: new Date(), cerradoMotivo: motivo.trim() },
    })

    // Si la unidad vuelve a una campaña, su cupo se recupera; si se cierra, no.
    if (devolverAlPool && derecho.asignacionId && desde === 'EMITIDO') {
      await tx.supplyAsignacion.update({
        where: { id: derecho.asignacionId },
        data: { emitidas: { decrement: 1 } },
      })
    }
  })
}
