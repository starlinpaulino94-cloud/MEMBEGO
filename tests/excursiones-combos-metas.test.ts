import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarDisponibilidadCombo } from '@/modules/excursiones/reservas/nucleo'
import { validarMeta } from '@/modules/excursiones/metricas/nucleo'
import { rangoDeParametros } from '@/modules/excursiones/reportes/nucleo'

test('validarDisponibilidadCombo: valida cupo y días de todas las actividades hijas', () => {
  const fechaLunes = new Date('2026-10-12T12:00:00.000Z') // Lunes (día 1)
  const fechaDomingo = new Date('2026-10-18T12:00:00.000Z') // Domingo (día 0)

  const comboConfig = {
    nombre: 'Combo Caribe: Catamarán + Buggies',
    capacidad: 20,
    horaSalida: '09:00',
    horarios: [
      { id: 'h-combo', diasSemana: [1, 2, 3, 4, 5], horaSalida: '09:00', cupo: 20 }
    ],
    actividades: [
      {
        nombre: 'Catamarán Isla Saona',
        capacidad: 30,
        horaSalida: '09:00',
        horarios: [{ id: 'h1', diasSemana: [1, 2, 3, 4, 5], horaSalida: '09:00', cupo: 25 }]
      },
      {
        nombre: 'Buggies 4x4',
        capacidad: 15,
        horaSalida: '14:00',
        horarios: [{ id: 'h2', diasSemana: [1, 2, 3, 4, 5], horaSalida: '14:00', cupo: 10 }]
      }
    ]
  }

  // 1. Lunes con 4 pasajeros -> OK
  const resOk = validarDisponibilidadCombo(fechaLunes, '09:00', 4, comboConfig)
  assert.equal(resOk.ok, true)

  // 2. Domingo no opera el combo
  const resDomingo = validarDisponibilidadCombo(fechaDomingo, '09:00', 2, comboConfig)
  assert.equal(resDomingo.ok, false)
  assert.match(resDomingo.error ?? '', /no opera/i)

  // 3. Exceso de cupo en la actividad Buggies (máximo 10 cupos)
  const resExceso = validarDisponibilidadCombo(fechaLunes, '09:00', 12, comboConfig)
  assert.equal(resExceso.ok, false)
  assert.match(resExceso.error ?? '', /Buggies 4x4.*cupo/i)
})

test('validarMeta: acepta metas asignadas por tipo de vendedor o producto específico', () => {
  // 1. Meta para Touroperadores
  const resTipo = validarMeta({
    tipoVendedor: 'Touroperador',
    periodo: 'MENSUAL',
    metaVentas: '50',
    metaIngresos: '100000',
    excursionId: 'exc-combo-1',
  })
  assert.equal(resTipo.ok, true)
  if (resTipo.ok) {
    assert.equal(resTipo.datos.tipoVendedor, 'Touroperador')
    assert.equal(resTipo.datos.excursionId, 'exc-combo-1')
    assert.equal(resTipo.datos.metaVentas, 50)
    assert.equal(resTipo.datos.metaIngresos, 100000)
  }

  // 2. Meta global de empresa
  const resGlobal = validarMeta({
    ambito: 'GENERAL',
    periodo: 'MENSUAL',
    metaPasajeros: '200',
  })
  assert.equal(resGlobal.ok, true)
})

test('rangoDeParametros: procesa rangos de fechas con zona horaria de plataforma', () => {
  const ahora = new Date('2026-08-24T18:00:00.000Z')
  const rango = rangoDeParametros('2026-08-01', '2026-08-31', ahora)
  assert.ok(rango.desde instanceof Date)
  assert.ok(rango.hasta instanceof Date)
  assert.ok(rango.desde < rango.hasta)
})
