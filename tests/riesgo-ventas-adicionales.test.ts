import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ETIQUETA_TIPO_DE_SENAL, evaluarEmpresa, UMBRALES, type MetricasDeEmpresa } from '../src/modules/riesgo-comercio/domain'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · la señal de subreporte de ventas adicionales (§45, §49).
 * Una SEÑAL para conversar; nunca una nota ni una sanción. Ejecutar: npm test
 */

const base: MetricasDeEmpresa = {
  companyId: 'c1', empresa: 'Café Central', pedidos: 0, cancelados: 0, completados: 0, reembolsados: 0, sinAtender: 0, conAjusteGrande: 0, saldo: null, limiteDeCredito: null, estadoDeCuenta: null,
}

const soloExtras = (m: MetricasDeEmpresa) => evaluarEmpresa(m).filter((s) => s.tipo === 'PROVEEDOR_SUBREPORTE_VENTAS_ADICIONALES')

test('pocas visitas: no hay señal (sin volumen no se opina)', () => {
  assert.equal(soloExtras({ ...base, visitasCerradas: UMBRALES.extras.minimoDeVisitas - 1, visitasConExtras: 0 }).length, 0)
})

test('muchas visitas cerradas y casi ninguna con extras: señal MEDIA al 5 %, ALTA al 1 %', () => {
  const media = soloExtras({ ...base, visitasCerradas: 100, visitasConExtras: 5 })
  assert.equal(media.length, 1)
  assert.equal(media[0]!.severidad, 'MEDIA')
  assert.match(media[0]!.detalle, /señal para revisar/)
  const alta = soloExtras({ ...base, visitasCerradas: 100, visitasConExtras: 1 })
  assert.equal(alta[0]!.severidad, 'ALTA')
  assert.equal(soloExtras({ ...base, visitasCerradas: 100, visitasConExtras: 30 }).length, 0, 'con extras normales no hay señal')
})

test('disputas a favor del cliente sobre las ventas: señal MEDIA al 20 %, ALTA al 40 %; sin ventas suficientes, nada', () => {
  assert.equal(soloExtras({ ...base, ventasAdicionales: 4, disputasAFavorDelCliente: 4 }).length, 0)
  assert.equal(soloExtras({ ...base, ventasAdicionales: 10, disputasAFavorDelCliente: 2 })[0]!.severidad, 'MEDIA')
  assert.equal(soloExtras({ ...base, ventasAdicionales: 10, disputasAFavorDelCliente: 4 })[0]!.severidad, 'ALTA')
  assert.equal(soloExtras({ ...base, ventasAdicionales: 10, disputasAFavorDelCliente: 1 }).length, 0)
})

test('la señal tiene etiqueta y sigue siendo una señal de empresa (no toca al cliente)', () => {
  assert.equal(ETIQUETA_TIPO_DE_SENAL.PROVEEDOR_SUBREPORTE_VENTAS_ADICIONALES, 'Ventas adicionales')
  const s = soloExtras({ ...base, visitasCerradas: 50, visitasConExtras: 0 })[0]!
  assert.equal(s.sujeto.tipo, 'EMPRESA')
  assert.equal(s.sujeto.id, 'c1')
})
