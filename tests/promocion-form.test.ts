import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { leerPromocionDeFormulario, type ValoresPromocion } from '../src/modules/promociones/formulario'
import { PromocionCampos, avanzadasConContenido } from '../src/components/admin/PromocionCampos'

/**
 * EL FORMULARIO DE PROMOCIÓN: TRES SECCIONES A LA VISTA, EL RESTO EN «OPCIONES AVANZADAS» (auditoría admin · fase 7, tarea 7.2;
 * 04 · F-01, F-04, F-05).
 *
 * Era una columna de 25 controles que mezclaba seis intenciones, con el error en un aviso arriba y un `document.querySelector`
 * para saber si la promoción estaba activa. Aquí se prueba la lectura (cada regla y el campo que señala) y el marcado real.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x)
    else f.set(k, v)
  }
  return f
}
const VALIDO = { tipo: 'descuento', titulo: '25% en tu primer mes', descripcion: 'Válido en sucursal principal', descuento: '25' }

// ── La lectura del formulario ────────────────────────────────────────────────

test('una promoción válida se lee con sus tipos y sus valores por defecto', () => {
  const r = leerPromocionDeFormulario(formulario(VALIDO))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.data.titulo, '25% en tu primer mes')
  assert.equal(r.data.descuento, 25)
  assert.equal(r.data.visibilidad, 'publica')
  assert.equal(r.data.prioridad, 0)
  assert.equal(r.data.campanaId, null)
  assert.equal(r.data.codigo, null)
  assert.equal(r.data.vigenciaHasta, null)
  assert.equal(r.data.esComprable, false)
  assert.deepEqual(r.share, { shareTitulo: null, shareDescripcion: null })
})

test('«none» es «sin campaña»; los textos al compartir se recortan a 120 y 200', () => {
  const r = leerPromocionDeFormulario(formulario({ ...VALIDO, campanaId: 'none', shareTitulo: 'x'.repeat(300), shareDescripcion: 'y'.repeat(300) }))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.data.campanaId, null)
  assert.equal(r.share.shareTitulo?.length, 120)
  assert.equal(r.share.shareDescripcion?.length, 200)
})

test('cada regla señala SU campo, no un aviso suelto', () => {
  const campo = (extra: Record<string, string | string[]>) => {
    const r = leerPromocionDeFormulario(formulario({ ...VALIDO, ...extra }))
    assert.equal(r.ok, false)
    return r.ok ? [] : Object.keys(r.campos)
  }
  assert.deepEqual(campo({ titulo: '' }), ['titulo'])
  assert.deepEqual(campo({ descripcion: '  ' }), ['descripcion'])
  assert.deepEqual(campo({ tipo: 'inventado' }), ['tipo'])
  assert.deepEqual(campo({ visibilidad: 'secreta' }), ['visibilidad'])
  assert.deepEqual(campo({ descuento: '-5' }), ['descuento'])
  assert.deepEqual(campo({ maxCanjes: '0' }), ['maxCanjes'])
  assert.deepEqual(campo({ prioridad: 'alta' }), ['prioridad'])
  assert.deepEqual(campo({ vigenciaDesde: '2026-10-21T10:00', vigenciaHasta: '2026-10-21T09:00' }), ['vigenciaHasta'])
})

test('una fecha ilegible ya no llega a la base: se señala en su campo', () => {
  const r = leerPromocionDeFormulario(formulario({ ...VALIDO, vigenciaDesde: 'no-es-fecha' }))
  assert.ok(!r.ok)
  if (!r.ok) assert.ok(r.campos.vigenciaDesde)
  const hasta = leerPromocionDeFormulario(formulario({ ...VALIDO, vigenciaHasta: 'mañana' }))
  assert.ok(!hasta.ok)
  if (!hasta.ok) assert.deepEqual(Object.keys(hasta.campos), ['vigenciaHasta'])
})

test('la venta solo se valida SI está activada; si no, sus campos se descartan', () => {
  // Sin venta: un precio absurdo no estorba y no se guarda.
  const sin = leerPromocionDeFormulario(formulario({ ...VALIDO, esComprable: 'false', precio: '-9', usosPorCompra: '0', diasPermitidos: ['1', '2'] }))
  assert.ok(sin.ok)
  if (sin.ok) {
    assert.equal(sin.data.precio, null)
    assert.equal(sin.data.usosPorCompra, 1)
    assert.deepEqual(sin.data.diasPermitidos, [])
  }
  // Con venta: el precio es obligatorio (0 = gratis) y los demás límites se comprueban.
  const falta = leerPromocionDeFormulario(formulario({ ...VALIDO, esComprable: 'true' }))
  assert.ok(!falta.ok)
  if (!falta.ok) assert.deepEqual(Object.keys(falta.campos), ['precio'])
  const gratis = leerPromocionDeFormulario(formulario({ ...VALIDO, esComprable: 'true', precio: '0', diasPermitidos: ['1', '9', 'x', '0'] }))
  assert.ok(gratis.ok)
  if (gratis.ok) {
    assert.equal(gratis.data.precio, 0)
    assert.deepEqual(gratis.data.diasPermitidos, [1, 0], 'solo días 0–6')
  }
})

test('con venta, cada límite señala su campo', () => {
  const campos = (extra: Record<string, string>) => {
    const r = leerPromocionDeFormulario(formulario({ ...VALIDO, esComprable: 'true', precio: '10', ...extra }))
    return r.ok ? [] : Object.keys(r.campos)
  }
  assert.deepEqual(campos({ usosPorCompra: '0' }), ['usosPorCompra'])
  assert.deepEqual(campos({ limitePorCliente: '0' }), ['limitePorCliente'])
  assert.deepEqual(campos({ beneficioVigenciaDias: '0' }), ['beneficioVigenciaDias'])
  assert.deepEqual(campos({ beneficioVigenciaHasta: 'cuando sea' }), ['beneficioVigenciaHasta'])
  assert.deepEqual(campos({ horaDesde: '18:00', horaHasta: '09:00' }), ['horaHasta'])
})

test('varios fallos se recogen A LA VEZ: el resumen dice cuántos y cada mensaje vive bajo su campo', () => {
  const r = leerPromocionDeFormulario(formulario({ tipo: 'descuento', titulo: '', descripcion: '', descuento: '-1' }))
  assert.ok(!r.ok)
  if (r.ok) return
  assert.equal(r.error, 'Hay 3 campos por corregir.')
  assert.deepEqual(Object.keys(r.campos).sort(), ['descripcion', 'descuento', 'titulo'])
  const uno = leerPromocionDeFormulario(formulario({ ...VALIDO, titulo: '' }))
  assert.ok(!uno.ok)
  if (!uno.ok) assert.equal(uno.error, uno.campos.titulo)
})

test('si falla, se devuelve TODO lo escrito: un error en el precio no vacía el título ni la descripción', () => {
  const r = leerPromocionDeFormulario(
    formulario({
      ...VALIDO,
      titulo: '  Con espacios  ',
      esComprable: 'true',
      precio: '-3',
      diasPermitidos: ['2', '4'],
      visibilidad: 'privada',
      campanaId: 'c1',
      activo: 'false',
      shareTitulo: 'Mira esto',
    })
  )
  assert.ok(!r.ok)
  if (r.ok) return
  assert.equal(r.valores.titulo, '  Con espacios  ', 'tal cual se escribió')
  assert.equal(r.valores.descripcion, 'Válido en sucursal principal')
  assert.equal(r.valores.esComprable, true)
  assert.equal(r.valores.precio, '-3')
  assert.deepEqual(r.valores.diasPermitidos, [2, 4])
  assert.equal(r.valores.visibilidad, 'privada')
  assert.equal(r.valores.campanaId, 'c1')
  assert.equal(r.valores.activo, false)
  assert.equal(r.valores.shareTitulo, 'Mira esto')
})

// ── El marcado ───────────────────────────────────────────────────────────────

const VACIOS: ValoresPromocion = {
  tipo: 'descuento', descuento: '', titulo: '', descripcion: '', codigo: '', imagenUrl: '', shareTitulo: '', shareDescripcion: '',
  vigenciaDesde: '2026-10-21T10:00', vigenciaHasta: '', maxCanjes: '', prioridad: '0', esComprable: false, precio: '', usosPorCompra: '1',
  limitePorCliente: '', beneficioVigenciaDias: '', beneficioVigenciaHasta: '', diasPermitidos: [], horaDesde: '', horaHasta: '',
  visibilidad: 'publica', campanaId: 'none', activo: true,
}

const pinta = (props: Partial<Parameters<typeof PromocionCampos>[0]> & { valores?: Partial<ValoresPromocion> } = {}) => {
  const { valores, ...resto } = props
  const v = { ...VACIOS, ...valores }
  return renderToStaticMarkup(
    h(PromocionCampos, {
      modo: 'crear', companyId: 'emp1', valores: v, campanas: [], tipo: v.tipo, esComprable: v.esComprable, activo: v.activo, ...resto,
    }) as never
  )
}
const control = (html: string, name: string) => html.match(new RegExp(`<(?:input|select|textarea|button)[^>]*name="${name}"[^>]*>`))?.[0] ?? ''

test('a la vista hay TRES secciones —Qué ofreces, Cuándo y Cuánto— y las opciones avanzadas van aparte', () => {
  const html = pinta()
  for (const titulo of ['Qué ofreces', 'Cuándo', 'Cuánto']) assert.match(html, new RegExp(`<legend class="sr-only">${titulo}</legend>`), titulo)
  assert.match(html, /<summary[^>]*>\s*Opciones avanzadas/)
  // Lo avanzado existe, pero dentro del plegable.
  const avanzadas = html.slice(html.indexOf('<details'))
  for (const nombre of ['codigo', 'maxCanjes', 'prioridad', 'shareTitulo', 'shareDescripcion', 'visibilidad']) {
    assert.ok(control(avanzadas, nombre), `${nombre} debería estar en «Opciones avanzadas»`)
    assert.ok(!control(html.slice(0, html.indexOf('<details')), nombre), `${nombre} no debería estar a la vista`)
  }
  // Y lo esencial, a la vista.
  const visible = html.slice(0, html.indexOf('<details'))
  for (const nombre of ['tipo', 'titulo', 'descripcion', 'vigenciaDesde', 'vigenciaHasta']) assert.ok(control(visible, nombre), `${nombre} debería estar a la vista`)
})

test('«Opciones avanzadas» está cerrada, y se abre sola si ya tiene contenido o un error ahí dentro', () => {
  assert.doesNotMatch(pinta(), /<details[^>]*open/)
  for (const valores of [{ codigo: 'BIENVENIDA25' }, { maxCanjes: '50' }, { prioridad: '3' }, { shareTitulo: 'x' }, { visibilidad: 'privada' }, { campanaId: 'c1' }]) {
    assert.match(pinta({ valores }), /<details[^>]*open/, JSON.stringify(valores))
  }
  assert.match(pinta({ errores: { maxCanjes: 'El límite de canjes debe ser mayor a 0.' } }), /<details[^>]*open/)
  // Un error de lo que está a la vista NO abre lo avanzado.
  assert.doesNotMatch(pinta({ errores: { titulo: 'Escribe el título de la promoción.' } }), /<details[^>]*open/)
  // Los límites de la venta solo cuentan si la venta está activada.
  const v = { ...VACIOS, limitePorCliente: '1' }
  assert.equal(avanzadasConContenido(v, {}), false)
  assert.equal(avanzadasConContenido({ ...v, esComprable: true }, {}), true)
})

test('cada campo tiene su etiqueta enlazada, y nada lleva asterisco', () => {
  const html = pinta({ campanas: [{ id: 'c1', nombre: 'Verano' }] })
  for (const id of ['tipo', 'titulo', 'descripcion', 'vigenciaDesde', 'vigenciaHasta', 'codigo', 'maxCanjes', 'prioridad', 'visibilidad', 'campanaId', 'shareTitulo', 'shareDescripcion']) {
    assert.match(html, new RegExp(`<label for="${id}"`), `${id} sin su etiqueta`)
    assert.match(html, new RegExp(`id="${id}"`), `${id} sin su control`)
  }
  assert.doesNotMatch(html, /Título \*|Descripción \*|Tipo de promoción \*|Precio \(RD\$\) \*/, 'se marca lo opcional, no lo obligatorio')
})

