import 'server-only'

import { sinEmpresa, type Tx } from '@/lib/tenant'
import { registrarMovimientos } from './movimientos'

/**
 * MEMBEGO SUPPLY · ACCIONES ADMINISTRATIVAS SOBRE UN LOTE (encargo 2026-09 bis, §12).
 *
 * Transferir, ajustar, cancelar unidades y extender el vencimiento. Todas
 * pasan por `registrarMovimientos` (bloqueo del lote, validación contra el
 * saldo, asiento con saldo antes/después) y exigen motivo: son las únicas
 * operaciones que cambian lo comprado sin una orden de por medio, y por eso
 * cada una deja rastro en el ledger Y en la bitácora (la action las audita).
 */

async function loteParaOperar(tx: Tx, loteId: string) {
  const lote = await tx.supplyLote.findUnique({
    where: { id: loteId },
    select: { id: true, codigo: true, estado: true, proveedorId: true, acuerdoId: true, snapshotItemNombre: true, snapshotVariante: true, venceAt: true, disponibles: true },
  })
  if (!lote) throw new Error('Lote no encontrado.')
  return lote
}

function exigirMotivo(motivo: string): string {
  const m = motivo.trim()
  if (m.length < 5) throw new Error('Esta operación exige un motivo (al menos cinco caracteres).')
  return m
}

/** Lotes del mismo proveedor y producto, vivos, a los que se puede transferir. */
export async function lotesCompatibles(loteId: string) {
  return sinEmpresa('Membego Supply: lotes a los que se puede transferir', async (tx) => {
    const lote = await loteParaOperar(tx, loteId)
    return tx.supplyLote.findMany({
      where: {
        id: { not: loteId },
        proveedorId: lote.proveedorId,
        snapshotItemNombre: lote.snapshotItemNombre,
        estado: { in: ['ACTIVO', 'PROGRAMADO', 'AGOTADO'] },
      },
      orderBy: { venceAt: 'asc' },
      select: { id: true, codigo: true, venceAt: true, disponibles: true, compradas: true },
    })
  })
}

/**
 * Mueve unidades DISPONIBLES de un lote a otro del mismo proveedor y producto.
 * Dos asientos TRANSFERENCIA (salida en el origen, entrada en el destino) con
 * la misma referencia: leyendo cualquiera de los dos se llega al otro.
 */
export async function transferirUnidades(
  origenId: string,
  destinoId: string,
  cantidad: number,
  motivo: string,
  actorId?: string | null
): Promise<{ referencia: string }> {
  const m = exigirMotivo(motivo)
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  if (origenId === destinoId) throw new Error('El lote de origen y el de destino son el mismo.')
  return sinEmpresa('Membego Supply: transferir unidades entre lotes', async (tx) => {
    const [origen, destino] = await Promise.all([loteParaOperar(tx, origenId), loteParaOperar(tx, destinoId)])
    if (origen.proveedorId !== destino.proveedorId) throw new Error('Los lotes son de proveedores distintos.')
    if (origen.snapshotItemNombre !== destino.snapshotItemNombre) throw new Error('Los lotes son de productos distintos.')
    if (destino.estado === 'CANCELADO' || destino.estado === 'CERRADO' || destino.estado === 'VENCIDO') {
      throw new Error(`El lote de destino está ${destino.estado.toLowerCase()}.`)
    }
    const referencia = `transfer:${origen.codigo}→${destino.codigo}:${Date.now().toString(36)}`
    // Bloqueo en orden fijo (por id) para que dos transferencias cruzadas no se
    // esperen mutuamente.
    const [primero, segundo] = [origenId, destinoId].sort()
    const plan = (id: string) =>
      id === origenId
        ? [{ tipo: 'TRANSFERENCIA' as const, origen: 'DISPONIBLE' as const, destino: null, cantidad, motivo: m, referencia }]
        : [{ tipo: 'TRANSFERENCIA' as const, origen: null, destino: 'DISPONIBLE' as const, cantidad, motivo: m, referencia }]
    await registrarMovimientos(tx, primero, plan(primero), { actorId })
    await registrarMovimientos(tx, segundo, plan(segundo), { actorId })
    return { referencia }
  })
}

