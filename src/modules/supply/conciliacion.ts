import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { comprobarInvariante, saldoVacio, type SaldoCubetas } from './ledger'
import { saldoDesdeLedger } from './movimientos'
import { INCIDENCIAS_DE_INCUMPLIMIENTO } from './catalogo'
import {
  GRAVEDAD_HALLAZGO,
  HALLAZGO_LABELS,
  TIPOS_HALLAZGO,
  type Gravedad,
  type TipoHallazgo,
} from './hallazgos'

export { GRAVEDAD_HALLAZGO, HALLAZGO_LABELS, TIPOS_HALLAZGO }
export type { Gravedad, TipoHallazgo }

/**
 * MEMBEGO SUPPLY · CONCILIACIÓN (Fases 32, 53, 54).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES UNA PANTALLA BONITA: ES UNA HERRAMIENTA OPERATIVA
 *
 * Su trabajo es contestar «¿cuadra?» con un sí o con una lista de hallazgos
 * concretos, cada uno con el id de la fila que hay que mirar. Un panel que
 * enseña porcentajes verdes sin decir qué fila revisar no sirve el día que algo
 * no cuadra, que es el único día que importa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE CONTRASTA CONTRA QUÉ
 *
 *   contadores del lote   ←→   suma del ledger        (deriva de caché)
 *   suma de cubetas       ←→   unidades compradas     (el invariante)
 *   redenciones vivas     ←→   vouchers redimidos     (doble redención)
 *   derechos redimidos    ←→   asientos de REDENCION  (asiento perdido)
 *   emitidas de campaña   ←→   derechos de la campaña (sobre-asignación)
 *
 * Cada contraste usa DOS caminos distintos hacia el mismo número. Comparar un
 * número consigo mismo es lo que hace que un panel de conciliación siempre
 * diga que todo está bien.
 */

export interface Hallazgo {
  tipo: TipoHallazgo
  gravedad: Gravedad
  titulo: string
  detalle: string
  /** Qué mirar: tabla e id concretos. */
  entidad: string
  entidadId: string
  loteId?: string
  proveedorId?: string
}

export interface ReporteConciliacion {
  generadoAt: Date
  lotesRevisados: number
  hallazgos: Hallazgo[]
  /** Resumen por gravedad, para el semáforo. */
  criticos: number
  altos: number
  medios: number
  cuadra: boolean
}

/**
 * Concilia un lote: contrasta sus contadores contra el ledger.
 *
 * Devuelve los dos saldos aunque cuadren: quien mira una conciliación quiere
 * ver los dos números, no una palabra.
 */
export async function conciliarLote(loteId: string): Promise<{
  hallazgos: Hallazgo[]
  contadores: SaldoCubetas
  ledger: SaldoCubetas
}> {
  return sinEmpresa('Membego Supply: conciliación de un lote', async (tx) => {
    const lote = await tx.supplyLote.findUnique({
      where: { id: loteId },
      select: {
        id: true,
        codigo: true,
        proveedorId: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        cerradas: true,
      },
    })
    if (!lote) throw new Error('Lote no encontrado.')

    const contadores: SaldoCubetas = {
      DISPONIBLE: lote.disponibles,
      ASIGNADO: lote.asignadas,
      RETENIDO: lote.retenidas,
      EMITIDO: lote.emitidas,
      REDIMIDO: lote.redimidas,
      CERRADO: lote.cerradas,
    }
    const ledger = await saldoDesdeLedger(tx, loteId)
    const hallazgos: Hallazgo[] = []

    for (const cubeta of Object.keys(contadores) as (keyof SaldoCubetas)[]) {
      if (contadores[cubeta] !== ledger[cubeta]) {
        hallazgos.push({
          tipo: 'DERIVA_CONTADORES',
          gravedad: GRAVEDAD_HALLAZGO.DERIVA_CONTADORES,
          titulo: `${lote.codigo}: ${cubeta} no coincide`,
          detalle: `El lote dice ${contadores[cubeta]} y el ledger ${ledger[cubeta]}. El ledger manda: hay que recalcular.`,
          entidad: 'SupplyLote',
          entidadId: lote.id,
          loteId: lote.id,
          proveedorId: lote.proveedorId,
        })
      }
      if (ledger[cubeta] < 0) {
        hallazgos.push({
          tipo: 'CUBETA_NEGATIVA',
          gravedad: GRAVEDAD_HALLAZGO.CUBETA_NEGATIVA,
          titulo: `${lote.codigo}: ${cubeta} en negativo`,
          detalle: `El ledger deja ${cubeta} en ${ledger[cubeta]}. Hay asientos que sacan unidades que nunca entraron.`,
          entidad: 'SupplyLote',
          entidadId: lote.id,
          loteId: lote.id,
          proveedorId: lote.proveedorId,
        })
      }
    }

    const sumaLedger = Object.values(ledger).reduce((t, n) => t + n, 0)
    if (sumaLedger !== lote.compradas) {
      hallazgos.push({
        tipo: 'INVARIANTE_ROTO',
        gravedad: GRAVEDAD_HALLAZGO.INVARIANTE_ROTO,
        titulo: `${lote.codigo}: las cubetas no suman lo comprado`,
        detalle: `Comprado ${lote.compradas}, suma de cubetas ${sumaLedger}. Diferencia: ${sumaLedger - lote.compradas}.`,
        entidad: 'SupplyLote',
        entidadId: lote.id,
        loteId: lote.id,
        proveedorId: lote.proveedorId,
      })
    }

    return { hallazgos, contadores, ledger }
  })
}

