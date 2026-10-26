import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CATEGORIAS_SUGERIDAS,
  agregarHoraSalida,
  agruparBloques,
  ahorroDeCombo,
  alternarDia,
  claveDeCombo,
  derivarDeCombo,
  diasDePreset,
  duracionEnMinutos,
  formato12h,
  horariosDataJson,
  leerExcursionDeFormulario,
  quitarHoraSalida,
  sumaDePrecios,
  type ActividadParaComboItem,
} from '../src/modules/excursiones/catalogo/formulario'
import { ComboActividades } from '../src/components/excursiones/excursion/ComboActividades'
import { SeccionGeneral } from '../src/components/excursiones/excursion/SeccionGeneral'
import { SeccionHorarios } from '../src/components/excursiones/excursion/SeccionHorarios'
import { SeccionPrecios } from '../src/components/excursiones/excursion/SeccionPrecios'
import { SeccionIncluye, SeccionUbicacion } from '../src/components/excursiones/excursion/SeccionTextos'
import type { ValoresExcursion } from '../src/components/excursiones/excursion/tipos'
import type { ComboEstado } from '../src/components/excursiones/excursion/useCombo'

/**
 * EL FORMULARIO DE EXCURSIÓN: PARTE PURA, SECCIONES Y CONTRATO CON LAS ACCIONES (auditoría admin · fase 7, 7.2).
 *
 * Eran 1 641 líneas con todo mezclado, un solo mensaje de error por intento y campos de texto que React reiniciaba cuando la
 * acción fallaba (un error del servidor borraba lo escrito). Aquí: las cuentas de horas, días y combos, la lectura del formulario
 * con el error de cada campo, el marcado de cada sección y el contrato de lo que las acciones leen con lo que el formulario manda.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const html = (n: unknown) => renderToStaticMarkup(n as never)

// ── Horas y días ────────────────────────────────────────────────────────────────────────────────────────────────────

test('horas · 12 horas legibles; lo que no es una hora se deja como viene', () => {
  assert.equal(formato12h('14:30'), '2:30 PM')
  assert.equal(formato12h('00:05'), '12:05 AM')
  assert.equal(formato12h('12:00'), '12:00 PM')
  assert.equal(formato12h('09:00'), '9:00 AM')
  assert.equal(formato12h(''), '')
  assert.equal(formato12h('x'), 'x')
})

test('horas · agregar no repite, ordena y rechaza lo que no es una hora', () => {
  assert.deepEqual(agregarHoraSalida(['09:00'], '14:00'), ['09:00', '14:00'])
  assert.deepEqual(agregarHoraSalida(['14:00'], '09:00'), ['09:00', '14:00'])
  assert.deepEqual(agregarHoraSalida(['09:00'], '09:00'), ['09:00'])
  assert.deepEqual(agregarHoraSalida(['09:00'], ' 10:30:15 '), ['09:00', '10:30'], 'se recorta a HH:MM')
  for (const mala of ['', '25:00', '9:5', 'abc', '12:60']) assert.deepEqual(agregarHoraSalida(['09:00'], mala), ['09:00'], mala)
})

test('horas · quitar deja siempre al menos una', () => {
  assert.deepEqual(quitarHoraSalida(['09:00', '14:00'], '09:00'), { horas: ['14:00'] })
  assert.deepEqual(quitarHoraSalida(['09:00'], '09:00'), { horas: ['09:00'], error: 'Debe haber al menos una hora de salida' })
})

test('días · alternar ordena, y siempre queda al menos un día', () => {
  assert.deepEqual(alternarDia([1, 3], 2), { dias: [1, 2, 3] })
  assert.deepEqual(alternarDia([1, 2, 3], 2), { dias: [1, 3] })
  assert.deepEqual(alternarDia([5], 5), { dias: [5], error: 'Debe seleccionar al menos un día de salida' })
  assert.deepEqual(diasDePreset('todos'), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(diasDePreset('laborables'), [1, 2, 3, 4, 5])
  assert.deepEqual(diasDePreset('finde'), [6, 7])
})

test('horarios · lo que viaja en horariosData y la duración mínima', () => {
  assert.deepEqual(JSON.parse(horariosDataJson(['09:00', '14:00'], [1, 2])), [
    { horaSalida: '09:00', diasSemana: [1, 2], cupo: null },
    { horaSalida: '14:00', diasSemana: [1, 2], cupo: null },
  ])
  assert.equal(duracionEnMinutos(3), 180)
  assert.equal(duracionEnMinutos(0.5), 30)
  assert.equal(duracionEnMinutos(0.1), 15, 'nunca menos de 15 minutos')
  assert.equal(duracionEnMinutos(1.5), 90)
  assert.ok(CATEGORIAS_SUGERIDAS.length >= 4)
})

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const A: ActividadParaComboItem = { id: 'a', nombre: 'Saona', categoria: null, horaSalida: '08:00', duracionMin: 480, precioAdulto: 100, precioNino: 60 }
const B: ActividadParaComboItem = { id: 'b', nombre: 'Buggies', categoria: null, horaSalida: '09:00', horaRegreso: '11:00', precioAdulto: 50, precioNino: null }

test('combo · la duración va del inicio más temprano al regreso más tardío; la primera hora es la de la primera actividad', () => {
  const r = derivarDeCombo([A, B], {})
  assert.equal(r.duracionHoras, 8, '08:00 a 16:00')
  assert.equal(r.primeraHora, '08:00')
})

test('combo · una hora fija manda sobre la de la actividad, y sin duración declarada se cuentan 2 horas', () => {
  assert.equal(derivarDeCombo([A, B], { a: ['07:00'] }).primeraHora, '07:00')
  assert.equal(derivarDeCombo([A, B], { a: ['07:00'] }).duracionHoras, 8, 'la actividad A sale a las 07:00 y dura 8 h: termina a las 15:00')
  const sinDuracion = derivarDeCombo([{ id: 'x', nombre: 'X', categoria: null, horaSalida: '10:00' }], {})
  assert.equal(sinDuracion.duracionHoras, 2)
  assert.deepEqual(derivarDeCombo([], {}), { duracionHoras: null, primeraHora: null })
})

test('combo · la suma de precios (el niño paga como adulto si no tiene precio) y el ahorro frente al precio del combo', () => {
  assert.deepEqual(sumaDePrecios([A, B]), { adulto: 150, nino: 110 })
  assert.equal(sumaDePrecios([]), null)
  assert.deepEqual(ahorroDeCombo({ adulto: 150 }, '120'), { ahorro: 30, pct: 20 })
  assert.deepEqual(ahorroDeCombo({ adulto: 150 }, '150'), { ahorro: 0, pct: 0 })
  assert.equal(ahorroDeCombo({ adulto: 150 }, ''), null)
  assert.equal(ahorroDeCombo({ adulto: 150 }, '0'), null)
  assert.equal(ahorroDeCombo({ adulto: 0 }, '10'), null)
  assert.equal(ahorroDeCombo(null, '10'), null)
  assert.ok((ahorroDeCombo({ adulto: 100 }, '130')?.ahorro ?? 0) < 0, 'un combo más caro que la suma da ahorro negativo (la pantalla no lo celebra)')
})

test('itinerario · las actividades que se permiten solapar contienen a las que caen dentro; las demás van sueltas', () => {
  const bloques = [
    { id: '1', nombre: 'Día en la isla', inicio: '08:00', fin: '16:00', permitirSolapamiento: true },
    { id: '2', nombre: 'Snorkel', inicio: '10:00', fin: '12:00' },
    { id: '3', nombre: 'Cena', inicio: '19:00', fin: '21:00' },
  ]
  const { raiz, hijosDe } = agruparBloques(bloques)
  assert.deepEqual(raiz.map((b) => b.id), ['1', '3'])
  assert.deepEqual(hijosDe(bloques[0]).map((b) => b.id), ['2'])
  assert.deepEqual(hijosDe(bloques[2]), [])
  assert.deepEqual(agruparBloques([]).raiz, [])
})

test('combo · la clave se arma con el contenido: igual contenido, igual clave; sin combo o sin actividades, ninguna', () => {
  const base = { tipoItem: 'COMBO' as const, actividadIds: ['a', 'b'], diasComunes: [1, 2], combinaciones: [{ horaInicio: '08:00', duracionTotalMin: 480 }], bloques: [{ inicio: '08:00', fin: '16:00' }] }
  assert.equal(claveDeCombo(base), claveDeCombo({ ...base, actividadIds: [...base.actividadIds] }))
  assert.notEqual(claveDeCombo(base), claveDeCombo({ ...base, diasComunes: [1] }))
  assert.notEqual(claveDeCombo(base), claveDeCombo({ ...base, actividadIds: ['a'] }))
  assert.equal(claveDeCombo({ ...base, tipoItem: 'ACTIVIDAD' }), null)
  assert.equal(claveDeCombo({ ...base, actividadIds: [] }), null)
})

// ── Leer el formulario ──────────────────────────────────────────────────────────────────────────────────────────────

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x)
  return f
}
const HORAS = JSON.stringify([{ horaSalida: '09:00', diasSemana: [1, 2, 3], cupo: null }])
const VALIDO = { nombre: 'Isla Saona', tipoItem: 'ACTIVIDAD', capacidad: '30', horariosData: HORAS, precioAdulto: '80' }

test('lectura · una actividad en regla, al crear y al editar', () => {
  assert.deepEqual(leerExcursionDeFormulario(formulario(VALIDO), 'crear'), { ok: true })
  const { precioAdulto: _precio, ...sinPrecio } = VALIDO
  assert.deepEqual(leerExcursionDeFormulario(formulario(sinPrecio), 'editar'), { ok: true }, 'al editar los precios viven en las variantes')
})

test('lectura · cada fallo nombra SU campo y uno solo dice el mensaje del campo', () => {
  const r = leerExcursionDeFormulario(formulario({ ...VALIDO, nombre: 'ab' }), 'crear')
  assert.ok(!r.ok)
  if (!r.ok) {
    assert.deepEqual(Object.keys(r.campos), ['nombre'])
    assert.match(r.error, /nombre de la excursión/)
  }
})

test('lectura · la capacidad y el impuesto fallan en voz alta (antes se guardaban como «nada»)', () => {
  for (const mala of ['0', '-3', '1.5', 'abc', '200000']) {
    const r = leerExcursionDeFormulario(formulario({ ...VALIDO, capacidad: mala }), 'crear')
    assert.ok(!r.ok && r.campos.capacidad, `capacidad «${mala}»`)
  }
  assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, capacidad: '' }), 'crear').ok, 'vacía es «sin capacidad declarada»')
  for (const malo of ['101', '-1', 'abc']) {
    const r = leerExcursionDeFormulario(formulario({ ...VALIDO, impuestoPct: malo }), 'crear')
    assert.ok(!r.ok && r.campos.impuestoPct, `impuesto «${malo}»`)
  }
  assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, impuestoPct: '18' }), 'crear').ok)
  assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, impuestoPct: '0' }), 'crear').ok)
})

test('lectura · al crear, el precio del adulto es obligatorio y los demás son opcionales pero no pueden ser ilegibles', () => {
  for (const malo of ['', '0', '-5', 'abc']) {
    const r = leerExcursionDeFormulario(formulario({ ...VALIDO, precioAdulto: malo }), 'crear')
    assert.ok(!r.ok && r.campos.precioAdulto, `adulto «${malo}»`)
  }
  for (const campo of ['precioNino', 'precioResidente', 'precioNinoResidente']) {
    assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, [campo]: '' }), 'crear').ok, `${campo} vacío`)
    assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, [campo]: '0' }), 'crear').ok, `${campo} gratis`)
    const r = leerExcursionDeFormulario(formulario({ ...VALIDO, [campo]: 'xx' }), 'crear')
    assert.ok(!r.ok && r.campos[campo as 'precioNino'], campo)
  }
})

test('lectura · sin horas de salida no hay actividad; un pase de día no las necesita', () => {
  const sin = leerExcursionDeFormulario(formulario({ ...VALIDO, horariosData: '[]' }), 'crear')
  assert.ok(!sin.ok && sin.campos.horasSalida)
  const rota = leerExcursionDeFormulario(formulario({ ...VALIDO, horariosData: 'no es json' }), 'crear')
  assert.ok(!rota.ok && rota.campos.horasSalida)
  const horaMala = leerExcursionDeFormulario(formulario({ ...VALIDO, horariosData: JSON.stringify([{ horaSalida: '25:99' }]) }), 'crear')
  assert.ok(!horaMala.ok && horaMala.campos.horasSalida)
  assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, tipoItem: 'PASE_DIA', horariosData: '[]' }), 'crear').ok)
})

test('lectura · un combo necesita 2 actividades distintas', () => {
  const COMBO = { ...VALIDO, tipoItem: 'COMBO' }
  for (const ids of [[], ['a'], ['a', 'a'], ['a', ' ']]) {
    const r = leerExcursionDeFormulario(formulario({ ...COMBO, actividadesComboIds: ids }), 'crear')
    assert.ok(!r.ok && r.campos.actividadesComboIds, JSON.stringify(ids))
  }
  assert.ok(leerExcursionDeFormulario(formulario({ ...COMBO, actividadesComboIds: ['a', 'b'] }), 'crear').ok)
  // Una actividad suelta ignora las actividades de un combo anterior.
  assert.ok(leerExcursionDeFormulario(formulario({ ...VALIDO, actividadesComboIds: ['a'] }), 'crear').ok)
})

test('lectura · varios errores a la vez salen TODOS, no uno por intento', () => {
  const r = leerExcursionDeFormulario(formulario({ nombre: '', tipoItem: 'ACTIVIDAD', capacidad: '0', horariosData: '[]', precioAdulto: '' }), 'crear')
  assert.ok(!r.ok)
  if (!r.ok) {
    assert.deepEqual(Object.keys(r.campos).sort(), ['capacidad', 'horasSalida', 'nombre', 'precioAdulto'])
    assert.equal(r.error, 'Hay 4 campos por corregir.')
  }
})

// ── Las acciones: contrato con el formulario ────────────────────────────────────────────────────────────────────────

test('las dos acciones leen el formulario con el parser, antes de tocar la base, y devuelven el error de cada campo', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/catalogo/actions.ts', 'utf8'))
  const crear = src.slice(src.indexOf('export async function crearExcursion'), src.indexOf('export async function actualizarExcursion'))
  const editar = src.slice(src.indexOf('export async function actualizarExcursion'), src.indexOf('export async function cambiarEstadoExcursion'))
  assert.match(crear, /leerExcursionDeFormulario\(formData, 'crear'\)/)
  assert.match(editar, /leerExcursionDeFormulario\(formData, 'editar'\)/)
  for (const cuerpo of [crear, editar]) {
    assert.match(cuerpo, /return \{ error: leido\.error, campos: leido\.campos \}/)
    assert.ok(cuerpo.indexOf('leerExcursionDeFormulario') < cuerpo.indexOf('validarExcursion('), 'el parser va antes que la validación del núcleo')
  }
})

test('CONTRATO · todo campo que leen las acciones de excursión viaja en el formulario con su name', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/catalogo/actions.ts', 'utf8'))
  const acciones = src.slice(src.indexOf('export async function crearExcursion'), src.indexOf('export async function cambiarEstadoExcursion'))
  const leidos = new Set<string>()
  const lista = src.match(/const CAMPOS_EXCURSION = \[([\s\S]*?)\]/)?.[1] ?? ''
  for (const m of lista.matchAll(/'(\w+)'/g)) leidos.add(m[1])
  // `\s*` porque `formData\n  .getAll('actividadesComboIds')` está partido en varias líneas en la acción.
  for (const m of acciones.matchAll(/formData\s*\.(?:get|getAll)\(\s*'(\w+)'\s*\)/g)) leidos.add(m[1])
  for (const campo of ['nombre', 'tipoItem', 'horariosData', 'precioAdulto', 'actividadesComboIds', 'excursionId', 'galeriaJson']) {
    assert.ok(leidos.has(campo), `no encuentro «${campo}» entre los campos que leen las acciones: el contrato dejó de medir lo que debe`)
  }

  const fuentes = [
    ...readdirSync('src/components/excursiones/excursion').filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join('src/components/excursiones/excursion', f), 'utf8')),
    readFileSync('src/components/excursiones/ExcursionForm.tsx', 'utf8'),
    readFileSync('src/components/excursiones/ExcursionImagenUpload.tsx', 'utf8'),
  ].join('\n')
  const enviados = new Set<string>()
  for (const m of fuentes.matchAll(/\bname="(\w+)"/g)) enviados.add(m[1])

  // `companyId` solo lo manda el formulario del superadmin; `precioTurista` es opcional y este formulario no lo pide.
  const sinEnviar = [...leidos].filter((c) => !enviados.has(c) && c !== 'companyId' && c !== 'precioTurista')
  assert.deepEqual(sinEnviar, [], `las acciones leen campos que el formulario no manda: ${sinEnviar.join(', ')}`)
})

// ── Las secciones, a HTML ───────────────────────────────────────────────────────────────────────────────────────────

const V: ValoresExcursion = {
  nombre: '',
  descripcion: '',
  categoria: '',
  capacidad: '30',
  ubicacion: '',
  puntoSalida: '',
  incluye: '',
  noIncluye: '',
  politicas: '',
  moneda: 'DOP',
  impuestoPct: '',
  precioAdulto: '',
  precioNino: '',
  precioResidente: '',
  precioNinoResidente: '',
}
const poner = () => {}
const control = (out: string, id: string) => out.match(new RegExp(`<(?:input|select|textarea|button)[^>]*id="${id}"[^>]*>`))?.[0] ?? ''

test('sección general · el tipo es un grupo con su estado; el nombre lleva name, etiqueta y error; el combo solo aparece en un combo', () => {
  const normal = html(h(SeccionGeneral, { v: V, poner, errores: {}, tipoItem: 'ACTIVIDAD', alCambiarTipo: poner, combo: h('div', { id: 'bloque-combo' }, 'CONFIG DEL COMBO') }))
  assert.match(normal, /<legend[^>]*>Tipo de ítem/)
  assert.match(normal, /aria-pressed="true"[^>]*>Tour \/ actividad/)
  assert.match(normal, /aria-pressed="false"[^>]*>Combo \/ paquete/)
  assert.match(normal, /<input type="hidden" name="tipoItem" value="ACTIVIDAD"/)
  assert.doesNotMatch(normal, /CONFIG DEL COMBO/)
  assert.match(control(normal, 'exc-nombre'), /name="nombre"/)
  assert.match(normal, /<label for="exc-nombre"[^>]*>Nombre de la excursión/)
  assert.match(normal, /Capacidad total por salida/)
  assert.match(normal, /Descripción[\s\S]*\(opcional\)/)

  const combo = html(h(SeccionGeneral, { v: V, poner, errores: {}, tipoItem: 'COMBO', alCambiarTipo: poner, combo: h('div', null, 'CONFIG DEL COMBO') }))
  assert.match(combo, /CONFIG DEL COMBO/)

  const pase = html(h(SeccionGeneral, { v: V, poner, errores: {}, tipoItem: 'PASE_DIA', alCambiarTipo: poner, combo: null }))
  assert.match(pase, /Cupo máximo por día/)

  const conErrores = html(h(SeccionGeneral, { v: V, poner, errores: { nombre: 'Escribe el nombre de la excursión (al menos 3 letras).', capacidad: 'La capacidad es un número entero, de 1 en adelante.' }, tipoItem: 'ACTIVIDAD', alCambiarTipo: poner, combo: null }))
  assert.match(control(conErrores, 'exc-nombre'), /aria-invalid="true"/)
  assert.match(control(conErrores, 'exc-nombre'), /aria-describedby="exc-nombre-error"/)
  assert.match(control(conErrores, 'exc-capacidad'), /aria-invalid="true"/)
})

test('sección general · los campos de texto son controlados (value), no de valor inicial: no se borran al fallar la acción', () => {
  const out = html(h(SeccionGeneral, { v: { ...V, nombre: 'Isla Saona', categoria: 'Playa' }, poner, errores: {}, tipoItem: 'ACTIVIDAD', alCambiarTipo: poner, combo: null }))
  assert.match(control(out, 'exc-nombre'), /value="Isla Saona"/)
  assert.match(control(out, 'exc-categoria'), /value="Playa"/)
  const carpeta = 'src/components/excursiones/excursion'
  for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.tsx'))) {
    assert.doesNotMatch(sinComentarios(readFileSync(join(carpeta, f), 'utf8')), /defaultValue=/, `${f}: un campo de valor inicial se reinicia al fallar la acción`)
  }
})

test('sección de horarios · un pase de día no tiene horas ni duración; una actividad sí, con la llegada calculada', () => {
  const props = {
    duracionHoras: 3,
    alCambiarDuracion: poner,
    horasSalida: ['09:00', '14:00'],
    alAgregarHora: poner,
    alQuitarHora: poner,
    nuevaHora: '14:00',
    alCambiarNuevaHora: poner,
    dias: [1, 2, 3, 4, 5, 6, 7],
    alAlternarDia: poner,
    alElegirPreset: poner,
  }
  const actividad = html(h(SeccionHorarios, { ...props, tipoItem: 'ACTIVIDAD' }))
  assert.match(actividad, /Duración y horarios de salida/)
  assert.match(actividad, /<label for="exc-duracion"[^>]*>Duración de la excursión/)
  assert.match(actividad, /180 minutos de recorrido/)
  assert.match(actividad, /9:00 AM/)
  assert.match(actividad, /Llegada estimada:[\s\S]*12:00 PM/)
  assert.match(actividad, /aria-label="Eliminar el horario de las 9:00 AM"/)
  assert.match(actividad, /<label for="exc-nueva-hora"[^>]*>Nueva hora de salida/)
  assert.match(actividad, /Horas de salida programadas \(2\)/)
  assert.match(actividad, /aria-pressed="true"[^>]*>Todos los días/)

  const pase = html(h(SeccionHorarios, { ...props, tipoItem: 'PASE_DIA' }))
  assert.match(pase, /Días de operación y disponibilidad/)
  assert.doesNotMatch(pase, /exc-duracion|exc-nueva-hora/)
  assert.match(pase, /Acceso libre sin horario rígido/)

  const conError = html(h(SeccionHorarios, { ...props, tipoItem: 'ACTIVIDAD', error: 'Agrega al menos una hora de salida.' }))
  assert.match(conError, /role="alert"[^>]*>Agrega al menos una hora de salida\./)
  assert.match(conError, /data-invalido="true"/)

  const unaHora = html(h(SeccionHorarios, { ...props, tipoItem: 'ACTIVIDAD', horasSalida: ['09:00'] }))
  assert.match(unaHora, /<button[^>]*disabled=""[^>]*aria-label="Eliminar el horario|aria-label="Eliminar el horario[^>]*disabled=""/, 'con una sola hora no se puede quitar')
})

test('sección de precios · al crear: el precio del adulto es obligatorio y el impuesto va vacío; al editar: moneda e impuesto', () => {
  const crear = html(h(SeccionPrecios, { v: V, poner, errores: {}, editando: false }))
  assert.match(control(crear, 'exc-precio-adulto'), /name="precioAdulto"/)
  assert.match(control(crear, 'exc-precio-adulto'), /required/)
  assert.match(crear, /<input type="hidden" name="impuestoPct" value=""/)
  assert.match(control(crear, 'exc-moneda'), /name="moneda"/)
  assert.match(crear, /Niño[\s\S]*\(opcional\)/)
  assert.doesNotMatch(crear, /exc-impuesto/)

  const conError = html(h(SeccionPrecios, { v: V, poner, errores: { precioAdulto: 'El precio por adulto es obligatorio y mayor que cero.' }, editando: false }))
  assert.match(control(conError, 'exc-precio-adulto'), /aria-invalid="true"/)

  const editar = html(h(SeccionPrecios, { v: { ...V, impuestoPct: '18' }, poner, errores: {}, editando: true }))
  assert.match(control(editar, 'exc-impuesto'), /name="impuestoPct"/)
  assert.match(control(editar, 'exc-impuesto'), /value="18"/)
  assert.doesNotMatch(editar, /name="precioAdulto"/, 'al editar los precios viven en las variantes')
  assert.doesNotMatch(editar, /type="hidden" name="impuestoPct"/)

  const combo = html(h(SeccionPrecios, { v: { ...V, precioAdulto: '120' }, poner, errores: {}, editando: false, resumenCombo: { adulto: 150, nino: 110, ahorro: { ahorro: 30, pct: 20 } } }))
  assert.match(combo, /Suma individual de actividades/)
  assert.match(combo, /\$150\.00 por adulto/)
  assert.match(combo, /Ahorro para el cliente: \$30\.00 \(20% de descuento\)/)
  assert.match(combo, /Copiar suma total/)
  assert.match(combo, /Aplicar 15 % de descuento \(\$127\.50\)/)
})

test('secciones de ubicación y de inclusiones: cada campo con su name y su etiqueta', () => {
  const u = html(h(SeccionUbicacion, { v: V, poner, errores: {} }))
  assert.match(control(u, 'exc-ubicacion'), /name="ubicacion"/)
  assert.match(control(u, 'exc-punto'), /name="puntoSalida"/)
  const i = html(h(SeccionIncluye, { v: V, poner, errores: {} }))
  for (const [id, nombre] of [['exc-incluye', 'incluye'], ['exc-noincluye', 'noIncluye'], ['exc-politicas', 'politicas']]) {
    assert.match(control(i, id), new RegExp(`name="${nombre}"`), nombre)
  }
})

test('combo · las actividades son un grupo de casillas con su name; con menos de 2 avisa; el error sale con el grupo', () => {
  const combo = {
    seleccionadas: [],
    horariosPorActividad: {},
    permitirSolapamiento: {},
    horarioFijo: {},
    actividadesSeleccionadas: [],
    actividadesConHorario: [],
    pasesDia: [],
    diasComunes: [],
    itinerario: { ok: true, itinerario: [] },
    combinaciones: [],
    cambiarHorario: poner,
    autoSincronizar: poner,
    alternarActividad: poner,
    alternarSolapamiento: poner,
  } as unknown as ComboEstado
  const out = html(h(ComboActividades, { combo, actividadesDisponibles: [A, { ...B, tipoItem: 'PASE_DIA', categoria: 'Piscina' }], duracionHoras: 3, error: 'Un combo debe incluir al menos 2 actividades del catálogo.' }))
  assert.match(out, /<legend[^>]*>Actividades del combo/)
  assert.equal((out.match(/name="actividadesComboIds"/g) ?? []).length, 2)
  assert.match(out, /Daypass/)
  assert.match(out, /Selecciona al menos 2 actividades/)
  assert.match(out, /role="alert"[^>]*>Un combo debe incluir al menos 2 actividades/)
  const vacio = html(h(ComboActividades, { combo, actividadesDisponibles: [], duracionHoras: 3 }))
  assert.match(vacio, /No hay otras actividades individuales registradas/)
})

test('el formulario ya no es un solo archivo: el contenedor es corto y cada sección vive aparte', () => {
  const lineas = readFileSync('src/components/excursiones/ExcursionForm.tsx', 'utf8').split('\n').length
  assert.ok(lineas < 300, `el contenedor tiene ${lineas} líneas (eran 1 641)`)
  const archivos = readdirSync('src/components/excursiones/excursion')
  for (const esperado of ['SeccionGeneral.tsx', 'SeccionHorarios.tsx', 'SeccionPrecios.tsx', 'SeccionTextos.tsx', 'ComboActividades.tsx', 'ComboItinerario.tsx', 'useCombo.ts', 'tipos.ts']) {
    assert.ok(archivos.includes(esperado), esperado)
  }
  for (const a of archivos) {
    const n = readFileSync(join('src/components/excursiones/excursion', a), 'utf8').split('\n').length
    assert.ok(n < 300, `${a} tiene ${n} líneas`)
  }
  const shell = sinComentarios(readFileSync('src/components/excursiones/ExcursionForm.tsx', 'utf8'))
  assert.match(shell, /useCombo\(/)
  assert.match(shell, /ref=\{formRef\}/)
  assert.doesNotMatch(shell, /document\.getElementById/, 'las sugerencias de categoría ya no tocan el DOM a mano')
  assert.doesNotMatch(shell, /defaultValue=/)
})
