import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyConciliacionEstado, SupplyDiscrepanciaEstado, SupplyDiscrepanciaTipo } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { codigoConciliacion } from './codigos'
import { conciliar as conciliarInterno } from './conciliacion'
import { crearCuentaPorCobrarEnTx, crearCuentaPorPagarEnTx } from './cuentas'
import { compararCifras, type DiscrepanciaNueva } from './conciliacion-cifras'
import { redondear2 } from './dinero'
export { compararCifras }
import { DISCREPANCIA_VIVA, TRANSICIONES_CONCILIACION, TRANSICIONES_DISCREPANCIA, exigirTransicion } from './estados'

/**
 * MEMBEGO SUPPLY · CONCILIACIÓN CONTRA EL PROVEEDOR (§18 del encargo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS CIFRAS, NO UNA
 *
 * `conciliacion.ts` contrasta Membego consigo mismo (contadores vs ledger).
 * Esto contrasta Membego CONTRA EL PROVEEDOR: Membego registra 125 redenciones
 * y el proveedor dice 123. Las dos cifras se guardan, la diferencia se
 * convierte en discrepancias tipadas, y cada una se investiga con documentos y
 * comentarios hasta resolverse —con ajuste financiero si hace falta— y
 * aprobarse. La conciliación no se cierra con una discrepancia viva.
 *
 * Los descuadres internos (CRÍTICA/ALTA) del período entran también como
 * discrepancias INTERNA: si los propios números de Membego no cuadran, no hay
 * conciliación posible con nadie.
 */

export interface DatosConciliacion {
  proveedorId: string
  acuerdoId?: string | null
  liquidacionId?: string | null
  desde: Date
  hasta: Date
  proveedorRedenciones: number
  proveedorMonto: number
  proveedorVentas?: number
  proveedorVentasMonto?: number
  proveedorDetalle?: Prisma.InputJsonValue
  notas?: string | null
  documentos?: string[]
  creadoPorId?: string | null
}


export async function abrirConciliacion(d: DatosConciliacion): Promise<{ id: string; codigo: string; discrepancias: number }> {
  if (d.hasta <= d.desde) throw new Error('El período termina antes de empezar.')
  // La conciliación interna abre su propia transacción: va ANTES, no dentro.
  const interna = await conciliarInterno(d.proveedorId, 200)

  return sinEmpresa('Membego Supply: abrir una conciliación con un proveedor', async (tx) => {
    const filtroAcuerdo = d.acuerdoId ? { acuerdoId: d.acuerdoId } : {}
    const [redenciones, ventas] = await Promise.all([
      tx.supplyRedencion.findMany({
        where: { proveedorId: d.proveedorId, ...filtroAcuerdo, reversadaAt: null, createdAt: { gte: d.desde, lte: d.hasta } },
        select: { costoUnitario: true },
      }),
      tx.supplyVentaDirecta.findMany({
        where: { proveedorId: d.proveedorId, ...filtroAcuerdo, estado: 'ENTREGADA', entregadaAt: { gte: d.desde, lte: d.hasta } },
        select: { montoProveedor: true },
      }),
    ])
    const membego = {
      membegoRedenciones: redenciones.length,
      membegoMonto: redondear2(redenciones.reduce((t, r) => t + Number(r.costoUnitario), 0)),
      membegoVentas: ventas.length,
      membegoVentasMonto: redondear2(ventas.reduce((t, v) => t + Number(v.montoProveedor), 0)),
    }
    const discrepancias = compararCifras({
      ...membego,
      proveedorRedenciones: d.proveedorRedenciones,
      proveedorMonto: redondear2(d.proveedorMonto),
      proveedorVentas: d.proveedorVentas ?? 0,
      proveedorVentasMonto: redondear2(d.proveedorVentasMonto ?? 0),
    })
    for (const h of interna.hallazgos.filter((h) => h.gravedad !== 'MEDIA')) {
      discrepancias.push({
        tipo: 'INTERNA', titulo: h.titulo, detalle: h.detalle, entidad: h.entidad, entidadId: h.entidadId,
      })
    }

    const secuencia = (await tx.supplyConciliacion.count()) + 1
    const con = await tx.supplyConciliacion.create({
      data: {
        codigo: codigoConciliacion(secuencia),
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        liquidacionId: d.liquidacionId ?? null,
        estado: 'ABIERTA',
        periodoDesde: d.desde,
        periodoHasta: d.hasta,
        membegoRedenciones: membego.membegoRedenciones,
        membegoMonto: new Prisma.Decimal(membego.membegoMonto),
        membegoVentas: membego.membegoVentas,
        membegoVentasMonto: new Prisma.Decimal(membego.membegoVentasMonto),
        proveedorRedenciones: d.proveedorRedenciones,
        proveedorMonto: new Prisma.Decimal(redondear2(d.proveedorMonto)),
        proveedorVentas: d.proveedorVentas ?? 0,
        proveedorVentasMonto: new Prisma.Decimal(redondear2(d.proveedorVentasMonto ?? 0)),
        proveedorDetalle: d.proveedorDetalle ?? {},
        notas: d.notas ?? null,
        documentos: d.documentos ?? [],
        creadoPorId: d.creadoPorId ?? null,
        discrepancias: {
          create: discrepancias.map((x) => ({
            tipo: x.tipo, titulo: x.titulo, detalle: x.detalle,
            cantidadMembego: x.cantidadMembego ?? null, cantidadProveedor: x.cantidadProveedor ?? null,
            montoMembego: x.montoMembego != null ? new Prisma.Decimal(x.montoMembego) : null,
            montoProveedor: x.montoProveedor != null ? new Prisma.Decimal(x.montoProveedor) : null,
            montoDiferencia: x.montoDiferencia != null ? new Prisma.Decimal(x.montoDiferencia) : null,
            entidad: x.entidad ?? null, entidadId: x.entidadId ?? null,
          })),
        },
      },
      select: { id: true, codigo: true },
    })
    return { id: con.id, codigo: con.codigo, discrepancias: discrepancias.length }
  })
}