test('se marca lo OPCIONAL y solo eso: título, descripción y tipo no llevan «(opcional)»', () => {
  const html = pinta({ campanas: [{ id: 'c1', nombre: 'Verano' }] })
  const etiqueta = (id: string) => html.match(new RegExp(`<label for="${id}"[^>]*>([\\s\\S]*?)</label>`))?.[1] ?? ''
  for (const id of ['tipo', 'titulo', 'descripcion']) assert.doesNotMatch(etiqueta(id), /opcional/, id)
  for (const id of ['vigenciaHasta', 'codigo', 'maxCanjes', 'prioridad', 'campanaId', 'shareTitulo']) assert.match(etiqueta(id), /\(opcional\)/, id)
})

test('un error queda enlazado a SU campo: aria-invalid, aria-describedby y un mensaje que se anuncia', () => {
  const html = pinta({ errores: { titulo: 'Escribe el título de la promoción.' } })
  const titulo = control(html, 'titulo')
  assert.match(titulo, /aria-invalid="true"/)
  assert.match(titulo, /aria-describedby="titulo-error"/)
  assert.match(html, /<p id="titulo-error" role="alert"[^>]*>Escribe el título/)
  assert.doesNotMatch(control(html, 'descripcion'), /aria-invalid="true"/)
  assert.doesNotMatch(pinta(), /aria-invalid="true"/)
})

