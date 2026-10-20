import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inicioDeHoyEn } from '../src/modules/reportes/rango'

/**
 * UN SOLO «HOY» (auditoría admin · D-03).
 *
 * El Resumen, «Visitas de hoy» del escáner y el contador de canjes del menú
 * contaban lo mismo con tres relojes: la zona de la empresa, un UTC-4 grabado a
 * mano y la hora del proceso (UTC en Vercel). A las 8 de la noche en Santo
 * Domingo daban tres números distintos de las mismas visitas.
 */

test('«hoy» empieza a la medianoche LOCAL del negocio, no a la de UTC', () => {
  // 02:00 UTC del 20 es todavía el 19 en Santo Domingo (22:00): hoy empezó el 19 a las 04:00 UTC.
  assert.equal(
    inicioDeHoyEn('America/Santo_Domingo', new Date('2026-10-20T02:00:00Z')).toISOString(),
    '2026-10-19T04:00:00.000Z'
  )
  // Justo a medianoche local el día ya es el nuevo.
  assert.equal(
    inicioDeHoyEn('America/Santo_Domingo', new Date('2026-10-20T04:00:00Z')).toISOString(),
    '2026-10-20T04:00:00.000Z'
  )
  // Y cuatro horas después sigue siendo el mismo «hoy».
  assert.equal(
    inicioDeHoyEn('America/Santo_Domingo', new Date('2026-10-20T08:00:00Z')).toISOString(),
    '2026-10-20T04:00:00.000Z'
  )
})

test('otra zona de la plataforma tiene SU hoy, no el de Santo Domingo', () => {
  // Ciudad de México no usa horario de verano desde 2022: UTC-6.
  assert.equal(
    inicioDeHoyEn('America/Mexico_City', new Date('2026-10-20T02:00:00Z')).toISOString(),
    '2026-10-19T06:00:00.000Z'
  )
  // Madrid en octubre antes del cambio de hora: UTC+2, ya es el día 20 a la 01:00 UTC.
  assert.equal(
    inicioDeHoyEn('Europe/Madrid', new Date('2026-10-20T01:00:00Z')).toISOString(),
    '2026-10-19T22:00:00.000Z'
  )
})

test('una zona inválida degrada a la de la plataforma en vez de romper', () => {
  assert.doesNotThrow(() => inicioDeHoyEn('No/Existe', new Date('2026-10-20T12:00:00Z')))
})

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('el Resumen, el escáner y el menú calculan «hoy» con la misma función', () => {
  const superficies: Record<string, RegExp> = {
    'src/modules/admin/dashboardQueries.ts': /inicioDeHoyEn\(/,
    'src/components/scanner/VisitasDeHoy.tsx': /inicioDeHoy\(/,
    'src/modules/navegacion/badges.ts': /inicioDeHoy\(/,
  }
  for (const [archivo, usa] of Object.entries(superficies)) {
    const src = sinComentarios(leer(archivo))
    assert.match(src, usa, `${archivo} debe usar la definición única de «hoy»`)
    assert.doesNotMatch(src, /setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/, `${archivo}: corte de «hoy» con la hora del proceso`)
    assert.doesNotMatch(src, /startOfTodaySantoDomingo|\*\s*60\s*\*\s*60\s*\*\s*1000\)\s*;?\s*\n\s*local/, `${archivo}: UTC-4 grabado a mano`)
  }
})
