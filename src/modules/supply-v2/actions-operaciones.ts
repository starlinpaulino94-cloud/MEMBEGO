'use server'

import { revalidatePath } from 'next/cache'
import { contextoDeAuditoria } from './actions-util'
import { comoError } from './actions-util'
import { exigirPermisoSupplyV2 } from './permisos'
import { cambiarInterruptor } from './operations/flags'
import { reconocerAlerta } from './operations/alertas'
import { conciliarAPeticion } from './operations/barrido-conciliacion'
import { evaluarYGuardarAlertas } from './operations/alertas'
import { marcarInvestigando, resolverIncidenteDePago } from './operations/resolucion'
import { reintentarEfecto } from './operations/outbox'
import { procesarEventoExterno, reintentarEvento } from './operations/inbox'
import { actorDelWebhook } from './operations/entrada'
import { auditarOperacion } from './operations/auditoria-operativa'
import { CAPACIDADES, type Capacidad } from './operations/salud-dominio'
import { RESOLUCIONES, type Resolucion } from './operations/conciliacion-dominio'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 4 · LO QUE EL PANEL PUEDE HACER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PERMISO SE COMPRUEBA AQUÍ, NO EN EL BOTÓN
 *
 * Una server action se despacha por su identificador desde cualquier sitio: el
 * botón oculto no protege nada. Cada acción empieza por `exigirPermisoSupplyV2`
 * y, en lo que mueve dinero, el servicio de dominio vuelve a comprobar por su
 * cuenta —permisos que solo se cumplen por costumbre no son permisos—.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS ACCIONES DE INCIDENTES NO SE REIMPLEMENTAN
 *
 * Investigar y resolver son las del bloque 3, con su candado, su actor humano,
 * su nota obligatoria y su servicio financiero oficial. Aquí solo se exponen.
 */

export interface EstadoOperacion {
  error?: string
  success?: string
}

const RUTA = '/superadmin/supply/operaciones'

function texto(fd: FormData, clave: string, max: number): string {
  return String(fd.get(clave) ?? '').trim().slice(0, max)
}

/** §10 · apagar o encender una capacidad. Apagar exige motivo. */
export async function cambiarInterruptorAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const clave = texto(fd, 'clave', 60) as Capacidad
    if (!CAPACIDADES.includes(clave)) return { error: 'Esa capacidad no existe.' }
    const encender = texto(fd, 'encender', 5) === 'si'
    const r = await cambiarInterruptor({ clave, encender, motivo: texto(fd, 'motivo', 300) }, ctx)
    revalidatePath(RUTA)
    return {
      success: r.activa
        ? `${r.etiqueta}: encendida.`
        : `${r.etiqueta}: APAGADA. Se corta ${r.corta.join(', ')}; sigue funcionando ${r.conserva.join(', ')}.`,
    }
  } catch (e) {
    return comoError(e, 'cambiarInterruptor')
  }
}

/** §22 · conciliación manual por compra, transacción o pasarela. */
export async function conciliarAPeticionAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const orderId = texto(fd, 'orderId', 60) || undefined
    const externalTransactionId = texto(fd, 'externalTransactionId', 120) || undefined
    const provider = texto(fd, 'provider', 40) || undefined
    // Sin criterio NO se barre: un barrido lanzado a mano sobre todo, desde un
    // panel, es la forma más fácil de convertir un clic en un incidente de
    // rendimiento.
    if (!orderId && !externalTransactionId && !provider) {
      return { error: 'Hay que decir qué conciliar: una compra, una transacción o una pasarela.' }
    }
    const r = await conciliarAPeticion({ orderId, externalTransactionId, provider }, ctx)
    await auditarOperacion(ctx, 'SUPPLY_V2_OPERATIONS_RECONCILE_RUN', 'SupplyV2PaymentReconciliation', orderId ?? externalTransactionId ?? provider ?? 'sin-criterio', {
      criterio: orderId ? 'orden' : externalTransactionId ? 'transaccion' : 'pasarela',
      revisados: r.revisados,
      discrepancias: r.discrepancias,
      incidentesAbiertos: r.incidentesAbiertos.length,
    })
    revalidatePath(RUTA)
    return {
      success:
        r.revisados === 0
          ? 'No había eventos externos que conciliar con ese criterio.'
          : `Revisados ${r.revisados}: ${r.cuadraron} cuadran, ${r.discrepancias} no. ${r.incidentesAbiertos.length} incidente(s) nuevo(s).`,
    }
  } catch (e) {
    return comoError(e, 'conciliarAPeticion')
  }
}

