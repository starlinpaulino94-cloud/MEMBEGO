import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPACIDADES_BASE,
  capacidadesDeEmpresa,
  categoriaDeEmpresa,
  seccionesQueApaga,
} from '../src/modules/capacidades/catalogo'

/**
 * EL VERTICAL MANDA — y no se puede volver a olvidar.
 *
 * `capacidadesEfectivas(type, raw, tipoNegocioCodigo?)` tiene el tercer
 * argumento OPCIONAL, así que omitirlo compila igual. Eso es exactamente lo que
 * pasó en tres sitios a la vez: el panel de capacidades, el resolutor que
 * decide a qué secciones entra cada empresa, y el menú del cliente. Los tres
 * resolvían la categoría con el `type` heredado aunque el superadmin hubiera
 * asignado el vertical correcto — el mismo fallo que ya se había corregido en
 * el registro y en la elegibilidad.
 *
 * La corrección no es solo pasar el argumento: es que se pase por un OBJETO
 * cuyo tipo lo exige, para que olvidarlo deje de compilar.
 */

const CATALOGO = readFileSync(join('src', 'modules', 'capacidades', 'catalogo.ts'), 'utf8')

const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────────── la regla, en puro ─────────────────

test('el vertical gana al type heredado', () => {
  // El caso que lo destapó: vertical RESTAURANTE bien asignado y un `type`
  // que aún decía carwash.
  const e = { type: 'carwash', tipoNegocioCodigo: 'RESTAURANTE', capacidades: null }
  assert.equal(categoriaDeEmpresa(e), 'RESTAURANTE')
})

test('pero una categoría fijada A MANO gana al vertical', () => {
  // Es la regla de recencia que ya existía: la última afirmación manda, y
  // elegirla en el panel es una afirmación.
  const e = {
    type: 'carwash',
    tipoNegocioCodigo: 'RESTAURANTE',
    capacidades: { categoria: 'GYM' },
  }
  assert.equal(categoriaDeEmpresa(e), 'GYM')
})

test('sin vertical, se resuelve como siempre', () => {
  assert.equal(
    categoriaDeEmpresa({ type: 'restaurante', tipoNegocioCodigo: null, capacidades: null }),
    'RESTAURANTE'
  )
})

test('un vertical que no es una categoría del catálogo no cuenta', () => {
  // `tipos_negocio` puede tener códigos que el catálogo aún no conoce (un hotel
  // registrado por manifiesto). Ante la duda no se cambia nada.
  const e = { type: 'carwash', tipoNegocioCodigo: 'HOTEL', capacidades: null }
  assert.equal(categoriaDeEmpresa(e), 'CAR_WASH')
})

test('lo desconocido sigue cayendo en CAR_WASH: fail-open', () => {
  // Ante la duda, TODOS los módulos encendidos: una empresa viva no puede
  // perder funciones porque su `type` esté mal escrito.
  const e = { type: 'lo-que-sea', tipoNegocioCodigo: null, capacidades: null }
  assert.equal(categoriaDeEmpresa(e), 'CAR_WASH')
  // Pero para pedir vehículo no vale ese default: `categoriaExplicita` es null.
  assert.equal(capacidadesDeEmpresa(e).categoriaExplicita, null)
})

/**
 * Y LO QUE DE VERDAD CAMBIA ENTRE CATEGORÍAS ES POCO.
 *
 * Conviene que quede fijado: los cuatro paquetes base solo se diferencian en
 * `CITA_ANTES_DEL_QR`. Si mañana alguien los separa más, esta prueba obliga a
 * revisar qué empresas cambian de módulos al aplicar el vertical correcto.
 */
test('los paquetes base solo se diferencian en CITA_ANTES_DEL_QR', () => {
  const sinCita = (cat: keyof typeof CAPACIDADES_BASE) =>
    CAPACIDADES_BASE[cat].filter((c) => c !== 'CITA_ANTES_DEL_QR').sort()
  const carwash = sinCita('CAR_WASH')
  for (const cat of ['BARBERIA', 'RESTAURANTE', 'GYM'] as const) {
    assert.deepEqual(
      sinCita(cat),
      carwash,
      `${cat} ya no comparte paquete con CAR_WASH: revisa el impacto del vertical`
    )
  }
  assert.ok(CAPACIDADES_BASE.CAR_WASH.includes('CITA_ANTES_DEL_QR'))
  assert.ok(!CAPACIDADES_BASE.RESTAURANTE.includes('CITA_ANTES_DEL_QR'))
})

// ───────────── la guardia: nadie llama a la de tres argumentos ─────────────

/** Todos los `.ts`/`.tsx` de `src`. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) fuentes(ruta, acc)
    else if (/\.tsx?$/.test(ruta) && !ruta.endsWith('.d.ts')) acc.push(ruta)
  }
  return acc
}

/**
 * `capacidadesEfectivas` es la de argumentos sueltos y el tercero es opcional:
 * es la que se puede llamar mal. Solo puede usarla el propio catálogo, a través
 * de `capacidadesDeEmpresa`, que exige el objeto completo.
 *
 * Las excepciones se declaran AQUÍ con su motivo, no se ignoran en silencio.
 */
const PUEDEN_USARLA = [
  join('src', 'modules', 'capacidades', 'catalogo.ts'),
  // Resuelve el vertical ANTES por su cuenta y solo cae aquí de respaldo, para
  // no quitarle acceso a una empresa anterior a la columna.
  join('src', 'modules', 'plataforma', 'registro.ts'),
]

