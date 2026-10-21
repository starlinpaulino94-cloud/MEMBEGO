import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { tarjetaCardnetVencida } from '@/modules/pagos/cardnet-expiracion'
import {
  consentimientoVigente,
  otorgarConsentimiento,
  revocarConsentimientos,
} from '@/modules/pagos/consentimientos'
import type { ContextoConsentimiento } from '@/modules/pagos/consentimientosCore'
import type { TarjetaDePantalla } from '@/modules/pagos/renovacionFormato'

/**
 * LO QUE EL CLIENTE HACE CON LA RENOVACIÓN AUTOMÁTICA DE SU MEMBRESÍA.
 *
 * Funciones sin sesión ni Next, para probarlas contra una base real. La puerta
 * —quién es el usuario, si la empresa puede cobrar con tarjeta, el límite de
 * peticiones— está en `renovacionActions.ts`; aquí solo está lo que se hace una
 * vez dentro.
 *
 * ENCENDER la renovación es un CONSENTIMIENTO: autoriza cobros SIN el cliente. Se
 * registra en la misma transacción que la enciende, y sin él el cobro no sale
 * (`renovarMembresiaPorTarjeta`). Quien llama es responsable de haber MOSTRADO el
 * texto de `contexto.textoVersion` y de haber recibido la aceptación; este módulo
 * no la inventa.
 *
 * Dos pestañas, o un «activar» y un «desactivar» a la vez, no pueden dejar
 * `autoRenovar` encendido sin consentimiento ni al revés: las dos escriben la
 * fila de la membresía (que la base bloquea hasta que la primera termina) y el
 * consentimiento se serializa por cliente dentro de `otorgarConsentimiento`.
 * Lo comprueba `tests/postgres/renovacion-activar.db.test.ts`.
 */

export type ActivarRenovacion =
  | 'ok'
  | 'membresia_no_encontrada'
  | 'membresia_no_activa'
  | 'cancelacion_programada'
  | 'cambio_de_plan_pendiente'
  | 'plan_sin_precio'
  | 'tarjeta_no_encontrada'
  | 'tarjeta_sin_perfil'
  | 'tarjeta_vencida'

/**
 * Enciende la renovación automática de una membresía con una tarjeta guardada.
 *
 * Las mismas condiciones que exige el cobro, comprobadas ANTES de prometerle nada
 * al cliente: una membresía activa, sin la cancelación programada (el cliente
 * acaba de decir que no quiere seguir), sin un cambio de plan por pagar, con un
 * plan que cuesta algo, y una tarjeta suya, activa, con perfil y no vencida.
 *
 * Si ya renovaba con OTRA tarjeta, el consentimiento anterior se retira y se
 * registra uno nuevo: el cliente autorizó ESA tarjeta, no «cualquiera». Si el
 * vigente es HEREDADO (de antes de que existiera el registro), activar con la
 * misma tarjeta lo CONFIRMA: se retira y se registra uno de cliente, con el texto
 * que de verdad vio.
 */
export async function activarRenovacion(input: {
  companyId: string
  clienteId: string
  membershipId: string
  tarjetaId: string
  contexto: ContextoConsentimiento
}): Promise<ActivarRenovacion> {
  return conEmpresa(input.companyId, async (tx) => {
    const membresia = await tx.membership.findFirst({
      where: { id: input.membershipId, clienteId: input.clienteId },
      select: {
        id: true,
        estado: true,
        canceladaAlVencimiento: true,
        planIdSolicitado: true,
        plan: { select: { precio: true } },
      },
    })
    if (!membresia) return 'membresia_no_encontrada' as const
    if (membresia.estado !== 'ACTIVA') return 'membresia_no_activa' as const
    if (membresia.canceladaAlVencimiento) return 'cancelacion_programada' as const
    if (membresia.planIdSolicitado) return 'cambio_de_plan_pendiente' as const
    if (Number(membresia.plan.precio) <= 0) return 'plan_sin_precio' as const

    const tarjeta = await tx.tarjetaTokenizada.findFirst({
      where: {
        id: input.tarjetaId,
        clienteId: input.clienteId,
        companyId: input.companyId,
        activa: true,
      },
      select: {
        id: true,
        paymentProfileId: true,
        token: true,
        tokenCifrado: true,
        vencMes: true,
        vencAnio: true,
      },
    })
    if (!tarjeta) return 'tarjeta_no_encontrada' as const
    // El cobro no intentaría una tarjeta vencida (apagaría la renovación): no se
    // enciende con una que ya lo está. Sin vencimiento conocido se deja pasar.
    if (tarjetaCardnetVencida(tarjeta.vencMes, tarjeta.vencAnio)) return 'tarjeta_vencida' as const
    // Lo mismo que exige el cobro: sin perfil ni token no hay tarjeta que señalar.
    if (!tarjeta.paymentProfileId && !tarjeta.tokenCifrado && !tarjeta.token) {
      return 'tarjeta_sin_perfil' as const
    }

    // Confirmar una renovación heredada: el consentimiento HEREDADO no tiene
    // texto; se sustituye por uno de cliente.
    const vigente = await consentimientoVigente(tx, {
      tipo: 'RENOVACION_AUTOMATICA',
      membershipId: input.membershipId,
    })
    if (vigente?.origen === 'HEREDADO') {
      await revocarConsentimientos(tx, {
        tipo: 'RENOVACION_AUTOMATICA',
        membershipId: input.membershipId,
      })
    }

    await tx.membership.update({
      where: { id: input.membershipId },
      data: { autoRenovar: true, tarjetaTokenizadaId: tarjeta.id },
    })
    await otorgarConsentimiento(tx, {
      companyId: input.companyId,
      clienteId: input.clienteId,
      tipo: 'RENOVACION_AUTOMATICA',
      tarjetaId: tarjeta.id,
      membershipId: input.membershipId,
      contexto: input.contexto,
    })
    // Sin asiento en `AuditLog`: `accion` es un enum de la base y ninguno de sus
    // valores dice esto, y ampliarlo es una migración para guardar lo que ya
    // guarda `consentimientos_pago` —quién, cuándo, desde dónde, bajo qué texto y,
    // al retirarlo, `revocadoAt`—. Esa tabla ES el registro.
    return 'ok' as const
  })
}

