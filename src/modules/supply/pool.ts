import 'server-only'

import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { economiaCampana, scorecard, type ScorecardProveedor } from './economia'
import { ambitoProveedor } from './permisos'
import type { EstrategiaSeleccion, LoteElegible } from './fefo'
import { lotesCandidatos } from './fefo'

/**
 * MEMBEGO SUPPLY · consultas del POOL (Fases 7, 47-53).
 *
 * Todo lo que las pantallas leen vive aquí, para que ni una página ni una
 * server action arme su propia consulta: las cifras de un módulo financiero no
 * pueden depender de quién escribió el `where`.
 *
 * Dos reglas que se repiten en cada consulta y que no son decorativas:
 *
 *  · `reversadaAt: null` en toda cuenta de redenciones. Una entrega deshecha
 *    no se entregó, no se paga y no cuenta como consumo.
 *  · El ámbito del proveedor (`ambitoProveedor`) en todo lo que sirve al
 *    portal del comercio. El proveedor A no ve al B, nunca.
 */

// ── Vista global (Fase 7) ───────────────────────────────────────────────────

export interface ResumenPool {
  unidadesCompradas: number
  disponibles: number
  asignadas: number
  retenidas: number
  emitidas: number
  redimidas: number
  cerradas: number
  valorAdquirido: number
  valorConsumido: number
  valorDisponible: number
  valorEnRiesgo: number
  lotesActivos: number
  proveedores: number
  proximasAVencer: number
}

/**
 * El tablero de Membego Supply.
 *
 * `valorEnRiesgo` son las unidades vivas de lotes que vencen dentro de 30
 * días, a costo. Es la cifra que convierte «tenemos supply» en «tenemos
 * RD$51.000 a punto de evaporarse», que es la que hace que alguien actúe.
 */
export async function resumenPool(ahora: Date = new Date()): Promise<ResumenPool> {
  return sinEmpresa('Membego Supply: tablero global de la plataforma', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: { estado: { notIn: ['CANCELADO'] } },
      select: {
        id: true,
        estado: true,
        venceAt: true,
        proveedorId: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        cerradas: true,
        snapshotCostoUnitario: true,
      },
    })

    const en30 = new Date(ahora.getTime() + 30 * 86_400_000)
    const r = {
      unidadesCompradas: 0,
      disponibles: 0,
      asignadas: 0,
      retenidas: 0,
      emitidas: 0,
      redimidas: 0,
      cerradas: 0,
      valorAdquirido: 0,
      valorConsumido: 0,
      valorDisponible: 0,
      valorEnRiesgo: 0,
      lotesActivos: 0,
      proveedores: 0,
      proximasAVencer: 0,
    }
    const proveedores = new Set<string>()

    for (const l of lotes) {
      const costo = Number(l.snapshotCostoUnitario)
      proveedores.add(l.proveedorId)
      r.unidadesCompradas += l.compradas
      r.disponibles += l.disponibles
      r.asignadas += l.asignadas
      r.retenidas += l.retenidas
      r.emitidas += l.emitidas
      r.redimidas += l.redimidas
      r.cerradas += l.cerradas
      r.valorAdquirido += l.compradas * costo
      r.valorConsumido += l.redimidas * costo
      r.valorDisponible += l.disponibles * costo
      if (l.estado === 'ACTIVO') r.lotesActivos += 1
      if (l.estado === 'ACTIVO' && l.venceAt <= en30 && l.venceAt > ahora) {
        const vivas = l.disponibles + l.asignadas + l.retenidas + l.emitidas
        r.proximasAVencer += vivas
        r.valorEnRiesgo += vivas * costo
      }
    }

    r.proveedores = proveedores.size
    for (const k of ['valorAdquirido', 'valorConsumido', 'valorDisponible', 'valorEnRiesgo'] as const) {
      r[k] = Number(r[k].toFixed(2))
    }
    return r
  })
}

// ── Filtros de las pantallas ────────────────────────────────────────────────

export interface FiltroSupply {
  proveedorId?: string
  acuerdoId?: string
  loteId?: string
  estado?: string
  desde?: Date
  hasta?: Date
  /** Texto libre sobre el nombre del producto o el código del lote. */
  q?: string
}

// ── Reporte por lote (Fase 50) ──────────────────────────────────────────────

