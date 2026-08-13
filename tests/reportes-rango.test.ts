import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leerRango,
  diaLocal,
  limiteDiaLocal,
  sumarDias,
  diasDelRango,
  variacion,
  paramsDeRango,
  MAX_DIAS_SERIE,
} from '../src/modules/reportes/rango'

/**
 * Si el corte de fechas se equivoca, el reporte no "se ve raro": dice una cifra
 * de ingresos que no cuadra con la caja. Por eso todo se prueba con un reloj
 * fijo y con la zona horaria real del negocio.
 */

const TZ = 'America/Santo_Domingo' // UTC-4 todo el año, sin horario de verano

test('el día local no se adelanta por culpa de UTC', () => {
  // 21:00 del 31 de enero en Santo Domingo son las 01:00 del 1 de febrero UTC.
  const nocheDelUltimoDia = new Date('2026-02-01T01:00:00Z')
  assert.equal(diaLocal(nocheDelUltimoDia, TZ), '2026-01-31')
  assert.equal(diaLocal(nocheDelUltimoDia, 'UTC'), '2026-02-01')
})

test('los límites del día son medianoche local, no medianoche UTC', () => {
  assert.equal(limiteDiaLocal('2026-01-31', TZ).toISOString(), '2026-01-31T04:00:00.000Z')
  assert.equal(limiteDiaLocal('2026-01-31', TZ, true).toISOString(), '2026-02-01T04:00:00.000Z')
})

test('una venta de la noche entra en el mes correcto', () => {
  const rango = leerRango({ rango: 'mes' }, TZ, new Date('2026-01-31T20:00:00Z'))
  const ventaNocturna = new Date('2026-02-01T01:00:00Z') // 31 de enero, 21:00 local
  assert.ok(
    ventaNocturna >= rango.desde && ventaNocturna < rango.hasta,
    'la venta de la noche del 31 pertenece a enero'
  )
})

test('sin parámetros usa los últimos 30 días terminando hoy', () => {
  const r = leerRango({}, TZ, new Date('2026-03-15T15:00:00Z'))
  assert.equal(r.preset, '30d')
  assert.equal(r.hastaDia, '2026-03-15')
  assert.equal(r.desdeDia, '2026-02-14')
  assert.equal(r.dias, 30)
})

test('cada preset cubre lo que promete su nombre', () => {
  const ahora = new Date('2026-03-15T15:00:00Z')
  const hoy = leerRango({ rango: 'hoy' }, TZ, ahora)
  assert.equal(hoy.dias, 1)
  assert.equal(hoy.desdeDia, '2026-03-15')

  const semana = leerRango({ rango: '7d' }, TZ, ahora)
  assert.equal(semana.dias, 7)
  assert.equal(semana.desdeDia, '2026-03-09')

  const mes = leerRango({ rango: 'mes' }, TZ, ahora)
  assert.equal(mes.desdeDia, '2026-03-01')
  assert.equal(mes.hastaDia, '2026-03-15')

  const pasado = leerRango({ rango: 'mes-pasado' }, TZ, ahora)
  assert.equal(pasado.desdeDia, '2026-02-01')
  assert.equal(pasado.hastaDia, '2026-02-28', 'febrero de 2026 tiene 28 días')
})

test('«mes pasado» acierta en año bisiesto y al cruzar de año', () => {
  const bisiesto = leerRango({ rango: 'mes-pasado' }, TZ, new Date('2028-03-10T15:00:00Z'))
  assert.equal(bisiesto.hastaDia, '2028-02-29')

  const enero = leerRango({ rango: 'mes-pasado' }, TZ, new Date('2026-01-10T15:00:00Z'))
  assert.equal(enero.desdeDia, '2025-12-01')
  assert.equal(enero.hastaDia, '2025-12-31')
})

