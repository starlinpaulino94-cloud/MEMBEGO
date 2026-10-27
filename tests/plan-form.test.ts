import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  leerPlanDeFormulario,
  valoresDePlanGuardado,
  valoresDePlanNuevo,
  valoresDePlantilla,
  type ValoresPlan,
} from '../src/modules/planes/formulario'
import { PlanCampos, paletaDelPlan } from '../src/components/admin/PlanCampos'

/**
 * UN SOLO FORMULARIO DE PLAN, CON SUS ERRORES ENLAZADOS (auditoría admin · fase 7, tarea 7.2; 04 · F-01, F-04, F-06, F-07).
 *
 * Eran `NuevoPlanForm` y `EditarPlanForm`, con un aviso arriba que no decía qué campo falló, un asterisco en lo obligatorio y un
 * `type="color"` libre cuyo valor por defecto era un azul ya retirado. Aquí se prueba la lectura del formulario (cada regla y
 * qué campo señala) y el marcado real de los campos, sin navegador.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}
const VALIDO = { nombre: 'Gold', precio: '1500', vigenciaDias: '30', lavados: '4', beneficios: 'Uno\n\n  Dos  \nTres', orden: '2' }

// ── La lectura del formulario ────────────────────────────────────────────────

test('un plan válido se lee con sus tipos: números, beneficios por línea, vacío = null', () => {
  const r = leerPlanDeFormulario(formulario({ ...VALIDO, esIlimitado: 'on', color: '', descripcion: '  ' }))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.plan.nombre, 'Gold')
  assert.equal(r.plan.precio, 1500)
  assert.equal(r.plan.vigenciaDias, 30)
  assert.equal(r.plan.lavados, 4)
  assert.equal(r.plan.esIlimitado, true)
  assert.deepEqual(r.plan.beneficios, ['Uno', 'Dos', 'Tres'], 'una línea vacía no es un beneficio y los espacios sobran')
  assert.equal(r.plan.descripcion, null)
  assert.equal(r.plan.color, null)
  assert.equal(r.plan.imagenUrl, null)
  assert.equal(r.plan.orden, 2)
})

test('lo que se podía omitir sigue teniendo su valor por defecto: vigencia 30, orden 0, usos 0', () => {
  const r = leerPlanDeFormulario(formulario({ nombre: 'Plata', precio: '0' }))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.plan.precio, 0, 'un plan gratis es válido')
  assert.equal(r.plan.vigenciaDias, 30)
  assert.equal(r.plan.orden, 0)
  assert.equal(r.plan.lavados, 0)
})

test('cada regla señala SU campo, no un aviso suelto', () => {
  const falla = (campos: Record<string, string>) => {
    const r = leerPlanDeFormulario(formulario(campos))
    assert.equal(r.ok, false)
    return r.ok ? null : r
  }
  assert.deepEqual(Object.keys(falla({ precio: '10' })!.campos), ['nombre'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X' })!.campos), ['precio'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '-5' })!.campos), ['precio'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: 'abc' })!.campos), ['precio'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', vigenciaDias: '0' })!.campos), ['vigenciaDias'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', orden: 'primero' })!.campos), ['orden'])
  // Lo que la prueba de producción dejó pasar: usos negativos, nombre desbordado y precio que la base no admite.
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', lavados: '-3' })!.campos), ['lavados'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', lavados: '2.5' })!.campos), ['lavados'])
  assert.deepEqual(Object.keys(falla({ nombre: 'Q'.repeat(81), precio: '10' })!.campos), ['nombre'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '100000000' })!.campos), ['precio'])
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', vigenciaDias: '1.5' })!.campos), ['vigenciaDias'])
  assert.ok(leerPlanDeFormulario(formulario({ nombre: 'Q'.repeat(80), precio: '99999999.99', lavados: '0' })).ok)
  assert.deepEqual(Object.keys(falla({ nombre: 'X', precio: '10', imagenUrl: 'https://otro-sitio.example/foto.png' })!.campos), ['imagenUrl'])
})

test('con un solo fallo el resumen es ese mensaje; con varios, cuántos son — y cada uno vive bajo su campo', () => {
  const uno = leerPlanDeFormulario(formulario({ precio: '10' }))
  assert.ok(!uno.ok)
  if (!uno.ok) assert.equal(uno.error, uno.campos.nombre)

  const varios = leerPlanDeFormulario(formulario({ precio: '-1', vigenciaDias: '0' }))
  assert.ok(!varios.ok)
  if (!varios.ok) {
    assert.equal(varios.error, 'Hay 3 campos por corregir.')
    assert.deepEqual(Object.keys(varios.campos).sort(), ['nombre', 'precio', 'vigenciaDias'])
  }
})

test('si falla, se devuelve TODO lo escrito: un error en el precio no vacía el nombre ni los beneficios', () => {
  const r = leerPlanDeFormulario(
    formulario({ nombre: '  Gold  ', precio: '-1', descripcion: 'Con  espacios', beneficios: 'Uno\nDos', esIlimitado: 'on', color: '#be123c', orden: '3', activo: 'on' })
  )
  assert.ok(!r.ok)
  if (r.ok) return
  assert.equal(r.valores.nombre, '  Gold  ', 'tal cual se escribió, sin recortar')
  assert.equal(r.valores.precio, '-1')
  assert.equal(r.valores.descripcion, 'Con  espacios')
  assert.equal(r.valores.beneficios, 'Uno\nDos')
  assert.equal(r.valores.esIlimitado, true)
  assert.equal(r.valores.color, '#be123c')
  assert.equal(r.valores.orden, '3')
  assert.equal(r.valores.activo, true)
})

// ── De dónde salen los valores iniciales ─────────────────────────────────────

test('un plan nuevo arranca con 30 días, orden 0 y activo; una plantilla se copia como valores editables', () => {
  const nuevo = valoresDePlanNuevo()
  assert.equal(nuevo.vigenciaDias, '30')
  assert.equal(nuevo.orden, '0')
  assert.equal(nuevo.activo, true)
  assert.equal(nuevo.color, '', 'sin color elegido: el formulario pone el de la paleta')
  const copia = valoresDePlantilla({ nombre: 'Lavado Gold', descripcion: 'd', precio: 1200, vigenciaDias: 30, lavados: 0, esIlimitado: true, beneficios: 'a\nb', condiciones: 'c' })
  assert.equal(copia.precio, '1200')
  assert.equal(copia.lavados, '', 'cero usos se deja en blanco, no «0»')
  assert.equal(copia.esIlimitado, true)
})

test('un plan guardado se abre tal como está, incluidos los beneficios en líneas y el color que tenía', () => {
  const v = valoresDePlanGuardado({
    companyId: 'emp1', nombre: 'Gold', precio: { toString: () => '1500.00' }, lavadosIncluidos: 4, esIlimitado: false, descripcion: null,
    beneficios: ['a', 'b'], activo: false, vigenciaDias: 60, condiciones: null, color: '#0ea5e9', imagenUrl: null, orden: 7,
  })
  assert.equal(v.precio, '1500.00')
  assert.equal(v.beneficios, 'a\nb')
  assert.equal(v.descripcion, '')
  assert.equal(v.color, '#0ea5e9')
  assert.equal(v.activo, false)
  assert.equal(v.orden, '7')
})

// ── El marcado ───────────────────────────────────────────────────────────────

const pinta = (props: Partial<Parameters<typeof PlanCampos>[0]> = {}) =>
  renderToStaticMarkup(h(PlanCampos, { modo: 'crear', valores: valoresDePlanNuevo(), empresaDeLaImagen: 'emp1', ...props }) as never)

test('cada campo tiene su etiqueta enlazada al control, y nada lleva asterisco', () => {
  const html = pinta()
  for (const id of ['nombre', 'precio', 'vigenciaDias', 'lavados', 'beneficios', 'descripcion', 'condiciones', 'orden']) {
    assert.match(html, new RegExp(`<label for="${id}"`), `${id} sin su etiqueta`)
    assert.match(html, new RegExp(`id="${id}"`), `${id} sin su control`)
  }
  assert.doesNotMatch(html, /\*<\/label>|Nombre del plan \*|Precio \(RD\$\) \*/, 'se marca lo opcional, no lo obligatorio')
})