/**
 * Conciliación completa: lotes, redenciones, asignaciones y derechos.
 *
 * `proveedorId` acota la revisión al portal de un proveedor; sin él, revisa la
 * plataforma entera (pantalla del superadmin).
 */
export async function conciliar(
  proveedorId?: string,
  limiteLotes = 200
): Promise<ReporteConciliacion> {
  return sinEmpresa('Membego Supply: conciliación global', async (tx) => {
    const hallazgos: Hallazgo[] = []
    const ahora = new Date()

    const lotes = await tx.supplyLote.findMany({
      where: proveedorId ? { proveedorId } : {},
      select: {
        id: true,
        codigo: true,
        proveedorId: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        cerradas: true,
      },
      take: limiteLotes,
      orderBy: { createdAt: 'desc' },
    })

    // ── 1 · Contadores vs ledger, lote a lote ──────────────────────────────
    for (const lote of lotes) {
      const grupos = await tx.supplyMovimiento.groupBy({
        by: ['origen', 'destino'],
        where: { loteId: lote.id },
        _sum: { cantidad: true },
      })
      const ledger = saldoVacio()
      const asientos = grupos.map((g) => ({
        tipo: 'AJUSTE' as const,
        origen: g.origen,
        destino: g.destino,
        cantidad: g._sum.cantidad ?? 0,
      }))
      for (const a of asientos) {
        if (a.origen) ledger[a.origen] -= a.cantidad
        if (a.destino) ledger[a.destino] += a.cantidad
      }

      const contadores: SaldoCubetas = {
        DISPONIBLE: lote.disponibles,
        ASIGNADO: lote.asignadas,
        RETENIDO: lote.retenidas,
        EMITIDO: lote.emitidas,
        REDIMIDO: lote.redimidas,
        CERRADO: lote.cerradas,
      }
      const derivadas = (Object.keys(contadores) as (keyof SaldoCubetas)[]).filter(
        (c) => contadores[c] !== ledger[c]
      )
      if (derivadas.length > 0) {
        hallazgos.push({
          tipo: 'DERIVA_CONTADORES',
          gravedad: GRAVEDAD_HALLAZGO.DERIVA_CONTADORES,
          titulo: `${lote.codigo}: contadores desviados`,
          detalle: `No coinciden: ${derivadas.join(', ')}. El ledger es la verdad; recalcular el lote.`,
          entidad: 'SupplyLote',
          entidadId: lote.id,
          loteId: lote.id,
          proveedorId: lote.proveedorId,
        })
      }

      const inv = comprobarInvariante(asientos)
      if (!inv.cuadra) {
        hallazgos.push({
          tipo: inv.negativas.length > 0 ? 'CUBETA_NEGATIVA' : 'INVARIANTE_ROTO',
          gravedad: 'CRITICA',
          titulo: `${lote.codigo}: el ledger no cuadra`,
          detalle:
            inv.negativas.length > 0
              ? `Cubetas en negativo: ${inv.negativas.join(', ')}.`
              : `Comprado ${inv.comprado}, cubetas ${inv.suma} (diferencia ${inv.diferencia}).`,
          entidad: 'SupplyLote',
          entidadId: lote.id,
          loteId: lote.id,
          proveedorId: lote.proveedorId,
        })
      }
    }

    const ambito = proveedorId ? { proveedorId } : {}

    // ── 2 · Doble redención ────────────────────────────────────────────────
    // El índice único parcial lo impide en la base; esto detecta las que
    // pudieran haber entrado ANTES de la migración, que es exactamente lo que
    // una conciliación tiene que encontrar.
    const duplicadas = await tx.supplyRedencion.groupBy({
      by: ['voucherId'],
      where: { ...ambito, reversadaAt: null },
      _count: { _all: true },
      having: { voucherId: { _count: { gt: 1 } } },
    })
    for (const d of duplicadas) {
      hallazgos.push({
        tipo: 'REDENCION_DUPLICADA',
        gravedad: GRAVEDAD_HALLAZGO.REDENCION_DUPLICADA,
        titulo: 'Voucher con dos entregas vivas',
        detalle: `El voucher tiene ${d._count._all} redenciones sin reversar. Una unidad se entregó dos veces.`,
        entidad: 'SupplyVoucher',
        entidadId: d.voucherId,
        proveedorId,
      })
    }

    // ── 3 · Redención sin asiento ──────────────────────────────────────────
    const redencionesVivas = await tx.supplyRedencion.findMany({
      where: { ...ambito, reversadaAt: null },
      select: { id: true, loteId: true, proveedorId: true },
      take: 1000,
      orderBy: { createdAt: 'desc' },
    })
    if (redencionesVivas.length > 0) {
      const conAsiento = await tx.supplyMovimiento.findMany({
        where: {
          tipo: 'REDENCION',
          redencionId: { in: redencionesVivas.map((r) => r.id) },
        },
        select: { redencionId: true },
      })
      const marcadas = new Set(conAsiento.map((m) => m.redencionId))
      for (const r of redencionesVivas) {
        if (!marcadas.has(r.id)) {
          hallazgos.push({
            tipo: 'ASIENTO_FALTANTE',
            gravedad: GRAVEDAD_HALLAZGO.ASIENTO_FALTANTE,
            titulo: 'Redención sin asiento en el ledger',
            detalle:
              'Se registró una entrega que no descontó supply. El lote está prometiendo una unidad que ya salió.',
            entidad: 'SupplyRedencion',
            entidadId: r.id,
            loteId: r.loteId,
            proveedorId: r.proveedorId,
          })
        }
      }
    }

    // ── 4 · Sobre-asignación ───────────────────────────────────────────────
    const asignaciones = await tx.supplyAsignacion.findMany({
      where: proveedorId ? { lote: { proveedorId } } : {},
      select: {
        id: true,
        etiqueta: true,
        cantidad: true,
        emitidas: true,
        liberadas: true,
        loteId: true,
      },
      take: 500,
    })
    for (const a of asignaciones) {
      if (a.emitidas + a.liberadas > a.cantidad) {
        hallazgos.push({
          tipo: 'SOBRE_ASIGNACION',
          gravedad: GRAVEDAD_HALLAZGO.SOBRE_ASIGNACION,
          titulo: `"${a.etiqueta}" repartió de más`,
          detalle: `Asignadas ${a.cantidad}, emitidas ${a.emitidas}, liberadas ${a.liberadas}.`,
          entidad: 'SupplyAsignacion',
          entidadId: a.id,
          loteId: a.loteId,
          proveedorId,
        })
      }
      // Contraste por el OTRO camino: los derechos que existen de verdad.
      const derechos = await tx.supplyDerecho.count({ where: { asignacionId: a.id } })
      if (derechos !== a.emitidas) {
        hallazgos.push({
          tipo: 'DERIVA_CONTADORES',
          gravedad: GRAVEDAD_HALLAZGO.DERIVA_CONTADORES,
          titulo: `"${a.etiqueta}": emitidas no coincide con los derechos`,
          detalle: `La asignación dice ${a.emitidas} y existen ${derechos} derechos.`,
          entidad: 'SupplyAsignacion',
          entidadId: a.id,
          loteId: a.loteId,
          proveedorId,
        })
      }
    }

    // ── 5 · Derechos vencidos que siguen activos ───────────────────────────
    const vencidosActivos = await tx.supplyDerecho.findMany({
      where: { ...ambito, estado: 'ACTIVO', vencAt: { lt: ahora } },
      select: { id: true, loteId: true, proveedorId: true, vencAt: true },
      take: 100,
    })
    for (const d of vencidosActivos) {
      hallazgos.push({
        tipo: 'DERECHO_VENCIDO_ACTIVO',
        gravedad: GRAVEDAD_HALLAZGO.DERECHO_VENCIDO_ACTIVO,
        titulo: 'Derecho vencido todavía activo',
        detalle: `Venció el ${d.vencAt.toISOString().slice(0, 10)} y sigue en ACTIVO. Falta pasar el cierre de vencimientos.`,
        entidad: 'SupplyDerecho',
        entidadId: d.id,
        loteId: d.loteId,
        proveedorId: d.proveedorId,
      })
    }

    // ── 6 · Vouchers huérfanos ─────────────────────────────────────────────
    const huerfanos = await tx.supplyVoucher.findMany({
      where: { ...ambito, estado: 'ACTIVO', derecho: { estado: { not: 'ACTIVO' } } },
      select: { id: true, proveedorId: true, derecho: { select: { estado: true } } },
      take: 100,
    })
    for (const v of huerfanos) {
      hallazgos.push({
        tipo: 'VOUCHER_HUERFANO',
        gravedad: GRAVEDAD_HALLAZGO.VOUCHER_HUERFANO,
        titulo: 'Voucher activo sobre un derecho que no lo está',
        detalle: `El derecho está ${v.derecho.estado} y el voucher sigue ACTIVO: es canjeable sin respaldo.`,
        entidad: 'SupplyVoucher',
        entidadId: v.id,
        proveedorId: v.proveedorId,
      })
    }

    // ── 7 · Reversas sin original ──────────────────────────────────────────
    const reversas = await tx.supplyMovimiento.findMany({
      where: { tipo: 'REVERSA_REDENCION', ...(proveedorId ? { lote: { proveedorId } } : {}) },
      select: { id: true, redencionId: true, loteId: true },
      take: 200,
    })
    for (const r of reversas) {
      if (!r.redencionId) {
        hallazgos.push({
          tipo: 'REVERSA_INVALIDA',
          gravedad: GRAVEDAD_HALLAZGO.REVERSA_INVALIDA,
          titulo: 'Reversa sin redención de origen',
          detalle: 'Un asiento de reversa no apunta a ninguna entrega. No se puede auditar qué deshizo.',
          entidad: 'SupplyMovimiento',
          entidadId: r.id,
          loteId: r.loteId,
          proveedorId,
        })
      }
    }

    const orden: Record<Gravedad, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2 }
    hallazgos.sort((a, b) => orden[a.gravedad] - orden[b.gravedad])

    return {
      generadoAt: ahora,
      lotesRevisados: lotes.length,
      hallazgos,
      criticos: hallazgos.filter((h) => h.gravedad === 'CRITICA').length,
      altos: hallazgos.filter((h) => h.gravedad === 'ALTA').length,
      medios: hallazgos.filter((h) => h.gravedad === 'MEDIA').length,
      cuadra: hallazgos.length === 0,
    }
  })
}

