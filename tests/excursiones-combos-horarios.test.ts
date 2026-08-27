import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  minutosDesdeMedianoche,
  formatoMinutosAHora,
  diasComunesCombo,
  validarItinerarioCombo,
  validarDisponibilidadCombo,
  autoResolverItinerarioCombo,
  optimizarItinerarioCombo,
  generarCombinacionesCombo,
} from '@/modules/excursiones/reservas/nucleo'

test('minutosDesdeMedianoche y formatoMinutosAHora: conversión exacta bidireccional', () => {
  assert.equal(minutosDesdeMedianoche('00:00'), 0)
  assert.equal(minutosDesdeMedianoche('09:30'), 570)
  assert.equal(minutosDesdeMedianoche('14:15'), 855)
  assert.equal(minutosDesdeMedianoche('23:59'), 1439)

  assert.equal(formatoMinutosAHora(0), '00:00')
  assert.equal(formatoMinutosAHora(570), '09:30')
  assert.equal(formatoMinutosAHora(855), '14:15')
})

test('diasComunesCombo: calcula la intersección estricta de días de operación de las actividades', () => {
  const catamaran = {
    horarios: [
      { id: 'h1', horaSalida: '09:00', diasSemana: [1, 2, 3, 4, 5], cupo: 20 }, // Lun a Vie
    ],
  }
  const buggies = {
    horarios: [
      { id: 'h2', horaSalida: '14:00', diasSemana: [3, 4, 5, 6, 7], cupo: 15 }, // Mié a Dom
    ],
  }

  // Intersección: Mié(3), Jue(4), Vie(5)
  const comunes = diasComunesCombo([catamaran, buggies])
  assert.deepEqual(comunes, [3, 4, 5])

  // Si una actividad opera solo findes [6,7] y otra solo laborables [1,2,3,4,5] -> []
  const findes = { horarios: [{ id: 'h3', horaSalida: '10:00', diasSemana: [6, 7], cupo: 10 }] }
  assert.deepEqual(diasComunesCombo([catamaran, findes]), [])
})

test('validarItinerarioCombo: aprueba actividades consecutivas sin solapamiento en el mismo día', () => {
  const actividades = [
    {
      id: 'act-2',
      nombre: 'Buggies 4x4',
      horaSalida: '14:00',
      duracionMin: 120, // 14:00 a 16:00
      horaRegreso: '16:00',
    },
    {
      id: 'act-1',
      nombre: 'Catamarán Saona',
      horaSalida: '09:00',
      duracionMin: 180, // 09:00 a 12:00
      horaRegreso: '12:00',
    },
  ]

  const res = validarItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.itinerario.length, 2)
    // Se ordenan cronológicamente
    assert.equal(res.itinerario[0].nombre, 'Catamarán Saona')
    assert.equal(res.itinerario[0].inicio, '09:00')
    assert.equal(res.itinerario[0].fin, '12:00')

    assert.equal(res.itinerario[1].nombre, 'Buggies 4x4')
    assert.equal(res.itinerario[1].inicio, '14:00')
    assert.equal(res.itinerario[1].fin, '16:00')
  }
})

test('validarItinerarioCombo: detecta y rechaza solapamiento de horas en el mismo día', () => {
  const actividadesConConflicto = [
    {
      id: 'act-1',
      nombre: 'Catamarán Saona',
      horaSalida: '09:00',
      duracionMin: 240, // 09:00 a 13:00 (termina a la 1:00 PM)
      horaRegreso: '13:00',
    },
    {
      id: 'act-2',
      nombre: 'Buggies 4x4',
      horaSalida: '12:30', // Inicia a las 12:30 PM -> ¡Conflicto de 30 minutos!
      duracionMin: 120,
      horaRegreso: '14:30',
    },
  ]

  const res = validarItinerarioCombo(actividadesConConflicto)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.match(res.error ?? '', /Conflicto de horario/i)
    assert.match(res.error ?? '', /Catamarán Saona.*13:00/i)
    assert.match(res.error ?? '', /Buggies 4x4.*12:30/i)
  }
})

