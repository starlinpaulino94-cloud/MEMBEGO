import { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions/application/transaction-service'
import { anotarFallo } from '@/lib/prisma-errors'
import { esCanalDeCobro, snapshotDeCobroConTarjeta, type CanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'

/**
 * LA VENTA DE UN COBRO CON TARJETA — el comprobante nace aquí.
 *
 * Un cobro aprobado en pasarela (app, web, renovación automática) activa la membresía o la compra, pero el
 * dinero también tiene que quedar en el LIBRO de ventas (`transactions`): con ticket, factura imprimible,
 * método «Tarjeta» y trazabilidad al intento (`pagoIntentoId`). Antes ese paso no existía y la conciliación
 * lo marcaba como «cobro sin transacción».
 *
 * TRES GARANTÍAS
 *
 *  1. IDEMPOTENTE. `transactions.pagoIntentoId` es único: aunque el webhook, el retorno del navegador y un
 *     reintento lleguen a la vez, el cobro deja UNA venta y UN número de ticket.
 *  2. AUTORREPARABLE. Se llama después de cada cumplimiento y también cuando una repetición encuentra el
 *     cobro ya entregado: una venta que faltó (la base se cayó justo ahí) se escribe en la siguiente pasada,
 *     y la conciliación (fase 4) ofrece hacerlo a mano.
 *  3. NUNCA DETIENE LA ENTREGA. El cliente ya pagó: un fallo de facturación no puede dejarlo sin su
 *     membresía. Por eso se registra DESPUÉS de entregar y no lanza (el error queda en el log del servidor),
 *     la misma regla de `registrarVentaConfirmada` del panel.
 *
 * Solo se factura un cobro APROBADO cuya entrega se COMPLETÓ: la venta dice «se vendió y se entregó».
 */

export interface VentaDelIntento {
  id: string
  codigo: string
  ticketNumero: string
  /** `true` si esta llamada la creó; `false` si ya existía (la idempotencia funcionando). */
  nueva: boolean
}

export async function asegurarVentaDelIntento(intentoId: string): Promise<VentaDelIntento | null> {
  try {
    const intento = await sinEmpresa(
      'pagos: localizar el intento aprobado para registrar su venta (la empresa sale del propio intento)',
      (tx) =>
        tx.pagoIntento.findUnique({
          where: { id: intentoId },
          include: {
            transaccion: { select: { id: true, codigo: true, ticketNumero: true } },
            cliente: { select: { nombre: true } },
            membership: {
              select: {
                id: true,
                fechaInicio: true,
                plan: { select: { nombre: true } },
                sucursalPago: { select: { id: true, nombre: true } },
                tarjetaTokenizada: { select: { marca: true, ultimos4: true } },
              },
            },
            compra: {
              select: { promocion: { select: { titulo: true } }, sucursalPago: { select: { id: true, nombre: true } } },
            },
          },
        })
    )
    if (!intento) return null
    if (intento.estado !== 'APROBADO' || intento.fulfillmentEstado !== 'COMPLETADA') return null
    if (intento.transaccion) return { ...intento.transaccion, nueva: false }

    const canal: CanalDeCobro | null = esCanalDeCobro(intento.canal) ? intento.canal : null
    const plan = intento.membership?.plan.nombre
    const detalle = intento.membership
      ? `${canal === 'RENOVACION_AUTOMATICA' ? 'Renovación' : 'Membresía'} ${plan ?? ''}`.trim()
      : `Promoción ${intento.compra?.promocion?.titulo ?? ''}`.trim()
    const sucursal = intento.membership?.sucursalPago ?? intento.compra?.sucursalPago ?? null
    const monto = Number(intento.monto)

    try {
      const t = await conEmpresa(intento.companyId, (tx) =>
        crearTransaccionAplicada(tx, {
          tipo: 'SALE',
          companyId: intento.companyId,
          sucursalId: sucursal?.id ?? null,
          clienteId: intento.clienteId,
          empleadoId: null,
          monto,
          metodoCobro: 'TARJETA',
          pagoIntentoId: intento.id,
          membershipId: intento.membershipId,
          // La venta lleva la fecha del COBRO, no la de cuando se escribe: si la autorreparación o la conciliación la
          // registran tarde, cae en el día en que el cliente pagó y los reportes y el cuadre de ese día la ven ahí.
          fecha: intento.activadoAt ?? undefined,
          snapshot: snapshotDeCobroConTarjeta({
            detalle,
            clienteNombre: intento.cliente?.nombre ?? 'Cliente',
            monto,
            canal,
            pagoIntentoId: intento.id,
            autorizacion: intento.autorizacion,
            tarjeta: intento.membership?.tarjetaTokenizada ?? null,
            sucursalNombre: sucursal?.nombre ?? null,
          }),
          auditoria: { ipAddress: intento.ipAddress, userAgent: intento.userAgent },
          resultado: null,
        })
      )
      return { ...t, nueva: true }
    } catch (e) {
      // Otra llamada ganó la carrera (webhook + retorno del navegador): la venta ya existe y es la misma.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existente = await sinEmpresa('pagos: releer la venta que ganó la carrera por el mismo intento', (tx) =>
          tx.transaction.findUnique({ where: { pagoIntentoId: intento.id }, select: { id: true, codigo: true, ticketNumero: true } })
        )
        return existente ? { ...existente, nueva: false } : null
      }
      throw e
    }
  } catch (e) {
    anotarFallo('pagos:venta-del-intento', { intentoId })(e)
    return null
  }
}