test('el tipo decide si se pide porcentaje, monto o nada', () => {
  assert.match(pinta({ tipo: 'descuento' }), /Descuento \(%\)/)
  assert.match(pinta({ tipo: 'monto_fijo' }), /Monto de descuento \(RD\$\)/)
  assert.doesNotMatch(pinta({ tipo: '2x1' }), /name="descuento"/)
})

test('la venta se lleva en un campo oculto leído del estado, y sus campos solo existen con la venta activada', () => {
  const sin = pinta({ esComprable: false })
  assert.match(sin, /<input type="hidden" name="esComprable" value="false"/)
  assert.doesNotMatch(sin, /name="precio"/)
  assert.doesNotMatch(sin, /Condiciones de la venta/)

  const con = pinta({ esComprable: true, valores: { precio: '10' } })
  assert.match(con, /<input type="hidden" name="esComprable" value="true"/)
  assert.ok(control(con, 'precio'))
  assert.match(control(con, 'precio'), /required/)
  assert.match(con, /Condiciones de la venta/)
  for (const nombre of ['limitePorCliente', 'beneficioVigenciaDias', 'beneficioVigenciaHasta', 'diasPermitidos', 'horaDesde', 'horaHasta']) {
    assert.ok(control(con, nombre), `${nombre} sin control`)
  }
  // Los siete días, y los marcados se conservan.
  const dias = pinta({ esComprable: true, valores: { diasPermitidos: [1, 5] } })
  assert.equal((dias.match(/name="diasPermitidos"/g) ?? []).length, 7)
  assert.equal((dias.match(/name="diasPermitidos"[^>]*checked=""/g) ?? []).length + (dias.match(/checked=""[^>]*name="diasPermitidos"/g) ?? []).length, 2)
})

