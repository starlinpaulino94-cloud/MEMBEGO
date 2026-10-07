import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CAPACIDAD_DE_SECCION, SECCIONES_POR_CAPACIDAD } from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/** ANALÍTICA · sección, guardias y aislamiento (Fase 6). El comportamiento contra la base está en `tests/postgres/analytics.db.test.ts`. */

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('«Resultados Membego» es la sección «resultados-membego», cuelga de PEDIDOS_MEMBEGO, es solo lectura y los roles acotados no la ven', () => {
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('resultados-membego'))
  assert.ok(SECCIONES_POR_CAPACIDAD.PEDIDOS_MEMBEGO?.includes('resultados-membego'))
  assert.equal(CAPACIDAD_DE_SECCION['resultados-membego'], 'PEDIDOS_MEMBEGO')
  assert.equal(FUNCIONES_POR_SECCION['resultados-membego'], undefined, 'solo lectura: no hay nada que delegar por función')
  assert.equal(adminSectionForPath('/admin/resultados-membego'), 'resultados-membego')
  for (const rol of ['MARKETING', 'SUPERVISOR', 'CAJERO'] as const) assert.equal(seccionPermitida(rol, 'resultados-membego', null), false, rol)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'resultados-membego', null), true)
})

test('la página de la empresa se guarda por sección en el layout y saca la empresa de la sesión, nunca de la URL', () => {
  assert.match(limpio('src/app/(admin)/admin/resultados-membego/layout.tsx'), /guardarSeccion\('resultados-membego'\)/)
  const p = limpio('src/app/(admin)/admin/resultados-membego/page.tsx')
  assert.match(p, /requireRole\(ADMIN_ROLES\)/)
  assert.match(p, /requireCompanyContext\(user\)/)
  assert.match(p, /conEmpresa\(companyId/)
  assert.doesNotMatch(p, /sp\.(companyId|empresa|empresaId)/, 'la empresa no viaja por la URL')
  assert.doesNotMatch(p, /sinEmpresa/, 'la empresa no usa el contexto de plataforma')
})

test('la analítica de plataforma es solo del superadmin, corre sin contexto de empresa y excluye lo de práctica', () => {
  const p = limpio('src/app/(superadmin)/superadmin/analitica/page.tsx')
  assert.match(p, /requireRole\('SUPERADMIN'\)/)
  assert.ok(p.indexOf("requireRole('SUPERADMIN')") < p.indexOf('panoramaDePlataformaEnTx(tx'), 'autoriza antes de leer')
  assert.match(p, /sinEmpresa\(/)
})

test('Supply Economics se compone en la PÁGINA: el módulo de analítica no lo importa y la vista lo rotula aparte', () => {
  const vista = limpio('src/components/analytics/AnaliticaPlataformaVista.tsx')
  assert.match(vista, /Supply Economics \(Membego → proveedores\)/)
  assert.match(leer('src/components/analytics/AnaliticaPlataformaVista.tsx'), /no se suman a éstas|no se suma al GMV/)
})

test('el menú: «Resultados Membego» detrás de su capacidad y en Operaciones; «Analítica de Membego» para el superadmin', () => {
  const nav = leer('src/components/layout/nav-config.ts')
  assert.match(nav, /href: '\/admin\/resultados-membego',[\s\S]{0,700}capacidad: 'PEDIDOS_MEMBEGO'/)
  assert.match(nav, /'\/admin\/facturacion-membego', '\/admin\/resultados-membego'/)
  assert.match(nav, /href: '\/superadmin\/analitica'/)
})
