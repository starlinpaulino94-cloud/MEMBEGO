import 'server-only'

import type { SupplyIncidenciaEstado, SupplyIncidenciaTipo } from '@prisma/client'
import { conEmpresaOTodas, sinEmpresa } from '@/lib/tenant'
import { TRANSICIONES_INCIDENCIA, exigirTransicion } from './estados'

/**
 * MEMBEGO SUPPLY · INCIDENCIAS Y DISPUTAS (Fases 29, 30).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TENER 1.000 VOUCHERS NO ES CUMPLIR UN CONTRATO
 *
 * «La pizza que dan con Membego es más pequeña.» «No quisieron atendernos.»
 * «Me cobraron igual.» Sin un sitio donde eso se registre ligado al LOTE, la
 * única fuente sobre cómo va un proveedor es que alguien se acuerde de
 * contarlo, y la decisión de volver a comprarle 5.000 unidades se toma a
 * ciegas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA OPERACIÓN ORIGINAL NO SE BORRA
 *
 * Resolver una disputa a favor del cliente NO elimina la redención. Cambia el
 * estado de la incidencia y, si procede, se compensa con un derecho nuevo o un
 * ajuste financiero. Borrar la entrega dejaría el ledger descuadrado y al
 * proveedor sin forma de defenderse.
 */

export interface DatosIncidencia {
  tipo: SupplyIncidenciaTipo
  detalle: string
  /** Lo que se sepa. Cuanto más, mejor conciliación después. */
  voucherId?: string | null
  derechoId?: string | null
  redencionId?: string | null
  clienteId?: string | null
  sucursalId?: string | null
  reportadoPorId?: string | null
}

/**
 * Abre una incidencia.
 *
 * Se resuelve el contexto (lote, acuerdo, proveedor, campaña) a partir de lo
 * que venga: con solo el voucher se llega a todo lo demás. Guardarlo
 * denormalizado aquí es lo que permite después preguntar «¿cuántas incidencias
 * tuvo el lote MBG-LITRE-001?» sin cuatro joins, y que la respuesta siga
 * existiendo si el voucher se archiva.
 */
export async function abrirIncidencia(d: DatosIncidencia): Promise<{ id: string }> {
  const res = await abrirIncidenciaEnTx(d)
  const { avisarIncidencia } = await import('./notificar')
  await avisarIncidencia(res.id)
  return res
}

async function abrirIncidenciaEnTx(d: DatosIncidencia): Promise<{ id: string }> {
  if (!d.detalle.trim()) throw new Error('Una incidencia necesita una descripción.')
  if (!d.voucherId && !d.derechoId && !d.redencionId) {
    throw new Error('Una incidencia tiene que apuntar a un beneficio concreto.')
  }

  return sinEmpresa('Membego Supply: incidencia de cumplimiento', async (tx) => {
    let derechoId = d.derechoId ?? null
    let voucherId = d.voucherId ?? null

    if (!derechoId && voucherId) {
      const v = await tx.supplyVoucher.findUnique({
        where: { id: voucherId },
        select: { derechoId: true },
      })
      derechoId = v?.derechoId ?? null
    }
    if (!derechoId && d.redencionId) {
      const r = await tx.supplyRedencion.findUnique({
        where: { id: d.redencionId },
        select: { derechoId: true, voucherId: true },
      })
      derechoId = r?.derechoId ?? null
      voucherId = voucherId ?? r?.voucherId ?? null
    }
    if (!derechoId) throw new Error('No se pudo identificar el beneficio de esta incidencia.')

    const derecho = await tx.supplyDerecho.findUniqueOrThrow({
      where: { id: derechoId },
      select: {
        clienteId: true,
        proveedorId: true,
        loteId: true,
        lote: { select: { acuerdoId: true } },
        asignacion: { select: { destinoTipo: true, destinoId: true } },
      },
    })

    const incidencia = await tx.supplyIncidencia.create({
      data: {
        proveedorId: derecho.proveedorId,
        clienteId: d.clienteId ?? derecho.clienteId,
        redencionId: d.redencionId ?? null,
        voucherId,
        derechoId,
        loteId: derecho.loteId,
        acuerdoId: derecho.lote.acuerdoId,
        sucursalId: d.sucursalId ?? null,
        destinoTipo: derecho.asignacion?.destinoTipo ?? null,
        destinoId: derecho.asignacion?.destinoId ?? null,
        tipo: d.tipo,
        estado: 'ABIERTA',
        detalle: d.detalle.trim(),
        reportadoPorId: d.reportadoPorId ?? null,
      },
      select: { id: true },
    })
    return incidencia
  })
}

/** Mueve una incidencia por su flujo de disputa. */
export async function moverIncidencia(
  incidenciaId: string,
  hasta: SupplyIncidenciaEstado,
  resolucion?: string | null,
  actorId?: string | null
): Promise<void> {
  await sinEmpresa('Membego Supply: resolución de una disputa', async (tx) => {
    const inc = await tx.supplyIncidencia.findUnique({
      where: { id: incidenciaId },
      select: { estado: true },
    })
    if (!inc) throw new Error('Incidencia no encontrada.')
    exigirTransicion(TRANSICIONES_INCIDENCIA, inc.estado, hasta, 'Incidencia de supply')

    const resuelve = hasta.startsWith('RESUELTA_')
    if (resuelve && !(resolucion ?? '').trim()) {
      throw new Error('Resolver una disputa exige decir cómo se resolvió.')
    }

    await tx.supplyIncidencia.update({
      where: { id: incidenciaId },
      data: {
        estado: hasta,
        ...(resolucion ? { resolucion: resolucion.trim() } : {}),
        ...(resuelve ? { resueltoPorId: actorId ?? null, resueltoAt: new Date() } : {}),
      },
    })
  })
}

export interface ResumenIncidencias {
  abiertas: number
  enRevision: number
  resueltas: number
  total: number
  porTipo: { tipo: SupplyIncidenciaTipo; total: number }[]
}

/** Resumen para el portal del proveedor y el panel de plataforma. */
export async function resumenIncidencias(proveedorId?: string): Promise<ResumenIncidencias> {
  // Con proveedor es la lectura de UNA empresa (su portal); sin él, la vista
  // de plataforma que cruza inquilinos a propósito.
  return conEmpresaOTodas(
    proveedorId,
    'Membego Supply: resumen de incidencias de toda la plataforma',
    async (tx) => {
      const where = proveedorId ? { proveedorId } : {}
      const [porEstado, porTipo] = await Promise.all([
        tx.supplyIncidencia.groupBy({ by: ['estado'], where, _count: { _all: true } }),
        tx.supplyIncidencia.groupBy({ by: ['tipo'], where, _count: { _all: true } }),
      ])
      const cuenta = (e: SupplyIncidenciaEstado) =>
        porEstado.find((g) => g.estado === e)?._count._all ?? 0

      return {
        abiertas: cuenta('ABIERTA'),
        enRevision: cuenta('EN_REVISION'),
        resueltas:
          cuenta('RESUELTA_CLIENTE') + cuenta('RESUELTA_COMERCIO') + cuenta('RESUELTA_MEMBEGO'),
        total: porEstado.reduce((t, g) => t + g._count._all, 0),
        porTipo: porTipo.map((g) => ({ tipo: g.tipo, total: g._count._all })),
      }
    }
  )
}