test('el periodo anterior tiene los mismos días, pegado al actual', () => {
  const r = leerRango({ rango: '7d' }, TZ, new Date('2026-03-15T15:00:00Z'))
  assert.equal(r.anterior.hastaDia, '2026-03-08', 'termina justo antes del actual')
  assert.equal(r.anterior.desdeDia, '2026-03-02')
  // Un mes de 31 días comparado contra uno de 30 inventaría una caída del 3%.
  const mes = leerRango({ rango: 'mes-pasado' }, TZ, new Date('2026-04-10T15:00:00Z'))
  assert.equal(mes.dias, 31, 'marzo')
  const anterioresDias =
    (Date.parse(`${mes.anterior.hastaDia}T12:00:00Z`) -
      Date.parse(`${mes.anterior.desdeDia}T12:00:00Z`)) /
      86_400_000 +
    1
  assert.equal(anterioresDias, 31)
})

test('las fechas a mano ganan al preset y se ordenan solas', () => {
  const r = leerRango({ rango: 'hoy', desde: '2026-02-10', hasta: '2026-02-01' }, TZ)
  assert.equal(r.preset, 'personalizado')
  assert.equal(r.desdeDia, '2026-02-01')
  assert.equal(r.hastaDia, '2026-02-10')
  assert.equal(r.dias, 10)
})

test('la basura en la URL no rompe el reporte', () => {
  const ahora = new Date('2026-03-15T15:00:00Z')
  assert.equal(leerRango({ rango: 'inventado' }, TZ, ahora).preset, '30d')
  assert.equal(leerRango({ desde: 'ayer', hasta: 'hoy' }, TZ, ahora).preset, '30d')
  // Una sola fecha no alcanza para un rango: se ignora.
  assert.equal(leerRango({ desde: '2026-01-01' }, TZ, ahora).preset, '30d')
})

test('la serie diaria incluye los días sin datos y tiene tope', () => {
  const r = leerRango({ rango: '7d' }, TZ, new Date('2026-03-15T15:00:00Z'))
  const dias = diasDelRango(r)
  assert.equal(dias.length, 7)
  assert.equal(dias[0], '2026-03-09')
  assert.equal(dias.at(-1), '2026-03-15')

  const enorme = diasDelRango({ desdeDia: '2020-01-01', dias: 5000 })
  assert.equal(enorme.length, MAX_DIAS_SERIE)
})

test('sumarDias cruza meses y años sin desviarse', () => {
  assert.equal(sumarDias('2026-02-28', 1), '2026-03-01')
  assert.equal(sumarDias('2028-02-28', 1), '2028-02-29')
  assert.equal(sumarDias('2026-01-01', -1), '2025-12-31')
})

test('la variación no inventa porcentajes sobre cero', () => {
  assert.equal(variacion(150, 100), 50)
  assert.equal(variacion(50, 100), -50)
  assert.equal(variacion(0, 100), -100)
  assert.equal(variacion(5, 0), null, 'sin base no hay porcentaje que enseñar')
  assert.equal(variacion(0, 0), null)
})

test('paramsDeRango deja limpia la URL por defecto', () => {
  const ahora = new Date('2026-03-15T15:00:00Z')
  assert.equal(paramsDeRango(leerRango({}, TZ, ahora)), '')
  assert.equal(paramsDeRango(leerRango({ rango: 'hoy' }, TZ, ahora)), '?rango=hoy')
  assert.equal(
    paramsDeRango(leerRango({ desde: '2026-01-01', hasta: '2026-01-31' }, TZ, ahora)),
    '?desde=2026-01-01&hasta=2026-01-31'
  )
})

// ── CSV del reporte ─────────────────────────────────────────────────────────
// Vive en `queries.ts` junto a las consultas, pero la función es pura: importar
// el módulo no abre conexión (el cliente de Prisma es perezoso).

const kpi = (valor: number, anterior = 0, variacion: number | null = null) => ({
  valor,
  anterior,
  variacion,
})

const CONTEXTO = { empresa: 'Car Wash Bella Vista', desdeDia: '2026-03-01', hastaDia: '2026-03-02', dias: 2 }