/** §12 · «ya lo sé, estoy en ello», con nota obligatoria. */
export async function reconocerAlertaAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await reconocerAlerta({ key: texto(fd, 'key', 60), nota: texto(fd, 'nota', 500) }, ctx)
    revalidatePath(RUTA)
    return {
      success:
        r.estaba === 'ACKNOWLEDGED'
          ? 'Esa alerta ya estaba reconocida.'
          : 'Alerta reconocida. Se cerrará sola cuando la condición desaparezca.',
    }
  } catch (e) {
    return comoError(e, 'reconocerAlerta')
  }
}

/** Reevaluar las alertas a mano, sin esperar al cron. Idempotente. */
export async function evaluarAlertasAction(_prev: EstadoOperacion, _fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await evaluarYGuardarAlertas(ctx)
    revalidatePath(RUTA)
    return {
      success: `Evaluado: ${r.activas} condición(es) activa(s), ${r.nuevas.length} nueva(s), ${r.resueltas.length} resuelta(s).`,
    }
  } catch (e) {
    return comoError(e, 'evaluarAlertas')
  }
}

/** §17 · investigar un incidente. El servicio del bloque 3, sin tocarlo. */
export async function investigarIncidenteAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'incidentId', 60)
    await marcarInvestigando(id, ctx)
    revalidatePath(`${RUTA}/incidentes/${id}`)
    revalidatePath(RUTA)
    return { success: 'Marcado como en investigación.' }
  } catch (e) {
    return comoError(e, 'investigarIncidente')
  }
}

/** §17 · resolver. `ACCEPT_EXTERNAL` pasa por el servicio financiero oficial. */
export async function resolverIncidenteAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'incidentId', 60)
    const resolucion = texto(fd, 'resolucion', 40) as Resolucion
    if (!Object.values(RESOLUCIONES).includes(resolucion)) return { error: 'Esa resolución no existe.' }
    const r = await resolverIncidenteDePago(
      {
        incidentId: id,
        resolucion,
        nota: texto(fd, 'nota', 2000),
        montoExterno: texto(fd, 'montoExterno', 20) || null,
      },
      ctx
    )
    revalidatePath(`${RUTA}/incidentes/${id}`)
    revalidatePath(RUTA)
    return {
      success: r.repetido
        ? 'Ese incidente ya estaba resuelto: no se hizo nada.'
        : r.pagoConfirmado
          ? 'Resuelto, y el pago quedó confirmado por el servicio oficial: derechos emitidos y aviso al cliente apuntado.'
          : 'Resuelto.',
    }
  } catch (e) {
    return comoError(e, 'resolverIncidente')
  }
}


/**
 * §18 · reintentar un efecto sin salida.
 *
 * El servicio es el del BLOQUE 1 (`reintentarEfecto`), que devuelve la escalera
 * completa y audita `SUPPLY_V2_OUTBOX_RETRIED` con nombre y apellido. Aquí no
 * se reimplementa: se expone. Y existe porque la infraestructura ya lo
 * soportaba —no se inventa una acción sin semántica detrás—.
 */