test('validarDisponibilidadCombo: valida secuencia sin solapamiento y día común de operación', () => {
  const fechaMiercoles = new Date('2026-10-14T12:00:00.000Z') // Miércoles (día 3 ISO)
  const fechaMartes = new Date('2026-10-13T12:00:00.000Z') // Martes (día 2 ISO)

  const comboConfig = {
    nombre: 'Combo Saona + Buggies Extremo',
    capacidad: 25,
    horaSalida: '09:00',
    horarios: [
      { id: 'h-combo', diasSemana: [1, 2, 3, 4, 5], horaSalida: '09:00', cupo: 25 },
    ],
    actividades: [
      {
        nombre: 'Catamarán Saona',
        capacidad: 30,
        horaSalida: '09:00',
        duracionMin: 180,
        horaRegreso: '12:00',
        horarios: [{ id: 'h1', diasSemana: [1, 2, 3, 4, 5], horaSalida: '09:00', cupo: 25 }],
      },
      {
        nombre: 'Buggies Aventura',
        capacidad: 15,
        horaSalida: '13:30',
        duracionMin: 120,
        horaRegreso: '15:30',
        horarios: [{ id: 'h2', diasSemana: [3, 4, 5, 6, 7], horaSalida: '13:30', cupo: 15 }], // Solo Mié a Dom
      },
    ],
  }

  // 1. Miércoles: Ambas actividades operan y no se solapan -> OK
  const resMiercoles = validarDisponibilidadCombo(fechaMiercoles, '09:00', 4, comboConfig)
  assert.equal(resMiercoles.ok, true)
  if (resMiercoles.ok) {
    assert.equal(resMiercoles.cupoDisponible, 15) // Cuello de botella en Buggies
    assert.equal(resMiercoles.itinerario.length, 2)
  }

  // 2. Martes: Buggies no opera los martes -> Rechaza por día no común
  const resMartes = validarDisponibilidadCombo(fechaMartes, '09:00', 4, comboConfig)
  assert.equal(resMartes.ok, false)
  assert.match(resMartes.error ?? '', /no opera en el día seleccionado/i)
})

test('autoResolverItinerarioCombo: auto-ajusta la segunda actividad al horario disponible más cercano sin solapamiento', () => {
  const actividades = [
    {
      id: 'act-catamaran',
      nombre: 'Catamarán Saona',
      horaSalida: '09:00',
      duracionMin: 180, // 09:00 a 12:00
      horarios: [{ horaSalida: '09:00' }],
    },
    {
      id: 'act-buggies',
      nombre: 'Buggies Punta Cana',
      horaSalida: '10:00', // Solapado con Catamarán (10:00 < 12:00)
      duracionMin: 120,
      horarios: [
        { horaSalida: '10:00' }, // Solapado
        { horaSalida: '13:00' }, // Válido y más cercano (13:00 >= 12:00)
        { horaSalida: '16:00' }, // Válido pero más lejano
      ],
    },
  ]

  const res = autoResolverItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    // Buggies se debió auto-ajustar a las 13:00
    assert.equal(res.horariosAsignados['act-buggies'], '13:00')
    assert.equal(res.horariosAsignados['act-catamaran'], '09:00')
    assert.equal(res.itinerario.length, 2)
    assert.equal(res.itinerario[0].nombre, 'Catamarán Saona')
    assert.equal(res.itinerario[0].inicio, '09:00')
    assert.equal(res.itinerario[0].fin, '12:00')
    assert.equal(res.itinerario[1].nombre, 'Buggies Punta Cana')
    assert.equal(res.itinerario[1].inicio, '13:00')
    assert.equal(res.itinerario[1].fin, '15:00')
    assert.equal(res.ajustes.length, 1)
    assert.match(res.ajustes[0], /Buggies Punta Cana.*13:00/i)
  }
})

