import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyAcuerdoEstado, SupplyOrdenEstado } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { codigoAcuerdo, codigoLote, numeroOrden } from './codigos'
import {
  ORDEN_PUEDE_GENERAR_LOTE,
  TRANSICIONES_ACUERDO,
  TRANSICIONES_ORDEN,
  exigirTransicion,
} from './estados'
import { registrarMovimientos } from './movimientos'
import { validarAcuerdo, type DatosAcuerdo } from './contrato'

export { validarAcuerdo }
export type { DatosAcuerdo }

/**
 * MEMBEGO SUPPLY · procurement (Fases 2-5).
 *
 * CONTRATO → ORDEN DE COMPRA → LOTE. Tres cosas distintas que la tentación
 * junta en una:
 *
 *  · El ACUERDO dice CÓMO funciona: vigencia, sucursales, capacidad diaria,
 *    sustituciones, qué pasa con lo que sobre, qué pasa si el comercio cierra.
 *  · La ORDEN dice QUÉ se compró y por cuánto. Es el documento financiero.
 *  · El LOTE es el activo: los derechos vivos, con su economía CONGELADA.
 *
 * Todo esto es del lado plataforma: se ejecuta con `sinEmpresa` porque cruza
 * inquilinos por diseño (Membego mira a todos sus proveedores). Las guardias
 * de rol están en `actions.ts`; aquí viven las reglas.
 */

// ── Acuerdos ────────────────────────────────────────────────────────────────

/** Crea el acuerdo en BORRADOR con su código correlativo por proveedor y año. */
export async function crearAcuerdo(d: DatosAcuerdo): Promise<{ id: string; codigo: string }> {
  const error = validarAcuerdo(d)
  if (error) throw new Error(error)

  return sinEmpresa('Membego Supply: la plataforma contrata con un proveedor', async (tx) => {
    const proveedor = await tx.company.findUnique({
      where: { id: d.proveedorId },
      select: { id: true, name: true },
    })
    if (!proveedor) throw new Error('Proveedor no encontrado.')

    const anio = d.inicioAt.getFullYear()
    // El correlativo se cuenta DENTRO de la transacción: dos altas simultáneas
    // del mismo proveedor chocarían en el índice único de `codigo` y la
    // segunda reintenta, en vez de crear dos acuerdos con el mismo código.
    const previos = await tx.supplyAcuerdo.count({
      where: { proveedorId: d.proveedorId, codigo: { startsWith: `MBG-` }, createdAt: { gte: new Date(anio, 0, 1) } },
    })

    const creado = await tx.supplyAcuerdo.create({
      data: {
        codigo: codigoAcuerdo(proveedor.name, anio, previos + 1),
        proveedorId: d.proveedorId,
        estado: 'BORRADOR',
        tipo: d.tipo,
        modeloComercial: d.modeloComercial,
        modalidadPago: d.modalidadPago,
        politicaSobrante: d.politicaSobrante,
        servicioId: d.servicioId ?? null,
        promocionId: d.promocionId ?? null,
        itemNombre: d.itemNombre.trim(),
        itemDescripcion: d.itemDescripcion ?? null,
        varianteEtiqueta: d.varianteEtiqueta ?? null,
        cantidad: d.cantidad,
        costoUnitario: new Prisma.Decimal(d.costoUnitario),
        precioReferencia: d.precioReferencia != null ? new Prisma.Decimal(d.precioReferencia) : null,
        aporteMembego: d.aporteMembego != null ? new Prisma.Decimal(d.aporteMembego) : null,
        moneda: d.moneda ?? 'DOP',
        anticipoPorcentaje:
          d.anticipoPorcentaje != null ? new Prisma.Decimal(d.anticipoPorcentaje) : null,
        condicionesPago: d.condicionesPago ?? null,
        inicioAt: d.inicioAt,
        finAt: d.finAt,
        sucursalIds: d.sucursalIds ?? [],
        capacidadDiaria: d.capacidadDiaria ?? null,
        capacidadHoraria: d.capacidadHoraria ?? null,
        diasBloqueados: d.diasBloqueados ?? [],
        horarioTexto: d.horarioTexto ?? null,
        reglasRedencion: d.reglasRedencion ?? null,
        reglasSustitucion: d.reglasSustitucion ?? null,
        reglasCumplimiento: d.reglasCumplimiento ?? null,
        politicaCancelacion: d.politicaCancelacion ?? null,
        notas: d.notas ?? null,
        creadoPorId: d.creadoPorId ?? null,
      },
      select: { id: true, codigo: true },
    })
    return creado
  })
}