// ── Señales de riesgo (Fase 54) ─────────────────────────────────────────────

export interface SenalRiesgo {
  proveedorId: string
  proveedorNombre: string
  senal: string
  detalle: string
  valor: number
}

/**
 * Señales deterministas de riesgo por proveedor.
 *
 * Reglas, no modelos. Un umbral que se puede leer en una línea de código es
 * un umbral que se puede discutir con el proveedor; una puntuación de un
 * modelo, no. Cuando haya volumen suficiente para que un modelo aporte algo,
 * estas reglas serán su línea base.
 */
export async function senalesDeRiesgo(): Promise<SenalRiesgo[]> {
  return sinEmpresa('Membego Supply: señales de riesgo por proveedor', async (tx) => {
    const senales: SenalRiesgo[] = []

    const proveedores = await tx.company.findMany({
      where: { supplyLotes: { some: {} } },
      select: { id: true, name: true },
    })

    for (const p of proveedores) {
      const [redenciones, reversadas, incidencias, incumplimientos] = await Promise.all([
        tx.supplyRedencion.count({ where: { proveedorId: p.id, reversadaAt: null } }),
        tx.supplyRedencion.count({ where: { proveedorId: p.id, reversadaAt: { not: null } } }),
        tx.supplyIncidencia.count({ where: { proveedorId: p.id } }),
        tx.supplyIncidencia.count({
          where: { proveedorId: p.id, tipo: { in: [...INCIDENCIAS_DE_INCUMPLIMIENTO] } },
        }),
      ])

      const base = redenciones + reversadas
      if (base < 10) continue // muestra demasiado pequeña para decir nada

      const tasaReversa = (reversadas / base) * 100
      if (tasaReversa > 5) {
        senales.push({
          proveedorId: p.id,
          proveedorNombre: p.name,
          senal: 'REVERSAS_ALTAS',
          detalle: `${tasaReversa.toFixed(1)}% de las entregas se reversaron.`,
          valor: Number(tasaReversa.toFixed(1)),
        })
      }

      const tasaIncumplimiento = (incumplimientos / base) * 100
      if (tasaIncumplimiento > 3) {
        senales.push({
          proveedorId: p.id,
          proveedorNombre: p.name,
          senal: 'INCUMPLIMIENTO_ALTO',
          detalle: `${tasaIncumplimiento.toFixed(1)}% de las entregas terminaron en incidencia de incumplimiento.`,
          valor: Number(tasaIncumplimiento.toFixed(1)),
        })
      }

      const tasaIncidencias = (incidencias / base) * 100
      if (tasaIncidencias > 10) {
        senales.push({
          proveedorId: p.id,
          proveedorNombre: p.name,
          senal: 'INCIDENCIAS_ALTAS',
          detalle: `${tasaIncidencias.toFixed(1)}% de las entregas generaron alguna incidencia.`,
          valor: Number(tasaIncidencias.toFixed(1)),
        })
      }
    }

    return senales.sort((a, b) => b.valor - a.valor)
  })
}
