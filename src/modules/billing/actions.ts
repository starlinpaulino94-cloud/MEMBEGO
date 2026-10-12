'use server'

/**
 * COMMERCE CORE · Merchant Billing — acciones del superadmin (Fase 4).
 *
 * SOLO el superadmin: asentar un pago, un ajuste o un crédito en la cuenta de una
 * empresa, cambiar cómo se le cobra y suspenderla o liberarla mueve dinero y cruza
 * empresas. La empresa solo LEE su cuenta (`/admin/facturacion-membego`). La empresa
 * de cada operación sale del argumento (el superadmin elige a cuál), pero se
 * comprueba que exista, y todo corre en `conEmpresa` sobre ESA empresa.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `FacturacionError` se enseña
 * tal cual; lo demás se traduce a uno genérico para no filtrar detalles de la base.
 */

import { revalidatePath } from 'next/cache'
import type { MerchantBillingCycle, MerchantFeeModel } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { registrarOperacion } from '@/modules/observabilidad/eventos'
import { barridoFacturacion, type ResultadoBarridoFacturacion } from './barrido'
import { FacturacionError } from './errores'
import { TIPOS_MANUALES, type TipoManual } from './domain'
import { actualizarConfigEnTx, asentarManualEnTx, fijarEstadoManualEnTx, generarCortesPendientesEnTx, type ContextoFacturacion } from './service'

export type ResultadoFacturacion<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/superadmin/facturacion'

async function superadmin(): Promise<{ ctx: ContextoFacturacion } | { error: string }> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return { error: 'Solo el superadmin puede administrar la facturación a empresas.' }
  const meta = await getRequestMeta()
  return { ctx: { actor: 'SUPERADMIN', actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof FacturacionError) return { ok: false, error: e.message }
  console.error('[billing]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function refrescar(companyId: string) {
  revalidatePath(RUTA)
  revalidatePath(`${RUTA}/${companyId}`)
  revalidatePath('/admin/facturacion-membego')
}

/** Asienta un pago, un ajuste o un crédito. `idempotencyKey` la genera el formulario: reenviar no duplica. */
export async function asentarMovimiento(entrada: {
  companyId: string
  tipo: string
  monto: number | string
  motivo?: string | null
  referencia?: string | null
  idempotencyKey: string
}): Promise<ResultadoFacturacion<{ balance: string; status: string; repetido: boolean }>> {
  const c = await superadmin()
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const tipo = TIPOS_MANUALES.find((t) => t === entrada.tipo) as TipoManual | undefined
  if (!tipo) return { ok: false, error: 'Elige un tipo de movimiento válido.' }
  const companyId = texto(entrada.companyId)
  try {
    const r = await conEmpresa(companyId, (tx) =>
      asentarManualEnTx(tx, companyId, { tipo, monto: entrada.monto, motivo: entrada.motivo ?? null, referencia: entrada.referencia ?? null, idempotencyKey: texto(entrada.idempotencyKey) }, c.ctx)
    )
    registrarOperacion({ dominio: 'facturacion', accion: r.repetido ? 'movimiento_repetido' : `movimiento_${tipo.toLowerCase()}`, companyId })
    refrescar(companyId)
    return { ok: true, balance: r.balance, status: r.status, repetido: r.repetido }
  } catch (e) {
    registrarOperacion({ dominio: 'facturacion', accion: 'movimiento_manual', companyId, error: e })
    return aError(e)
  }
}

/** Cambia cómo se le cobra a la empresa (rige hacia adelante). */
export async function guardarConfigDeCobro(entrada: {
  companyId: string
  feeModel: string
  cpaAmount: number | string
  percentageRate: number | string
  creditLimit: number | string
  billingCycle: string
}): Promise<ResultadoFacturacion<{ cambio: boolean }>> {
  const c = await superadmin()
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const companyId = texto(entrada.companyId)
  try {
    const r = await conEmpresa(companyId, (tx) =>
      actualizarConfigEnTx(
        tx,
        companyId,
        {
          feeModel: texto(entrada.feeModel) as MerchantFeeModel,
          cpaAmount: entrada.cpaAmount,
          percentageRate: entrada.percentageRate,
          creditLimit: entrada.creditLimit,
          billingCycle: texto(entrada.billingCycle) as MerchantBillingCycle,
        },
        c.ctx
      )
    )
    refrescar(companyId)
    return { ok: true, cambio: !r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Suspende la cuenta a mano (queda así hasta que se libere) o devuelve el control al sistema. */
export async function cambiarEstadoDeCuenta(entrada: { companyId: string; accion: string; motivo: string }): Promise<ResultadoFacturacion<{ status: string }>> {
  const c = await superadmin()
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (entrada.accion !== 'SUSPENDER' && entrada.accion !== 'LIBERAR') return { ok: false, error: 'Acción no válida.' }
  const accion = entrada.accion
  const companyId = texto(entrada.companyId)
  try {
    const r = await conEmpresa(companyId, (tx) => fijarEstadoManualEnTx(tx, companyId, { accion, motivo: texto(entrada.motivo) }, c.ctx))
    refrescar(companyId)
    return { ok: true, status: r.status }
  } catch (e) {
    return aError(e)
  }
}

/** Emite los estados de cuenta que faltan de una empresa. */
export async function emitirCortesDeEmpresa(companyId: string): Promise<ResultadoFacturacion<{ generados: number }>> {
  const c = await superadmin()
  if ('error' in c) return { ok: false, error: c.error }
  const id = texto(companyId)
  try {
    const r = await conEmpresa(id, (tx) => generarCortesPendientesEnTx(tx, id))
    refrescar(id)
    return { ok: true, generados: r.generados }
  } catch (e) {
    return aError(e)
  }
}

/** «Revisar ahora»: el mismo barrido que hace el cron (comisiones que faltan, gracias vencidas, cortes). */
export async function revisarFacturacionAhora(): Promise<ResultadoFacturacion<{ resultado: ResultadoBarridoFacturacion }>> {
  const c = await superadmin()
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const resultado = await barridoFacturacion()
    revalidatePath(RUTA)
    revalidatePath('/admin/facturacion-membego')
    return { ok: true, resultado }
  } catch (e) {
    return aError(e)
  }
}
