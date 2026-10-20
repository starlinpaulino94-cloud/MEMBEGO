import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paginaDeUrl, paginasDe, resumirSaldos } from '../src/modules/excursiones/panel/saldos'

/**
 * SALDOS DEL VENDEDOR (auditoría admin · D-02).
 *
 * El panel sumaba «por cobrar» y «ya cobrado» sobre una lista recortada a 200
 * filas: con 263 comisiones enseñaba RD$20 000 de RD$26 000 y RD$0 cobrado de
 * RD$2 265, sin avisar. Ahora la base de datos suma todo y la lista es aparte.
 */

test('los saldos suman TODAS las comisiones, no las que caben en una página', () => {
  // 260 comisiones de RD$100 por cobrar y 3 pagadas que suman RD$2 265: el caso real que falló.
  const r = resumirSaldos(
    [
      { pagada: false, moneda: 'DOP', neto: 26_000, lineas: 260 },
      { pagada: true, moneda: 'DOP', neto: 2_265, lineas: 3 },
    ],
    'DOP',
    {}
  )
  assert.deepEqual(r, { porCobrar: 26_000, cobrado: 2_265 })
})

test('una moneda distinta se convierte con la tasa de la empresa', () => {
  const r = resumirSaldos(
    [
      { pagada: false, moneda: 'DOP', neto: 1_000 },
      { pagada: false, moneda: 'USD', neto: 100 },
      { pagada: true, moneda: 'USD', neto: 10 },
    ],
    'DOP',
    { USD_DOP: 58.5 }
  )
  assert.equal(r.porCobrar, 1_000 + 5_850)
  assert.equal(r.cobrado, 585)
})

test('sin comisiones, los dos saldos son cero', () => {
  assert.deepEqual(resumirSaldos([], 'DOP', {}), { porCobrar: 0, cobrado: 0 })
})

test('la lista se pagina sin perder el total', () => {
  assert.equal(paginasDe(0, 200), 1)
  assert.equal(paginasDe(200, 200), 1)
  assert.equal(paginasDe(201, 200), 2)
  assert.equal(paginasDe(263, 200), 2)
  assert.equal(paginaDeUrl(undefined), 1)
  assert.equal(paginaDeUrl('3'), 3)
  assert.equal(paginaDeUrl(['2', '5']), 2)
  for (const malo of ['0', '-1', 'x', '1.5', '']) assert.equal(paginaDeUrl(malo), 1, malo)
})

const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('el saldo sale de la agregación en base de datos, no de la lista que se pinta', () => {
  const queries = sinComentarios(readFileSync('src/modules/excursiones/panel/queries.ts', 'utf8'))
  assert.match(queries, /GROUP BY 1, 2/, 'falta la agregación por estado de pago y moneda')
  assert.match(queries, /resumirSaldos\(/)
  // La forma del defecto: filtrar la lista ya recortada para sumar.
  assert.doesNotMatch(queries, /lineas\s*\.\s*filter\(/)
  assert.doesNotMatch(queries, /const suma\s*=/)
  // Ajustes con signo y sin bajar de cero: la misma regla que `netoComision`.
  assert.match(queries, /GREATEST\(0,\s*c\."monto"\s*\+\s*COALESCE\(a\."suma",\s*0\)\)/)
  // Las anuladas no cuentan.
  assert.match(queries, /c\."estado" <> 'ANULADA'/)
})

test('el Inicio del vendedor pide solo los saldos, no la lista de comisiones', () => {
  const inicio = sinComentarios(readFileSync('src/app/(vendedor)/vendedor/page.tsx', 'utf8'))
  assert.match(inicio, /misSaldos\(/)
  assert.doesNotMatch(inicio, /misComisiones\(/)
})
