import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarDisponibilidad,
  validarDisponibilidadCombo,
  validarDisponibilidadComboMultiFecha,
} from '../src/modules/excursiones/reservas/nucleo'

test('validarDisponibilidadCombo: el cupo disponible del combo está delimitado por el menor cupo entre sus actividades hijas', () => {
  const comboConfig = {
    capacidad: 50,
    nombre: 'Super Combo Aventura',
    actividades: [
      {
        id: 'act-1',
        nombre: 'Buggies',
        tipoItem: 'ACTIVIDAD',
        capacidad: 20,
        duracionMin: 120,
        horaSalida: '09:00',
        horarios: [
          { id: 'h1', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '09:00', cupo: 20 },
        ],
      },
      {
        id: 'act-2',
        nombre: 'Paseo en Catamarán Saona',
        tipoItem: 'ACTIVIDAD',
        capacidad: 8, // Solo 8 cupos
        duracionMin: 180,
        horaSalida: '11:30',
        horarios: [
          { id: 'h2', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '11:30', cupo: 8 },
        ],
      },
    ],
  }

  const fecha = new Date(Date.UTC(2026, 8, 1)) // 2026-09-01
  const res = validarDisponibilidadCombo(fecha, '09:00', 5, comboConfig)

  assert.equal(res.ok, true, 'Debe aprobar la reserva de 5 pasajeros')
  if (res.ok) {
    assert.equal(res.cupoDisponible, 8, 'El cupo del combo debe ser 8 (limitado por el Catamarán)')
  }
})

test('validarDisponibilidadCombo: rechaza si los pasajeros exceden el cupo de alguna actividad hija aunque el combo tenga capacidad', () => {
  const comboConfig = {
    capacidad: 50, // Combo dice 50
    nombre: 'Mega Combo Extremo',
    actividades: [
      {
        id: 'act-1',
        nombre: 'Buggies',
        tipoItem: 'ACTIVIDAD',
        capacidad: 30,
        duracionMin: 120,
        horaSalida: '09:00',
        horarios: [
          { id: 'h1', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '09:00', cupo: 30 },
        ],
      },
      {
        id: 'act-2',
        nombre: 'Zipline Canopy',
        tipoItem: 'ACTIVIDAD',
        capacidad: 4, // Solo 4 cupos
        duracionMin: 90,
        horaSalida: '11:30',
        horarios: [
          { id: 'h2', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '11:30', cupo: 4 },
        ],
      },
    ],
  }

  const fecha = new Date(Date.UTC(2026, 8, 1))
  const res = validarDisponibilidadCombo(fecha, '09:00', 6, comboConfig)

  assert.equal(res.ok, false, 'Debe rechazar la reserva de 6 pasajeros')
  assert.ok(
    res.error?.includes('Zipline Canopy') && res.error?.includes('cupo disponible (4 cupos)'),
    `El error debe indicar que Zipline Canopy excede el cupo disponible: ${res.error}`
  )
})

test('Agregador de ocupación: suma reservas directas e items de combos sobre la misma actividad y turno', () => {
  // Simulación del comportamiento del motor de BD:
  // Capacidad de la actividad = 15
  const capacidadActividad = 15

  // Reservas directas en la actividad a las 09:00
  const reservasDirectas = [
    { fecha: '2026-09-01', hora: '09:00', adultos: 3, ninos: 2 }, // 5 pax
    { fecha: '2026-09-01', hora: '09:00', adultos: 2, ninos: 0 }, // 2 pax
  ]

  // Reservas de combos que incluyeron esta actividad a las 09:00
  const reservasItemsDeCombos = [
    { fecha: '2026-09-01', hora: '09:00', adultos: 4, ninos: 1 }, // 5 pax
  ]

  const reservasMap = new Map<string, number>()
  for (const r of reservasDirectas) {
    const key = `${r.fecha}|${r.hora}`
    reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
  }
  for (const r of reservasItemsDeCombos) {
    const key = `${r.fecha}|${r.hora}`
    reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
  }

  const ocupadosTotal = reservasMap.get('2026-09-01|09:00') || 0
  const cupoDisponible = Math.max(0, capacidadActividad - ocupadosTotal)

  assert.equal(ocupadosTotal, 12, 'Total ocupados debe ser 5 directos + 2 directos + 5 de combos = 12')
  assert.equal(cupoDisponible, 3, 'Cupo disponible debe ser 15 - 12 = 3')
})

test('validarDisponibilidadComboMultiFecha: calcula cupo mínimo en fechas distintas', () => {
  const comboConfig = {
    capacidad: 30,
    nombre: 'Combo 2 Días',
    actividades: [
      {
        id: 'act-1',
        nombre: 'Paseo en Buggy',
        tipoItem: 'ACTIVIDAD',
        capacidad: 25,
        duracionMin: 120,
        horaSalida: '09:00',
        horarios: [
          { id: 'h1', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '09:00', cupo: 25 },
        ],
      },
      {
        id: 'act-2',
        nombre: 'Día de Buceo y Snorkel',
        tipoItem: 'ACTIVIDAD',
        capacidad: 6, // Solo 6 cupos
        duracionMin: 180,
        horaSalida: '10:00',
        horarios: [
          { id: 'h2', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '10:00', cupo: 6 },
        ],
      },
    ],
  }

  const fechaDia1 = new Date(Date.UTC(2026, 8, 1))
  const fechaDia2 = new Date(Date.UTC(2026, 8, 2))

  const items = [
    { actividadId: 'act-1', fecha: fechaDia1, hora: '09:00' },
    { actividadId: 'act-2', fecha: fechaDia2, hora: '10:00' },
  ]

  const resOk = validarDisponibilidadComboMultiFecha(4, comboConfig, items)
  assert.equal(resOk.ok, true, 'Debe aceptar 4 pasajeros')
  if (resOk.ok) {
    assert.equal(resOk.cupoDisponible, 6, 'El cupo debe ser 6 (limitado por el día de buceo)')
  }

  const resExcedido = validarDisponibilidadComboMultiFecha(7, comboConfig, items)
  assert.equal(resExcedido.ok, false, 'Debe rechazar 7 pasajeros')
  assert.ok(
    resExcedido.error?.includes('Día de Buceo y Snorkel') && resExcedido.error?.includes('6 cupos'),
    `El error debe indicar que excede cupos en la actividad: ${resExcedido.error}`
  )
})
