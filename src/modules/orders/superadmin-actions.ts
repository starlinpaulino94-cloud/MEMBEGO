'use server'

/**
 * COMMERCE CORE · pedidos — acciones del SUPERADMIN (sprint de cierre, 2026-10-08).
 *
 * Verificar un pago contra el extracto bancario. Es la única forma HUMANA de llevar un
 * pedido a `PAYMENT_VERIFIED` (la otra es una fuente externa automática: la pasarela o
 * el proveedor, por el sistema). La empresa no puede: lo que ella registra es su palabra
 * (`EXTERNAL_PAYMENT_REPORTED`). Si el pedido ya cobró su comisión como CPA (modelo
 * HYBRID), Merchant Billing asienta la diferencia hasta el porcentaje en la misma
 * transacción.
 *
 * Devuelve un resultado, no lanza: el mensaje de un `PedidoError`/`FacturacionError` se
 * enseña tal cual; lo demás se traduce a uno genérico.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { FacturacionError } from '@/modules/billing/errores'
import { PedidoError } from './errores'
import { verificarPagoExternamenteEnTx, type ContextoPedido } from './service'

export type ResultadoVerificacionBancaria = { ok: true; nivel: string; comision: string | null; repetido: boolean } | { ok: false; error: string }

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Marca el pago de un pedido como VERIFICADO contra la conciliación bancaria. `referenciaBancaria`
 * es la línea del extracto (clave de idempotencia: la misma línea no verifica dos veces);
 * `referenciaDelPago` es lo que ve la empresa (número de transferencia), opcional.
 */
export async function verificarPagoBancario(entrada: {
  companyId: string
  codigoPedido: string
  referenciaBancaria: string
  monto: number | string
  metodo: 'TRANSFER' | 'CARD'
  referenciaDelPago?: string | null
}): Promise<ResultadoVerificacionBancaria> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return { ok: false, error: 'Solo el superadmin verifica pagos contra el banco.' }
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'Datos no válidos.' }
  const companyId = texto(entrada.companyId)
  const codigo = texto(entrada.codigoPedido)
  const metodo = entrada.metodo === 'CARD' ? 'CARD' : entrada.metodo === 'TRANSFER' ? 'TRANSFER' : null
  if (!companyId || !codigo) return { ok: false, error: 'Indica la empresa y el código del pedido.' }
  if (!metodo) return { ok: false, error: 'Indica si el pago fue por transferencia o tarjeta.' }
  const meta = await getRequestMeta()
  const ctx: ContextoPedido & { superadmin: true } = { actor: 'EMPRESA', actorId: user.metadata.dbUserId ?? null, superadmin: true, ...meta }
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const pedido = await tx.membegoOrder.findFirst({ where: { companyId, code: codigo }, select: { id: true } })
      if (!pedido) throw new PedidoError('NO_EXISTE', `No hay ningún pedido ${codigo} en esta empresa.`)
      return verificarPagoExternamenteEnTx(
        tx,
        companyId,
        pedido.id,
        { source: 'BANK_RECONCILED', verificationRef: texto(entrada.referenciaBancaria), method: metodo, amount: entrada.monto, reference: texto(entrada.referenciaDelPago) || null },
        ctx
      )
    })
    revalidatePath('/superadmin/facturacion')
    revalidatePath(`/superadmin/facturacion/${companyId}`)
    revalidatePath('/admin/pedidos-membego')
    revalidatePath('/admin/facturacion-membego')
    return { ok: true, nivel: r.nivel, comision: r.comision, repetido: r.repetido }
  } catch (e) {
    if (e instanceof PedidoError || e instanceof FacturacionError) return { ok: false, error: e.message }
    console.error('[pedidos:verificar-pago]', e instanceof Error ? e.message : e)
    return { ok: false, error: 'No se pudo verificar el pago. Intenta de nuevo.' }
  }
}