/** Cambia el estado de un acuerdo comprobando la máquina de estados. */
export async function moverAcuerdo(
  acuerdoId: string,
  hasta: SupplyAcuerdoEstado,
  aprobadoPorId?: string | null
): Promise<void> {
  await sinEmpresa('Membego Supply: ciclo de vida de un contrato', async (tx) => {
    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: acuerdoId },
      select: { estado: true },
    })
    if (!acuerdo) throw new Error('Acuerdo no encontrado.')
    exigirTransicion(TRANSICIONES_ACUERDO, acuerdo.estado, hasta, 'Acuerdo de supply')

    await tx.supplyAcuerdo.update({
      where: { id: acuerdoId },
      data: {
        estado: hasta,
        ...(hasta === 'APROBADO'
          ? { aprobadoPorId: aprobadoPorId ?? null, aprobadoAt: new Date() }
          : {}),
      },
    })
  })
}

// ── Órdenes de compra ───────────────────────────────────────────────────────

export interface LineaOrden {
  itemNombre: string
  varianteEtiqueta?: string | null
  cantidad: number
  costoUnitario: number
}

export interface DatosOrden {
  acuerdoId: string
  lineas: LineaOrden[]
  impuestos?: number
  condicionesPago?: string | null
  notas?: string | null
  creadoPorId?: string | null
}

/**
 * Crea la orden en BORRADOR.
 *
 * NO activa nada ni crea lotes: entre pedir y tener derechos que repartir hay
 * una aprobación y una confirmación, y saltárselas sería exactamente el
 * "cualquier usuario crea compromisos financieros" que la Fase 3 prohíbe.
 */
export async function crearOrden(d: DatosOrden): Promise<{ id: string; numero: string }> {
  if (d.lineas.length === 0) throw new Error('Una orden de compra sin líneas no compra nada.')
  for (const l of d.lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) {
      return Promise.reject(new Error(`La línea "${l.itemNombre}" tiene una cantidad inválida.`))
    }
    if (l.costoUnitario < 0) {
      return Promise.reject(new Error(`La línea "${l.itemNombre}" tiene un costo negativo.`))
    }
  }

  return sinEmpresa('Membego Supply: la plataforma emite una orden de compra', async (tx) => {
    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: d.acuerdoId },
      select: { id: true, proveedorId: true, estado: true, moneda: true, condicionesPago: true },
    })
    if (!acuerdo) throw new Error('Acuerdo no encontrado.')
    if (acuerdo.estado === 'CANCELADO' || acuerdo.estado === 'VENCIDO') {
      throw new Error('No se puede comprar contra un acuerdo cancelado o vencido.')
    }

    const subtotal = d.lineas.reduce((t, l) => t + l.cantidad * l.costoUnitario, 0)
    const impuestos = d.impuestos ?? 0
    const secuencia = (await tx.supplyOrden.count()) + 1

    const orden = await tx.supplyOrden.create({
      data: {
        numero: numeroOrden(secuencia),
        acuerdoId: acuerdo.id,
        proveedorId: acuerdo.proveedorId,
        estado: 'BORRADOR',
        moneda: acuerdo.moneda,
        subtotal: new Prisma.Decimal(subtotal),
        impuestos: new Prisma.Decimal(impuestos),
        total: new Prisma.Decimal(subtotal + impuestos),
        condicionesPago: d.condicionesPago ?? acuerdo.condicionesPago,
        notas: d.notas ?? null,
        creadoPorId: d.creadoPorId ?? null,
        lineas: {
          create: d.lineas.map((l) => ({
            itemNombre: l.itemNombre.trim(),
            varianteEtiqueta: l.varianteEtiqueta ?? null,
            cantidad: l.cantidad,
            costoUnitario: new Prisma.Decimal(l.costoUnitario),
            subtotal: new Prisma.Decimal(l.cantidad * l.costoUnitario),
          })),
        },
      },
      select: { id: true, numero: true },
    })
    return orden
  })
}