/**
 * Ajuste administrativo: entran o salen unidades DISPONIBLES sin compra ni
 * consumo (un conteo físico, un error de carga). Siempre con motivo; nunca
 * toca unidades ya emitidas o redimidas.
 */
export async function ajustarLote(loteId: string, delta: number, motivo: string, actorId?: string | null): Promise<void> {
  const m = exigirMotivo(motivo)
  if (!Number.isInteger(delta) || delta === 0) throw new Error('El ajuste tiene que ser un entero distinto de cero.')
  await sinEmpresa('Membego Supply: ajuste administrativo de un lote', async (tx) => {
    const lote = await loteParaOperar(tx, loteId)
    if (lote.estado === 'CANCELADO' || lote.estado === 'CERRADO') throw new Error(`El lote está ${lote.estado.toLowerCase()}.`)
    await registrarMovimientos(
      tx,
      loteId,
      [
        delta > 0
          ? { tipo: 'AJUSTE', origen: null, destino: 'DISPONIBLE', cantidad: delta, motivo: m, referencia: 'ajuste-admin' }
          : { tipo: 'AJUSTE', origen: 'DISPONIBLE', destino: null, cantidad: -delta, motivo: m, referencia: 'ajuste-admin' },
      ],
      { actorId }
    )
  })
}

/** Cancela unidades disponibles: pasan a CERRADO y dejan de poder repartirse. */
export async function cancelarUnidades(loteId: string, cantidad: number, motivo: string, actorId?: string | null): Promise<void> {
  const m = exigirMotivo(motivo)
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  await sinEmpresa('Membego Supply: cancelar unidades de un lote', async (tx) => {
    await loteParaOperar(tx, loteId)
    await registrarMovimientos(
      tx,
      loteId,
      [{ tipo: 'CANCELACION', origen: 'DISPONIBLE', destino: 'CERRADO', cantidad, motivo: m, referencia: 'cancelacion-admin' }],
      { actorId }
    )
  })
}

/**
 * Extiende el vencimiento del lote y, con él, el de los derechos y vouchers
 * activos que vencían con el lote. No acorta nunca: para eso está cancelar.
 */
export async function extenderVencimiento(
  loteId: string,
  nuevaFecha: Date,
  motivo: string,
  actorId?: string | null
): Promise<{ antes: Date; despues: Date; derechosExtendidos: number }> {
  const m = exigirMotivo(motivo)
  void actorId
  return sinEmpresa('Membego Supply: extender el vencimiento de un lote', async (tx) => {
    const lote = await loteParaOperar(tx, loteId)
    if (nuevaFecha <= lote.venceAt) throw new Error('La nueva fecha tiene que ser posterior al vencimiento actual.')
    if (lote.estado === 'CANCELADO' || lote.estado === 'CERRADO') throw new Error(`El lote está ${lote.estado.toLowerCase()}.`)
    const acuerdo = await tx.supplyAcuerdo.findUnique({ where: { id: lote.acuerdoId }, select: { finAt: true } })
    if (acuerdo && nuevaFecha > acuerdo.finAt) {
      throw new Error('La nueva fecha supera la vigencia del acuerdo: enmienda primero el acuerdo (Extender la vigencia).')
    }
    await tx.supplyLote.update({
      where: { id: loteId },
      data: { venceAt: nuevaFecha, ...(lote.estado === 'VENCIDO' ? { estado: 'ACTIVO' } : {}), version: { increment: 1 } },
    })
    const derechos = await tx.supplyDerecho.updateMany({
      where: { loteId, estado: 'ACTIVO', vencAt: lote.venceAt },
      data: { vencAt: nuevaFecha },
    })
    await tx.supplyVoucher.updateMany({
      where: { derecho: { loteId }, estado: 'ACTIVO', vigenteHasta: lote.venceAt },
      data: { vigenteHasta: nuevaFecha },
    })
    void m
    return { antes: lote.venceAt, despues: nuevaFecha, derechosExtendidos: derechos.count }
  })
}