test('«Promoción activa» y su campo oculto solo existen al editar, y dicen lo mismo', () => {
  assert.doesNotMatch(pinta({ modo: 'crear' }), /name="activo"|Promoción activa/)
  const activa = pinta({ modo: 'editar', activo: true })
  const pausada = pinta({ modo: 'editar', activo: false })
  assert.match(activa, /<input type="hidden" name="activo" value="true"/)
  assert.match(pausada, /<input type="hidden" name="activo" value="false"/)
  assert.match(activa, /<label[^>]*for="activo"[^>]*>Promoción activa/)
})

test('la campaña solo se ofrece si hay campañas', () => {
  assert.doesNotMatch(pinta(), /name="campanaId"/)
  assert.match(pinta({ campanas: [{ id: 'c1', nombre: 'Verano' }] }), /name="campanaId"/)
})

// ── El cableado ──────────────────────────────────────────────────────────────

test('las acciones leen el formulario con la función pura y devuelven los campos y lo escrito', () => {
  const src = sinComentarios(readFileSync('src/modules/admin/promocionActions.ts', 'utf8'))
  assert.match(src, /leerPromocionDeFormulario\(formData\)/)
  assert.doesNotMatch(src, /function parsePromocion/)
  assert.equal((src.match(/campos: leido\.campos, valores: leido\.valores/g) ?? []).length, 2, 'crear y actualizar')
  assert.equal((src.match(/campos: \{ campanaId: campanaError \}/g) ?? []).length, 2, 'la campaña inválida también señala su campo')
})

test('el formulario ya no toca el DOM: el interruptor y el campo oculto leen la misma variable', () => {
  const form = sinComentarios(readFileSync('src/components/admin/PromocionForm.tsx', 'utf8'))
  const campos = sinComentarios(readFileSync('src/components/admin/PromocionCampos.tsx', 'utf8'))
  for (const src of [form, campos]) assert.doesNotMatch(src, /document\.querySelector|getElementById/)
  assert.match(form, /state\.valores \?\? inicial/)
  assert.match(form, /key=\{state\.valores \? JSON\.stringify\(state\.valores\) : 'inicial'\}/)
  assert.match(form, /querySelector<HTMLElement>\('\[aria-invalid="true"\]'\)\?\.focus\(\)/)
})

test('las dos páginas usan la cabecera estándar con enlace de vuelta, no un <h1> a mano', () => {
  for (const ruta of ['src/app/(admin)/admin/promociones/nuevo/page.tsx', 'src/app/(admin)/admin/promociones/[id]/editar/page.tsx']) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    assert.match(src, /<PageHeader[\s\S]*back=/, ruta)
    assert.doesNotMatch(src, /<h1/, `${ruta}: un <h1> a mano`)
  }
})