/**
 * Mueve una orden por su máquina de estados.
 *
 * APROBADA exige un aprobador DISTINTO de quien la creó. No es ceremonia: es
 * la única comprobación que impide que una persona sola comprometa el
 * presupuesto de la plataforma. Cuando el creador es desconocido (importación,
 * script) se permite, porque si no, esas órdenes quedarían bloqueadas para
 * siempre sin una forma legítima de desbloquearlas.
 */
export async function moverOrden(
  ordenId: string,
  hasta: SupplyOrdenEstado,
  actorId?: string | null,
  motivo?: string | null
): Promise<void> {
  await sinEmpresa('Membego Supply: ciclo de vida de una orden de compra', async (tx) => {
    const orden = await tx.supplyOrden.findUnique({
      where: { id: ordenId },
      select: { estado: true, creadoPorId: true },
    })
    if (!orden) throw new Error('Orden no encontrada.')
    exigirTransicion(TRANSICIONES_ORDEN, orden.estado, hasta, 'Orden de supply')

    if (hasta === 'APROBADA' && actorId && orden.creadoPorId && actorId === orden.creadoPorId) {
      throw new Error('Una orden de compra no la puede aprobar quien la creó.')
    }

    await tx.supplyOrden.update({
      where: { id: ordenId },
      data: {
        estado: hasta,
        ...(hasta === 'APROBADA' ? { aprobadoPorId: actorId ?? null, aprobadoAt: new Date() } : {}),
        ...(hasta === 'CONFIRMADA' ? { confirmadaAt: new Date() } : {}),
        ...(hasta === 'CANCELADA'
          ? { canceladaAt: new Date(), canceladaMotivo: motivo ?? null }
          : {}),
      },
    })
  })
}

// ── Lotes ───────────────────────────────────────────────────────────────────

export interface ResultadoLote {
  id: string
  codigo: string
  compradas: number
}

/**
 * Crea los lotes de una orden y ASIENTA LA COMPRA en el ledger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ ES DONDE NACE EL SUPPLY
 *
 * Un lote por línea de la orden. Cada uno copia el snapshot económico del
 * acuerdo y recibe un único asiento `COMPRA` (null → DISPONIBLE). A partir de
 * ese momento, `disponibles` ya no se escribe a mano en ninguna parte.
 *
 * TAMBIÉN NACE EL COMPROMISO FINANCIERO: un asiento `COMPROMISO_COMPRA` por el
 * total. Es memorando —no significa que se deba ese dinero hoy, depende de la
 * modalidad— pero sin él no hay forma de contrastar contratado contra pagado
 * cuando llegue la liquidación.
 *
 * IDEMPOTENTE por orden: si la orden ya tiene lotes, los devuelve en vez de
 * duplicar el supply. Activar dos veces una orden es un clic doble, no una
 * compra doble.
 */
