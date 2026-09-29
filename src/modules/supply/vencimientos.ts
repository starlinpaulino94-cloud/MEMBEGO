import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import {
  ACCIONES_POR_POLITICA,
  DEPOSITO_VIVO,
  UMBRALES_VENCIMIENTO,
  nivelRiesgoVencimiento,
  parsearUmbrales,
} from './catalogo'
import { registrarMovimientos } from './movimientos'
import { saldoDisponibleDeposito } from './dinero'

/**
 * Umbrales de aviso VIGENTES. Configurables por entorno (§20 del encargo):
 * `SUPPLY_UMBRALES_VENCIMIENTO="90,60,30,15,7,1"`. Sin variable, el default.
 */
export function umbralesVencimiento(): readonly number[] {
  return parsearUmbrales(process.env.SUPPLY_UMBRALES_VENCIMIENTO)
}

/**
 * MEMBEGO SUPPLY · MOTOR DE VENCIMIENTOS (Fase 39).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE VENCE SIN USARSE YA ESTÁ PAGADO
 *
 * 170 pizzas a diez días de vencer no son «170 pizzas»: son RD$51.000 a punto
 * de evaporarse. Este motor convierte esa cifra en un aviso con nombre, fecha
 * y acciones posibles, y las acciones dependen de lo que se pactó en el
 * contrato: extender solo se propone si la política lo permite.
 *
 * PROPONE, NO APLICA. Extender un contrato, pedir un reembolso o convertir el
 * producto son conversaciones con una empresa. Un cron que las ejecute solo
 * acabaría mandando peticiones que nadie negoció.
 *
 * LO QUE SÍ HACE SOLO es CERRAR lo que ya venció: eso no es una decisión, es
 * reconocer un hecho, y dejarlo abierto haría que el pool prometiera unidades
 * que ningún proveedor está obligado a entregar.
 */

export interface AlertaVencimiento {
  loteId: string
  acuerdoId: string
  codigo: string
  proveedorId: string
  proveedorNombre: string
  item: string
  venceAt: Date
  diasRestantes: number
  nivel: 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO'
  /** Unidades que todavía se pueden repartir (disponibles + asignadas). */
  enRiesgo: number
  /** Emitidas sin canjear: vencen en manos de clientes. */
  expuestas: number
  costoUnitario: number
  /** Dinero que se pierde si nadie las usa. */
  exposicionFinanciera: number
  politicaSobrante: string
  acciones: readonly string[]
}

function diasHasta(fecha: Date, ahora: Date): number {
  return Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000)
}

/**
 * Lotes que vencen dentro de `dias` y todavía tienen unidades vivas.
 *
 * Solo lotes ACTIVOS: uno CANCELADO o ya CERRADO no tiene nada en riesgo, y
 * listarlo llenaría la alerta de ruido que nadie puede accionar.
 */
export async function alertasDeVencimiento(
  dias: number = Math.max(...umbralesVencimiento(), ...UMBRALES_VENCIMIENTO),
  ahora: Date = new Date()
): Promise<AlertaVencimiento[]> {
  const limite = new Date(ahora.getTime() + dias * 86_400_000)

  return sinEmpresa('Membego Supply: supply a punto de vencer en toda la plataforma', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: { estado: 'ACTIVO', venceAt: { lte: limite, gt: ahora } },
      select: {
        id: true,
        codigo: true,
        proveedorId: true,
        venceAt: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        snapshotItemNombre: true,
        snapshotCostoUnitario: true,
        proveedor: { select: { name: true } },
        acuerdoId: true,
        acuerdo: { select: { politicaSobrante: true } },
      },
      orderBy: { venceAt: 'asc' },
    })

    return lotes
      .map((l) => {
        const enRiesgo = l.disponibles + l.asignadas + l.retenidas
        const costoUnitario = Number(l.snapshotCostoUnitario)
        const diasRestantes = diasHasta(l.venceAt, ahora)
        return {
          loteId: l.id,
          acuerdoId: l.acuerdoId,
          codigo: l.codigo,
          proveedorId: l.proveedorId,
          proveedorNombre: l.proveedor.name,
          item: l.snapshotItemNombre,
          venceAt: l.venceAt,
          diasRestantes,
          nivel: nivelRiesgoVencimiento(diasRestantes),
          enRiesgo,
          expuestas: l.emitidas,
          costoUnitario,
          // La exposición incluye lo emitido sin canjear: esas unidades también
          // vencen, y su costo también se pierde si el cliente no aparece.
          exposicionFinanciera: Number(((enRiesgo + l.emitidas) * costoUnitario).toFixed(2)),
          politicaSobrante: l.acuerdo.politicaSobrante,
          acciones: ACCIONES_POR_POLITICA[l.acuerdo.politicaSobrante],
        }
      })
      .filter((a) => a.enRiesgo + a.expuestas > 0)
      // Por RIESGO, no por fecha: 500 unidades que vencen en diez días importan
      // más que 2 que vencen mañana, y ordenar por calendario las esconde.
      .sort((a, b) => b.exposicionFinanciera - a.exposicionFinanciera)
  })
}

