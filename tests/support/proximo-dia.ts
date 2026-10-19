/**
 * Próximo día de la semana (0 = domingo … 6 = sábado, como `getUTCDay`) a las 12:00 UTC, con al menos `minDias` de
 * adelanto respecto a hoy.
 *
 * Las validaciones de disponibilidad rechazan fechas pasadas y, si la fecha es hoy, horas de salida ya pasadas. Una
 * fecha FIJA en la prueba caduca el día que llega y la prueba empieza a fallar sola: le pasó a «valida cupo y días de
 * todas las actividades hijas» el 12 de octubre de 2026, la fecha que ella misma fijaba. Con una fecha relativa a
 * hoy nunca cae en el pasado.
 */
export function proximoDiaUTC(diaJS: number, minDias = 7): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + minDias)
  d.setUTCHours(12, 0, 0, 0)
  while (d.getUTCDay() !== diaJS) d.setUTCDate(d.getUTCDate() + 1)
  return d
}
