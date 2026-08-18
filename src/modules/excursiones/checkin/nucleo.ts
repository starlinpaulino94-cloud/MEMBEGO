/**
 * EXCURSIONES · Check-in — NÚCLEO PURO.
 *
 * El check-in responde a una sola pregunta en el muelle, con el bus esperando:
 * ¿este grupo se sube o no? Todo lo que decide eso vive aquí, sin base de
 * datos, porque una regla que solo se puede probar en producción se prueba con
 * clientes delante.
 *
 * Dos cosas que este QR NO es:
 * - No es el QR del vendedor. Ese identifica a quien capta; este identifica una
 *   reserva concreta el día de su salida (§84).
 * - No es una credencial de canje. No descuenta beneficios ni toca el escáner
 *   del mostrador: solo registra que la gente se presentó.
 */

import { OFFSET_PLATAFORMA_MIN } from '@/modules/excursiones/metricas/nucleo'

/**
 * Ventana de embarque: el día de la excursión, más el día anterior y el
 * siguiente. La víspera porque hay salidas de madrugada que el operador
 * prepara la noche antes; el día después porque un bus que sale a las 11 de la
 * noche vuelve al día siguiente y nadie va a discutir con el reloj a esa hora.
 *
 * Fuera de esa ventana no se bloquea el embarque: se AVISA. El operador tiene
 * el bus delante y sabe más que el sistema — pero si escanea la reserva
 * equivocada, tiene que enterarse antes de subir a nadie.
 */
export const DIAS_GRACIA_CHECKIN = 1

/** Día local (AAAA-MM-DD) de un instante, en la zona de la plataforma. */
export function diaLocal(fecha: Date): string {
  return new Date(fecha.getTime() + OFFSET_PLATAFORMA_MIN * 60_000).toISOString().slice(0, 10)
}

/** Distancia en días entre la fecha de la excursión y el momento del escaneo. */
export function diasDeDiferencia(fechaExcursion: Date, ahora: Date): number {
  const a = Date.parse(`${diaLocal(fechaExcursion)}T00:00:00Z`)
  const b = Date.parse(`${diaLocal(ahora)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export type ResultadoCheckin =
  | { ok: true; aviso: string | null; yaEstaba: boolean }
  | { ok: false; error: string }

export interface ReservaParaCheckin {
  estado: string
  fecha: Date
  checkinAt: Date | null
  totalPasajeros: number
}

/**
 * ¿Se puede embarcar esta reserva?
 *
 * - Cancelada: NO. Es lo único que se rechaza de plano; subir a alguien cuya
 *   reserva se anuló es el error que después nadie sabe explicar.
 * - Ya embarcada: sí, pero avisando. Repetir el escaneo no es un error —el
 *   operador escanea dos veces por costumbre— y no debe duplicar nada.
 * - Fuera de la ventana: sí, con aviso. La decisión es del operador.
 */
export function evaluarCheckin(
  reserva: ReservaParaCheckin,
  ahora: Date
): ResultadoCheckin {
  if (reserva.estado === 'CANCELADA') {
    return { ok: false, error: 'Esta reserva está cancelada. No debe embarcar.' }
  }
  if (reserva.totalPasajeros <= 0) {
    return { ok: false, error: 'Esta reserva no tiene pasajeros registrados.' }
  }

  const dias = diasDeDiferencia(reserva.fecha, ahora)
  let aviso: string | null = null
  if (dias < -DIAS_GRACIA_CHECKIN) {
    aviso = `Esta excursión es dentro de ${Math.abs(dias)} días. Verifica que sea la reserva correcta.`
  } else if (dias > DIAS_GRACIA_CHECKIN) {
    aviso = `Esta excursión era hace ${dias} días. Verifica que sea la reserva correcta.`
  }

  return { ok: true, aviso, yaEstaba: reserva.checkinAt !== null }
}

/**
 * Cuántos pasajeros embarcan. Lo que llega de la pantalla se acota a los que la
 * reserva tiene: no se puede subir a cinco personas en una reserva de tres, y
 * un número negativo no es «nadie», es un dato roto.
 */
export function pasajerosQueEmbarcan(seleccionados: unknown, total: number): number {
  const n = Number(seleccionados)
  if (!Number.isFinite(n)) return total
  return Math.max(0, Math.min(Math.trunc(n), Math.max(0, total)))
}

/** Resumen legible del manifiesto de una salida. */
export function resumenManifiesto(
  reservas: { totalPasajeros: number; presentes: number; checkinAt: Date | null }[]
): { reservas: number; embarcadas: number; pasajeros: number; presentes: number } {
  return {
    reservas: reservas.length,
    embarcadas: reservas.filter((r) => r.checkinAt !== null).length,
    pasajeros: reservas.reduce((t, r) => t + r.totalPasajeros, 0),
    presentes: reservas.reduce((t, r) => t + r.presentes, 0),
  }
}

/**
 * El código que viaja en el QR. Se prefija para que el escáner sepa de un
 * vistazo qué está leyendo: un código suelto no dice si es una reserva, una
 * membresía o un ticket, y el mostrador ya lee tres cosas distintas.
 */
export const PREFIJO_CHECKIN = 'EXC:'

export function codigoDeCheckin(token: string): string {
  return `${PREFIJO_CHECKIN}${token}`
}

/**
 * Limpia lo que llegó del lector físico. Los lectores «escriben» el código como
 * un teclado: espacios y saltos colados son lo normal, no la excepción.
 */
export function tokenDesdeCodigo(codigo: string): string | null {
  const limpio = (codigo ?? '').trim().replace(/\s+/g, '')
  if (!limpio) return null
  const sinPrefijo = limpio.toUpperCase().startsWith(PREFIJO_CHECKIN)
    ? limpio.slice(PREFIJO_CHECKIN.length)
    : limpio
  return /^[A-Za-z0-9_-]{8,64}$/.test(sinPrefijo) ? sinPrefijo : null
}