test('nadie llama a la versión que permite olvidarse del vertical', () => {
  const infractores = fuentes('src')
    .filter((f) => !PUEDEN_USARLA.some((p) => f.endsWith(p)))
    .filter((f) => /capacidadesEfectivas\s*\(/.test(sinComentarios(readFileSync(f, 'utf8'))))
    .map((f) => f.replaceAll('\\', '/'))

  assert.deepEqual(
    infractores,
    [],
    'usa `capacidadesDeEmpresa({ type, tipoNegocioCodigo, capacidades })`: con el objeto, ' +
      'olvidarse del vertical deja de compilar.\n' +
      infractores.join('\n')
  )
})

test('las tres puertas leen `tipoNegocioCodigo` de la base', () => {
  // Pasarlo no sirve de nada si la consulta no lo trae.
  for (const [nombre, ruta] of [
    ['el resolutor', join('src', 'modules', 'capacidades', 'resolver.ts')],
    ['el menú del cliente', join('src', 'modules', 'cliente', 'navDisponible.ts')],
    [
      'el panel',
      join('src', 'app', '(superadmin)', 'superadmin', 'capacidades', 'page.tsx'),
    ],
    ['guardar', join('src', 'modules', 'capacidades', 'actions.ts')],
  ] as const) {
    assert.match(
      readFileSync(ruta, 'utf8'),
      /tipoNegocioCodigo: true/,
      `${nombre} tiene que seleccionar tipoNegocioCodigo`
    )
  }
})

// ───────────── M102 · qué apaga cada capacidad ─────────────

test('las capacidades que controlan secciones lo dicen', () => {
  assert.deepEqual(seccionesQueApaga('CITAS'), ['Citas'])
  assert.deepEqual(seccionesQueApaga('SEGUIMIENTO'), ['Seguimiento de beneficios'])
  assert.deepEqual(seccionesQueApaga('RULETA'), ['Ruleta y gamificación'])
})

test('y las que no controlan ninguna no inventan una', () => {
  // Enseñar «Controla: —» en catorce interruptores sería ruido.
  assert.deepEqual(seccionesQueApaga('POS_CAJA'), [])
  assert.deepEqual(seccionesQueApaga('CITA_ANTES_DEL_QR'), [])
})

test('toda sección controlada tiene nombre legible', () => {
  // Sin esto el aviso diría «se apagará citas» en minúscula y con el código
  // interno, que es lo que se venía enseñando: nada.
  const conNombre = ['CITAS', 'SEGUIMIENTO', 'RULETA'] as const
  for (const cap of conNombre) {
    for (const s of seccionesQueApaga(cap)) {
      assert.match(s, /^[A-ZÁÉÍÓÚÑ]/, `«${s}» no parece un nombre de menú`)
    }
  }
})

// ───────────── M101, M104 · aviso y bitácora ─────────────

test('se avisa antes de apagar una sección, y solo entonces', () => {
  const panel = readFileSync(join('src', 'components', 'capacidades', 'CapacidadesPanel.tsx'), 'utf8')
  // Solo lo que HOY está encendido y de verdad se apaga.
  assert.match(panel, /activasSet\.has\(cap\) && datos\.get\(`cap_\$\{cap\}`\) !== 'on'/)
  assert.match(panel, /if \(secciones\.length === 0\) return/)
  assert.match(panel, /<ConfirmDialog/)
  // Y el diálogo nombra las secciones, no dice «algunas».
  assert.match(panel, /porApagar\.join\(', '\)/)
})

test('guardar deja una acción propia con lo que cambió', () => {
  const acciones = readFileSync(join('src', 'modules', 'capacidades', 'actions.ts'), 'utf8')
  assert.match(acciones, /accion: 'CAPACIDADES_ACTUALIZADAS'/)
  assert.ok(
    !/accion: 'NOTA_INTERNA'/.test(sinComentarios(acciones)),
    'era una nota interna: no se podía filtrar por acción en Auditoría'
  )
  assert.match(acciones, /encendidas,\s*\n\s*apagadas,/)
})

test('la categoría derivada al guardar sale de lo mismo que muestra la pantalla', () => {
  const acciones = readFileSync(join('src', 'modules', 'capacidades', 'actions.ts'), 'utf8')
  assert.match(acciones, /const derivada = categoriaDeEmpresa\(company\)/)
  assert.ok(
    !/categoriaDeType\(company\.type\)/.test(sinComentarios(acciones)),
    'derivarla del `type` decidía si fijar la categoría sobre la información equivocada'
  )
})

// ───────────── M103, M106 · el selector ─────────────

test('el selector busca y marca práctica, suspendida y ajustada', () => {
  const page = readFileSync(
    join('src', 'app', '(superadmin)', 'superadmin', 'capacidades', 'page.tsx'),
    'utf8'
  )
  assert.match(page, /name="q"/)
  assert.match(page, /e\.esDemo \? ' · práctica' : ''/)
  assert.match(page, /!e\.isActive \? ' · suspendida' : ''/)
  assert.match(page, /ajustada\(e\) \? ' · ajustada' : ''/)
})

test('la página hace UNA consulta, no dos', () => {
  const page = readFileSync(
    join('src', 'app', '(superadmin)', 'superadmin', 'capacidades', 'page.tsx'),
    'utf8'
  )
  const veces = [...page.matchAll(/sinEmpresa\(/g)].length
  assert.equal(veces, 1, `la página abre ${veces} transacciones; con una basta`)
})

test('el catálogo expone la puerta única', () => {
  assert.match(CATALOGO, /export interface EmpresaParaCapacidades/)
  assert.match(CATALOGO, /export function capacidadesDeEmpresa/)
  assert.match(CATALOGO, /export function categoriaDeEmpresa/)
})