export interface FilaLote {
  id: string
  codigo: string
  proveedor: string
  item: string
  variante: string | null
  estado: string
  inicioAt: Date
  venceAt: Date
  compradas: number
  disponibles: number
  asignadas: number
  retenidas: number
  emitidas: number
  redimidas: number
  cerradas: number
  /** Suma de cubetas. Tiene que ser igual a `compradas`. */
  suma: number
  cuadra: boolean
  costoUnitario: number
  costoTotal: number
  costoConsumido: number
  costoDisponible: number
}

/** Lotes con su cuadre aritmético incluido. */
export async function reporteLotes(f: FiltroSupply = {}): Promise<FilaLote[]> {
  return sinEmpresa('Membego Supply: reporte de lotes', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.loteId ? { id: f.loteId } : {}),
        ...(f.desde || f.hasta
          ? { venceAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } }
          : {}),
        ...(f.q
          ? {
              OR: [
                { codigo: { contains: f.q, mode: 'insensitive' as const } },
                { snapshotItemNombre: { contains: f.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { venceAt: 'asc' },
      select: {
        id: true,
        codigo: true,
        estado: true,
        inicioAt: true,
        venceAt: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        cerradas: true,
        snapshotItemNombre: true,
        snapshotVariante: true,
        snapshotCostoUnitario: true,
        proveedor: { select: { name: true } },
      },
    })

    return lotes.map((l) => {
      const costo = Number(l.snapshotCostoUnitario)
      const suma =
        l.disponibles + l.asignadas + l.retenidas + l.emitidas + l.redimidas + l.cerradas
      return {
        id: l.id,
        codigo: l.codigo,
        proveedor: l.proveedor.name,
        item: l.snapshotItemNombre,
        variante: l.snapshotVariante,
        estado: l.estado,
        inicioAt: l.inicioAt,
        venceAt: l.venceAt,
        compradas: l.compradas,
        disponibles: l.disponibles,
        asignadas: l.asignadas,
        retenidas: l.retenidas,
        emitidas: l.emitidas,
        redimidas: l.redimidas,
        cerradas: l.cerradas,
        suma,
        cuadra: suma === l.compradas,
        costoUnitario: costo,
        costoTotal: Number((l.compradas * costo).toFixed(2)),
        costoConsumido: Number((l.redimidas * costo).toFixed(2)),
        costoDisponible: Number((l.disponibles * costo).toFixed(2)),
      }
    })
  })
}

// ── Reporte por proveedor (Fase 49) ─────────────────────────────────────────

export interface FilaProveedor {
  proveedorId: string
  proveedor: string
  acuerdos: number
  compradas: number
  asignadas: number
  sinAsignar: number
  emitidas: number
  redimidas: number
  pendientesCliente: number
  costoTotal: number
  costoConsumido: number
  costoDisponible: number
  scorecard: ScorecardProveedor
}

export async function reporteProveedores(f: FiltroSupply = {}): Promise<FilaProveedor[]> {
  return sinEmpresa('Membego Supply: reporte por proveedor', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: f.proveedorId ? { proveedorId: f.proveedorId } : {},
      select: {
        proveedorId: true,
        acuerdoId: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        snapshotCostoUnitario: true,
        proveedor: { select: { name: true } },
      },
    })

    const porProveedor = new Map<string, FilaProveedor & { acuerdoIds: Set<string> }>()
    for (const l of lotes) {
      const costo = Number(l.snapshotCostoUnitario)
      let fila = porProveedor.get(l.proveedorId)
      if (!fila) {
        fila = {
          proveedorId: l.proveedorId,
          proveedor: l.proveedor.name,
          acuerdos: 0,
          compradas: 0,
          asignadas: 0,
          sinAsignar: 0,
          emitidas: 0,
          redimidas: 0,
          pendientesCliente: 0,
          costoTotal: 0,
          costoConsumido: 0,
          costoDisponible: 0,
          scorecard: scorecard({
            contratadas: 0,
            emitidas: 0,
            redimidas: 0,
            reversadas: 0,
            incidencias: 0,
            incumplimientos: 0,
          }),
          acuerdoIds: new Set<string>(),
        }
        porProveedor.set(l.proveedorId, fila)
      }
      fila.acuerdoIds.add(l.acuerdoId)
      fila.compradas += l.compradas
      fila.asignadas += l.asignadas + l.retenidas
      fila.sinAsignar += l.disponibles
      // `emitidas` histórico = las que están en manos de clientes MÁS las ya
      // redimidas. La cubeta EMITIDO sola diría 28 cuando se repartieron 412,
      // y el reporte del proveedor tiene que enseñar las dos cifras.
      fila.emitidas += l.emitidas + l.redimidas
      fila.redimidas += l.redimidas
      fila.pendientesCliente += l.emitidas
      fila.costoTotal += l.compradas * costo
      fila.costoConsumido += l.redimidas * costo
      fila.costoDisponible += l.disponibles * costo
    }

    const filas: FilaProveedor[] = []
    for (const fila of porProveedor.values()) {
      const [reversadas, incidencias, incumplimientos] = await Promise.all([
        tx.supplyRedencion.count({
          where: { proveedorId: fila.proveedorId, reversadaAt: { not: null } },
        }),
        tx.supplyIncidencia.count({ where: { proveedorId: fila.proveedorId } }),
        tx.supplyIncidencia.count({
          where: {
            proveedorId: fila.proveedorId,
            tipo: {
              in: ['BENEFICIO_NEGADO', 'PRODUCTO_NO_DISPONIBLE', 'SUCURSAL_NO_ACEPTO', 'EMPRESA_CERRADA'],
            },
          },
        }),
      ])

      const { acuerdoIds, ...resto } = fila
      filas.push({
        ...resto,
        acuerdos: acuerdoIds.size,
        costoTotal: Number(fila.costoTotal.toFixed(2)),
        costoConsumido: Number(fila.costoConsumido.toFixed(2)),
        costoDisponible: Number(fila.costoDisponible.toFixed(2)),
        scorecard: scorecard({
          contratadas: fila.compradas,
          emitidas: fila.emitidas,
          redimidas: fila.redimidas,
          reversadas,
          incidencias,
          incumplimientos,
        }),
      })
    }

    return filas.sort((a, b) => b.costoTotal - a.costoTotal)
  })
}