export async function generarLotes(ordenId: string, actorId?: string | null): Promise<ResultadoLote[]> {
  return sinEmpresa('Membego Supply: la plataforma activa un lote comprado', async (tx) => {
    const orden = await tx.supplyOrden.findUnique({
      where: { id: ordenId },
      select: {
        id: true,
        numero: true,
        estado: true,
        proveedorId: true,
        moneda: true,
        total: true,
        acuerdoId: true,
        acuerdo: {
          select: {
            id: true,
            codigo: true,
            tipo: true,
            modeloComercial: true,
            costoUnitario: true,
            precioReferencia: true,
            aporteMembego: true,
            inicioAt: true,
            finAt: true,
            sucursalIds: true,
            capacidadDiaria: true,
            capacidadHoraria: true,
            varianteEtiqueta: true,
          },
        },
        lineas: { select: { id: true, itemNombre: true, varianteEtiqueta: true, cantidad: true, costoUnitario: true } },
      },
    })
    if (!orden) throw new Error('Orden no encontrada.')
    if (!ORDEN_PUEDE_GENERAR_LOTE.includes(orden.estado)) {
      throw new Error(
        `Una orden en estado ${orden.estado} todavía no puede generar supply. Confírmala primero.`
      )
    }

    const yaCreados = await tx.supplyLote.findMany({
      where: { ordenId },
      select: { id: true, codigo: true, compradas: true },
    })
    if (yaCreados.length > 0) return yaCreados

    const acuerdo = orden.acuerdo
    const resultado: ResultadoLote[] = []

    for (const [i, linea] of orden.lineas.entries()) {
      const lote = await tx.supplyLote.create({
        data: {
          codigo: codigoLote(acuerdo.codigo, i + 1),
          acuerdoId: acuerdo.id,
          ordenId: orden.id,
          lineaId: linea.id,
          proveedorId: orden.proveedorId,
          estado: 'ACTIVO',
          snapshotItemNombre: linea.itemNombre,
          snapshotVariante: linea.varianteEtiqueta ?? acuerdo.varianteEtiqueta,
          snapshotCostoUnitario: linea.costoUnitario,
          snapshotPrecioReferencia: acuerdo.precioReferencia,
          snapshotAporteMembego: acuerdo.aporteMembego,
          snapshotModelo: acuerdo.modeloComercial,
          snapshotTipo: acuerdo.tipo,
          snapshotMoneda: orden.moneda,
          snapshotSucursalIds: acuerdo.sucursalIds,
          snapshotCapacidadDiaria: acuerdo.capacidadDiaria,
          snapshotCapacidadHoraria: acuerdo.capacidadHoraria,
          inicioAt: acuerdo.inicioAt,
          venceAt: acuerdo.finAt,
        },
        select: { id: true, codigo: true },
      })

      await registrarMovimientos(
        tx,
        lote.id,
        [
          {
            tipo: 'COMPRA',
            origen: null,
            destino: 'DISPONIBLE',
            cantidad: linea.cantidad,
            referencia: orden.numero,
            motivo: `Compra de ${linea.cantidad} unidades en la orden ${orden.numero}.`,
          },
        ],
        { actorId }
      )

      resultado.push({ id: lote.id, codigo: lote.codigo, compradas: linea.cantidad })
    }

    await tx.supplyAsientoFinanciero.create({
      data: {
        proveedorId: orden.proveedorId,
        acuerdoId: acuerdo.id,
        ordenId: orden.id,
        tipo: 'COMPROMISO_COMPRA',
        monto: orden.total,
        moneda: orden.moneda,
        referencia: orden.numero,
        motivo: `Compromiso de compra por la orden ${orden.numero}.`,
        actorId: actorId ?? null,
      },
    })

    if (orden.estado !== 'ACTIVA') {
      await tx.supplyOrden.update({ where: { id: orden.id }, data: { estado: 'ACTIVA' } })
    }
    const acuerdoActual = await tx.supplyAcuerdo.findUnique({
      where: { id: acuerdo.id },
      select: { estado: true },
    })
    if (acuerdoActual && acuerdoActual.estado === 'APROBADO') {
      await tx.supplyAcuerdo.update({ where: { id: acuerdo.id }, data: { estado: 'ACTIVO' } })
    }

    return resultado
  })
}

// ── Enmiendas (Fase 20) ─────────────────────────────────────────────────────

