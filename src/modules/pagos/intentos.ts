/**
 * EL CICLO DE VIDA DE UN INTENTO DE PAGO EN PASARELA.
 *
 * Un `PagoIntento` es el registro de que alguien fue enviado a pagar. Existe
 * porque en una pasarela con redirección el cobro ocurre FUERA de nuestro
 * servidor: el cliente se va a la pantalla de CardNET y vuelve después. Sin una
 * fila creada ANTES de irse, cuando vuelve no hay forma de saber qué estaba
 * pagando ni por cuánto — y "por cuánto" no se puede leer del retorno, porque
 * ese dato viaja por el navegador del cliente y es manipulable.
 *
 * DOS GARANTÍAS QUE ESTE MÓDULO SOSTIENE:
 *
 *  1. IDEMPOTENCIA. El retorno del navegador y el webhook de la pasarela
 *     describen el mismo cobro y pueden llegar los dos, en cualquier orden y
 *     repetidos. `activadoAt` se escribe con un UPDATE condicional
 *     (`activadoAt: null` en el WHERE): quien gana la carrera activa, el resto
 *     no hace nada. Sin eso, un cliente que refresca la página de retorno se
 *     lleva dos membresías por un pago.
 *
 *  2. LA APROBACIÓN LA DECIDE EL SERVIDOR. `confirmarIntento` no acepta un
 *     "aprobado" de quien lo llama: recibe el resultado ya verificado
 *     server-to-server contra la pasarela. La ruta de retorno solo aporta el
 *     identificador de sesión.
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import { activarMembresia } from '@/modules/pagos/activacion'
import type { PaymentProviderKind } from '@/lib/payments'

export type EstadoIntento = 'CREADO' | 'REDIRIGIDO' | 'APROBADO' | 'RECHAZADO' | 'EXPIRADO' | 'ERROR'

export interface CrearIntentoInput {
  companyId: string
  clienteId: string | null
  proveedor: PaymentProviderKind
  /** Uno de los dos, según qué se esté pagando. */
  compraId?: string | null
  membershipId?: string | null
  monto: number
  moneda?: string
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Registra el intento ANTES de mandar al cliente a la pasarela.
 *
 * El monto se guarda aquí, tomado de nuestra base de datos, y es el que vale
 * para conciliar. Lo que la pasarela reporte se compara contra este número; no
 * se sustituye por él.
 */