test('se marca lo OPCIONAL y solo eso: nombre, precio y vigencia no llevan «(opcional)»', () => {
  const html = pinta()
  const etiqueta = (id: string) => html.match(new RegExp(`<label for="${id}"[^>]*>([\\s\\S]*?)</label>`))?.[1] ?? ''
  for (const id of ['nombre', 'precio', 'vigenciaDias']) assert.doesNotMatch(etiqueta(id), /opcional/, id)
  for (const id of ['lavados', 'beneficios', 'descripcion', 'condiciones', 'orden']) assert.match(etiqueta(id), /\(opcional\)/, id)
})

/** La etiqueta completa del control con ese `name` (el orden de los atributos no importa). */
const control = (html: string, name: string) => html.match(new RegExp(`<(?:input|select|textarea)[^>]*name="${name}"[^>]*>`))?.[0] ?? ''

test('un error queda enlazado a SU campo: aria-invalid, aria-describedby y un mensaje que se anuncia', () => {
  const html = pinta({ errores: { precio: 'El precio no es válido: usa un número desde 0.' } })
  const precio = control(html, 'precio')
  assert.match(precio, /aria-invalid="true"/)
  assert.match(precio, /aria-describedby="precio-error"/)
  assert.match(html, /<p id="precio-error" role="alert"[^>]*>El precio no es válido/)
  // Y los que no fallaron no se marcan.
  assert.doesNotMatch(control(html, 'nombre'), /aria-invalid="true"/)
})