export interface DatosEnmienda {
  acuerdoId: string
  campo: 'VIGENCIA' | 'CANTIDAD' | 'CAPACIDAD' | 'SUCURSALES' | 'SUSTITUCION' | 'COSTO' | 'POLITICA'
  antes: Prisma.InputJsonValue
  despues: Prisma.InputJsonValue
  motivo: string
  solicitadoPorId?: string | null
  aprobadoPorId?: string | null
  /** Si amplía unidades, sobre qué lote se asienta el AJUSTE. */
  loteId?: string | null
  unidadesExtra?: number | null
  /** Nueva fecha de vencimiento cuando el campo es VIGENCIA. */
  nuevoFinAt?: Date | null
}

/**
 * Registra una enmienda y APLICA su efecto.
 *
 * El comercio ve sus números y no los toca: pasar de 1.000 a 1.200 unidades o
 * mover el vencimiento solo ocurre por aquí, con antes, después, motivo y quién
 * aprobó. Y si la enmienda amplía unidades, el ledger recibe su AJUSTE en la
 * MISMA transacción: sin eso, el contrato y el lote dirían cosas distintas.
 */
export async function registrarEnmienda(d: DatosEnmienda): Promise<{ id: string }> {
  if (!d.motivo.trim()) throw new Error('Una enmienda de contrato exige un motivo.')

  return sinEmpresa('Membego Supply: enmienda de contrato con un proveedor', async (tx) => {
    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: d.acuerdoId },
      select: { id: true, estado: true, cantidad: true },
    })
    if (!acuerdo) throw new Error('Acuerdo no encontrado.')
    if (acuerdo.estado === 'CANCELADO') {
      throw new Error('Un acuerdo cancelado no se enmienda: se firma uno nuevo.')
    }

    let movimientoId: string | null = null

    if (d.campo === 'CANTIDAD' && d.unidadesExtra && d.loteId) {
      if (!Number.isInteger(d.unidadesExtra) || d.unidadesExtra <= 0) {
        throw new Error('Las unidades añadidas por una enmienda tienen que ser un entero positivo.')
      }
      const res = await registrarMovimientos(
        tx,
        d.loteId,
        [
          {
            tipo: 'AJUSTE',
            origen: null,
            destino: 'DISPONIBLE',
            cantidad: d.unidadesExtra,
            motivo: `Enmienda de contrato: ${d.motivo}`,
          },
        ],
        { actorId: d.aprobadoPorId ?? d.solicitadoPorId }
      )
      movimientoId = res.movimientoIds[0] ?? null
      await tx.supplyAcuerdo.update({
        where: { id: acuerdo.id },
        data: { cantidad: acuerdo.cantidad + d.unidadesExtra },
      })
    }

    if (d.campo === 'VIGENCIA' && d.nuevoFinAt) {
      await tx.supplyAcuerdo.update({ where: { id: acuerdo.id }, data: { finAt: d.nuevoFinAt } })
      // Los lotes vivos heredan la extensión: el vencimiento que se enseña al
      // cliente sale del lote, no del acuerdo, así que no propagarlo dejaría
      // vouchers caducando en una fecha que el contrato ya movió.
      await tx.supplyLote.updateMany({
        where: { acuerdoId: acuerdo.id, estado: { in: ['ACTIVO', 'PROGRAMADO', 'AGOTADO'] } },
        data: { venceAt: d.nuevoFinAt },
      })
    }

    const enmienda = await tx.supplyEnmienda.create({
      data: {
        acuerdoId: acuerdo.id,
        campo: d.campo,
        antes: d.antes,
        despues: d.despues,
        motivo: d.motivo.trim(),
        movimientoId,
        solicitadoPorId: d.solicitadoPorId ?? null,
        aprobadoPorId: d.aprobadoPorId ?? null,
        aprobadoAt: d.aprobadoPorId ? new Date() : null,
      },
      select: { id: true },
    })
    return enmienda
  })
}

/** Lectura simple reutilizada por pantallas y reportes. */
export async function lotesDeAcuerdo(tx: Tx, acuerdoId: string) {
  return tx.supplyLote.findMany({
    where: { acuerdoId },
    orderBy: { venceAt: 'asc' },
  })
}