test('optimizarItinerarioCombo: encuentra la combinación más fluida y compacta sin solapamiento', () => {
  const actividades = [
    {
      id: 'act-1',
      nombre: 'Snorkel Arrecife',
      duracionMin: 90,
      horarios: [{ horaSalida: '08:30' }, { horaSalida: '11:00' }, { horaSalida: '14:00' }],
    },
    {
      id: 'act-2',
      nombre: 'Caballos en Playa',
      duracionMin: 60,
      horarios: [{ horaSalida: '10:30' }, { horaSalida: '13:00' }, { horaSalida: '16:00' }],
    },
  ]

  const res = optimizarItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    // La combinación más compacta de menor duración total (150 min vs 180 min):
    // 13:00 a 14:00 Caballos -> 14:00 a 15:30 Snorkel (0 minutos de espera)
    assert.equal(res.horariosAsignados['act-2'], '13:00')
    assert.equal(res.horariosAsignados['act-1'], '14:00')
    assert.equal(res.itinerario[0].nombre, 'Caballos en Playa')
    assert.equal(res.itinerario[0].inicio, '13:00')
    assert.equal(res.itinerario[0].fin, '14:00')
    assert.equal(res.itinerario[1].nombre, 'Snorkel Arrecife')
    assert.equal(res.itinerario[1].inicio, '14:00')
    assert.equal(res.itinerario[1].fin, '15:30')
  }
})

test('autoResolverItinerarioCombo: retorna error si no hay ningún horario compatible sin solapamiento', () => {
  const actividadesIncompatibles = [
    {
      id: 'act-1',
      nombre: 'Tour Todo el Día',
      horaSalida: '09:00',
      duracionMin: 480, // 09:00 a 17:00
      horarios: [{ horaSalida: '09:00' }],
    },
    {
      id: 'act-2',
      nombre: 'Paseo Matutino',
      horaSalida: '10:00',
      duracionMin: 120, // 10:00 a 12:00
      horarios: [{ horaSalida: '10:00' }], // Solo opera a las 10:00
    },
  ]

  const res = autoResolverItinerarioCombo(actividadesIncompatibles)
  assert.equal(res.ok, false)
  assert.match(res.error ?? '', /solap/i)
})

test('validarItinerarioCombo y autoResolverItinerarioCombo: resuelve actividades de 3 horas (09:00/11:00 y 09:00/13:00)', () => {
  const act1 = {
    id: 'act-1',
    nombre: 'Actividad 1',
    duracionMin: 180, // 3 horas
    horaSalida: '11:00', // Terminará a las 14:00 (2:00 PM)
    horarios: [{ horaSalida: '09:00' }, { horaSalida: '11:00' }],
  }
  const act2 = {
    id: 'act-2',
    nombre: 'Actividad 2',
    duracionMin: 180, // 3 horas
    horaSalida: '13:00', // Inicia a las 13:00 (1:00 PM) -> Conflicto con 14:00
    horarios: [{ horaSalida: '09:00' }, { horaSalida: '13:00' }],
  }

  // 1. Con 11:00 y 13:00 debe rechazar por solapamiento (11:00 a 14:00 choca con 13:00)
  const valSolapado = validarItinerarioCombo([act1, act2])
  assert.equal(valSolapado.ok, false)
  assert.match(valSolapado.error ?? '', /termina a las 14:00 y "Actividad 2" inicia a las 13:00/i)

  // 2. autoResolverItinerarioCombo debe resolver a 09:00 y 13:00
  const res = autoResolverItinerarioCombo([act1, act2])
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.horariosAsignados['act-1'], '09:00')
    assert.equal(res.horariosAsignados['act-2'], '13:00')
    assert.equal(res.itinerario[0].inicio, '09:00')
    assert.equal(res.itinerario[0].fin, '12:00')
    assert.equal(res.itinerario[1].inicio, '13:00')
    assert.equal(res.itinerario[1].fin, '16:00')
  }
})