test('sin errores no hay ni un aria-invalid="true"; la ayuda sí se enlaza', () => {
  const html = pinta()
  assert.doesNotMatch(html, /aria-invalid="true"/)
  assert.match(control(html, 'vigenciaDias'), /aria-describedby="vigenciaDias-ayuda"/)
})

test('crear y editar comparten los campos; «Plan activo» solo existe al editar', () => {
  assert.doesNotMatch(pinta({ modo: 'crear' }), /name="activo"/)
  const editar = pinta({ modo: 'editar', planId: 'p1', valores: { ...valoresDePlanNuevo(), activo: false } })
  assert.match(editar, /name="activo"/)
  assert.doesNotMatch(editar, /name="activo"[^>]*checked/, 'un plan inactivo se abre inactivo')
  for (const nombre of ['nombre', 'precio', 'vigenciaDias', 'lavados', 'esIlimitado', 'beneficios', 'descripcion', 'condiciones', 'orden', 'color']) {
    assert.match(pinta({ modo: 'crear' }), new RegExp(`name="${nombre}"`), `crear sin ${nombre}`)
    assert.match(editar, new RegExp(`name="${nombre}"`), `editar sin ${nombre}`)
  }
})

test('el selector de empresa solo aparece con `companies` (superadmin al crear) y su error se enlaza', () => {
  assert.doesNotMatch(pinta(), /name="companyId"/)
  const html = pinta({ companies: [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }], errores: { companyId: 'Elige la empresa del plan.' } })
  assert.match(html, /<select[^>]*name="companyId"/)
  assert.match(html, /<option value="a">Acme<\/option>/)
  assert.match(html, /aria-describedby="companyId-error"/)
})

// ── El color: paleta cerrada, sin perder el que ya tenía ─────────────────────

