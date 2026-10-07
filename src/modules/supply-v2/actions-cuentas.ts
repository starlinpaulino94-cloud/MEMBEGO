'use server'

import type { MetodoPagoTipo } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, texto, type EstadoAccion } from './actions-util'
import { RUTA_FINANZAS } from './core/catalogo'
import { cambiarEstadoCuenta, crearCuentaCobro } from './payment-accounts/cuentas'

/**
 * MEMBEGO SUPPLY · server actions de las cuentas de cobro de la plataforma.
 *
 * Mismo permiso que registrar pagos a proveedores (`SUPPLY_V2_PAYMENT_CREATE`):
 * quien mueve dinero de Membego decide a qué cuenta le pagan los clientes. La
 * bitácora se escribe en la misma transacción que el cambio.
 */

export async function crearCuentaCobroAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const tipo = texto(fd, 'tipo', 20)
    if (tipo !== 'TRANSFERENCIA' && tipo !== 'PRESENCIAL') return { error: 'Tipo de cuenta no válido.' }

    // Nace apagada salvo que se diga lo contrario: dar de alta una cuenta y
    // publicar precios son dos decisiones.
    const activa = String(fd.get('activa') ?? '') === 'on'
    const res = await crearCuentaCobro(
      {
        tipo: tipo as MetodoPagoTipo,
        nombre: texto(fd, 'nombre', 120),
        titular: texto(fd, 'titular', 120) || null,
        numeroCuenta: texto(fd, 'numeroCuenta', 60) || null,
        tipoCuenta: texto(fd, 'tipoCuenta', 40) || null,
        instrucciones: texto(fd, 'instrucciones', 500) || null,
        moneda: texto(fd, 'moneda', 3) || 'DOP',
      },
      activa,
      ctx
    )
    if (!res.ok) return { error: res.mensaje }
    revalidatePath(`${RUTA_FINANZAS}/cuentas-cobro`)
    return {
      success: activa
        ? 'Cuenta dada de alta y activa. Los clientes ya pueden pagarle a Membego.'
        : 'Cuenta dada de alta, apagada. Actívala cuando quieras empezar a cobrar.',
      id: res.id,
    }
  } catch (e) {
    return comoError(e, 'crear-cuenta-cobro')
  }
}

export async function cambiarEstadoCuentaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const cuentaId = texto(fd, 'cuentaId', 60)
    const activa = String(fd.get('activa') ?? '') === 'true'
    const res = await cambiarEstadoCuenta(cuentaId, activa, ctx)
    if (!res.ok) return { error: res.mensaje }
    revalidatePath(`${RUTA_FINANZAS}/cuentas-cobro`)
    if (res.sinCobro) {
      return { success: 'Cuenta desactivada. Era la última activa, así que Membego deja de cobrar y las ofertas de pago dejan de publicarse.' }
    }
    return { success: activa ? 'Cuenta activada.' : 'Cuenta desactivada.' }
  } catch (e) {
    return comoError(e, 'estado-cuenta-cobro')
  }
}