export interface AjusteDiscrepancia {
  lado: 'CXP' | 'CXC'
  monto: number
  descripcion?: string | null
}

/**
 * Mueve una discrepancia. AJUSTADA exige el ajuste y lo crea (cuenta por pagar
 * o por cobrar con origen DIFERENCIA_CONCILIACION); RESUELTA y RECHAZADA
 * exigen la resolución escrita; APROBADA la firma otra persona.
 */
export async function moverDiscrepancia(
  discrepanciaId: string,
  hasta: SupplyDiscrepanciaEstado,
  d: { resolucion?: string | null; ajuste?: AjusteDiscrepancia | null; actorId?: string | null }
): Promise<void> {
  const resolucion = d.resolucion?.trim() ?? ''
  if ((hasta === 'RESUELTA' || hasta === 'AJUSTADA' || hasta === 'RECHAZADA') && !resolucion) {
    throw new Error('Resolver o rechazar una discrepancia exige decir cómo.')
  }
  if (hasta === 'AJUSTADA' && (!d.ajuste || !Number.isFinite(d.ajuste.monto) || d.ajuste.monto <= 0)) {
    throw new Error('Resolver con ajuste exige el lado (por pagar o por cobrar) y un monto positivo.')
  }
  await sinEmpresa('Membego Supply: estado de una discrepancia de conciliación', async (tx) => {
    const disc = await tx.supplyDiscrepancia.findUnique({
      where: { id: discrepanciaId },
      select: { estado: true, titulo: true, resueltoPorId: true, conciliacion: { select: { id: true, proveedorId: true, acuerdoId: true, estado: true } } },
    })
    if (!disc) throw new Error('Discrepancia no encontrada.')
    if (disc.conciliacion.estado === 'CERRADA') throw new Error('La conciliación ya está cerrada.')
    exigirTransicion(TRANSICIONES_DISCREPANCIA, disc.estado, hasta, 'Discrepancia')
    if (hasta === 'APROBADA' && d.actorId && disc.resueltoPorId && d.actorId === disc.resueltoPorId) {
      throw new Error('Una discrepancia no la aprueba quien la resolvió.')
    }

    if (hasta === 'AJUSTADA' && d.ajuste) {
      const descripcion = d.ajuste.descripcion?.trim() || `Ajuste por conciliación: ${disc.titulo}`
      if (d.ajuste.lado === 'CXP') {
        await crearCuentaPorPagarEnTx(tx, {
          proveedorId: disc.conciliacion.proveedorId, acuerdoId: disc.conciliacion.acuerdoId, origen: 'DIFERENCIA_CONCILIACION',
          descripcion, montoBruto: d.ajuste.monto, discrepanciaId, creadoPorId: d.actorId ?? null,
          claveIdempotencia: `discrepancia-cxp:${discrepanciaId}`,
        })
      } else {
        await crearCuentaPorCobrarEnTx(tx, {
          proveedorId: disc.conciliacion.proveedorId, acuerdoId: disc.conciliacion.acuerdoId, origen: 'DIFERENCIA_CONCILIACION',
          descripcion, monto: d.ajuste.monto, discrepanciaId, creadoPorId: d.actorId ?? null,
          claveIdempotencia: `discrepancia-cxc:${discrepanciaId}`,
        })
      }
    }

    await tx.supplyDiscrepancia.update({
      where: { id: discrepanciaId },
      data: {
        estado: hasta,
        ...(resolucion ? { resolucion } : {}),
        ...(hasta === 'RESUELTA' || hasta === 'AJUSTADA' || hasta === 'RECHAZADA' ? { resueltoPorId: d.actorId ?? null, resueltoAt: new Date() } : {}),
        ...(hasta === 'APROBADA' ? { aprobadoPorId: d.actorId ?? null, aprobadoAt: new Date() } : {}),
      },
    })
    if (disc.conciliacion.estado === 'ABIERTA') {
      await tx.supplyConciliacion.update({ where: { id: disc.conciliacion.id }, data: { estado: 'EN_REVISION' } })
    }
  })
}

