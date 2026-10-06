import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CAPACIDADES,
  CAPACIDADES_BASE,
  CAPACIDAD_DE_SECCION,
  SECCIONES_POR_CAPACIDAD,
} from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { FUNCIONES_EMPRESA } from '../src/modules/plataforma/conceptos'

/**
 * COMMERCE CORE · catálogo — capacidad, sección y guardias (Fase 1).
 *
 * El catálogo unificado nace APAGADO para todos y se enciende empresa por
 * empresa. Aquí se comprueba el cableado; el comportamiento contra la base
 * está en `tests/postgres/catalog.db.test.ts`.
 */

test('CATALOGO_UNIFICADO existe y no está encendida de serie en ninguna categoría', () => {
  assert.ok((CAPACIDADES as readonly string[]).includes('CATALOGO_UNIFICADO'))
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) {
    assert.ok(!(base as readonly string[]).includes('CATALOGO_UNIFICADO'), `${categoria} la enciende de serie`)
  }
})

test('la sección «catalogo» existe, cuelga de la capacidad y /admin/catalogo resuelve a ella', () => {
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('catalogo'))
  assert.deepEqual(SECCIONES_POR_CAPACIDAD.CATALOGO_UNIFICADO, ['catalogo'])
  assert.equal(CAPACIDAD_DE_SECCION.catalogo, 'CATALOGO_UNIFICADO')
  assert.equal(adminSectionForPath('/admin/catalogo'), 'catalogo')
  assert.equal(adminSectionForPath('/admin/catalogo/nuevo'), 'catalogo')
})

test('la capacidad está clasificada como función de empresa (Core, no de un vertical)', () => {
  assert.ok((FUNCIONES_EMPRESA as readonly string[]).includes('CATALOGO_UNIFICADO'))
})

test('los roles acotados (Marketing, Supervisión) no ven el catálogo; los plenos sí', () => {
  assert.equal(seccionPermitida('MARKETING', 'catalogo', null), false)
  assert.equal(seccionPermitida('SUPERVISOR', 'catalogo', null), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'catalogo', null), true)
})

test('toda función de permiso del catálogo se exige de verdad en alguna acción', () => {
  const funciones = (FUNCIONES_POR_SECCION.catalogo ?? []).map((f) => f.codigo)
  assert.deepEqual(funciones.sort(), ['archivar', 'crear', 'editar', 'publicar', 'variante'])
  const src = readFileSync('src/modules/catalog/actions.ts', 'utf8')
  const usadas = new Set([...src.matchAll(/contexto\('(\w+)'\)/g)].map((m) => m[1]))
  // `cambiarEstadoItemCatalogo` elige la función según el destino: archivar y
  // publicar se conceden por separado, y restaurar a borrador es editar.
  assert.match(src, /estado === 'ARCHIVED' \? 'archivar' : estado === 'DRAFT' \? 'editar' : 'publicar'/)
  assert.match(src, /contexto\(funcion\)/)
  usadas.add('archivar').add('publicar')
  for (const f of funciones) assert.ok(usadas.has(f), `la función «${f}» está en el catálogo de permisos y ninguna acción la pide`)
})

// ── Guardia de las acciones, leída del código ────────────────────────────────

const src = readFileSync('src/modules/catalog/actions.ts', 'utf8')
const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('todas las acciones exportadas piden la guardia ANTES de tocar la base', () => {
  const exportadas = [...sinComentarios.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), [
    'actualizarItemCatalogo',
    'actualizarVarianteCatalogo',
    'agregarVarianteCatalogo',
    'cambiarEstadoItemCatalogo',
    'crearItemCatalogo',
    'eliminarVarianteCatalogo',
  ])
  for (const nombre of exportadas) {
    const desde = sinComentarios.indexOf(`export async function ${nombre}`)
    const resto = sinComentarios.slice(desde)
    const cuerpo = resto.slice(0, resto.indexOf('\n}\n') + 3)
    const guardia = cuerpo.indexOf('await contexto(')
    const base = cuerpo.indexOf('conEmpresa(')
    assert.ok(guardia >= 0, `${nombre} no pide contexto()`)
    assert.ok(base < 0 || guardia < base, `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /if \('error' in c\) return \{ ok: false, error: c\.error \}/, `${nombre} no corta si la guardia falla`)
  }
})

test('contexto() exige la sección «catalogo» y saca la empresa de la sesión, no de la entrada', () => {
  assert.match(sinComentarios, /requireSection\('catalogo', funcion\)/)
  assert.match(sinComentarios, /resolveCompanyId\(user\)/, 'sin FormData: el superadmin usa su empresa activa')
  assert.doesNotMatch(sinComentarios, /companyId:\s*entrada/)
  assert.doesNotMatch(sinComentarios, /\bprisma\./, 'las acciones no usan el cliente global: todo va por conEmpresa')
})

test('el servicio y las lecturas filtran SIEMPRE por companyId (con la Capa 2 apagada es lo único que separa empresas)', () => {
  for (const archivo of ['service.ts', 'queries.ts']) {
    const s = readFileSync(`src/modules/catalog/${archivo}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const consultas = [...s.matchAll(/tx\.catalog\w+\.(findFirst|findMany|count|updateMany)\(\{([\s\S]*?)\}\)/g)]
    assert.ok(consultas.length > 0)
    for (const [llamada, , cuerpo] of consultas) {
      assert.match(cuerpo, /companyId/, `${archivo}: una consulta no filtra por empresa → ${llamada.slice(0, 70)}…`)
    }
  }
})

test('Commerce Core no importa de supply-v2', () => {
  for (const archivo of ['actions.ts', 'service.ts', 'queries.ts', 'domain.ts', 'auditoria.ts', 'errores.ts']) {
    const s = readFileSync(`src/modules/catalog/${archivo}`, 'utf8')
    // Solo los import: un comentario puede nombrar a Supply sin depender de él.
    const imports = [...s.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const origen of imports) assert.doesNotMatch(origen, /supply/i, `${archivo} importa de ${origen}`)
  }
})
