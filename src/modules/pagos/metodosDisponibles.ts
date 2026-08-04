import { conEmpresa } from '@/lib/tenant'
import type { CompraEstado } from '@prisma/client'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'
import { esEmpresaDemo } from '@/modules/demo'

/**
 * QUÉ MÉTODOS DE PAGO SE OFRECEN, y a quién.
 *
 * LA DISTINCIÓN QUE IMPORTA — y que hace que retirar transferencia sea seguro:
 *
 *   · COMPRAS NUEVAS: se ofrecen solo los métodos encendidos hoy. Apagar
 *     `PAGO_TRANSFERENCIA` deja de ofrecerla de aquí en adelante.
 *   · COMPRAS COMPROMETIDAS: una compra que ya eligió cuenta bancaria o ya subió
 *     su comprobante sigue pudiendo completarse. El cliente sube su comprobante
 *     y el administrador lo valida, exactamente como antes.
 *
 * Si se retirara transferencia de golpe —borrando el método o bloqueando el
 * formulario de comprobante— esas compras quedarían atrapadas: el cliente sin
 * poder pagar y el negocio sin poder cobrar. Por eso se separan los dos casos.
 */

export type MetodoDisponible = 'TRANSFERENCIA' | 'CARDNET'

export interface MetodosDePago {
  /** Métodos ofrecidos para iniciar una compra NUEVA. */
  disponibles: MetodoDisponible[]
  /** Cuentas bancarias activas (solo tiene sentido con TRANSFERENCIA). */
  cuentas: {
    id: string
    nombre: string
    titular: string | null
    numeroCuenta: string | null
    tipoCuenta: string | null
    instrucciones: string | null
  }[]
  /** true = no hay ninguna forma de pagar en línea. Hay que avisarlo fuerte. */
  sinMetodos: boolean
}

/**
 * Métodos para una compra NUEVA.
 *
 * Fail-safe deliberado: si la consulta de capacidades falla, se asume que
 * transferencia sigue disponible. Preferimos ofrecer de más a dejar al negocio
 * sin poder cobrar por un error de lectura.
 */
export async function getMetodosParaCompraNueva(companyId: string): Promise<MetodosDePago> {
  const [transferencia, cardnet, demo] = await Promise.all([
    tieneCapacidad(companyId, 'PAGO_TRANSFERENCIA').catch(() => true),
    tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false),
    esEmpresaDemo(companyId),
  ])

  const disponibles: MetodoDisponible[] = []
  // CardNET primero: si está activo es el camino preferente (cobro inmediato,
  // sin trabajo manual de validación).
  //
  // NUNCA en una empresa de demostración. Es el único punto de todo el sistema
  // donde el dinero de una persona se mueve de verdad, y un cobro hecho en un
  // entrenamiento es un cobro que hay que devolver. La transferencia sí se
  // deja: es manual, alguien tendría que ir al banco a propósito, y practicar
  // el flujo de subir y validar un comprobante es justo lo que se entrena.
  if (cardnet && cardnetTokensConfigurado() && !demo) disponibles.push('CARDNET')
  if (transferencia) disponibles.push('TRANSFERENCIA')

  const cuentas = disponibles.includes('TRANSFERENCIA')
    ? await getCuentasTransferencia(companyId)
    : []

  return {
    disponibles,
    cuentas,
    // Transferencia encendida pero sin ninguna cuenta cargada = tampoco se
    // puede pagar. Cuenta como "sin métodos" para que el aviso salga.
    sinMetodos:
      disponibles.length === 0 ||
      (disponibles.length === 1 && disponibles[0] === 'TRANSFERENCIA' && cuentas.length === 0),
  }
}

/**
 * ¿Se le sigue ofreciendo transferencia a ESTA compra concreta?
 *
 * `yaComprometida` es la pregunta que decide, y su definición importa:
 *   comprometida = el cliente ya eligió una cuenta bancaria, o ya subió su
 *   comprobante.
 *
 * NO vale usar el estado de la compra como criterio ("está esperando pago,
 * luego es antigua"): una compra creada un minuto después de apagar la
 * capacidad también nace esperando pago, así que ese criterio dejaría la
 * transferencia encendida para siempre. El compromiso, en cambio, solo puede
 * haber ocurrido cuando el método todavía se ofrecía.
 *
 * Cuando está comprometida se devuelve `true` sin mirar la capacidad: esa
 * compra tiene derecho a terminar su ciclo. Es la diferencia entre "dejar de
 * ofrecer" y "romper lo que ya estaba en curso".
 */
export async function ofrecerTransferencia(
  companyId: string,
  yaComprometida: boolean
): Promise<boolean> {
  if (yaComprometida) return true
  return tieneCapacidad(companyId, 'PAGO_TRANSFERENCIA').catch(() => true)
}

/** Cuentas bancarias activas de la empresa. */
export async function getCuentasTransferencia(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.metodoPago.findMany({
      where: { companyId, activo: true, tipo: 'TRANSFERENCIA' },
      select: {
        id: true,
        nombre: true,
        titular: true,
        numeroCuenta: true,
        tipoCuenta: true,
        instrucciones: true,
      },
    })
  ).catch(() => [])
}

export interface TransferenciasEnVuelo {
  /** Compras y membresías esperando pago que ya eligieron cuenta o subieron comprobante. */
  comprometidas: number
  /** Esperando pago sin haber elegido método todavía: estas pasarán a CardNET. */
  sinComprometer: number
}

/**
 * Qué pasaría si se apaga transferencia ahora. Lo usa el panel para avisar
 * ANTES de apagarla, no después.
 *
 * `comprometidas` son las que seguirán funcionando por transferencia (hay que
 * terminar de validarlas a mano). `sinComprometer` son las que, al volver el
 * cliente, verán solo los métodos nuevos.
 */
export async function getTransferenciasEnVuelo(
  companyId: string
): Promise<TransferenciasEnVuelo> {
  const ESPERANDO: CompraEstado[] = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION']
  const COMPROMISO = [{ comprobanteUrl: { not: null } }, { metodoPagoId: { not: null } }]

  const [comprasComp, comprasTotal, membComp, membTotal] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.productoCompra
        .count({ where: { companyId, estado: { in: ESPERANDO }, OR: COMPROMISO } })
        .catch(() => 0),
      tx.productoCompra.count({ where: { companyId, estado: { in: ESPERANDO } } }).catch(() => 0),
      tx.membership
        .count({
          where: {
            cliente: { companyId },
            estado: { in: ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'] },
            OR: COMPROMISO,
          },
        })
        .catch(() => 0),
      tx.membership
        .count({
          where: {
            cliente: { companyId },
            estado: { in: ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'] },
          },
        })
        .catch(() => 0),
    ])
  ).catch(() => [0, 0, 0, 0])

  const comprometidas = comprasComp + membComp
  return {
    comprometidas,
    sinComprometer: Math.max(0, comprasTotal + membTotal - comprometidas),
  }
}