export async function agregarNotaDiscrepancia(
  discrepanciaId: string,
  texto: string,
  documentoPath: string | null,
  actorId?: string | null
): Promise<{ id: string }> {
  if (!texto.trim() && !documentoPath) throw new Error('Una nota necesita texto o un documento.')
  return sinEmpresa('Membego Supply: nota en una discrepancia', (tx) =>
    tx.supplyDiscrepanciaNota.create({
      data: { discrepanciaId, texto: texto.trim() || 'Documento adjunto.', documentoPath, actorId: actorId ?? null },
      select: { id: true },
    })
  )
}

/**
 * Cierra la conciliación. Exige que no quede ninguna discrepancia viva
 * (todas APROBADAS o RECHAZADAS) y, si está ligada a una liquidación pagada,
 * la marca CONCILIADA: es el último eslabón de la cadena del encargo.
 */
export async function cerrarConciliacion(conciliacionId: string, actorId?: string | null): Promise<void> {
  await sinEmpresa('Membego Supply: cerrar una conciliación', async (tx) => {
    const con = await tx.supplyConciliacion.findUnique({
      where: { id: conciliacionId },
      select: { estado: true, liquidacionId: true, discrepancias: { select: { estado: true } } },
    })
    if (!con) throw new Error('Conciliación no encontrada.')
    exigirTransicion(TRANSICIONES_CONCILIACION, con.estado, 'CERRADA', 'Conciliación')
    const vivas = con.discrepancias.filter((x) => DISCREPANCIA_VIVA.includes(x.estado)).length
    if (vivas > 0) throw new Error(`Quedan ${vivas} discrepancia(s) sin aprobar o rechazar.`)
    await tx.supplyConciliacion.update({
      where: { id: conciliacionId },
      data: { estado: 'CERRADA', cerradoPorId: actorId ?? null, cerradaAt: new Date() },
    })
    if (con.liquidacionId) {
      const liq = await tx.supplyLiquidacion.findUnique({ where: { id: con.liquidacionId }, select: { estado: true } })
      if (liq?.estado === 'PAGADA') {
        await tx.supplyLiquidacion.update({ where: { id: con.liquidacionId }, data: { estado: 'CONCILIADA', conciliadaAt: new Date() } })
      }
    }
  })
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export async function listarConciliaciones(f: { proveedorId?: string; estado?: SupplyConciliacionEstado; limite?: number } = {}) {
  return sinEmpresa('Membego Supply: conciliaciones con proveedores', (tx) =>
    tx.supplyConciliacion.findMany({
      where: { ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}), ...(f.estado ? { estado: f.estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: f.limite ?? 200,
      select: {
        id: true, codigo: true, estado: true, periodoDesde: true, periodoHasta: true,
        membegoRedenciones: true, membegoMonto: true, proveedorRedenciones: true, proveedorMonto: true,
        membegoVentas: true, membegoVentasMonto: true, proveedorVentas: true, proveedorVentasMonto: true,
        createdAt: true, cerradaAt: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { codigo: true } },
        liquidacion: { select: { id: true, codigo: true, estado: true } },
        discrepancias: { select: { estado: true } },
      },
    })
  )
}

export async function fichaConciliacion(id: string) {
  return sinEmpresa('Membego Supply: ficha de una conciliación', (tx) =>
    tx.supplyConciliacion.findUnique({
      where: { id },
      include: {
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        liquidacion: { select: { id: true, codigo: true, estado: true, netoLiquidar: true } },
        creadoPor: { select: { name: true } },
        cerradoPor: { select: { name: true } },
        discrepancias: {
          orderBy: [{ estado: 'asc' }, { createdAt: 'asc' }],
          include: {
            resueltoPor: { select: { id: true, name: true } },
            aprobadoPor: { select: { name: true } },
            cuentaPorPagar: { select: { codigo: true, montoNeto: true } },
            cuentaPorCobrar: { select: { codigo: true, montoNeto: true } },
            notas: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
          },
        },
      },
    })
  )
}

/** Discrepancias vivas en toda la plataforma (tablero). */
export async function discrepanciasAbiertas(tx: Tx, proveedorId?: string): Promise<number> {
  return tx.supplyDiscrepancia.count({
    where: { estado: { in: [...DISCREPANCIA_VIVA] }, ...(proveedorId ? { conciliacion: { proveedorId } } : {}) },
  })
}
