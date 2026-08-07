import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularDistanciaM, formatearDistancia } from '../src/modules/geo/cercanos/distancia'
import {
  DIAS_HORARIO,
  diaLocal,
  estaAbierto,
  textoHorarioHoy,
  TZ_MEMBEGO,
  type HorarioDetallado,
} from '../src/modules/geo/cercanos/horario'

/**
 * Pruebas del módulo "Cerca de mí" (docs/GEOLOCALIZACION.md §16): la distancia
 * que ordena la lista y el horario que decide el filtro "abierto ahora".
 * Ambas son funciones puras y deterministas: si fallan aquí, falla la tarjeta
 * que el usuario ve en el mapa.
 */

// ─── Distancia (Haversine) ────────────────────────────────────────────────────

test('calcularDistanciaM devuelve 0 para el mismo punto', () => {
  assert.equal(calcularDistanciaM(18.4861, -69.9312, 18.4861, -69.9312), 0)
})

test('calcularDistanciaM: 1° de longitud en el ecuador ≈ 111 km', () => {
  const d = calcularDistanciaM(0, 0, 0, 1)
  assert.ok(Math.abs(d - 111_195) < 500, `esperado ~111195 m, recibido ${d}`)
})

test('calcularDistanciaM: Santo Domingo → Santiago de los Caballeros (~130 km)', () => {
  const d = calcularDistanciaM(18.4861, -69.9312, 19.4548, -70.6976)
  assert.ok(d > 100_000 && d < 160_000, `distancia esperada entre 100 y 160 km, recibido ${d}`)
})

test('calcularDistanciaM es simétrica', () => {
  const a = calcularDistanciaM(18.4861, -69.9312, 18.7, -70.2)
  const b = calcularDistanciaM(18.7, -70.2, 18.4861, -69.9312)
  assert.equal(a, b)
})

test('formatearDistancia redondea a decenas de metros', () => {
  assert.equal(formatearDistancia(850), 'A 850 m')
  assert.equal(formatearDistancia(45), 'A 50 m')
  assert.equal(formatearDistancia(1000), 'A 1.0 km')
})

test('formatearDistancia usa km con un decimal hasta los 10 km', () => {
  assert.equal(formatearDistancia(1234), 'A 1.2 km')
  assert.equal(formatearDistancia(9999), 'A 10.0 km')
  assert.equal(formatearDistancia(15_000), 'A 15 km')
})

test('formatearDistancia nunca inventa un número', () => {
  assert.equal(formatearDistancia(null), 'a poca distancia')
  assert.equal(formatearDistancia(undefined), 'a poca distancia')
})

// ─── Horario (zona America/Santo_Domingo, UTC-4) ─────────────────────────────

test('diaLocal resuelve el día de la zona horaria, no el de la máquina', () => {
  // 2026-08-06T12:00Z = 08:00 en Santo Domingo (jueves) → ISO 4.
  assert.equal(diaLocal(new Date('2026-08-06T12:00:00Z'), TZ_MEMBEGO), 4)
  // 2026-08-06T03:00Z = 23:00 del miércoles local → ISO 3.
  assert.equal(diaLocal(new Date('2026-08-06T03:00:00Z'), TZ_MEMBEGO), 3)
})

/** Horario que cubre el día de `now`, para no depender del día real. */
function horarioPara(now: Date, rangos: [string, string][] = [['00:00', '23:59']]) {
  const clave = DIAS_HORARIO[diaLocal(now, TZ_MEMBEGO) - 1]
  return { [clave]: rangos }
}

test('estaAbierto con horario nulo = desconocido', () => {
  assert.equal(estaAbierto(null, new Date('2026-08-06T12:00:00Z')), null)
  assert.equal(estaAbierto(undefined, new Date('2026-08-06T12:00:00Z')), null)
})

test('estaAbierto: horario sin clave para el día = desconocido', () => {
  const now = new Date('2026-08-06T12:00:00Z') // jueves
  const horario: HorarioDetallado = { LUNES: [['08:00', '18:00']] }
  assert.equal(estaAbierto(horario, now), null)
})

test('estaAbierto: día con lista vacía = cerrado', () => {
  const now = new Date('2026-08-06T12:00:00Z')
  assert.equal(estaAbierto(horarioPara(now, []), now), false)
})

test('estaAbierto respeta los límites del rango', () => {
  const now = new Date('2026-08-06T12:00:00Z') // jueves
  const horario = horarioPara(now, [['08:00', '18:00']])
  // 08:00 local = 12:00Z (abierto, >= desde).
  assert.equal(estaAbierto(horario, new Date('2026-08-06T12:00:00Z')), true)
  // 18:00 local = 22:00Z (abierto, <= hasta).
  assert.equal(estaAbierto(horario, new Date('2026-08-06T22:00:00Z')), true)
  // 18:01 local = 22:01Z (cerrado).
  assert.equal(estaAbierto(horario, new Date('2026-08-06T22:01:00Z')), false)
  // 07:59 local = 11:59Z (cerrado).
  assert.equal(estaAbierto(horario, new Date('2026-08-06T11:59:00Z')), false)
})

test('estaAbierto con dos turnos: el hueco del mediodía está cerrado', () => {
  const now = new Date('2026-08-06T12:00:00Z')
  const horario = horarioPara(now, [['08:00', '12:00'], ['14:00', '18:00']])
  // 13:00 local = 17:00Z → hueco.
  assert.equal(estaAbierto(horario, new Date('2026-08-06T17:00:00Z')), false)
  // 15:00 local = 19:00Z → segundo turno.
  assert.equal(estaAbierto(horario, new Date('2026-08-06T19:00:00Z')), true)
})

test('estaAbierto ignora rangos mal formados', () => {
  const now = new Date('2026-08-06T12:00:00Z')
  // Rango con un solo elemento y rango invertido (desde >= hasta).
  const clave = DIAS_HORARIO[diaLocal(now, TZ_MEMBEGO) - 1]
  const horario: HorarioDetallado = {
    [clave]: [
      ['10:00'] as unknown as [string, string],
      ['12:00', '09:00'],
      ['9:99', '18:00'],
    ],
  }
  assert.equal(estaAbierto(horario, now), false)
})

test('textoHorarioHoy resume el horario del día actual', () => {
  const now = new Date('2026-08-06T12:00:00Z') // jueves
  assert.equal(textoHorarioHoy(horarioPara(now, [['08:00', '18:00']]), now), '08:00–18:00')
  assert.equal(textoHorarioHoy(horarioPara(now, [['08:00', '12:00'], ['14:00', '18:00']]), now), '08:00–12:00, 14:00–18:00')
  assert.equal(textoHorarioHoy(horarioPara(now, []), now), 'Cerrado hoy')
  assert.equal(textoHorarioHoy(null, now), null)
})