export async function reintentarEfectoAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'outboxId', 60)
    if (!id) return { error: 'Falta el efecto.' }
    const r = await reintentarEfecto(id, ctx)
    revalidatePath(`${RUTA}/difuntos`)
    revalidatePath(RUTA)
    return {
      success: `Reintentado (estaba ${r.estaba}). Se le devolvió la escalera completa: si falla, volverá a reprogramarse.`,
    }
  } catch (e) {
    return comoError(e, 'reintentarEfecto')
  }
}

/**
 * §4D · reintentar un EVENTO EXTERNO que falló o se quedó sin salida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTA ACCIÓN Y NO EXISTÍA
 *
 * El bloque 1 ya traía `reintentarEvento` —con su candado, su bitácora
 * `SUPPLY_V2_EXTERNAL_EVENT_RETRIED` y su devolución de escalera—, y el bloque 4
 * ya traía la alerta `INBOX_DEAD`. Pero no había botón: el panel sabía DECIR
 * que había eventos externos sin salida y no ofrecía nada que hacer con ellos.
 * Un aviso sin palanca obliga a abrir una consola contra la base de producción,
 * que es exactamente lo que el Centro de Operaciones existe para evitar.
 *
 * Reintentar vuelve a pasar por `procesarEventoExterno`, así que vuelve a pasar
 * por la identidad idempotente `(provider, externalEventId, eventType)`: pulsar
 * dos veces no cobra dos veces.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PROCESA AQUÍ MISMO, NO «CUANDO PASE EL CRON»
 *
 * `reintentarEvento` devuelve la fila a `RECEIVED`; el barrido del cron la
 * recogería, pero el plan puede correr el cron una vez al día y quien pulsa el
 * botón está mirando un pago que no entró. Así que se procesa en el acto y lo
 * que se contesta es el RESULTADO —entró, se ignoró, sigue sin cuadrar—, no un
 * «quedó encolado» que no dice nada.
 *
 * La confirmación se atribuye a la cuenta de la integración, igual que si el
 * aviso hubiera entrado solo: quién pulsó el botón ya quedó en la bitácora con
 * `SUPPLY_V2_EXTERNAL_EVENT_RETRIED`, y el asiento financiero debe leerse igual
 * viniera de la pasarela o de este reintento.
 */
export async function reintentarEventoAction(_prev: EstadoOperacion, fd: FormData): Promise<EstadoOperacion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OPERATIONS_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'eventoId', 60)
    if (!id) return { error: 'Falta el evento.' }
    const r = await reintentarEvento(id, ctx)

    const cuenta = await actorDelWebhook()
    if (!cuenta) {
      return {
        success: `Reencolado (estaba ${r.estaba}), pero NO se pudo procesar: falta configurar la cuenta de la integración (SUPPLY_V2_WEBHOOK_ACTOR_ID). El evento espera.`,
      }
    }

    const proceso = await procesarEventoExterno(id, { ...ctx, actorId: cuenta })
    revalidatePath(`${RUTA}/inbox`)
    revalidatePath(RUTA)
    return { success: `${MENSAJE_DE_PROCESO[proceso.resultado]} (estaba ${r.estaba}).` }
  } catch (e) {
    return comoError(e, 'reintentarEvento')
  }
}

/**
 * Lo que se le dice al operador según lo que pasó de verdad. Ninguno de estos
 * mensajes promete más de lo que ocurrió: «se procesó» solo cuando movió el
 * dinero.
 */
const MENSAJE_DE_PROCESO: Record<string, string> = {
  PROCESADO: 'Procesado: el pago quedó confirmado y los derechos emitidos',
  REPETIDO: 'No hizo falta: el evento ya estaba resuelto',
  IGNORADO: 'Recibido y descartado a propósito: mira el último error de la fila',
  RECHAZADO: 'Rechazado: no cuadra con la compra. Queda un incidente abierto para revisarlo',
  REINTENTABLE: 'Volvió a fallar por algo transitorio. Reprogramado: el cron lo reintentará',
}