test('generarCombinacionesCombo: genera exhaustivamente todas las combinaciones válidas sin solapamiento', () => {
  const snorquel = {
    id: 'snorquel',
    nombre: 'Snorquel Arrecife',
    duracionMin: 90, // 1.5 horas
    horarios: [{ horaSalida: '09:00' }, { horaSalida: '11:00' }, { horaSalida: '14:00' }],
  }
  const buggies = {
    id: 'buggies',
    nombre: 'Buggies 4x4',
    duracionMin: 120, // 2 horas
    horarios: [{ horaSalida: '10:30' }, { horaSalida: '13:00' }, { horaSalida: '16:00' }],
  }

  const combinaciones = generarCombinacionesCombo([snorquel, buggies])
  
  // Debe haber encontrado múltiples combinaciones válidas
  assert.ok(combinaciones.length >= 3)

  // 1. Turno Mañana temprano: 09:00 Snorquel (hasta 10:30) -> 10:30 Buggies (hasta 12:30)
  const c1 = combinaciones[0]
  assert.equal(c1.horaInicio, '09:00')
  assert.equal(c1.horaFin, '12:30')
  assert.equal(c1.duracionTotalMin, 210) // 3.5 horas
  assert.equal(c1.horariosAsignados['snorquel'], '09:00')
  assert.equal(c1.horariosAsignados['buggies'], '10:30')

  // 2. Turno Mediodía: 11:00 Snorquel (hasta 12:30) -> 13:00 Buggies (hasta 15:00)
  const c2 = combinaciones.find((c) => c.horariosAsignados['snorquel'] === '11:00' && c.horariosAsignados['buggies'] === '13:00')
  assert.ok(c2)
  assert.equal(c2?.horaInicio, '11:00')
  assert.equal(c2?.horaFin, '15:00')

  // 3. Turno Tarde: 14:00 Snorquel (hasta 15:30) -> 16:00 Buggies (hasta 18:00)
  const c3 = combinaciones.find((c) => c.horariosAsignados['snorquel'] === '14:00' && c.horariosAsignados['buggies'] === '16:00')
  assert.ok(c3)
  assert.equal(c3?.horaInicio, '14:00')
  assert.equal(c3?.horaFin, '18:00')

  // Ninguna combinación debe tener solapamiento
  for (const comb of combinaciones) {
    const acts = [
      { ...snorquel, horaSalida: comb.horariosAsignados['snorquel'] },
      { ...buggies, horaSalida: comb.horariosAsignados['buggies'] },
    ]
    const val = validarItinerarioCombo(acts)
    assert.equal(val.ok, true)
  }
})

test('persistencia de horarios en items de combo: valida asignación de 09:00 y 13:00 sin solapamiento', () => {
  const item1 = {
    id: 'saona',
    nombre: 'Isla Saona',
    duracionMin: 180, // 3h
    horaSalida: '09:00', // Asignado en el combo
    horarios: [{ horaSalida: '09:00' }, { horaSalida: '11:00' }],
  }
  const item2 = {
    id: 'buggies',
    nombre: 'Buggies Punta Cana',
    duracionMin: 180, // 3h
    horaSalida: '13:00', // Asignado en el combo
    horarios: [{ horaSalida: '09:00' }, { horaSalida: '13:00' }],
  }

  // 1. Validar que la asignación guardada es válida y no se solapa
  const val = validarItinerarioCombo([item1, item2])
  assert.equal(val.ok, true)
  if (val.ok) {
    assert.equal(val.itinerario[0].inicio, '09:00')
    assert.equal(val.itinerario[0].fin, '12:00')
    assert.equal(val.itinerario[1].inicio, '13:00')
    assert.equal(val.itinerario[1].fin, '16:00')
  }

  // 2. Si un combo legacy viene con 09:00 y 09:00, autoResolverItinerarioCombo lo cura a 09:00 y 13:00
  const legacyConflict = [
    { ...item1, horaSalida: '09:00' },
    { ...item2, horaSalida: '09:00' },
  ]
  const resolved = autoResolverItinerarioCombo(legacyConflict)
  assert.equal(resolved.ok, true)
  if (resolved.ok) {
    assert.equal(resolved.horariosAsignados['saona'], '09:00')
    assert.equal(resolved.horariosAsignados['buggies'], '13:00')
  }
})

// ─── Tests: Permitir Solapamiento ────────────────────────────────────────────

