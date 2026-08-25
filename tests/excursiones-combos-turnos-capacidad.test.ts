import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generarCombinacionesCombo,
  validarDisponibilidadComboMultiFecha,
  validarItinerarioCombo,
  autoResolverItinerarioCombo,
  optimizarItinerarioCombo,
} from '../src/modules/excursiones/reservas/nucleo'

test('generarCombinacionesCombo soporta Daypasses sin obligar solapamiento horario', () => {
  const actividades = [
    {
      id: 'act-1',
      nombre: 'Buggies Aventura',
      tipoItem: 'ACTIVIDAD',
      duracionMin: 120, // 2h
      horaSalida: '09:00',
      horarios: [
        { id: 'h1', horaSalida: '09:00', diasSemana: [1, 2, 3, 4, 5, 6, 7] },
        { id: 'h2', horaSalida: '14:00', diasSemana: [1, 2, 3, 4, 5, 6, 7] },
      ],
    },
    {
      id: 'act-2',
      nombre: 'Catamarán Saona',
      tipoItem: 'ACTIVIDAD',
      duracionMin: 180, // 3h
      horaSalida: '11:30',
      horarios: [
        { id: 'h3', horaSalida: '11:30', diasSemana: [1, 2, 3, 4, 5, 6, 7] },
        { id: 'h4', horaSalida: '16:30', diasSemana: [1, 2, 3, 4, 5, 6, 7] },
      ],
    },
    {
      id: 'act-3',
      nombre: 'Club de Playa Daypass',
      tipoItem: 'PASE_DIA',
      duracionMin: null,
      horaSalida: null,
      horarios: [],
    },
  ]

  const combinaciones = generarCombinacionesCombo(actividades)
  assert.ok(combinaciones.length > 0, 'Debe generar combinaciones válidas')

  // Comprobar que en las combinaciones, solo se calculan las actividades con horario
  const primera = combinaciones[0]
  assert.equal(primera.horariosAsignados['act-1'], '09:00')
  assert.equal(primera.horariosAsignados['act-2'], '11:30')
  assert.equal(primera.horariosAsignados['act-3'], undefined, 'El daypass no debe tener asignado horario en los turnos')
  assert.equal(primera.resumenTexto, '9:00 AM Buggies Aventura ➔ 11:30 AM Catamarán Saona')
})

test('validarDisponibilidadComboMultiFecha permite agendar en fechas distintas respetando días operativos', () => {
  const comboConfig = {
    capacidad: 50,
    actividades: [
      {
        id: 'act-1',
        nombre: 'Buggies',
        tipoItem: 'ACTIVIDAD',
        capacidad: 20,
        duracionMin: 120,
        horaSalida: '09:00',
        horarios: [
          { id: 'h1', diasSemana: [1, 2, 3, 4, 5], horaSalida: '09:00', cupo: 20 },
        ],
      },
      {
        id: 'act-2',
        nombre: 'Daypass Resort',
        tipoItem: 'PASE_DIA',
        capacidad: 30,
        duracionMin: null,
        horaSalida: null,
        horarios: [],
      },
    ],
  }

  // Fecha 1: Lunes 2026-08-31 (Día semana 1)
  const fechaLunes = new Date(Date.UTC(2026, 7, 31))
  // Fecha 2: Martes 2026-09-01 (Día semana 2)
  const fechaMartes = new Date(Date.UTC(2026, 8, 1))

  const itemsValidos = [
    { actividadId: 'act-1', fecha: fechaLunes, hora: '09:00' },
    { actividadId: 'act-2', fecha: fechaMartes, hora: null },
  ]

  const resValida = validarDisponibilidadComboMultiFecha(4, comboConfig, itemsValidos)
  assert.equal(resValida.ok, true, 'Debe ser válida la reserva multi-fecha')

  // Fecha Domingo 2026-09-06 (Día semana 7 - no opera Buggies)
  const fechaDomingo = new Date(Date.UTC(2026, 8, 6))
  const itemsInoperativos = [
    { actividadId: 'act-1', fecha: fechaDomingo, hora: '09:00' },
    { actividadId: 'act-2', fecha: fechaMartes, hora: null },
  ]

  const resInvalida = validarDisponibilidadComboMultiFecha(4, comboConfig, itemsInoperativos)
  assert.equal(resInvalida.ok, false)
  assert.ok(resInvalida.error?.includes('no opera'), 'Debe rechazar días no operativos')
})

test('validarDisponibilidadComboMultiFecha detecta solapamiento si coinciden el mismo día', () => {
  const comboConfig = {
    capacidad: 50,
    actividades: [
      {
        id: 'act-1',
        nombre: 'Buggies',
        tipoItem: 'ACTIVIDAD',
        capacidad: 20,
        duracionMin: 120, // 09:00 a 11:00
        horaSalida: '09:00',
        horarios: [
          { id: 'h1', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '09:00', cupo: 20 },
        ],
      },
      {
        id: 'act-2',
        nombre: 'Zipline',
        tipoItem: 'ACTIVIDAD',
        capacidad: 20,
        duracionMin: 90,
        horaSalida: '10:00', // Solapa a las 10:00
        horarios: [
          { id: 'h2', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '10:00', cupo: 20 },
        ],
      },
    ],
  }

  const mismaFecha = new Date(Date.UTC(2026, 7, 31))
  const itemsSolapados = [
    { actividadId: 'act-1', fecha: mismaFecha, hora: '09:00' },
    { actividadId: 'act-2', fecha: mismaFecha, hora: '10:00' },
  ]

  const res = validarDisponibilidadComboMultiFecha(2, comboConfig, itemsSolapados)
  assert.equal(res.ok, false)
  assert.ok(
    res.error?.includes('Conflicto de horario') || res.error?.includes('solaparse'),
    'Debe detectar cruce de horario en el mismo día'
  )
})