// ── Reporte por campaña (Fase 51) ───────────────────────────────────────────

export interface FilaCampana {
  asignacionId: string
  etiqueta: string
  destinoTipo: string
  destinoId: string | null
  loteCodigo: string
  proveedor: string
  asignadas: number
  emitidas: number
  liberadas: number
  redimidas: number
  porEmitir: number
  activasSinCanjear: number
  costoUnitario: number
  costoComprometido: number
  costoConsumido: number
  costoExpuesto: number
  ingresos: number
  tasaRedencion: number
}

export async function reporteCampanas(f: FiltroSupply = {}): Promise<FilaCampana[]> {
  return sinEmpresa('Membego Supply: economía por campaña', async (tx) => {
    const asignaciones = await tx.supplyAsignacion.findMany({
      where: {
        ...(f.loteId ? { loteId: f.loteId } : {}),
        ...(f.proveedorId ? { lote: { proveedorId: f.proveedorId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        etiqueta: true,
        destinoTipo: true,
        destinoId: true,
        cantidad: true,
        emitidas: true,
        liberadas: true,
        lote: {
          select: {
            codigo: true,
            snapshotCostoUnitario: true,
            proveedor: { select: { name: true } },
          },
        },
      },
    })

    const filas: FilaCampana[] = []
    for (const a of asignaciones) {
      const [redimidas, ingresosAgg] = await Promise.all([
        tx.supplyRedencion.count({ where: { asignacionId: a.id, reversadaAt: null } }),
        tx.supplyDerecho.aggregate({
          where: { asignacionId: a.id },
          _sum: { precioCliente: true },
        }),
      ])
      const costoUnitario = Number(a.lote.snapshotCostoUnitario)
      const eco = economiaCampana({
        asignadas: a.cantidad,
        emitidas: a.emitidas,
        liberadas: a.liberadas,
        redimidas,
        costoUnitario,
        ingresos: Number(ingresosAgg._sum.precioCliente ?? 0),
      })

      filas.push({
        asignacionId: a.id,
        etiqueta: a.etiqueta,
        destinoTipo: a.destinoTipo,
        destinoId: a.destinoId,
        loteCodigo: a.lote.codigo,
        proveedor: a.lote.proveedor.name,
        asignadas: eco.asignadas,
        emitidas: eco.emitidas,
        liberadas: a.liberadas,
        redimidas: eco.redimidas,
        porEmitir: eco.porEmitir,
        activasSinCanjear: eco.activasSinCanjear,
        costoUnitario,
        costoComprometido: eco.costoComprometido,
        costoConsumido: eco.costoConsumido,
        costoExpuesto: eco.costoExpuesto,
        ingresos: eco.ingresos,
        tasaRedencion: eco.tasaRedencion,
      })
    }
    return filas
  })
}

// ── Reporte de redenciones (Fase 48) ────────────────────────────────────────

export interface FilaRedencion {
  id: string
  fecha: Date
  cliente: string
  proveedor: string
  sucursal: string | null
  empleado: string | null
  item: string
  loteCodigo: string
  campana: string | null
  costoUnitario: number
  extras: number
  aporteCliente: number
  reversada: boolean
}

export async function reporteRedenciones(f: FiltroSupply = {}, limite = 500): Promise<FilaRedencion[]> {
  return sinEmpresa('Membego Supply: reporte de redenciones', async (tx) => {
    const filas = await tx.supplyRedencion.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.loteId ? { loteId: f.loteId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.desde || f.hasta
          ? {
              createdAt: {
                ...(f.desde ? { gte: f.desde } : {}),
                ...(f.hasta ? { lte: f.hasta } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        createdAt: true,
        costoUnitario: true,
        extrasMonto: true,
        aporteClienteComercio: true,
        reversadaAt: true,
        cliente: { select: { nombre: true } },
        proveedor: { select: { name: true } },
        sucursal: { select: { nombre: true } },
        empleado: { select: { name: true } },
        voucher: {
          select: {
            derecho: {
              select: {
                asignacion: { select: { etiqueta: true } },
                lote: { select: { codigo: true, snapshotItemNombre: true } },
              },
            },
          },
        },
      },
    })

    return filas.map((r) => ({
      id: r.id,
      fecha: r.createdAt,
      cliente: r.cliente.nombre,
      proveedor: r.proveedor.name,
      sucursal: r.sucursal?.nombre ?? null,
      empleado: r.empleado?.name ?? null,
      item: r.voucher.derecho.lote.snapshotItemNombre,
      loteCodigo: r.voucher.derecho.lote.codigo,
      campana: r.voucher.derecho.asignacion?.etiqueta ?? null,
      costoUnitario: Number(r.costoUnitario),
      extras: Number(r.extrasMonto),
      aporteCliente: Number(r.aporteClienteComercio),
      reversada: r.reversadaAt !== null,
    }))
  })
}

// ── Portal del proveedor (Fase 19) ──────────────────────────────────────────

export interface CompromisoProveedor {
  loteId: string
  codigo: string
  item: string
  variante: string | null
  contratadas: number
  entregadas: number
  pendientes: number
  vouchersActivos: number
  venceAt: Date
  estado: string
  capacidadDiaria: number | null
}

/**
 * Lo que una empresa ve de SUS compromisos con Membego.
 *
 * Lo que NO devuelve, y es deliberado: costo unitario, valor del contrato,
 * saldos con otros proveedores. El comercio ve volumen y cumplimiento; la
 * economía de Membego no es suya. El costo aparece en su liquidación, que es
 * otra pantalla y otra pregunta.
 */
export async function compromisosDelProveedor(companyId: string): Promise<CompromisoProveedor[]> {
  // `conEmpresa` y NO `sinEmpresa`: esto es una lectura DE una empresa, no una
  // que cruce inquilinos. Con RLS encendido, dentro de esta transacción solo
  // existen las filas de este proveedor — y el `where` explícito sigue ahí
  // como primera barrera.
  return conEmpresa(companyId, async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: { ...ambitoProveedor(companyId), estado: { notIn: ['CANCELADO'] } },
      orderBy: { venceAt: 'asc' },
      select: {
        id: true,
        codigo: true,
        estado: true,
        venceAt: true,
        compradas: true,
        redimidas: true,
        emitidas: true,
        snapshotItemNombre: true,
        snapshotVariante: true,
        snapshotCapacidadDiaria: true,
      },
    })

    return lotes.map((l) => ({
      loteId: l.id,
      codigo: l.codigo,
      item: l.snapshotItemNombre,
      variante: l.snapshotVariante,
      contratadas: l.compradas,
      entregadas: l.redimidas,
      pendientes: l.compradas - l.redimidas,
      vouchersActivos: l.emitidas,
      venceAt: l.venceAt,
      estado: l.estado,
      capacidadDiaria: l.snapshotCapacidadDiaria,
    }))
  })
}

// ── Selección FEFO sobre datos reales ───────────────────────────────────────

/**
 * Lotes candidatos para entregar un producto, ya ordenados por la estrategia.
 *
 * Es el puente entre `fefo.ts` (puro) y la base: lee, adapta y delega. La
 * decisión de qué lote se consume no vive en una consulta SQL, porque ahí no
 * se puede probar.
 */
export async function candidatosParaEntregar(
  tx: Tx,
  opciones: {
    proveedorId?: string | null
    sucursalId?: string | null
    item?: string | null
    estrategia?: EstrategiaSeleccion
    exigirDisponibles?: boolean
  } = {}
): Promise<LoteElegible[]> {
  const lotes = await tx.supplyLote.findMany({
    where: {
      estado: 'ACTIVO',
      ...(opciones.proveedorId ? { proveedorId: opciones.proveedorId } : {}),
      ...(opciones.item
        ? { snapshotItemNombre: { contains: opciones.item, mode: 'insensitive' as const } }
        : {}),
    },
    select: {
      id: true,
      codigo: true,
      estado: true,
      venceAt: true,
      inicioAt: true,
      createdAt: true,
      disponibles: true,
      asignadas: true,
      proveedorId: true,
      snapshotCostoUnitario: true,
      snapshotSucursalIds: true,
    },
  })

  const elegibles: LoteElegible[] = lotes.map((l) => ({
    id: l.id,
    codigo: l.codigo,
    estado: l.estado,
    venceAt: l.venceAt,
    inicioAt: l.inicioAt,
    createdAt: l.createdAt,
    costoUnitario: Number(l.snapshotCostoUnitario),
    utilizables: l.disponibles + l.asignadas,
    disponibles: l.disponibles,
    proveedorId: l.proveedorId,
    snapshotSucursalIds: l.snapshotSucursalIds,
  }))

  return lotesCandidatos(
    elegibles,
    {
      sucursalId: opciones.sucursalId,
      proveedorId: opciones.proveedorId,
      exigirDisponibles: opciones.exigirDisponibles,
    },
    opciones.estrategia
  )
}

// ── Beneficios del cliente (Fase 16) ────────────────────────────────────────

export interface BeneficioCliente {
  derechoId: string
  voucherId: string | null
  producto: string
  variante: string | null
  proveedor: string
  proveedorSlug: string
  estado: string
  venceAt: Date
  origen: string
  campana: string | null
  /** Sucursales donde vale. Vacío = todas las del proveedor. */
  sucursalIds: string[]
  reservaAt: Date | null
  /** true = hay que reservar antes de poder enseñar el QR. */
  exigeReserva: boolean
  precioPagado: number
}

/**
 * "Mis beneficios": lo que esta persona tiene de Membego Supply.
 *
 * Los vencidos y usados NO se devuelven por defecto: la pantalla es para usar
 * beneficios, no para leer historia. El historial tiene su propia consulta con
 * `incluirCerrados`.
 */
export async function beneficiosDelCliente(
  clienteIds: readonly string[],
  incluirCerrados = false
): Promise<BeneficioCliente[]> {
  if (clienteIds.length === 0) return []

  return sinEmpresa('Membego Supply: beneficios de una persona en toda la red', async (tx) => {
    const derechos = await tx.supplyDerecho.findMany({
      where: {
        clienteId: { in: [...clienteIds] },
        ...(incluirCerrados ? {} : { estado: 'ACTIVO' }),
      },
      orderBy: { vencAt: 'asc' },
      select: {
        id: true,
        estado: true,
        vencAt: true,
        origen: true,
        precioCliente: true,
        proveedor: { select: { name: true, slug: true } },
        asignacion: { select: { etiqueta: true } },
        lote: {
          select: {
            snapshotItemNombre: true,
            snapshotVariante: true,
            snapshotSucursalIds: true,
            snapshotTipo: true,
          },
        },
        vouchers: { where: { estado: 'ACTIVO' }, select: { id: true }, take: 1 },
        reservas: { where: { estado: 'CONFIRMADA' }, select: { inicioAt: true }, take: 1 },
      },
    })

    return derechos.map((d) => ({
      derechoId: d.id,
      voucherId: d.vouchers[0]?.id ?? null,
      producto: d.lote.snapshotItemNombre,
      variante: d.lote.snapshotVariante,
      proveedor: d.proveedor.name,
      proveedorSlug: d.proveedor.slug,
      estado: d.estado,
      venceAt: d.vencAt,
      origen: d.origen,
      campana: d.asignacion?.etiqueta ?? null,
      sucursalIds: d.lote.snapshotSucursalIds,
      reservaAt: d.reservas[0]?.inicioAt ?? null,
      exigeReserva: d.lote.snapshotTipo === 'CAPACIDAD_AGENDADA',
      precioPagado: Number(d.precioCliente),
    }))
  })
}
