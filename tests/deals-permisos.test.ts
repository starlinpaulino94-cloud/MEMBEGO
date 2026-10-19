import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CAPACIDAD_DE_SECCION, CAPACIDADES, CAPACIDADES_BASE, SECCIONES_POR_CAPACIDAD } from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { FUNCIONES_EMPRESA } from '../src/modules/plataforma/conceptos'

/**
 * COMMERCE CORE · ofertas con presupuesto — sección, guardias y aislamiento (Fase 5).
 *
 * Aquí se comprueba el cableado y que cada acción autoriza ANTES de tocar la base; el
 * comportamiento contra la base está en `tests/postgres/deals.db.test.ts`.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('la capacidad DEALS_MARKETPLACE existe, gobierna la sección «deals» y está encendida de serie en todas las categorías', () => {
  assert.ok((CAPACIDADES as readonly string[]).includes('DEALS_MARKETPLACE'))
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('deals'))
  assert.deepEqual(SECCIONES_POR_CAPACIDAD.DEALS_MARKETPLACE, ['deals'])
  assert.equal(CAPACIDAD_DE_SECCION['deals'], 'DEALS_MARKETPLACE')
  assert.ok((FUNCIONES_EMPRESA as readonly string[]).includes('DEALS_MARKETPLACE'), 'una función de empresa se puede encender por override')
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) {
    assert.ok((base as readonly string[]).includes('DEALS_MARKETPLACE'), `${categoria} no la enciende de serie`)
  }
})

test('/admin/deals resuelve a su sección, y los roles acotados (Marketing, Supervisión) no la ven; los plenos sí', () => {
  assert.equal(adminSectionForPath('/admin/deals'), 'deals')
  assert.equal(adminSectionForPath('/admin/deals/abc123'), 'deals')
  assert.equal(adminSectionForPath('/admin/deals/nueva'), 'deals')
  assert.equal(seccionPermitida('MARKETING', 'deals', null), false)
  assert.equal(seccionPermitida('SUPERVISOR', 'deals', null), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'deals', null), true)
})

const acciones = limpio('src/modules/deals/actions.ts')

test('las funciones de permiso son crear, publicar, presupuesto y archivar, y las cuatro se exigen de verdad', () => {
  const funciones = (FUNCIONES_POR_SECCION['deals'] ?? []).map((f) => f.codigo)
  assert.deepEqual([...funciones].sort(), ['archivar', 'crear', 'presupuesto', 'publicar'])
  for (const f of funciones) assert.match(acciones, new RegExp(`contexto\\('${f}'\\)`), `ninguna acción exige la función «${f}»`)
})

test('toda acción de la empresa autoriza con requireSection(\'deals\', …) y saca la empresa de la sesión', () => {
  assert.match(acciones, /requireSection\('deals', funcion\)/)
  assert.match(acciones, /resolveCompanyId\(user\)/)
  const exportadas = [...acciones.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
  assert.ok(exportadas.length >= 7, 'faltan acciones')
  for (const [, nombre, params] of exportadas) {
    assert.doesNotMatch(params, /companyId|empresaId/i, `${nombre} recibe la empresa del navegador`)
    // Cada una pide el contexto (sesión + permiso) ANTES de abrir la transacción.
    const cuerpo = acciones.slice(acciones.indexOf(`export async function ${nombre}(`))
    const i = cuerpo.indexOf('await contexto(')
    const j = cuerpo.indexOf('conEmpresa(')
    assert.ok(i > 0 && (j < 0 || i < j), `${nombre} no autoriza antes de tocar la base`)
  }
})

test('las acciones de la empresa nunca aceptan el presupuesto reservado o gastado, la cuota ni los cupos usados del navegador', () => {
  assert.doesNotMatch(acciones, /feePerRedemption|budgetReserved|budgetSpent|claimsActive/)
})

const cliente = limpio('src/modules/deals/cliente-actions.ts')

test('reclamar: exige sesión de CLIENTE, deduce la empresa de la oferta y comprueba las tres capacidades', () => {
  assert.match(cliente, /getUser\(\)/)
  assert.match(cliente, /role !== 'CLIENTE'/)
  assert.match(cliente, /formSubmitLimiter\(/)
  assert.match(cliente, /tx\.deal\.findUnique\(\{ where: \{ id: dealId \}/)
  assert.match(cliente, /empresaOfreceOfertas\(oferta\.companyId\)/)
  assert.match(cliente, /asegurarClienteEnEmpresa\(/)
  assert.doesNotMatch(cliente, /entrada\.companyId|entrada\.customerId|entrada\.fee|entrada\.precio/)
  // Reclamar dos veces no es un error para la persona: se le lleva a su pedido.
  assert.match(cliente, /YA_RECLAMADA/)
})

test('la empresa «ofrece ofertas» solo con las tres capacidades (ofertas, catálogo y pedidos)', () => {
  const pub = limpio('src/modules/deals/publico.ts')
  for (const c of ['DEALS_MARKETPLACE', 'CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO']) assert.match(pub, new RegExp(`tieneCapacidad\\(companyId, '${c}'\\)`))
})

test('el menú, el mapa de capacidades del menú y el catálogo conocen DEALS_MARKETPLACE', () => {
  assert.match(leer('src/components/layout/nav-config.ts'), /\| 'DEALS_MARKETPLACE'/)
  assert.match(leer('src/modules/navegacion/contexto.ts'), /'DEALS_MARKETPLACE'/)
})

test('«Obtener oferta» no afilia a nadie por una oferta que no se puede reclamar, y el reclamo respeta el tope de pedidos abiertos (auditoría F5–F9, M2 y M7)', () => {
  const cliente = limpio('src/modules/deals/cliente-actions.ts')
  const previa = cliente.indexOf('motivoNoReclamarEnTx(')
  assert.ok(previa > 0 && previa < cliente.indexOf('asegurarClienteEnEmpresa('), 'comprueba la oferta ANTES de crear la ficha')
  const servicio = limpio('src/modules/deals/service.ts')
  const reclamar = servicio.slice(servicio.indexOf('export async function reclamarOfertaEnTx'))
  assert.match(reclamar, /contarPedidosAbiertosEnTx\(/)
  assert.ok(reclamar.indexOf('contarPedidosAbiertosEnTx(') < reclamar.indexOf('UPDATE "deals"'), 'el tope va antes de apartar cupo y presupuesto')
})