const REPORTE = {
  ingresosCaja: kpi(1500.5, 1000, 50),
  ingresosMembresias: kpi(800),
  operaciones: kpi(2),
  entregas: kpi(4),
  clientesNuevos: kpi(3),
  serie: [
    { dia: '2026-03-01', ventas: 2, entregas: 1, ingresos: 1500.5 },
    { dia: '2026-03-02', ventas: 0, entregas: 3, ingresos: 0 },
  ],
  porTipo: [{ tipo: 'SALE', operaciones: 2, ingresos: 1500.5 }],
  porMetodo: [{ metodo: 'EFECTIVO', operaciones: 2, ingresos: 1500.5 }],
  topClientes: [{ nombre: 'Ramón Polanco', operaciones: 4 }],
  activasPorPlan: [{ plan: 'Mensual', count: 12 }],
  incompleto: false,
}

test('el CSV lleva la serie con su fila de TOTAL, que cuadra', async () => {
  const { reporteToCsv } = await import('../src/modules/reportes/queries')
  const csv = reporteToCsv(REPORTE, CONTEXTO)
  // Sin BOM, «Ramón Polanco» llega como «RamÃ³n Polanco».
  assert.match(csv, /^﻿/)
  // Cabeceras sin acentos, como el resto de las exportaciones del panel.
  assert.match(csv, /Dia;Ventas;Entregas sin cobro;Ingresos de caja/)
  assert.match(csv, /\n2026-03-01;2;1;1500\.50\n/)
  assert.match(csv, /\nTOTAL;2;4;1500\.50/)
})

test('el CSV trae los SEIS bloques del reporte, no solo la serie', async () => {
  // Exportaba únicamente la serie diaria: una sexta parte de lo que la pantalla
  // enseñaba, y sin ninguna señal de que faltara el resto.
  const { reporteToCsv } = await import('../src/modules/reportes/queries')
  const csv = reporteToCsv(REPORTE, CONTEXTO)
  for (const bloque of [
    'Alcance del reporte',
    'Totales',
    'Actividad por dia',
    'Operaciones por tipo',
    'Como pagaron',
    'Clientes mas activos',
    'Membresias activas por plan (foto de hoy)',
  ]) {
    assert.ok(csv.includes(bloque), `falta el bloque «${bloque}»`)
  }
  // Y las etiquetas son las de la pantalla, no los códigos internos.
  assert.ok(csv.includes('Efectivo'), 'el método sale con su nombre legible')
  assert.ok(csv.includes('Ramón Polanco'))
})

test('el alcance viaja DENTRO del archivo', async () => {
  // Un CSV descargado no lleva encima el periodo con el que se generó: sin
  // estas líneas, dos exportaciones del mismo día son indistinguibles.
  const { reporteToCsv } = await import('../src/modules/reportes/queries')
  const csv = reporteToCsv(REPORTE, CONTEXTO)
  assert.ok(csv.includes('Car Wash Bella Vista'))
  assert.ok(csv.includes('2026-03-01 a 2026-03-02'))
  assert.match(csv, /Datos completos;Si/)
})

test('si el reporte venía incompleto, el archivo lo dice', async () => {
  const { reporteToCsv } = await import('../src/modules/reportes/queries')
  const csv = reporteToCsv({ ...REPORTE, incompleto: true }, CONTEXTO)
  assert.match(csv, /Datos completos;NO - alguna consulta fallo/)
})

test('un periodo sin actividad sigue siendo un archivo válido', async () => {
  const { reporteToCsv } = await import('../src/modules/reportes/queries')
  const csv = reporteToCsv(
    {
      ...REPORTE,
      ingresosCaja: kpi(0),
      serie: [],
      porTipo: [],
      porMetodo: [],
      topClientes: [],
      activasPorPlan: [],
    },
    CONTEXTO
  )
  assert.match(csv, /\nTOTAL;0;0;0\.00/)
  // Los bloques vacíos siguen apareciendo con su cabecera: un bloque que
  // desaparece se confunde con uno que no se exporta.
  assert.ok(csv.includes('Como pagaron'))
})
