/**
 * IMAGEN DEL PLAN · lo que se acepta y dónde se ve.
 *
 * Dos clases de prueba:
 *
 *  1. `validarImagenPlan` — la que decide si una URL entra en la base. Se
 *     prueba con valores, que es como debe probarse una función pura.
 *  2. Guardias de fuente sobre las pantallas. Los módulos de servidor no se
 *     pueden importar aquí (`server-only`), así que se lee el ARCHIVO, y con
 *     los comentarios quitados: cada cadena que se busca aparece también
 *     explicada en un comentario del propio archivo, y una prueba satisfecha
 *     por leer la explicación de lo que vigila no vigila nada.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validarImagenPlan, prefijoImagenPlan } from '../src/modules/planes/imagen'

const BASE = 'https://proyecto.supabase.co'
const BUENA = `${BASE}/storage/v1/object/public/promociones/empresa-1/planes/plan-1/foto.jpg`

function fuenteSinComentarios(...ruta: string[]): string {
  const texto = readFileSync(join(__dirname, '..', ...ruta), 'utf8')
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ── La función que decide ────────────────────────────────────────────────────

test('sin imagen es válido: el campo es opcional', () => {
  assert.equal(validarImagenPlan('', BASE), null)
  assert.equal(validarImagenPlan('   ', BASE), null)
})

test('una URL de nuestro bucket pasa', () => {
  assert.equal(validarImagenPlan(BUENA, BASE), null)
})

test('un origen ajeno se rechaza aunque parezca una imagen', () => {
  const error = validarImagenPlan('https://cdn.ajeno.example/foto.jpg', BASE)
  assert.ok(error, 'debería rechazarse')
  assert.match(error!, /subirse desde el formulario/)
})

test('un host que solo EMPIEZA parecido no cuela', () => {
  // `https://proyecto.supabase.co.malo.example/...` empieza por el dominio
  // pero no por el prefijo completo, que es lo que se compara.
  const suplantado = 'https://proyecto.supabase.co.malo.example/storage/v1/object/public/promociones/x.jpg'
  assert.ok(validarImagenPlan(suplantado, BASE))
})

test('otro bucket del mismo proyecto tampoco: comprobantes es privado', () => {
  const otro = `${BASE}/storage/v1/object/public/comprobantes/empresa-1/recibo.jpg`
  assert.ok(validarImagenPlan(otro, BASE))
})

test('solo formatos de imagen, y el parámetro de consulta no engaña', () => {
  assert.ok(validarImagenPlan(BUENA.replace('.jpg', '.svg'), BASE), 'svg no')
  assert.equal(validarImagenPlan(`${BUENA}?v=2`, BASE), null, 'con query sí')
  assert.ok(
    validarImagenPlan(`${BASE}/storage/v1/object/public/promociones/x.html?a=.jpg`, BASE),
    'la extensión se mira antes del ?, no después'
  )
})

test('sin NEXT_PUBLIC_SUPABASE_URL se rechaza, no se deja pasar', () => {
  // Fallar abierto aquí sería aceptar cualquier origen justo cuando la
  // configuración está rota.
  assert.equal(prefijoImagenPlan(undefined), null)
  assert.ok(validarImagenPlan(BUENA, undefined))
})

// ── Guardias de las pantallas ────────────────────────────────────────────────

test('el servidor valida la imagen: no basta con el campo oculto', () => {
  const src = fuenteSinComentarios('src', 'modules', 'admin', 'planActions.ts')
  assert.match(src, /validarImagenPlan\(imagenUrl\)/)
  assert.match(src, /imagenUrl: parsed\.imagenUrl/)
})

test('la ruta lleva la empresa en el primer segmento', () => {
  const src = fuenteSinComentarios('src', 'lib', 'storage-rutas.ts')
  assert.match(src, /export function rutaPlan\(/)
  assert.match(src, /\$\{empresa\}\/planes\//)
})

test('las tres pantallas del cliente pintan la imagen', () => {
  const pantallas: [string, string[]][] = [
    ['tarjeta de planes', ['src', 'components', 'cliente', 'PlanesGrid.tsx']],
    ['membresía del cliente', ['src', 'app', '(cliente)', 'membresia', '[membresiaId]', 'page.tsx']],
    ['landing pública del plan', ['src', 'app', '(public)', 'plan', '[id]', 'page.tsx']],
  ]
  for (const [nombre, ruta] of pantallas) {
    const src = fuenteSinComentarios(...ruta)
    assert.match(src, /imagenUrl/, `${nombre}: no lee imagenUrl`)
    assert.match(src, /<img/, `${nombre}: no pinta ninguna imagen`)
  }
})

test('la pantalla de inicio prefiere la imagen del plan al logo de la empresa', () => {
  // Cuatro planes de la misma empresa son cuatro veces el mismo logo: la
  // rejilla del inicio no distingue nada. El logo se queda solo de respaldo.
  const src = fuenteSinComentarios('src', 'modules', 'home', 'lectura.ts')
  assert.match(src, /imagen: p\.imagenUrl \?\? p\.company\.logoUrl/)
})

test('las consultas públicas de planes traen la imagen', () => {
  const src = fuenteSinComentarios('src', 'modules', 'marketplace', 'queries.ts')
  // Las dos: el catálogo global (inicio y «ver más») y la de una empresa.
  assert.ok(
    (src.match(/imagenUrl: p\.imagenUrl/g) ?? []).length >= 2,
    'alguna consulta pública no devuelve la imagen'
  )
})

test('el motor de elegibilidad trae la imagen: si no, la tarjeta nunca la ve', () => {
  const src = fuenteSinComentarios('src', 'modules', 'elegibilidad', 'index.ts')
  assert.match(src, /imagenUrl: true/, 'falta en el select')
  assert.match(src, /imagenUrl: p\.imagenUrl/, 'falta en el mapeo')
})
