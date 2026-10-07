import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACIDAD_DE_SECCION,
  CAPACIDADES_BASE,
  CAPACIDADES_OVERRIDE_TENANT_NUEVO,
  CATEGORIAS,
  RUTAS_POR_MODULO_CLIENTE,
  capacidadesEfectivas,
} from '../src/modules/capacidades/catalogo'
import { ENLACES_ADMIN, canSeeItem, type ContextoNav } from '../src/components/layout/nav-config'

/**
 * FASE 0 · ocultamiento de módulos secundarios (Plan Maestro §8).
 *
 * Guardias de lo decidido, para que nadie lo deshaga sin enterarse:
 *  · RULETA, PUBLICACIONES y HOME_BUILDER no están encendidos en NINGUNA
 *    categoría (ocultos para toda empresa, nueva o existente).
 *  · CRM y MENSAJERIA siguen encendidos en el paquete base: una empresa
 *    EXISTENTE (sin overrides guardados) no pierde nada.
 *  · Un tenant NUEVO nace con ambos apagados por override explícito.
 */

const APAGADAS_PARA_TODOS = ['RULETA', 'PUBLICACIONES', 'HOME_BUILDER'] as const
const TIPO_POR_CATEGORIA: Record<(typeof CATEGORIAS)[number], string> = {
  CAR_WASH: 'carwash',
  BARBERIA: 'barberia',
  RESTAURANTE: 'restaurante',
  GYM: 'gym',
  EXCURSIONES: 'excursiones',
}

test('ninguna categoría enciende RULETA, PUBLICACIONES ni HOME_BUILDER de serie', () => {
  for (const categoria of CATEGORIAS) {
    for (const cap of APAGADAS_PARA_TODOS) {
      assert.ok(!CAPACIDADES_BASE[categoria].includes(cap), `${categoria} enciende ${cap}`)
    }
  }
})

test('una empresa EXISTENTE (sin overrides) conserva CRM y MENSAJERIA y no ve los módulos ocultos', () => {
  for (const categoria of CATEGORIAS) {
    const { activas } = capacidadesEfectivas(TIPO_POR_CATEGORIA[categoria], null)
    assert.ok(activas.has('CRM'), `${categoria}: perdió CRM`)
    assert.ok(activas.has('MENSAJERIA'), `${categoria}: perdió MENSAJERIA`)
    for (const cap of APAGADAS_PARA_TODOS) assert.ok(!activas.has(cap), `${categoria}: ve ${cap}`)
  }
})

test('un tenant NUEVO nace sin CRM ni MENSAJERIA, y el resto de su paquete base no se toca', () => {
  for (const categoria of CATEGORIAS) {
    const tipo = TIPO_POR_CATEGORIA[categoria]
    const nuevo = capacidadesEfectivas(tipo, { overrides: CAPACIDADES_OVERRIDE_TENANT_NUEVO }).activas
    const existente = capacidadesEfectivas(tipo, null).activas
    assert.ok(!nuevo.has('CRM'), `${categoria}: el tenant nuevo conserva CRM`)
    assert.ok(!nuevo.has('MENSAJERIA'), `${categoria}: el tenant nuevo conserva MENSAJERIA`)
    const quitadas = [...existente].filter((c) => !nuevo.has(c)).sort()
    assert.deepEqual(quitadas, ['CRM', 'MENSAJERIA'], `${categoria}: el default de tenant nuevo quita de más`)
  }
})

test('el default de tenant nuevo se puede revertir encendiendo la capacidad (override explícito gana)', () => {
  const { activas } = capacidadesEfectivas('carwash', {
    overrides: { ...CAPACIDADES_OVERRIDE_TENANT_NUEVO, CRM: true },
  })
  assert.ok(activas.has('CRM'))
  assert.ok(!activas.has('MENSAJERIA'))
})

test('cada módulo oculto cuelga de la sección que lo guarda (la ruta se cierra por URL, no solo el menú)', () => {
  assert.equal(CAPACIDAD_DE_SECCION.publicaciones, 'PUBLICACIONES')
  assert.equal(CAPACIDAD_DE_SECCION.comunicacion, 'MENSAJERIA')
  assert.equal(CAPACIDAD_DE_SECCION.gamificacion, 'RULETA')
  assert.equal(CAPACIDAD_DE_SECCION.leads, 'CRM')
})

