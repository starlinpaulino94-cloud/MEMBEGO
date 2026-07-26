/**
 * Caja (POS) · pruebas del ARQUEO — la cuenta que decide si a la gaveta le
 * falta o le sobra dinero al cerrar el turno. Ejecutar: npm test
 *
 * Es lógica pura (src/modules/caja/arqueo.ts), la MISMA que usa `cerrarCaja`
 * en producción: si alguien la rompe, estas pruebas lo gritan antes del deploy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularArqueo, etiquetaArqueo } from '../src/modules/caja/arqueo'

test('caja cuadrada: lo contado coincide con lo esperado', () => {
  const r = calcularArqueo({
    balanceInicial: 1000,
    cobrosEfectivo: 2500,
    entradas: 0,
    salidas: 0,
    balanceFinal: 3500,
  })
  assert.equal(r.balanceEsperado, 3500)
  assert.equal(r.diferencia, 0)
  assert.equal(r.estado, 'CUADRADA')
})

test('faltante: se contó menos de lo que debía haber', () => {
  const r = calcularArqueo({
    balanceInicial: 1000,
    cobrosEfectivo: 2500,
    entradas: 0,
    salidas: 0,
    balanceFinal: 3450,
  })
  assert.equal(r.diferencia, -50)
  assert.equal(r.estado, 'FALTANTE')
  assert.equal(etiquetaArqueo(r.diferencia), 'faltante RD$50.00')
})

test('sobrante: se contó más de lo esperado', () => {
  const r = calcularArqueo({
    balanceInicial: 500,
    cobrosEfectivo: 1000,
    entradas: 0,
    salidas: 0,
    balanceFinal: 1520,
  })
  assert.equal(r.diferencia, 20)
  assert.equal(r.estado, 'SOBRANTE')
  assert.equal(etiquetaArqueo(r.diferencia), 'sobrante RD$20.00')
})

test('las entradas suman y las salidas restan al esperado', () => {
  const r = calcularArqueo({
    balanceInicial: 1000,
    cobrosEfectivo: 500,
    entradas: 300, // aporte de fondo
    salidas: 200, // retiro / gasto
    balanceFinal: 1600,
  })
  // 1000 + 500 + 300 − 200 = 1600
  assert.equal(r.balanceEsperado, 1600)
  assert.equal(r.estado, 'CUADRADA')
})

test('los cobros que NO son en efectivo no entran a la gaveta', () => {
  // Solo se pasa `cobrosEfectivo`: una venta por transferencia no debe alterar
  // el esperado. Si alguien sumara todos los métodos, esta prueba falla.
  const r = calcularArqueo({
    balanceInicial: 1000,
    cobrosEfectivo: 0,
    entradas: 0,
    salidas: 0,
    balanceFinal: 1000,
  })
  assert.equal(r.balanceEsperado, 1000)
  assert.equal(r.estado, 'CUADRADA')
})

test('los centavos no inventan diferencias por coma flotante', () => {
  // 0.1 + 0.2 === 0.30000000000000004 en coma flotante. Sin redondeo, esta
  // caja saldría "descuadrada" por 4e-17 y el cierre mostraría un faltante
  // fantasma al empleado.
  const r = calcularArqueo({
    balanceInicial: 0.1,
    cobrosEfectivo: 0.2,
    entradas: 0,
    salidas: 0,
    balanceFinal: 0.3,
  })
  assert.equal(r.diferencia, 0)
  assert.equal(r.estado, 'CUADRADA')
})

test('una caja sin movimientos cierra con lo que abrió', () => {
  const r = calcularArqueo({
    balanceInicial: 2000,
    cobrosEfectivo: 0,
    entradas: 0,
    salidas: 0,
    balanceFinal: 2000,
  })
  assert.equal(r.estado, 'CUADRADA')
  assert.equal(etiquetaArqueo(r.diferencia), 'cuadrada')
})

test('el esperado puede quedar negativo si se retiró más de lo que había', () => {
  // No es un error de cálculo: es una situación real que el arqueo debe
  // reportar tal cual para que el encargado la investigue.
  const r = calcularArqueo({
    balanceInicial: 100,
    cobrosEfectivo: 0,
    entradas: 0,
    salidas: 500,
    balanceFinal: 0,
  })
  assert.equal(r.balanceEsperado, -400)
  assert.equal(r.diferencia, 400)
  assert.equal(r.estado, 'SOBRANTE')
})