test('validarItinerarioCombo: permite solapamiento cuando la actividad contenedora tiene permitirSolapamiento', () => {
  const actividades = [
    {
      id: 'viaje-saona',
      nombre: 'Viaje a Isla Saona',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '08:00',
      duracionMin: 600, // 08:00 → 18:00
      permitirSolapamiento: true,
    },
    {
      id: 'buceo',
      nombre: 'Buceo Acuático',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '11:00',
      duracionMin: 90, // 11:00 → 12:30 (solapado dentro de Saona)
      permitirSolapamiento: false,
    },
  ]

  const res = validarItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.itinerario.length, 2)
    assert.equal(res.itinerario[0].nombre, 'Viaje a Isla Saona')
    assert.equal(res.itinerario[1].nombre, 'Buceo Acuático')
  }
})

test('validarItinerarioCombo: rechaza solapamiento cuando ninguna actividad tiene permitirSolapamiento', () => {
  const actividades = [
    {
      id: 'catamaran',
      nombre: 'Catamarán',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '09:00',
      duracionMin: 240,
      permitirSolapamiento: false,
    },
    {
      id: 'buggies',
      nombre: 'Buggies',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '12:00',
      duracionMin: 120,
      permitirSolapamiento: false,
    },
  ]

  const res = validarItinerarioCombo(actividades)
  assert.equal(res.ok, false)
})

test('autoResolverItinerarioCombo: no mueve actividades con permitirSolapamiento', () => {
  const actividades = [
    {
      id: 'viaje-saona',
      nombre: 'Viaje a Isla Saona',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '08:00',
      duracionMin: 600,
      horarios: [{ horaSalida: '08:00' }],
      permitirSolapamiento: true,
    },
    {
      id: 'buceo',
      nombre: 'Buceo Acuático',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '11:00',
      duracionMin: 90,
      horarios: [{ horaSalida: '11:00' }],
      permitirSolapamiento: false,
    },
  ]

  const res = autoResolverItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    // La actividad solapada no se movió
    assert.equal(res.horariosAsignados['viaje-saona'], '08:00')
  }
})

test('optimizarItinerarioCombo: excluye actividades con permitirSolapamiento del combinador', () => {
  const actividades = [
    {
      id: 'viaje',
      nombre: 'Viaje a Isla Saona',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '08:00',
      duracionMin: 600,
      horarios: [{ horaSalida: '08:00' }],
      permitirSolapamiento: true,
    },
    {
      id: 'catamaran',
      nombre: 'Catamarán',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '09:00',
      duracionMin: 180,
      horarios: [{ horaSalida: '09:00' }, { horaSalida: '14:00' }],
      permitirSolapamiento: false,
    },
    {
      id: 'buggies',
      nombre: 'Buggies',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '13:00',
      duracionMin: 120,
      horarios: [{ horaSalida: '09:00' }, { horaSalida: '13:00' }],
      permitirSolapamiento: false,
    },
  ]

  const res = optimizarItinerarioCombo(actividades)
  assert.equal(res.ok, true)
  if (res.ok) {
    // La actividad con solapamiento se mantiene en 08:00
    assert.equal(res.horariosAsignados['viaje'], '08:00')
    // Las otras dos actividades se optimizan sin solaparse entre sí
    assert.ok(res.itinerario.length >= 2)
  }
})

test('generarCombinacionesCombo: incluye actividades con permitirSolapamiento en las combinaciones', () => {
  const actividades = [
    {
      id: 'viaje',
      nombre: 'Viaje a Isla Saona',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '08:00',
      duracionMin: 600,
      horarios: [{ horaSalida: '08:00' }],
      permitirSolapamiento: true,
    },
    {
      id: 'buceo',
      nombre: 'Buceo Acuático',
      tipoItem: 'ACTIVIDAD',
      horaSalida: '11:00',
      duracionMin: 90,
      horarios: [{ horaSalida: '11:00' }, { horaSalida: '14:00' }],
      permitirSolapamiento: false,
    },
  ]

  const combos = generarCombinacionesCombo(actividades)
  assert.ok(combos.length > 0)
  // Todas las combinaciones deben incluir la actividad solapada con su hora fija
  for (const combo of combos) {
    assert.equal(combo.horariosAsignados['viaje'], '08:00')
  }
})