test('HOME_BUILDER no cuelga de ninguna sección: comparte /admin/personalizacion con la marca', () => {
  // Si alguien lo mapeara a 'personalizacion', apagarlo escondería también el
  // formulario de color y módulos del cliente, que NO se ocultan.
  assert.ok(!Object.values(CAPACIDAD_DE_SECCION).includes('HOME_BUILDER'))
  assert.equal(CAPACIDAD_DE_SECCION.personalizacion, undefined)
})

test('el menú declara la capacidad de cada módulo oculto', () => {
  const capacidadDe = (href: string) => ENLACES_ADMIN.find((e) => e.href === href)?.capacidad
  assert.equal(capacidadDe('/admin/publicaciones'), 'PUBLICACIONES')
  assert.equal(capacidadDe('/admin/comunicacion'), 'MENSAJERIA')
  assert.equal(capacidadDe('/admin/crm'), 'CRM')
  assert.equal(capacidadDe('/admin/gamificacion'), 'RULETA')
})

test('con las capacidades de un tenant nuevo el menú de admin no ofrece los módulos apagados', () => {
  const activas = capacidadesEfectivas('carwash', { overrides: CAPACIDADES_OVERRIDE_TENANT_NUEVO }).activas
  const ctx: ContextoNav = {
    role: 'ADMINISTRADOR',
    scope: 'COMPANY',
    capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES', 'POS_CAJA', 'CRM', 'PUBLICACIONES', 'MENSAJERIA'].filter(
      (c) => activas.has(c as never)
    ) as ContextoNav['capacidades'],
  }
  const hrefs = new Set(ENLACES_ADMIN.filter((e) => canSeeItem(e, ctx)).map((e) => e.href))
  for (const oculto of ['/admin/publicaciones', '/admin/comunicacion', '/admin/crm', '/admin/gamificacion']) {
    assert.ok(!hrefs.has(oculto), `${oculto} sigue en el menú de un tenant nuevo`)
  }
  assert.ok(hrefs.has('/admin/clientes'), 'el núcleo (clientes) sigue visible')
})

test('la ruta del cliente de la ruleta existe en el mapa que el menú usa para esconderla', () => {
  // navDisponible la fuerza oculta cuando falta la capacidad RULETA.
  assert.deepEqual(RUTAS_POR_MODULO_CLIENTE.RULETA, ['/cliente/ruleta'])
})

// ── Toda alta de empresa lleva los overrides de tenant nuevo (auditoría del 2026-10-07, M1) ──

test('todo sitio que crea una empresa usa CAPACIDADES_OVERRIDE_TENANT_NUEVO (si no, nace con CRM y Mensajería encendidos)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const raiz = join(__dirname, '..', 'src')
  const archivos = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
    })
  // El seed de desarrollo crea empresas de demostración sin capacidades a propósito.
  const EXENTOS = new Set(['lib/seed.ts'])
  const sinOverride: string[] = []
  let altas = 0
  for (const a of archivos(raiz)) {
    const rel = relative(raiz, a).split('\\').join('/')
    if (EXENTOS.has(rel)) continue
    const t = readFileSync(a, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const n = (t.match(/\bcompany\.(create|upsert|createMany)\(/g) ?? []).length
    if (n === 0) continue
    altas += n
    if (!t.includes('CAPACIDADES_OVERRIDE_TENANT_NUEVO')) sinOverride.push(rel)
  }
  // Piso de cordura: si el rastreo dejara de ver las altas, la prueba pasaría en vacío.
  // Eran 5 mientras existía Supply V1 (proveedores.ts, retirado en #574); hoy son 4.
  assert.ok(altas >= 4, `solo encontró ${altas} altas de empresa`)
  assert.deepEqual(sinOverride, [], 'estas altas de empresa no usan CAPACIDADES_OVERRIDE_TENANT_NUEVO')
})
