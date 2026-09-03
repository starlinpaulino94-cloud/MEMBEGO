import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  obtenerDetalleConversion,
  convertirMoneda,
  resolver,
} from '../src/modules/excursiones/config'
import {
  netoComision,
} from '../src/modules/excursiones/comisiones/nucleo'
import {
  totalLiquidacion,
} from '../src/modules/excursiones/liquidaciones/nucleo'

test('obtenerDetalleConversion: misma divisa no genera conversión', () => {
  const detalle = obtenerDetalleConversion(1500, 'DOP', 'DOP', { USD_DOP: 58.5 })
  assert.equal(detalle.esConversion, false)
  assert.equal(detalle.montoOriginal, 1500)
  assert.equal(detalle.montoConvertido, 1500)
  assert.equal(detalle.monedaOriginal, 'DOP')
  assert.equal(detalle.monedaDestino, 'DOP')
  assert.equal(detalle.tasaConfigurada, true)
  assert.equal(detalle.tasa, 1)
})

test('obtenerDetalleConversion: tasa directa convierte monto y formatea tasaLabel', () => {
  const tasas = { USD_DOP: 58.5 }
  const detalle = obtenerDetalleConversion(100, 'USD', 'DOP', tasas)

  assert.equal(detalle.esConversion, true)
  assert.equal(detalle.montoOriginal, 100)
  assert.equal(detalle.montoConvertido, 5850)
  assert.equal(detalle.monedaOriginal, 'USD')
  assert.equal(detalle.monedaDestino, 'DOP')
  assert.equal(detalle.tasa, 58.5)
  assert.equal(detalle.tasaConfigurada, true)
  assert.equal(detalle.esInversa, false)
  assert.equal(detalle.tasaLabel, '1 USD = 58.5 DOP')
})

test('obtenerDetalleConversion: tasa inversa calcula correctamente cuando solo existe la tasa en sentido opuesto', () => {
  const tasas = { USD_DOP: 58.5 }
  const detalle = obtenerDetalleConversion(5850, 'DOP', 'USD', tasas)

  assert.equal(detalle.esConversion, true)
  assert.equal(detalle.montoOriginal, 5850)
  assert.equal(detalle.montoConvertido, 100)
  assert.equal(detalle.monedaOriginal, 'DOP')
  assert.equal(detalle.monedaDestino, 'USD')
  assert.equal(detalle.tasa, 1 / 58.5)
  assert.equal(detalle.tasaConfigurada, true)
  assert.equal(detalle.esInversa, true)
  assert.equal(detalle.tasaLabel, '1 USD = 58.5 DOP')
})

test('obtenerDetalleConversion: divisa sin tasa configurada hace fallback 1:1 con bandera tasaConfigurada: false', () => {
  const tasas = { USD_DOP: 58.5 }
  const detalle = obtenerDetalleConversion(250, 'EUR', 'DOP', tasas)

  assert.equal(detalle.esConversion, true)
  assert.equal(detalle.montoOriginal, 250)
  assert.equal(detalle.montoConvertido, 250)
  assert.equal(detalle.monedaOriginal, 'EUR')
  assert.equal(detalle.monedaDestino, 'DOP')
  assert.equal(detalle.tasa, 1)
  assert.equal(detalle.tasaConfigurada, false)
  assert.equal(detalle.tasaLabel, '1:1 (Tasa no configurada)')
})

test('obtenerDetalleConversion: normaliza códigos de divisa en minúsculas y maneja números decimales', () => {
  const tasas = { USD_DOP: 58.5 }
  const detalle = obtenerDetalleConversion(10.55, 'usd', 'dop', tasas)

  assert.equal(detalle.monedaOriginal, 'USD')
  assert.equal(detalle.monedaDestino, 'DOP')
  // 10.55 * 58.5 = 617.175 -> redondeado a centavos 617.18
  assert.equal(detalle.montoConvertido, 617.18)
})

test('convertirMoneda: delega a obtenerDetalleConversion y redondea a dos decimales', () => {
  const tasas = { USD_DOP: 60 }
  assert.equal(convertirMoneda(10, 'USD', 'DOP', tasas), 600)
  assert.equal(convertirMoneda(600, 'DOP', 'USD', tasas), 10)
  assert.equal(convertirMoneda(500, 'DOP', 'DOP', tasas), 500)
  assert.equal(convertirMoneda(100, 'EUR', 'DOP', tasas), 100)
})

test('resolver: preserva monedaDefecto y tasasCambio válidas', () => {
  const config = resolver({
    monedaDefecto: 'USD',
    tasasCambio: {
      USD_DOP: 58.5,
      EUR_USD: 1.08,
    },
  })

  assert.equal(config.monedaDefecto, 'USD')
  assert.deepEqual(config.tasasCambio, {
    USD_DOP: 58.5,
    EUR_USD: 1.08,
  })
})

test('consolidación de liquidación multi-moneda con comisiones en USD y DOP', () => {
  const tasas = { USD_DOP: 58.5 }
  const monedaBase = 'DOP'

  // Simulación de 3 comisiones:
  // Comisión 1: 50 USD
  // Comisión 2: 1,000 DOP
  // Comisión 3: 20 USD con un ajuste de -5 USD -> neto 15 USD
  const comisiones = [
    { monto: 50, moneda: 'USD', ajustes: [] },
    { monto: 1000, moneda: 'DOP', ajustes: [] },
    { monto: 20, moneda: 'USD', ajustes: [{ monto: -5 }] },
  ]

  const lineasProcesadas = comisiones.map((c) => {
    const netoOrig = netoComision(c.monto, c.ajustes)
    const conv = obtenerDetalleConversion(netoOrig, c.moneda, monedaBase, tasas)
    return {
      netoOriginal: netoOrig,
      monedaOriginal: c.moneda,
      netoConvertido: conv.montoConvertido,
      conversion: conv,
    }
  })

  assert.equal(lineasProcesadas[0].netoConvertido, 50 * 58.5) // 2925
  assert.equal(lineasProcesadas[1].netoConvertido, 1000)      // 1000
  assert.equal(lineasProcesadas[2].netoConvertido, 15 * 58.5) // 877.5

  const total = totalLiquidacion(lineasProcesadas.map((l) => l.netoConvertido))
  // 2925 + 1000 + 877.5 = 4802.5
  assert.equal(total, 4802.5)

  // Verificamos que se detectan las 2 comisiones convertidas y 1 sin conversión
  const convertidas = lineasProcesadas.filter((l) => l.conversion.esConversion)
  assert.equal(convertidas.length, 2)
  assert.equal(convertidas[0].conversion.tasaLabel, '1 USD = 58.5 DOP')
})
