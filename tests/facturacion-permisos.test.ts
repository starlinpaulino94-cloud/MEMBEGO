import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CAPACIDAD_DE_SECCION, SECCIONES_POR_CAPACIDAD } from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/**
 * COMMERCE CORE · Merchant Billing — sección, guardias y aislamiento (Fase 4).
 *
 * Aquí se comprueba el cableado y que cada acción autoriza ANTES de tocar la base;
 * el comportamiento contra la base está en `tests/postgres/billing.db.test.ts`.
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const limpio = (ruta: string) => leer(ruta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('«Mi cuenta Membego» es la sección «facturacion-membego», cuelga de PEDIDOS_MEMBEGO y es solo lectura (sin funciones de permiso)', () => {
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('facturacion-membego'))
  assert.ok(SECCIONES_POR_CAPACIDAD.PEDIDOS_MEMBEGO?.includes('facturacion-membego'))
  assert.equal(CAPACIDAD_DE_SECCION['facturacion-membego'], 'PEDIDOS_MEMBEGO')
  assert.equal(FUNCIONES_POR_SECCION['facturacion-membego'], undefined, 'la empresa solo lee su cuenta: no hay nada que delegar por función')
})

test('/admin/facturacion-membego resuelve a su sección; los roles acotados no la ven y los plenos sí', () => {
  assert.equal(adminSectionForPath('/admin/facturacion-membego'), 'facturacion-membego')
  assert.equal(seccionPermitida('MARKETING', 'facturacion-membego', null), false)
  assert.equal(seccionPermitida('SUPERVISOR', 'facturacion-membego', null), false)
  assert.equal(seccionPermitida('CAJERO', 'facturacion-membego', null), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'facturacion-membego', null), true)
})

test('el layout de la empresa guarda la sección y la página no trae acciones de escritura', () => {
  assert.match(limpio('src/app/(admin)/admin/facturacion-membego/layout.tsx'), /guardarSeccion\('facturacion-membego'\)/)
  const p = limpio('src/app/(admin)/admin/facturacion-membego/page.tsx')
  assert.doesNotMatch(p, /modules\/billing\/(actions|service)/, 'la vista de la empresa no importa nada que escriba')
  assert.doesNotMatch(p, /components\/billing\/(CuentaAcciones|BarridoAcciones)/)
  assert.match(p, /requireRole\(ADMIN_ROLES\)/)
  assert.match(p, /conEmpresa\(companyId/, 'la lectura va por conEmpresa con la empresa de la sesión')
  assert.doesNotMatch(p, /\bparams\b/, 'la empresa no sale de la URL (la página no tiene parámetros de ruta)')
  assert.match(p, /requireCompanyContext\(user\)/)
})

const acciones = limpio('src/modules/billing/actions.ts')

test('todas las acciones de billing son solo del superadmin y autorizan ANTES de tocar la base', () => {
  const exportadas = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['asentarMovimiento', 'cambiarEstadoDeCuenta', 'emitirCortesDeEmpresa', 'guardarConfigDeCobro', 'revisarFacturacionAhora'])
  for (const nombre of exportadas) {
    const desde = acciones.indexOf(`export async function ${nombre}`)
    const resto = acciones.slice(desde)
    const cuerpo = resto.slice(0, resto.indexOf('\n}\n') + 3)
    const guardia = cuerpo.indexOf('await superadmin()')
    const base = Math.min(...['conEmpresa(', 'barridoFacturacion('].map((t) => (cuerpo.indexOf(t) < 0 ? Infinity : cuerpo.indexOf(t))))
    assert.ok(guardia >= 0, `${nombre} no pide superadmin()`)
    assert.ok(guardia < base, `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /if \('error' in c\) return \{ ok: false, error: c\.error \}/, `${nombre} no corta si la guardia falla`)
  }
})

test('superadmin() exige el rol SUPERADMIN y el actor del contexto sale de la sesión', () => {
  assert.match(acciones, /user\.metadata\.role !== 'SUPERADMIN'/)
  assert.match(acciones, /actor: 'SUPERADMIN', actorId: user\.metadata\.dbUserId/)
  assert.doesNotMatch(acciones, /\bprisma\./, 'las acciones no usan el cliente global: todo va por conEmpresa')
  assert.doesNotMatch(acciones, /actor: entrada/)
})

test('el servicio también exige SUPERADMIN para lo manual: no depende de que la acción lo haya hecho', () => {
  const s = limpio('src/modules/billing/service.ts')
  for (const f of ['asentarManualEnTx', 'actualizarConfigEnTx', 'fijarEstadoManualEnTx']) {
    const desde = s.indexOf(`export async function ${f}`)
    const cuerpo = s.slice(desde, desde + 700)
    assert.match(cuerpo, /ctx\.actor !== 'SUPERADMIN'\) fallo\('SOLO_SUPERADMIN'/, `${f} no exige superadmin`)
  }
})

test('las páginas del superadmin piden el rol SUPERADMIN antes de leer', () => {
  for (const ruta of ['src/app/(superadmin)/superadmin/facturacion/page.tsx', 'src/app/(superadmin)/superadmin/facturacion/[companyId]/page.tsx']) {
    const p = limpio(ruta)
    assert.match(p, /await requireRole\('SUPERADMIN'\)/, ruta)
    assert.ok(p.indexOf("requireRole('SUPERADMIN')") < p.indexOf('sinEmpresa('), `${ruta} lee antes de autorizar`)
  }
})

test('el cron de facturación existe, está programado y exige el secreto antes de barrer', () => {
  const ruta = limpio('src/app/api/cron/facturacion/route.ts')
  assert.ok(ruta.indexOf('autorizarCron(req)') >= 0 && ruta.indexOf('autorizarCron(req)') < ruta.indexOf('barridoFacturacion()'))
  const vercel = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/facturacion'))
})

test('el menú ofrece las dos entradas: «Mi cuenta Membego» detrás de la capacidad y «Cobros a empresas» para el superadmin', () => {
  const nav = leer('src/components/layout/nav-config.ts')
  assert.match(nav, /href: '\/admin\/facturacion-membego'[\s\S]{0,400}capacidad: 'PEDIDOS_MEMBEGO'/)
  assert.match(nav, /href: '\/superadmin\/facturacion'/)
})
