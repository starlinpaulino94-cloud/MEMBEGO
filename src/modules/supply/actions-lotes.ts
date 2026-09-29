'use server'

import { revalidatePath } from 'next/cache'
import { exigirPlataforma } from './permisos'
import { auditar, comoError, fechaFinDeDia, numero, refrescarPlataforma, texto, type EstadoAccion } from './actions-util'
import { ajustarLote, cancelarUnidades, extenderVencimiento, transferirUnidades } from './lotes-operaciones'
import { aplicarDepositoAOrden } from './depositos'
import { adjuntarComprobantePago } from './finanzas'
import { rutaValida } from '@/modules/storage/comprobantes'

/**
 * MEMBEGO SUPPLY · server actions de operación sobre lotes y pagos de órdenes
 * (encargo 2026-09 bis, §7 y §12). Mismo contrato: guardia → dominio → bitácora.
 */

export type { EstadoAccion }

function refrescarLote(loteId: string): void {
  refrescarPlataforma('lotes')
  refrescarPlataforma(`lotes/${loteId}`)
  refrescarPlataforma('vencimientos')
}

export async function transferirUnidadesAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const origenId = texto(fd, 'loteId', 60)
    const destinoId = texto(fd, 'destinoLoteId', 60)
    const cantidad = numero(fd, 'cantidad') ?? 0
    const motivo = texto(fd, 'motivo', 500)
    if (!origenId || !destinoId) return { error: 'Elige el lote de destino.' }
    const r = await transferirUnidades(origenId, destinoId, cantidad, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_LOTE_TRANSFERENCIA', 'SupplyLote', origenId, { destinoLoteId: destinoId, cantidad, motivo, referencia: r.referencia })
    refrescarLote(origenId)
    refrescarLote(destinoId)
    return { success: `${cantidad} unidad(es) transferidas.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function ajustarLoteAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const loteId = texto(fd, 'loteId', 60)
    const delta = numero(fd, 'delta') ?? 0
    const motivo = texto(fd, 'motivo', 500)
    await ajustarLote(loteId, delta, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_LOTE_AJUSTE', 'SupplyLote', loteId, { delta, motivo })
    refrescarLote(loteId)
    return { success: `Ajuste de ${delta > 0 ? '+' : ''}${delta} unidad(es) registrado.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function cancelarUnidadesAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const loteId = texto(fd, 'loteId', 60)
    const cantidad = numero(fd, 'cantidad') ?? 0
    const motivo = texto(fd, 'motivo', 500)
    await cancelarUnidades(loteId, cantidad, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_LOTE_CANCELACION', 'SupplyLote', loteId, { cantidad, motivo })
    refrescarLote(loteId)
    return { success: `${cantidad} unidad(es) canceladas.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function extenderVencimientoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const loteId = texto(fd, 'loteId', 60)
    const nuevaFecha = fechaFinDeDia(fd, 'nuevaFecha')
    const motivo = texto(fd, 'motivo', 500)
    if (!nuevaFecha) return { error: 'Falta la nueva fecha.' }
    const r = await extenderVencimiento(loteId, nuevaFecha, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_LOTE_VENCIMIENTO_EXTENDIDO', 'SupplyLote', loteId, { antes: r.antes.toISOString(), despues: r.despues.toISOString(), motivo, derechosExtendidos: r.derechosExtendidos })
    refrescarLote(loteId)
    revalidatePath('/cliente/beneficios')
    return { success: `Vencimiento extendido; ${r.derechosExtendidos} derecho(s) de clientes también.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function aplicarDepositoAOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const depositoId = texto(fd, 'depositoId', 60)
    const ordenId = texto(fd, 'ordenId', 60)
    const monto = numero(fd, 'monto')
    if (!depositoId || !ordenId || monto == null) return { error: 'Faltan datos.' }
    const r = await aplicarDepositoAOrden(depositoId, ordenId, monto, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_DEPOSITO_APLICADO', 'SupplyDeposito', depositoId, { ordenId, monto: r.montoAplicado, saldoAntes: r.saldoAntes, saldoDespues: r.saldoDespues })
    refrescarPlataforma('ordenes')
    refrescarPlataforma(`ordenes/${ordenId}`)
    refrescarPlataforma('finanzas/depositos')
    refrescarPlataforma(`finanzas/depositos/${depositoId}`)
    return { success: `Pagado con el depósito. Saldo restante: ${r.saldoDespues.toFixed(2)}.` }
  } catch (e) {
    return comoError(e)
  }
}

/** Guarda la ruta del comprobante que el navegador ya subió al bucket privado. */
export async function adjuntarComprobantePagoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const pagoId = texto(fd, 'pagoId', 60)
    const ruta = texto(fd, 'comprobantePath', 500)
    if (!pagoId || !ruta) return { error: 'Sube primero el archivo.' }
    if (!(await rutaValida('pago', pagoId, ruta))) return { error: 'La ruta del comprobante no corresponde a este pago.' }
    await adjuntarComprobantePago(pagoId, ruta)
    refrescarPlataforma('finanzas/pagos')
    refrescarPlataforma('ordenes')
    return { success: 'Comprobante adjuntado.' }
  } catch (e) {
    return comoError(e)
  }
}