export async function crearIntento(input: CrearIntentoInput) {
  if (!input.compraId && !input.membershipId) {
    throw new Error('Un intento de pago tiene que apuntar a una compra o a una membresía.')
  }
  return conEmpresa(input.companyId, (tx) =>
    tx.pagoIntento.create({
      data: {
        companyId: input.companyId,
        clienteId: input.clienteId ?? null,
        proveedor: input.proveedor,
        compraId: input.compraId ?? null,
        membershipId: input.membershipId ?? null,
        monto: input.monto,
        moneda: input.moneda ?? 'DOP',
        estado: 'CREADO',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  )
}

/** Marca que el cliente ya fue enviado a la pasarela y con qué sesión. */
export async function marcarRedirigido(
  intentoId: string,
  referenciaExterna: string,
  companyId: string
) {
  await conEmpresa(companyId, (tx) =>
    tx.pagoIntento.update({
      where: { id: intentoId },
      data: { estado: 'REDIRIGIDO', referenciaExterna },
    })
  ).catch(anotarFallo('pagos:marcarRedirigido', { intentoId }))
}

/** Busca el intento por la referencia que devuelve la pasarela. */
export async function buscarIntentoPorReferencia(referenciaExterna: string) {
  return sinEmpresa(
    'pagos: webhook/callback de la pasarela localiza el intento por referencia de cualquier empresa',
    (tx) =>
      tx.pagoIntento.findFirst({
        where: { referenciaExterna },
        orderBy: { createdAt: 'desc' },
      })
  ).catch(anotarFallo('pagos:buscarIntentoPorReferencia'))
}

export interface ResultadoVerificado {
  aprobada: boolean
  autorizacion: string | null
  motivo: string | null
  /** Payload tal cual lo devolvió la pasarela. Evidencia ante disputas. */
  crudo: unknown
  /** Monto que la pasarela dice haber cobrado, si lo reporta. */
  montoCobrado?: number | null
}

export type ConfirmacionResultado =
  | { ok: true; estado: 'APROBADO'; yaEstaba: boolean; compraId: string | null; membershipId: string | null }
  | { ok: false; estado: 'RECHAZADO' | 'ERROR'; motivo: string }

/**
 * Cierra el intento con un resultado YA VERIFICADO contra la pasarela y, si fue
 * aprobado, activa el producto exactamente una vez.
 *
 * `yaEstaba: true` significa que otra llamada (el webhook, o el mismo cliente
 * recargando) ya lo activó. No es un error: es la idempotencia funcionando, y
 * la pantalla debe mostrar lo mismo que la primera vez.
 */
export async function confirmarIntento(
  intentoId: string,
  resultado: ResultadoVerificado
): Promise<ConfirmacionResultado> {
  const intento = await sinEmpresa(
    'pagos: localizar intento por id al confirmar (puede llegar de webhook o retorno, cualquier empresa)',
    (tx) => tx.pagoIntento.findUnique({ where: { id: intentoId } })
  )
  if (!intento) return { ok: false, estado: 'ERROR', motivo: 'Intento de pago no encontrado.' }

  if (!resultado.aprobada) {
    await conEmpresa(intento.companyId, (tx) =>
      tx.pagoIntento
        .update({
          where: { id: intentoId },
          data: {
            estado: 'RECHAZADO',
            motivoRechazo: resultado.motivo ?? 'La pasarela rechazó la transacción.',
            respuesta: (resultado.crudo ?? null) as never,
          },
        })
    ).catch(anotarFallo('pagos:confirmarIntento:rechazo', { intentoId }))
    return {
      ok: false,
      estado: 'RECHAZADO',
      motivo: resultado.motivo ?? 'La pasarela rechazó la transacción.',
    }
  }

  // El monto se compara, no se confía. Si la pasarela reporta menos de lo que
  // pedimos, esto NO activa: se marca ERROR para que un humano lo mire. Un
  // cobro por debajo del precio es exactamente lo que produce un ataque de
  // manipulación de monto, y activar en ese caso regala producto.
  const esperado = Number(intento.monto)
  if (
    resultado.montoCobrado != null &&
    Math.abs(resultado.montoCobrado - esperado) > 0.01
  ) {
    const motivo = `El monto cobrado (${resultado.montoCobrado}) no coincide con el esperado (${esperado}).`
    await conEmpresa(intento.companyId, (tx) =>
      tx.pagoIntento
        .update({
          where: { id: intentoId },
          data: { estado: 'ERROR', motivoRechazo: motivo, respuesta: (resultado.crudo ?? null) as never },
        })
    ).catch(anotarFallo('pagos:confirmarIntento:montoDistinto', { intentoId }))
    return { ok: false, estado: 'ERROR', motivo }
  }

  // ── El candado de idempotencia ──────────────────────────────────────────
  // updateMany con `activadoAt: null` en el WHERE es una operación atómica: la
  // base de datos decide quién llega primero. `count === 0` = ya lo activó otro
  // (webhook, recarga de la página, doble clic) y aquí no hay nada que hacer.
  const marca = await conEmpresa(intento.companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intentoId, activadoAt: null },
      data: {
        estado: 'APROBADO',
        activadoAt: new Date(),
        autorizacion: resultado.autorizacion,
        respuesta: (resultado.crudo ?? null) as never,
      },
    })
  )

  if (marca.count === 0) {
    return {
      ok: true,
      estado: 'APROBADO',
      yaEstaba: true,
      compraId: intento.compraId,
      membershipId: intento.membershipId,
    }
  }

  const meta = { ipAddress: intento.ipAddress, userAgent: intento.userAgent }

  // userId null a propósito: no lo activó ningún administrador, lo activó el
  // cobro. La bitácora lo registra como activación automática.
  if (intento.compraId) {
    const res = await activarCompraPromocion(intento.compraId, null, meta, {
      motivo: `Pago aprobado por ${intento.proveedor}`,
    })
    if (!res.ok) {
      // El cobro SÍ ocurrió: no se revierte `activadoAt` (eso abriría la puerta
      // a un doble cobro en el reintento). Se deja constancia del fallo para
      // que un administrador complete la entrega a mano.
      await conEmpresa(intento.companyId, (tx) =>
        tx.pagoIntento
          .update({
            where: { id: intentoId },
            data: { motivoRechazo: `Cobrado, pero la activación falló: ${res.error}` },
          })
      ).catch(anotarFallo('pagos:confirmarIntento:activacionCompraFallo', { intentoId }))
    }
  } else if (intento.membershipId) {
    const res = await activarMembresia(intento.membershipId, null, meta)
    if (!res.ok) {
      await conEmpresa(intento.companyId, (tx) =>
        tx.pagoIntento
          .update({
            where: { id: intentoId },
            data: { motivoRechazo: `Cobrado, pero la activación falló: ${res.error}` },
          })
      ).catch(anotarFallo('pagos:confirmarIntento:activacionMembresiaFallo', { intentoId }))
    }
  }

  return {
    ok: true,
    estado: 'APROBADO',
    yaEstaba: false,
    compraId: intento.compraId,
    membershipId: intento.membershipId,
  }
}