test('el color es una paleta cerrada de radios con su contraste, no un `type="color"` libre', () => {
  const html = pinta()
  assert.doesNotMatch(html, /type="color"/)
  assert.match(html, /role="radiogroup"/)
  assert.equal((html.match(/<input[^>]*type="radio"[^>]*name="color"/g) ?? []).length, 8)
  assert.doesNotMatch(html, /#2563eb|#0ea5e9/i, 'el azul retirado ya no es el valor por defecto')
})

test('un plan nuevo arranca con el color por defecto de la paleta; uno guardado sin color sigue sin color', () => {
  const marcado = (html: string) => html.match(/<input[^>]*type="radio"[^>]*name="color"[^>]*checked/g)?.length ?? 0
  assert.equal(marcado(pinta({ modo: 'crear' })), 1)
  assert.equal(marcado(pinta({ modo: 'editar', planId: 'p', valores: { ...valoresDePlanNuevo(), color: '' } })), 0, 'sin color elegido no se inventa uno')
})

test('un color que ya tenía y no está en la paleta se CONSERVA como «Color actual»: guardar sin tocarlo no lo borra', () => {
  const valores: ValoresPlan = { ...valoresDePlanNuevo(), color: '#0EA5E9' }
  const paleta = paletaDelPlan(valores.color)
  assert.equal(paleta.length, 9)
  assert.deepEqual([paleta[0]!.valor, paleta[0]!.nombre], ['#0ea5e9', 'Color actual'])
  const html = pinta({ modo: 'editar', planId: 'p', valores })
  const marcado = html.match(/<input[^>]*name="color"[^>]*checked=""[^>]*>/)?.[0] ?? ''
  assert.match(marcado, /value="#0ea5e9"/, 'el color de antes sigue elegido')
  assert.equal((html.match(/type="radio"[^>]*name="color"/g) ?? []).length, 9)
  // Un color de la paleta no se duplica.
  assert.equal(paletaDelPlan('#0f6fd9').length, 8)
})

test('«Más opciones» se abre sola si ya tiene contenido o un error, y cerrada si no', () => {
  assert.doesNotMatch(pinta(), /<details[^>]*open/)
  assert.match(pinta({ valores: { ...valoresDePlanNuevo(), condiciones: 'Solo sucursal principal' } }), /<details[^>]*open/)
  assert.match(pinta({ valores: { ...valoresDePlanNuevo(), orden: '3' } }), /<details[^>]*open/)
  assert.match(pinta({ errores: { orden: 'El orden debe ser un número.' } }), /<details[^>]*open/)
})

// ── El cableado ──────────────────────────────────────────────────────────────

test('las cuatro páginas usan el formulario único y los dos viejos ya no existen', () => {
  assert.ok(!existsSync('src/components/admin/NuevoPlanForm.tsx'))
  assert.ok(!existsSync('src/components/admin/EditarPlanForm.tsx'))
  const paginas: [string, RegExp][] = [
    ['src/app/(admin)/admin/planes/nuevo/page.tsx', /<PlanForm\s+modo="crear"/],
    ['src/app/(admin)/admin/planes/[id]/editar/page.tsx', /<PlanForm modo="editar" planId=\{plan\.id\}/],
    ['src/app/(superadmin)/superadmin/planes/nuevo/page.tsx', /<PlanForm modo="crear"/],
    ['src/app/(superadmin)/superadmin/planes/[id]/editar/page.tsx', /<PlanForm modo="editar" planId=\{plan\.id\}/],
  ]
  for (const [ruta, patron] of paginas) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    assert.match(src, patron, ruta)
    assert.match(src, /<PageHeader[\s\S]*variant="formulario"/, `${ruta}: cabecera de formulario`)
    assert.doesNotMatch(src, /<h1/, `${ruta}: un <h1> a mano`)
  }
})

test('las acciones leen el formulario con la función pura y devuelven los campos y lo escrito', () => {
  const src = sinComentarios(readFileSync('src/modules/admin/planActions.ts', 'utf8'))
  assert.match(src, /leerPlanDeFormulario\(formData\)/)
  assert.doesNotMatch(src, /function parsePlan/)
  assert.equal((src.match(/campos: leido\.campos, valores: leido\.valores/g) ?? []).length, 2, 'crear y actualizar')
})

test('el formulario vivo vuelve a montar los campos con lo escrito y pone el foco en el primer error', () => {
  const src = sinComentarios(readFileSync('src/components/admin/PlanForm.tsx', 'utf8'))
  assert.match(src, /state\.valores \?\? inicial/)
  assert.match(src, /key=\{state\.valores \? JSON\.stringify\(state\.valores\) : 'inicial'\}/)
  assert.match(src, /querySelector<HTMLElement>\('\[aria-invalid="true"\]'\)\?\.focus\(\)/)
  assert.match(src, /modo === 'crear' \? crearPlan : actualizarPlan/)
})
