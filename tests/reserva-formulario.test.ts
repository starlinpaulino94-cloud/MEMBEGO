import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LIMITE_BUSQUEDA_CLIENTE,
  MIN_BUSQUEDA_CLIENTE,
  claveItinerario,
  detalleDeCliente,
  diasDespuesISO,
  esFechaReal,
  fechaLocalISO,
  hoyISO,
  itinerarioInicial,
  leerBusquedaCliente,
  leerReservaDeFormulario,
  moverActivo,
  resumenDeReserva,
  serializarItinerarioCombo,
  type ExcursionOpcion,
} from '../src/modules/excursiones/reservas/formulario'
import { ClienteBuscador } from '../src/components/excursiones/reserva/ClienteBuscador'
import { PasoCliente } from '../src/components/excursiones/reserva/PasoCliente'
import { PasoComercial } from '../src/components/excursiones/reserva/PasoComercial'
import { PasoExcursion } from '../src/components/excursiones/reserva/PasoExcursion'
import { PasoFechaPasajeros } from '../src/components/excursiones/reserva/PasoFechaPasajeros'
import { PasoLogistica } from '../src/components/excursiones/reserva/PasoLogistica'
import type { ValoresReserva } from '../src/components/excursiones/reserva/tipos'

/**
 * EL FORMULARIO «NUEVA RESERVA»: PARTE PURA, PASOS Y CONTRATO CON LA ACCIÓN (auditoría admin · fase 7, 7.2 y 7.4).
 *
 * Eran 1 371 líneas con todo mezclado y un defecto: la fecha no viajaba (el campo no tenía `name`) y no se podía crear ninguna
 * reserva desde el panel. La prueba central es el CONTRATO: todo campo que la acción lee tiene que estar en el formulario con su
 * `name`. El resto: fechas, combos, importes, lectura con el error de cada campo, la búsqueda de cliente y el marcado de los pasos.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const html = (n: unknown) => renderToStaticMarkup(n as never)

// ── El contrato: lo que la acción lee es lo que el formulario manda ─────────────────────────────────────────────────

test('CONTRATO · todo campo que lee la acción viaja en el formulario con su name (la fecha no viajaba)', () => {
  const acciones = sinComentarios(readFileSync('src/modules/excursiones/reservas/actions.ts', 'utf8'))
  const cuerpo = acciones.slice(acciones.indexOf('export async function crearReserva'))
  const fin = cuerpo.indexOf('\nexport async function ', 10)
  const crear = fin > 0 ? cuerpo.slice(0, fin) : cuerpo
  const parser = sinComentarios(readFileSync('src/modules/excursiones/reservas/formulario.ts', 'utf8'))

  const leidos = new Set<string>()
  for (const m of crear.matchAll(/formData\.get\('(\w+)'\)/g)) leidos.add(m[1])
  for (const m of parser.matchAll(/(?:texto|enteroNoNegativo)\(formData, '(\w+)'\)/g)) leidos.add(m[1])
  assert.ok(leidos.size >= 15, `esperaba leer los campos de la reserva y leí ${leidos.size}`)
  for (const campo of ['fecha', 'excursionId', 'varianteId', 'adultos', 'ninos', 'clienteId', 'clienteEmail']) {
    assert.ok(leidos.has(campo), `no encuentro «${campo}» entre los campos que lee la acción: el contrato dejó de medir lo que debe`)
  }

  const carpeta = 'src/components/excursiones/reserva'
  const fuentes = [
    ...readdirSync(carpeta).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join(carpeta, f), 'utf8')),
    readFileSync('src/components/excursiones/ReservaForm.tsx', 'utf8'),
  ].join('\n')
  const enviados = new Set<string>()
  for (const m of fuentes.matchAll(/\bname="(\w+)"/g)) enviados.add(m[1])

  // `companyId` lo lee `resolveCompanyId` solo para el superadmin; el formulario del panel de empresa no lo manda.
  const sinEnviar = [...leidos].filter((c) => !enviados.has(c) && c !== 'companyId')
  assert.deepEqual(sinEnviar, [], `la acción lee campos que el formulario no manda: ${sinEnviar.join(', ')}`)
})

test('CONTRATO · la fecha tiene un solo dueño a la vez: el campo visible, o el oculto solo si no hay campo (combo por días)', () => {
  const shell = sinComentarios(readFileSync('src/components/excursiones/ReservaForm.tsx', 'utf8'))
  assert.match(shell, /\{porDias && <input type="hidden" name="fecha"/)
  const paso = sinComentarios(readFileSync('src/components/excursiones/reserva/PasoFechaPasajeros.tsx', 'utf8'))
  assert.match(paso, /name="fecha"/)
})

// ── Fechas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('fechas · la fecha local del navegador, los atajos y las fechas que existen', () => {
  const ahora = new Date(2026, 9, 22, 21, 30) // 22 oct 2026, 9:30 de la noche local
  assert.equal(fechaLocalISO(ahora), '2026-10-22')
  assert.equal(hoyISO(ahora), '2026-10-22')
  assert.equal(diasDespuesISO(1, ahora), '2026-10-23')
  assert.equal(diasDespuesISO(10, ahora), '2026-11-01')
  assert.equal(esFechaReal('2026-10-22'), true)
  assert.equal(esFechaReal('2028-02-29'), true)
  for (const mala of ['', '2026-02-31', '2026-13-01', '22/10/2026', '2026-1-1', 'hoy']) assert.equal(esFechaReal(mala), false, mala)
})

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const COMBO: NonNullable<ExcursionOpcion['comboItems']> = [
  { id: 'a1', nombre: 'Saona', tipoItem: 'EXCURSION', duracionMin: 480, horaSalida: '08:00', horarios: [{ id: 'h1', horaSalida: '08:00', diasSemana: [] }] },
  { id: 'a2', nombre: 'Pase de piscina', tipoItem: 'PASE_DIA', duracionMin: null, horaSalida: null, horarios: [] },
]

test('combo · la clave del itinerario cambia con la fecha o las actividades, no con la referencia', () => {
  assert.equal(claveItinerario(false, COMBO, '2026-10-22'), null)
  assert.equal(claveItinerario(true, undefined, '2026-10-22'), null)
  assert.equal(claveItinerario(true, COMBO, '2026-10-22'), '2026-10-22|a1,a2')
  assert.equal(claveItinerario(true, [...COMBO], '2026-10-22'), claveItinerario(true, COMBO, '2026-10-22'))
  assert.notEqual(claveItinerario(true, COMBO, '2026-10-23'), claveItinerario(true, COMBO, '2026-10-22'))
})

test('combo · el itinerario de partida: cada actividad en la fecha elegida; el pase de día sin hora', () => {
  assert.deepEqual(itinerarioInicial(COMBO, '2026-10-22'), {
    a1: { fecha: '2026-10-22', hora: '08:00' },
    a2: { fecha: '2026-10-22', hora: '' },
  })
  assert.deepEqual(itinerarioInicial([{ ...COMBO[0], horaSalida: null }], '2026-10-22'), { a1: { fecha: '2026-10-22', hora: '09:00' } })
})

test('combo · lo que viaja: «días separados» usa lo elegido por actividad; «mismo día», el turno coordinado; el pase de día no lleva hora', () => {
  const porDias = JSON.parse(
    serializarItinerarioCombo({
      comboItems: COMBO,
      esCombo: true,
      modo: 'DIAS_DIFERENTES',
      itinerario: { a1: { fecha: '2026-10-25', hora: '10:00' }, a2: { fecha: '2026-10-26', hora: '' } },
      fecha: '2026-10-22',
      combinaciones: [],
      turnoId: '',
    })
  )
  assert.deepEqual(porDias, [
    { actividadId: 'a1', fecha: '2026-10-25', hora: '10:00' },
    { actividadId: 'a2', fecha: '2026-10-26', hora: null },
  ])

  const mismoDia = JSON.parse(
    serializarItinerarioCombo({
      comboItems: COMBO,
      esCombo: true,
      modo: 'MISMO_DIA',
      itinerario: {},
      fecha: '2026-10-22',
      combinaciones: [{ id: 'c1', nombre: 'Turno 1', horaInicio: '08:00', horaFin: '18:00', duracionTotalMin: 600, horariosAsignados: { a1: '08:30' }, itinerario: [], resumenTexto: '' }],
      turnoId: 'c1',
    })
  )
  assert.deepEqual(mismoDia, [
    { actividadId: 'a1', fecha: '2026-10-22', hora: '08:30' },
    { actividadId: 'a2', fecha: '2026-10-22', hora: null },
  ])

  assert.equal(serializarItinerarioCombo({ comboItems: COMBO, esCombo: false, modo: 'MISMO_DIA', itinerario: {}, fecha: '2026-10-22', combinaciones: [], turnoId: '' }), '')
})

// ── Importes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const VARIANTE = { id: 'v1', nombre: 'Estándar', precioAdulto: 100, precioNino: 60 }

test('importes · adultos y niños al precio de su tarifa, el descuento antes del impuesto, y sin tarifa no hay resumen', () => {
  const r = resumenDeReserva({ variante: VARIANTE, impuestoPct: 18, fecha: '2026-10-22', hora: '08:00', adultos: 2, ninos: 1, descuento: '10' })
  assert.ok(r)
  assert.equal(r.precioAdulto, 100)
  assert.equal(r.precioNino, 60)
  assert.equal(r.subtotal, 260)
  assert.equal(r.descuento, 10)
  assert.equal(r.impuestos, 45)
  assert.equal(r.total, 295)
  assert.equal(resumenDeReserva({ variante: undefined, impuestoPct: 0, fecha: '', hora: '', adultos: 1, ninos: 0, descuento: '' }), null)
})

test('importes · sin precio de niño el niño paga como adulto; un descuento mayor que el subtotal deja el total en cero; texto raro es cero', () => {
  const sinNino = resumenDeReserva({ variante: { ...VARIANTE, precioNino: null }, impuestoPct: null, fecha: '2026-10-22', hora: '', adultos: 1, ninos: 1, descuento: '' })
  assert.equal(sinNino?.subtotal, 200)
  const grande = resumenDeReserva({ variante: VARIANTE, impuestoPct: 18, fecha: '2026-10-22', hora: '', adultos: 1, ninos: 0, descuento: '999' })
  assert.equal(grande?.total, 0)
  const raro = resumenDeReserva({ variante: VARIANTE, impuestoPct: 0, fecha: '2026-10-22', hora: '', adultos: 1, ninos: 0, descuento: 'abc' })
  assert.equal(raro?.descuento, 0)
})

// ── Buscar un cliente ───────────────────────────────────────────────────────────────────────────────────────────────

test('búsqueda · se recorta, se acota, y con menos letras de las mínimas no se manda', () => {
  assert.equal(MIN_BUSQUEDA_CLIENTE, 2)
  assert.equal(leerBusquedaCliente('  ana  '), 'ana')
  assert.equal(leerBusquedaCliente('a'), '')
  assert.equal(leerBusquedaCliente(' a '), '')
  assert.equal(leerBusquedaCliente('x'.repeat(500)).length, 80)
  assert.equal(leerBusquedaCliente(undefined), '')
  assert.equal(leerBusquedaCliente(42), '')
})

test('búsqueda · el detalle muestra correo y teléfono, y lo que falte no deja separadores sueltos', () => {
  assert.equal(detalleDeCliente({ id: '1', nombre: 'Ana', email: 'a@x.com', telefono: '809' }), 'a@x.com · 809')
  assert.equal(detalleDeCliente({ id: '1', nombre: 'Ana', email: null, telefono: '809' }), '809')
  assert.equal(detalleDeCliente({ id: '1', nombre: 'Ana' }), '')
})

test('búsqueda · las flechas dan la vuelta y sin resultados no hay opción activa', () => {
  assert.equal(moverActivo(-1, 3, 1), 0)
  assert.equal(moverActivo(-1, 3, -1), 2)
  assert.equal(moverActivo(0, 3, 1), 1)
  assert.equal(moverActivo(2, 3, 1), 0)
  assert.equal(moverActivo(0, 3, -1), 2)
  assert.equal(moverActivo(5, 3, 1), 0)
  assert.equal(moverActivo(0, 0, 1), -1)
})

// ── Leer el formulario ──────────────────────────────────────────────────────────────────────────────────────────────

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}
const BASE = { excursionId: 'e1', varianteId: 'v1', fecha: '2026-10-25', adultos: '2', ninos: '0' }

test('lectura · un cliente existente elegido y todo lo demás en orden', () => {
  const r = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'EXISTENTE', clienteId: 'c1', vendedorId: 'v9' }))
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.datos, { excursionId: 'e1', varianteId: 'v1', vendedorId: 'v9', clienteId: 'c1', clienteNombre: '', clienteEmail: '', clienteTelefono: '' })
})

test('lectura · un cliente nuevo: el correo se pasa a minúsculas y el teléfono es opcional', () => {
  const r = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'NUEVO', clienteNombre: 'Laura Méndez', clienteEmail: ' Laura@Ejemplo.COM ' }))
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.datos.clienteEmail, 'laura@ejemplo.com')
    assert.equal(r.datos.clienteTelefono, '')
    assert.equal(r.datos.clienteId, '')
  }
})

test('lectura · cada fallo nombra SU campo, y uno solo dice el mensaje del campo', () => {
  const sinFecha = leerReservaDeFormulario(formulario({ ...BASE, fecha: '', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(!sinFecha.ok)
  if (!sinFecha.ok) {
    assert.deepEqual(Object.keys(sinFecha.campos), ['fecha'])
    assert.equal(sinFecha.error, 'Elige la fecha de la excursión.')
  }
  const fechaImposible = leerReservaDeFormulario(formulario({ ...BASE, fecha: '2026-02-31', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(!fechaImposible.ok && fechaImposible.campos.fecha)
})

test('lectura · la excursión primero y, si no, la tarifa; los pasajeros; el descuento', () => {
  const r1 = leerReservaDeFormulario(formulario({ ...BASE, excursionId: '', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(!r1.ok && r1.campos.excursionId && !r1.campos.varianteId)
  const r2 = leerReservaDeFormulario(formulario({ ...BASE, varianteId: '', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(!r2.ok && r2.campos.varianteId && !r2.campos.excursionId)
  const r3 = leerReservaDeFormulario(formulario({ ...BASE, adultos: '0', ninos: '0', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(!r3.ok && r3.campos.pasajeros)
  const r4 = leerReservaDeFormulario(formulario({ ...BASE, adultos: '0', ninos: '2', modoCliente: 'EXISTENTE', clienteId: 'c1' }))
  assert.ok(r4.ok, 'solo niños es una reserva válida')
  for (const malo of ['-5', 'abc', '1e']) {
    const r = leerReservaDeFormulario(formulario({ ...BASE, descuento: malo, modoCliente: 'EXISTENTE', clienteId: 'c1' }))
    assert.ok(!r.ok && r.campos.descuento, `descuento «${malo}»`)
  }
  assert.ok(leerReservaDeFormulario(formulario({ ...BASE, descuento: '', modoCliente: 'EXISTENTE', clienteId: 'c1' })).ok)
  assert.ok(leerReservaDeFormulario(formulario({ ...BASE, descuento: '0', modoCliente: 'EXISTENTE', clienteId: 'c1' })).ok)
})

test('lectura · el cliente: existente sin elegir, nuevo sin datos o con un correo que no es un correo', () => {
  const sinElegir = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'EXISTENTE' }))
  assert.ok(!sinElegir.ok && Object.keys(sinElegir.campos).join() === 'clienteId')
  const nuevoVacio = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'NUEVO' }))
  assert.ok(!nuevoVacio.ok)
  if (!nuevoVacio.ok) {
    assert.deepEqual(Object.keys(nuevoVacio.campos).sort(), ['clienteEmail', 'clienteNombre'])
    assert.equal(nuevoVacio.error, 'Hay 2 campos por corregir.')
  }
  const correoMalo = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'NUEVO', clienteNombre: 'Laura', clienteEmail: 'laura@' }))
  assert.ok(!correoMalo.ok && correoMalo.campos.clienteEmail === 'Ese correo no parece válido.')
  const sinNombre = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'NUEVO', clienteEmail: 'laura@ejemplo.com' }))
  assert.ok(!sinNombre.ok && sinNombre.campos.clienteNombre && !sinNombre.campos.clienteEmail)
})

test('lectura · el modo manda: un cliente elegido no se mezcla con datos sueltos del formulario de uno nuevo, ni al revés', () => {
  const existente = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'EXISTENTE', clienteId: 'c1', clienteNombre: 'Otro', clienteEmail: 'otro@x.com' }))
  assert.ok(existente.ok)
  if (existente.ok) assert.deepEqual([existente.datos.clienteNombre, existente.datos.clienteEmail], ['', ''])
  const nuevo = leerReservaDeFormulario(formulario({ ...BASE, modoCliente: 'NUEVO', clienteId: 'c1', clienteNombre: 'Laura', clienteEmail: 'laura@x.com' }))
  assert.ok(nuevo.ok)
  if (nuevo.ok) assert.equal(nuevo.datos.clienteId, '')
})

test('lectura · sin `modoCliente` (un envío de antes) se entiende por lo que venga: un id, o nombre y correo', () => {
  assert.ok(leerReservaDeFormulario(formulario({ ...BASE, clienteId: 'c1' })).ok)
  assert.ok(leerReservaDeFormulario(formulario({ ...BASE, clienteNombre: 'Laura', clienteEmail: 'laura@x.com' })).ok)
  const nada = leerReservaDeFormulario(formulario({ ...BASE }))
  assert.ok(!nada.ok && nada.campos.clienteId)
})

test('lectura · varios errores a la vez salen TODOS, no uno por intento', () => {
  const r = leerReservaDeFormulario(formulario({ excursionId: '', fecha: '', adultos: '0', ninos: '0', modoCliente: 'EXISTENTE' }))
  assert.ok(!r.ok)
  if (!r.ok) {
    assert.deepEqual(Object.keys(r.campos).sort(), ['clienteId', 'excursionId', 'fecha', 'pasajeros'])
    assert.equal(r.error, 'Hay 4 campos por corregir.')
  }
})

// ── La acción y la consulta ─────────────────────────────────────────────────────────────────────────────────────────

test('la acción lee el formulario con el parser, devuelve el error de cada campo y la búsqueda tiene su guardia', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/reservas/actions.ts', 'utf8'))
  const crear = src.slice(src.indexOf('export async function crearReserva'))
  assert.match(crear, /leerReservaDeFormulario\(formData\)/)
  assert.match(crear, /return \{ error: leido\.error, campos: leido\.campos \}/)
  assert.match(crear, /campos: \{ fecha: v\.error \}/, 'el error de fecha del núcleo también sale junto a su campo')
  assert.doesNotMatch(crear, /formData\.get\('clienteId'\)/, 'la lectura del cliente es del parser, no de la acción')

  const buscar = src.slice(src.indexOf('export async function buscarClientes'), src.indexOf('export async function crearReserva'))
  assert.match(buscar, /requireSection\('excursiones', 'reserva_crear'\)/, 'la misma función que crear la reserva')
  assert.match(buscar, /resolveCompanyId\(user\)/, 'la empresa sale de la sesión, no de lo que mande el navegador')
  assert.match(buscar, /leerBusquedaCliente\(busqueda\)/)
  assert.match(buscar, /buscarClientesParaReserva\(companyId, q\)/)
})

test('la consulta de clientes busca en TODA la empresa, limita lo que muestra y dice si hay más', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/reservas/queries.ts', 'utf8'))
  const cuerpo = src.slice(src.indexOf('export async function buscarClientesParaReserva'), src.indexOf('export async function empresaTieneClientes'))
  assert.match(cuerpo, /companyId,\s*\n\s*OR: \[/, 'siempre dentro de la empresa')
  assert.match(cuerpo, /nombreBusqueda: \{ contains: normalizarBusqueda\(q\) \}/)
  assert.match(cuerpo, /telefono: \{ contains: q \}/)
  assert.match(cuerpo, /email: \{ contains: q, mode: 'insensitive' \}/)
  assert.match(cuerpo, /take: LIMITE_BUSQUEDA_CLIENTE \+ 1/, 'uno más del límite, para poder decir «hay más»')
  assert.match(cuerpo, /hayMas: clientes\.length > LIMITE_BUSQUEDA_CLIENTE/)
  assert.equal(LIMITE_BUSQUEDA_CLIENTE, 10)
  // La página del panel ya no trae una lista de clientes con tope: pregunta si hay alguno.
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/reservas/nueva/page.tsx', 'utf8'))
  assert.doesNotMatch(pagina, /clientesParaReserva/)
  assert.match(pagina, /empresaTieneClientes\(companyId\)/)
})

// ── Los pasos, a HTML ───────────────────────────────────────────────────────────────────────────────────────────────

const EXCURSION: ExcursionOpcion = {
  id: 'e1',
  nombre: 'Isla Saona',
  moneda: 'DOP',
  impuestoPct: 18,
  portadaUrl: null,
  tipoItem: 'EXCURSION',
  variantes: [VARIANTE],
  horarios: [{ id: 'h1', horaSalida: '08:00', diasSemana: [] }],
}

const V: ValoresReserva = {
  busquedaExcursion: '',
  excursionId: 'e1',
  varianteId: 'v1',
  hora: '08:00',
  fecha: '2026-10-25',
  adultos: 2,
  ninos: 0,
  descuento: '',
  vendedorId: '',
  canal: 'MOSTRADOR',
  modoCombo: 'MISMO_DIA',
  turnoCombo: '',
  itinerario: {},
  modoCliente: 'EXISTENTE',
  cliente: null,
  clienteNombre: '',
  clienteEmail: '',
  clienteTelefono: '',
  mostrarLogistica: false,
  voucherAgencia: '',
  hotelRecogida: '',
  lobbyRecogida: '',
  horaRecogida: '',
  habitacion: '',
  notas: '',
}
const poner = () => {}
const buscar = async () => ({ clientes: [], hayMas: false })
const control = (out: string, id: string) => out.match(new RegExp(`<(?:input|select|textarea|button)[^>]*id="${id}"[^>]*>`))?.[0] ?? ''

test('paso 1 · cada tarjeta dice si está elegida; el buscador y el grupo tienen nombre; un error sale con el grupo', () => {
  const out = html(h(PasoExcursion, { v: V, poner, errores: {}, excursiones: [EXCURSION] }))
  assert.match(out, /<label for="reserva-buscar-excursion"[^>]*>Buscar en el catálogo/)
  assert.match(out, /<legend[^>]*>Excursiones y paquetes/)
  assert.match(out, /aria-pressed="true"/)
  assert.match(out, /Isla Saona/)
  const conError = html(h(PasoExcursion, { v: { ...V, excursionId: '' }, poner, errores: { excursionId: 'Elige la excursión o el paquete.' }, excursiones: [EXCURSION] }))
  assert.match(conError, /role="alert"[^>]*>Elige la excursión o el paquete\./)
  assert.match(conError, /data-invalido="true"/)
})

test('paso 3 · la fecha lleva name="fecha", etiqueta y error enlazados; un combo por días no tiene campo de fecha', () => {
  const normal = html(h(PasoFechaPasajeros, { v: V, poner, errores: {}, excursion: EXCURSION, variante: VARIANTE, porDias: false }))
  const campo = control(normal, 'reserva-fecha')
  assert.match(campo, /name="fecha"/)
  assert.match(campo, /type="date"/)
  assert.match(campo, /required/)
  assert.match(normal, /<label for="reserva-fecha"[^>]*>Fecha del tour/)
  assert.match(normal, /Hoy[\s\S]*Mañana[\s\S]*Pasado mañana/)
  assert.match(normal, /aria-label="Aumentar adultos"/)
  assert.match(normal, /aria-label="Disminuir niños"/)

  const conError = html(h(PasoFechaPasajeros, { v: V, poner, errores: { fecha: 'Elige la fecha de la excursión.' }, excursion: EXCURSION, variante: VARIANTE, porDias: false }))
  const marcado = control(conError, 'reserva-fecha')
  assert.match(marcado, /aria-invalid="true"/)
  assert.match(marcado, /aria-describedby="reserva-fecha-error"/)

  const combo = { ...EXCURSION, tipoItem: 'COMBO', comboItems: COMBO }
  const porDias = html(h(PasoFechaPasajeros, { v: V, poner, errores: {}, excursion: combo, variante: VARIANTE, porDias: true }))
  assert.doesNotMatch(porDias, /name="fecha"/)
  assert.match(porDias, /Fechas programadas/)

  const sinPasajeros = html(h(PasoFechaPasajeros, { v: V, poner, errores: { pasajeros: 'Una reserva necesita al menos un pasajero.' }, excursion: EXCURSION, variante: VARIANTE, porDias: false }))
  assert.match(sinPasajeros, /role="alert"[^>]*>Una reserva necesita al menos un pasajero\./)
})

test('paso 4 · «existente»: el buscador y modoCliente; el id solo cuando hay uno elegido; «nuevo»: tres campos con name y etiqueta', () => {
  const existente = html(h(PasoCliente, { v: V, poner, errores: {}, buscar }))
  assert.match(existente, /<input type="hidden" name="modoCliente" value="EXISTENTE"/)
  assert.doesNotMatch(existente, /name="clienteId"/, 'sin cliente elegido no viaja un id vacío')
  assert.match(existente, /role="combobox"/)
  assert.doesNotMatch(existente, /name="clienteNombre"/)

  const elegido = html(h(PasoCliente, { v: { ...V, cliente: { id: 'c1', nombre: 'Ana Pérez', email: 'ana@x.com' } }, poner, errores: {}, buscar }))
  assert.match(elegido, /<input type="hidden" name="clienteId" value="c1"/)
  assert.match(elegido, /Ana Pérez/)
  assert.match(elegido, /Cambiar/)

  const nuevo = html(h(PasoCliente, { v: { ...V, modoCliente: 'NUEVO' }, poner, errores: { clienteEmail: 'Ese correo no parece válido.' }, buscar }))
  assert.match(nuevo, /<input type="hidden" name="modoCliente" value="NUEVO"/)
  for (const n of ['clienteNombre', 'clienteEmail', 'clienteTelefono']) assert.match(nuevo, new RegExp(`name="${n}"`), n)
  assert.match(nuevo, /<label for="reserva-cliente-nombre"[^>]*>Nombre y apellido/)
  assert.match(control(nuevo, 'reserva-cliente-email'), /aria-invalid="true"/)
  assert.match(nuevo, /Teléfono[\s\S]*\(opcional\)/)
  assert.doesNotMatch(nuevo, /role="combobox"/)
})

test('buscador · es un combobox accesible: nombre, ayuda, lista oculta enlazada y estado anunciado', () => {
  const out = html(h(ClienteBuscador, { buscar, seleccionado: null, alElegir: poner, alLimpiar: poner, alCrearNuevo: poner }))
  const campo = control(out, 'reserva-cliente-buscar')
  assert.match(campo, /role="combobox"/)
  assert.match(campo, /aria-expanded="false"/)
  assert.match(campo, /aria-autocomplete="list"/)
  assert.match(campo, /autoComplete="off"|autocomplete="off"/)
  const idLista = campo.match(/aria-controls="([^"]+)"/)?.[1]
  assert.ok(idLista, 'aria-controls apunta a la lista')
  assert.match(out, new RegExp(`<ul[^>]*id="${idLista}"[^>]*role="listbox"|<ul[^>]*role="listbox"[^>]*id="${idLista}"`))
  assert.match(out, /<ul[^>]*hidden/, 'la lista está oculta mientras no hay resultados')
  assert.match(out, /<label for="reserva-cliente-buscar"[^>]*>Buscar cliente/)
  assert.match(out, /Escribe al menos 2 letras/)
  assert.match(out, /role="status"[^>]*class="sr-only"|class="sr-only"[^>]*role="status"/)
  const conError = html(h(ClienteBuscador, { buscar, seleccionado: null, alElegir: poner, alLimpiar: poner, alCrearNuevo: poner, error: 'Elige un cliente de la búsqueda o crea uno nuevo.' }))
  assert.match(control(conError, 'reserva-cliente-buscar'), /aria-invalid="true"/)
})

test('buscador · Intro no envía el formulario, Escape cierra, la respuesta tardía se descarta y se dice cuando hay más o ninguno', () => {
  const src = sinComentarios(readFileSync('src/components/excursiones/reserva/ClienteBuscador.tsx', 'utf8'))
  assert.match(src, /e\.key === 'Enter'[\s\S]{0,120}e\.preventDefault\(\)/, 'Intro dentro de un formulario lo enviaría')
  assert.match(src, /e\.key === 'Escape'/)
  assert.match(src, /numero === ultimaPeticion\.current/, 'una respuesta que llega tarde no pisa a la nueva')
  assert.match(src, /onMouseDown/, 'elegir con el ratón no pierde el foco antes del clic')
  assert.match(src, /Hay más de \{LIMITE_BUSQUEDA_CLIENTE\} clientes que coinciden/)
  assert.match(src, /Ningún cliente coincide con/)
  assert.match(src, /Crear cliente nuevo/)
  assert.doesNotMatch(src, /useEffect\([^)]*\)\s*=>\s*\{[^}]*setEstado/, 'el estado se deriva, no se sincroniza en un efecto')
})

test('paso 5 · vendedor, canal y descuento llevan su name y su etiqueta; el descuento malo marca su campo', () => {
  const out = html(h(PasoComercial, { v: V, poner, errores: { descuento: 'El descuento tiene que ser un número, cero o más.' }, vendedores: [{ id: 'x1', nombre: 'Luis', apellido: 'A', codigo: 'LA01' }, { id: 'x2', nombre: 'Inactivo', codigo: 'IN01', estado: 'INACTIVO' }], moneda: 'DOP' }))
  assert.match(control(out, 'reserva-vendedor'), /name="vendedorId"/)
  assert.match(control(out, 'reserva-canal'), /name="canal"/)
  assert.match(control(out, 'reserva-descuento'), /name="descuento"/)
  assert.match(control(out, 'reserva-descuento'), /aria-invalid="true"/)
  assert.match(out, /Luis/)
  assert.doesNotMatch(out, /Inactivo/, 'un vendedor inactivo no se ofrece')
  assert.match(out, /Descuento comercial \(DOP\)/)
})

test('paso 6 · plegada, la logística sigue en el formulario (oculta) y el botón dice si está desplegada', () => {
  const plegada = html(h(PasoLogistica, { v: V, poner }))
  assert.match(plegada, /aria-expanded="false"/)
  assert.match(plegada, /<div id="reserva-logistica" hidden/)
  for (const n of ['voucherAgencia', 'hotelRecogida', 'lobbyRecogida', 'horaRecogida', 'habitacion', 'notas']) {
    assert.match(plegada, new RegExp(`name="${n}"`), `${n} sigue en el formulario aunque esté plegado`)
  }
  const abierta = html(h(PasoLogistica, { v: { ...V, mostrarLogistica: true }, poner }))
  assert.match(abierta, /aria-expanded="true"/)
  assert.doesNotMatch(abierta, /<div id="reserva-logistica" hidden/)
  assert.match(abierta, /Voucher o localizador de agencia[\s\S]*\(opcional\)/)
})

test('el formulario ya no es un solo archivo: el contenedor es corto y cada paso vive aparte', () => {
  const lineas = readFileSync('src/components/excursiones/ReservaForm.tsx', 'utf8').split('\n').length
  assert.ok(lineas < 260, `el contenedor tiene ${lineas} líneas (eran 1 371)`)
  const archivos = readdirSync('src/components/excursiones/reserva').filter((f) => f.endsWith('.tsx'))
  for (const esperado of ['PasoExcursion', 'PasoModalidad', 'PasoFechaPasajeros', 'PasoCliente', 'PasoComercial', 'PasoLogistica', 'ResumenReserva', 'ClienteBuscador', 'ComboProgramacion']) {
    assert.ok(archivos.includes(`${esperado}.tsx`), esperado)
  }
  // Ningún archivo vuelve a ser enorme.
  for (const a of archivos) {
    const n = readFileSync(join('src/components/excursiones/reserva', a), 'utf8').split('\n').length
    assert.ok(n < 260, `${a} tiene ${n} líneas`)
  }
  // El portal del vendedor sigue importando sus tipos de aquí.
  assert.match(readFileSync('src/components/excursiones/ReservaForm.tsx', 'utf8'), /export type \{ ClienteOpcion, ExcursionOpcion, VendedorOpcion \}/)
})
