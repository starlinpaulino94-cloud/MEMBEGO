import 'server-only'

import type { MetodoPagoTipo } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'

/**
 * MEMBEGO SUPPLY · cuentas de cobro de la PLATAFORMA (tabla `supply_cuentas_cobro`).
 *
 * Son las cuentas a las que un cliente le paga a Membego (no a una empresa).
 * El Supply original las administraba; al retirarlo quedó solo esto, porque el
 * checkout del Supply vigente las LEE (`paymentAccountGateway`) y sin una
 * activa no hay dónde pagar.
 *
 * ESTE ES EL DATO QUE ENCIENDE LA VENTA: no hay un interruptor aparte. La venta
 * está encendida si —y solo si— existe una cuenta activa. Dos llaves para lo
 * mismo terminan con una en el estado que nadie esperaba.
 */

export interface CuentaAdmin {
  id: string
  tipo: MetodoPagoTipo
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
  moneda: string
  activa: boolean
  /** Cuántos pedidos la señalan. Una cuenta con historia no se borra. */
  pedidos: number
  createdAt: Date
}

/** Todas, activas e inactivas: es la vista de quien las administra. */
export async function cuentasParaAdministrar(): Promise<CuentaAdmin[]> {
  const filas = await sinEmpresa('Supply: administrar cuentas de cobro', (tx) =>
    tx.supplyCuentaCobro.findMany({
      orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      include: { _count: { select: { pedidos: true } } },
    })
  )
  return filas.map((c) => ({
    id: c.id,
    tipo: c.tipo,
    nombre: c.nombre,
    titular: c.titular,
    numeroCuenta: c.numeroCuenta,
    tipoCuenta: c.tipoCuenta,
    instrucciones: c.instrucciones,
    moneda: c.moneda,
    activa: c.activa,
    pedidos: c._count.pedidos,
    createdAt: c.createdAt,
  }))
}

export interface DatosCuenta {
  tipo: MetodoPagoTipo
  nombre: string
  titular?: string | null
  numeroCuenta?: string | null
  tipoCuenta?: string | null
  instrucciones?: string | null
  moneda?: string
}

/**
 * Da de alta una cuenta. Nace ACTIVA solo si quien la da de alta lo dice: el
 * formulario lo pregunta en vez de asumirlo. El número NO va a la bitácora: el
 * registro se lee en pantalla y se exporta, y una cuenta bancaria repetida en
 * cada línea es un dato que se esparce sin que nadie lo decida.
 */
export async function crearCuentaCobro(
  d: DatosCuenta,
  activa: boolean,
  ctx: ContextoAuditoria
): Promise<{ ok: true; id: string } | { ok: false; mensaje: string }> {
  const nombre = d.nombre.trim()
  if (!nombre) return { ok: false, mensaje: 'La cuenta necesita un nombre.' }

  // Una transferencia sin número de cuenta no se puede hacer. Se exige aquí y
  // no solo en el formulario: publicar una cuenta a la que nadie puede
  // transferir enciende la venta y la rompe en el mismo gesto.
  const numero = d.numeroCuenta?.trim() || null
  if (d.tipo === 'TRANSFERENCIA' && !numero) {
    return { ok: false, mensaje: 'Una cuenta de transferencia necesita su número.' }
  }

  const id = await sinEmpresa('Supply: alta de una cuenta de cobro', async (tx) => {
    const creada = await tx.supplyCuentaCobro.create({
      data: {
        tipo: d.tipo,
        nombre,
        titular: d.titular?.trim() || null,
        numeroCuenta: numero,
        tipoCuenta: d.tipoCuenta?.trim() || null,
        instrucciones: d.instrucciones?.trim() || null,
        moneda: (d.moneda || 'DOP').trim().toUpperCase().slice(0, 3),
        activa,
      },
      select: { id: true },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_CUENTA_COBRO_ALTA', 'SupplyCuentaCobro', creada.id, { nombre, activa })
    return creada.id
  })
  return { ok: true, id }
}

/**
 * Enciende o apaga una cuenta. No hay borrado: un pedido guarda a QUÉ cuenta se
 * le pidió transferir, y esa es la respuesta a «¿dónde dije que pagara?» seis
 * meses después. Apagar la última cuenta activa APAGA LA VENTA: se avisa, no se
 * impide (puede ser que la cuenta se cerró en el banco).
 */
export async function cambiarEstadoCuenta(
  cuentaId: string,
  activa: boolean,
  ctx: ContextoAuditoria
): Promise<{ ok: true; sinCobro: boolean } | { ok: false; mensaje: string }> {
  return sinEmpresa('Supply: activar o desactivar una cuenta de cobro', async (tx) => {
    const cuenta = await tx.supplyCuentaCobro.findUnique({ where: { id: cuentaId }, select: { id: true, activa: true } })
    if (!cuenta) return { ok: false as const, mensaje: 'Cuenta no encontrada.' }
    if (cuenta.activa === activa) return { ok: true as const, sinCobro: false }

    await tx.supplyCuentaCobro.update({ where: { id: cuentaId }, data: { activa } })
    await auditarEnTx(tx, ctx, 'SUPPLY_CUENTA_COBRO_ESTADO', 'SupplyCuentaCobro', cuentaId, { activa })
    const quedan = await tx.supplyCuentaCobro.count({ where: { activa: true } })
    return { ok: true as const, sinCobro: quedan === 0 }
  })
}
