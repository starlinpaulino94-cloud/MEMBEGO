import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  totalMonetarioComisiones,
  esRemuneracionEspecie,
  resumenRemuneracionLiquidacion,
  type LineaLiquidacionParaResumen,
  type BonoLiquidacionParaResumen,
} from '../src/modules/excursiones/liquidaciones/nucleo'

test('esRemuneracionEspecie identifica PAQUETE_REGALO como especie', () => {
  assert.equal(esRemuneracionEspecie('PAQUETE_REGALO'), true)
  assert.equal(esRemuneracionEspecie('PORCENTAJE'), false)
  assert.equal(esRemuneracionEspecie('FIJO_ADULTO'), false)
  assert.equal(esRemuneracionEspecie(null), false)
})

test('totalMonetarioComisiones excluye paquetes de regalo del total en efectivo', () => {
  const comisiones = [
    { neto: 1000, tipoCalculo: 'PORCENTAJE' },
    { neto: 500, tipoCalculo: 'FIJO_VENTA' },
    { neto: 3500, tipoCalculo: 'PAQUETE_REGALO' }, // Voucher en especie, no dinero
    { neto: 250, tipoCalculo: 'FIJO_ADULTO' },
  ]
  const total = totalMonetarioComisiones(comisiones)
  assert.equal(total, 1750) // 1000 + 500 + 250 (excluye 3500 de regalo)
})

test('resumenRemuneracionLiquidacion agrupa por conceptos y separa especie de efectivo', () => {
  const lineas: LineaLiquidacionParaResumen[] = [
    {
      id: 'c1',
      tipoCalculo: 'PORCENTAJE',
      monto: 1000,
      neto: 900,
      ajustes: [{ monto: -100, motivo: 'Penalidad' }],
      desglose: '10% sobre 10000',
    },
    {
      id: 'c2',
      tipoCalculo: 'FIJO_ADULTO',
      monto: 400,
      neto: 450,
      ajustes: [{ monto: 50, motivo: 'Bono puntual' }],
      desglose: '200 x 2 adultos',
    },
    {
      id: 'c3',
      tipoCalculo: 'FIJO_NINO',
      monto: 200,
      neto: 200,
      ajustes: [],
      desglose: '100 x 2 niños',
    },
    {
      id: 'c4',
      tipoCalculo: 'ESCALON',
      monto: 1500,
      neto: 1500,
      ajustes: [],
      desglose: '15% sobre 10000 (tramo 10+ pax)',
    },
    {
      id: 'c5',
      tipoCalculo: 'PAQUETE_REGALO',
      monto: 3500,
      neto: 3500,
      ajustes: [],
      desglose: '¡Meta cumplida! Paquete de regalo otorgado: Saona VIP',
    },
  ]

  const bonos: BonoLiquidacionParaResumen[] = [
    {
      id: 'b1',
      descripcion: 'Bono meta mensual 50 pasajeros alcanzada',
      monto: 2000,
    },
  ]

  const resumen = resumenRemuneracionLiquidacion(lineas, bonos)

  // Porcentaje
  assert.equal(resumen.porcentaje.total, 900)
  assert.equal(resumen.porcentaje.cantidad, 1)

  // Fijo adulto
  assert.equal(resumen.fijoAdulto.total, 450)
  assert.equal(resumen.fijoAdulto.cantidad, 1)

  // Fijo niño
  assert.equal(resumen.fijoNino.total, 200)
  assert.equal(resumen.fijoNino.cantidad, 1)

  // Escalón
  assert.equal(resumen.escalon.total, 1500)
  assert.equal(resumen.escalon.cantidad, 1)

  // Bonos por metas
  assert.equal(resumen.bonosMetas.total, 2000)
  assert.equal(resumen.bonosMetas.cantidad, 1)

  // Ajustes
  assert.equal(resumen.ajustesPositivos.total, 50)
  assert.equal(resumen.ajustesPositivos.cantidad, 1)
  assert.equal(resumen.ajustesNegativos.total, 100)
  assert.equal(resumen.ajustesNegativos.cantidad, 1)

  // Premios en especie
  assert.equal(resumen.premiosEspecie.cantidad, 1)
  assert.equal(resumen.premiosEspecie.valorEstimado, 3500)
  assert.equal(resumen.premiosEspecie.descripciones.length, 1)

  // Total monetario a transferir: 900 + 450 + 200 + 1500 + 2000 = 5050
  assert.equal(resumen.totalMonetario, 5050)
})