export interface ResultadoCierre {
  lotesCerrados: number
  unidadesCerradas: number
  derechosVencidos: number
  vouchersVencidos: number
}

/**
 * Cierra lo que ya venció. Se llama desde el cron.
 *
 * El orden importa: primero los derechos y vouchers de los clientes, después
 * las unidades sueltas del lote. Al revés, las unidades emitidas se cerrarían
 * dos veces —una por el barrido del lote y otra por el del derecho— y el
 * invariante se rompería.
 */
export async function cerrarVencidos(ahora: Date = new Date(), limite = 500): Promise<ResultadoCierre> {
  return sinEmpresa('Membego Supply: cierre de supply vencido', async (tx) => {
    const res: ResultadoCierre = {
      lotesCerrados: 0,
      unidadesCerradas: 0,
      derechosVencidos: 0,
      vouchersVencidos: 0,
    }

    // 1 · Derechos de clientes cuya fecha pasó.
    const derechos = await tx.supplyDerecho.findMany({
      where: { estado: 'ACTIVO', vencAt: { lte: ahora } },
      select: { id: true, loteId: true, asignacionId: true },
      take: limite,
    })
    for (const d of derechos) {
      await registrarMovimientos(tx, d.loteId, [
        {
          tipo: 'EXPIRACION',
          origen: 'EMITIDO',
          destino: 'CERRADO',
          cantidad: 1,
          derechoId: d.id,
          asignacionId: d.asignacionId,
          motivo: 'El beneficio venció sin utilizarse.',
        },
      ])
      await tx.supplyDerecho.update({
        where: { id: d.id },
        data: { estado: 'VENCIDO', cerradoAt: ahora, cerradoMotivo: 'Vencimiento.' },
      })
      res.derechosVencidos += 1
      res.unidadesCerradas += 1
    }

    const vouchers = await tx.supplyVoucher.updateMany({
      where: { estado: 'ACTIVO', vigenteHasta: { lte: ahora } },
      data: { estado: 'VENCIDO', cerradoAt: ahora, cerradoMotivo: 'Vencimiento.' },
    })
    res.vouchersVencidos = vouchers.count

    // 2 · Unidades del lote que nunca llegaron a nadie.
    const lotes = await tx.supplyLote.findMany({
      where: { estado: { in: ['ACTIVO', 'AGOTADO'] }, venceAt: { lte: ahora } },
      select: { id: true, disponibles: true, asignadas: true, retenidas: true },
      take: limite,
    })
    for (const l of lotes) {
      const entradas = (
        [
          ['DISPONIBLE', l.disponibles],
          ['ASIGNADO', l.asignadas],
          ['RETENIDO', l.retenidas],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([cubeta, n]) => ({
          tipo: 'EXPIRACION' as const,
          origen: cubeta,
          destino: 'CERRADO' as const,
          cantidad: n,
          motivo: 'El lote venció con unidades sin repartir.',
        }))

      if (entradas.length > 0) {
        await registrarMovimientos(tx, l.id, entradas)
        res.unidadesCerradas += entradas.reduce((t, e) => t + e.cantidad, 0)
      }
      await tx.supplyLote.update({ where: { id: l.id }, data: { estado: 'VENCIDO' } })
      res.lotesCerrados += 1
    }

    // 3 · Contratos cuya vigencia terminó.
    await tx.supplyAcuerdo.updateMany({
      where: { estado: 'ACTIVO', finAt: { lte: ahora } },
      data: { estado: 'VENCIDO' },
    })

    return res
  })
}

/**
 * Umbral de aviso que le toca hoy a un lote, o null si no toca ninguno.
 *
 * Existe para que las notificaciones no se repitan cada día: se avisa EN los
 * umbrales (30, 14, 7, 3, 1), no todos los días entre medias. Un aviso diario
 * durante un mes deja de leerse a la semana.
 */
export function umbralDelDia(diasRestantes: number, umbrales: readonly number[] = umbralesVencimiento()): number | null {
  return umbrales.find((u) => u === diasRestantes) ?? null
}

// ── Lo demás que vence (§20): derechos, depósitos, acuerdos ─────────────────

export interface VencimientoGenerico {
  tipo: 'DERECHO' | 'DEPOSITO' | 'ACUERDO'
  id: string
  codigo: string
  proveedorId: string
  proveedorNombre: string
  descripcion: string
  venceAt: Date
  diasRestantes: number
  nivel: 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO'
  /** Unidades (derechos) o dinero (depósitos, acuerdos) en juego. */
  unidades: number
  monto: number
}

/**
 * Derechos activos, depósitos con saldo y acuerdos activos que terminan
 * dentro de `dias`. Un derecho vence en manos del cliente; un depósito con
 * saldo llega a su fecha prevista de cierre con dinero parado; un acuerdo que
 * termina deja de poder vender o comprar.
 */
export async function vencimientosProximos(dias = 90, ahora: Date = new Date()): Promise<VencimientoGenerico[]> {
  const limite = new Date(ahora.getTime() + dias * 86_400_000)
  return sinEmpresa('Membego Supply: derechos, depósitos y acuerdos a punto de vencer', async (tx) => {
    const [derechos, depositos, acuerdos] = await Promise.all([
      tx.supplyDerecho.groupBy({
        by: ['proveedorId', 'loteId', 'vencAt'],
        where: { estado: 'ACTIVO', vencAt: { lte: limite, gt: ahora } },
        _count: { _all: true },
        _sum: { costoUnitario: true },
      }),
      tx.supplyDeposito.findMany({
        where: { estado: { in: [...DEPOSITO_VIVO] }, cierraAt: { lte: limite, gt: ahora } },
        select: { id: true, codigo: true, proveedorId: true, cierraAt: true, montoOriginal: true, montoAplicado: true, montoDevuelto: true, proveedor: { select: { name: true } } },
      }),
      tx.supplyAcuerdo.findMany({
        where: { estado: { in: ['ACTIVO', 'SUSPENDIDO'] }, finAt: { lte: limite, gt: ahora } },
        select: { id: true, codigo: true, proveedorId: true, finAt: true, itemNombre: true, cantidad: true, costoUnitario: true, modeloComercial: true, proveedor: { select: { name: true } } },
      }),
    ])
    const lotes = derechos.length
      ? await tx.supplyLote.findMany({
          where: { id: { in: [...new Set(derechos.map((d) => d.loteId))] } },
          select: { id: true, codigo: true, snapshotItemNombre: true, proveedor: { select: { name: true } } },
        })
      : []
    const porLote = new Map(lotes.map((l) => [l.id, l]))
    const out: VencimientoGenerico[] = []
    for (const d of derechos) {
      const lote = porLote.get(d.loteId)
      const diasRestantes = diasHasta(d.vencAt, ahora)
      out.push({
        tipo: 'DERECHO', id: `${d.loteId}:${d.vencAt.toISOString()}`, codigo: lote?.codigo ?? d.loteId,
        proveedorId: d.proveedorId, proveedorNombre: lote?.proveedor.name ?? '—',
        descripcion: `${d._count._all} derecho(s) de ${lote?.snapshotItemNombre ?? 'supply'} en manos de clientes`,
        venceAt: d.vencAt, diasRestantes, nivel: nivelRiesgoVencimiento(diasRestantes),
        unidades: d._count._all, monto: Number(d._sum.costoUnitario ?? 0),
      })
    }
    for (const dep of depositos) {
      const disponible = saldoDisponibleDeposito({ montoOriginal: Number(dep.montoOriginal), montoAplicado: Number(dep.montoAplicado), montoDevuelto: Number(dep.montoDevuelto) })
      if (disponible <= 0 || !dep.cierraAt) continue
      const diasRestantes = diasHasta(dep.cierraAt, ahora)
      out.push({
        tipo: 'DEPOSITO', id: dep.id, codigo: dep.codigo, proveedorId: dep.proveedorId, proveedorNombre: dep.proveedor.name,
        descripcion: 'Depósito con saldo que llega a su fecha de cierre',
        venceAt: dep.cierraAt, diasRestantes, nivel: nivelRiesgoVencimiento(diasRestantes), unidades: 0, monto: disponible,
      })
    }
    for (const a of acuerdos) {
      const diasRestantes = diasHasta(a.finAt, ahora)
      out.push({
        tipo: 'ACUERDO', id: a.id, codigo: a.codigo, proveedorId: a.proveedorId, proveedorNombre: a.proveedor.name,
        descripcion: `Acuerdo de ${a.itemNombre} termina su vigencia`,
        venceAt: a.finAt, diasRestantes, nivel: nivelRiesgoVencimiento(diasRestantes),
        unidades: a.cantidad, monto: a.modeloComercial === 'COMISION' ? 0 : Number((a.cantidad * Number(a.costoUnitario)).toFixed(2)),
      })
    }
    return out.sort((x, y) => x.diasRestantes - y.diasRestantes || y.monto - x.monto)
  })
}