/**
 * Apaga la renovación automática de una membresía y retira su consentimiento.
 * Idempotente. La tarjeta se conserva, y la membresía sigue vigente hasta su
 * vencimiento: lo único que cambia es que ya no se cobra sola.
 *
 * NUNCA se bloquea por una capacidad apagada: dejar de cobrarle a alguien no
 * puede depender de un interruptor de la empresa.
 */
export async function desactivarRenovacion(input: {
  companyId: string
  clienteId: string
  membershipId: string
}): Promise<'ok' | 'membresia_no_encontrada'> {
  return conEmpresa(input.companyId, async (tx) => {
    const membresia = await tx.membership.findFirst({
      where: { id: input.membershipId, clienteId: input.clienteId },
      select: { id: true },
    })
    if (!membresia) return 'membresia_no_encontrada' as const
    await tx.membership.update({
      where: { id: input.membershipId },
      data: { autoRenovar: false },
    })
    // El rastro de que se retiró es `revocadoAt` en el consentimiento.
    await revocarConsentimientos(tx, {
      tipo: 'RENOVACION_AUTOMATICA',
      membershipId: input.membershipId,
    })
    return 'ok' as const
  })
}

export interface EstadoRenovacion {
  /**
   * ¿Se renueva sola? Solo es cierto con LAS TRES cosas que el cobro exige:
   * `autoRenovar`, tarjeta activa y consentimiento vigente. Si la pantalla dijera
   * «se renueva sola» con `autoRenovar` a secas, prometería un cobro que el cron
   * no va a hacer.
   */
  activa: boolean
  tarjeta: { id: string; marca: string | null; ultimos4: string | null } | null
  /**
   * Lo que el cliente aceptó, si la renovación está activa: `HEREDADO` es de antes
   * de que existiera el registro y no hay texto; la pantalla le ofrece confirmarla.
   */
  origen: 'CLIENTE' | 'HEREDADO' | null
}

/** Cómo está la renovación automática de una membresía, para su pantalla. */
export async function estadoRenovacion(
  companyId: string,
  membershipId: string
): Promise<EstadoRenovacion> {
  const apagada: EstadoRenovacion = { activa: false, tarjeta: null, origen: null }
  return conEmpresa(companyId, async (tx) => {
    const m = await tx.membership.findUnique({
      where: { id: membershipId },
      select: {
        autoRenovar: true,
        tarjetaTokenizada: { select: { id: true, marca: true, ultimos4: true, activa: true } },
      },
    })
    const tarjeta = m?.tarjetaTokenizada
    if (!m || !m.autoRenovar || !tarjeta || !tarjeta.activa) return apagada
    const consentimiento = await consentimientoVigente(tx, {
      tipo: 'RENOVACION_AUTOMATICA',
      membershipId,
    })
    if (!consentimiento) return apagada
    return {
      activa: true,
      tarjeta: { id: tarjeta.id, marca: tarjeta.marca, ultimos4: tarjeta.ultimos4 },
      origen: consentimiento.origen === 'HEREDADO' ? 'HEREDADO' : 'CLIENTE',
    }
  })
}

/**
 * Las tarjetas activas del cliente que se le pueden ofrecer para renovar, la
 * predeterminada primero. Solo lo que permite reconocerlas (marca y últimos 4):
 * nunca el token. Una vencida va marcada, y la pantalla no la ofrece.
 */
export async function tarjetasParaRenovar(
  companyId: string,
  clienteId: string
): Promise<TarjetaDePantalla[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.tarjetaTokenizada.findMany({
      where: { clienteId, companyId, activa: true },
      select: {
        id: true,
        marca: true,
        ultimos4: true,
        predeterminada: true,
        vencMes: true,
        vencAnio: true,
        paymentProfileId: true,
        token: true,
        tokenCifrado: true,
      },
      orderBy: [{ predeterminada: 'desc' }, { createdAt: 'desc' }],
    })
  )
  return filas
    // Sin perfil ni token no hay nada que cobrar: no se ofrece (el servicio
    // tampoco la aceptaría).
    .filter((t) => t.paymentProfileId || t.tokenCifrado || t.token)
    .map((t) => ({
      id: t.id,
      marca: t.marca,
      ultimos4: t.ultimos4,
      predeterminada: t.predeterminada,
      vencida: tarjetaCardnetVencida(t.vencMes, t.vencAnio),
    }))
}
