import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import {
  ACCIONES_POR_POLITICA,
  UMBRALES_VENCIMIENTO,
  nivelRiesgoVencimiento,
} from './catalogo'
import { registrarMovimientos } from './movimientos'

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
  dias: number = Math.max(...UMBRALES_VENCIMIENTO),
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
export function umbralDelDia(diasRestantes: number): number | null {
  return UMBRALES_VENCIMIENTO.find((u) => u === diasRestantes) ?? null
}
