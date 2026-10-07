import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { puedeOperarEnEmpresa } from '../src/lib/auth/empresa-de-la-sesion'

/**
 * Los escáneres y los canjes comprobaban «la empresa del recurso es la de la sesión» así:
 * `role !== 'SUPERADMIN' && companyId && distinta`. Con una sesión SIN `companyId` la
 * comprobación se saltaba y esa persona podía cerrar pedidos, canjear ofertas y validar
 * membresías de CUALQUIER empresa (hallazgo M11 de la auditoría del 2026-10-07). Ahora
 * todos pasan por `puedeOperarEnEmpresa`, que falla cerrado.
 */

const sesion = (role: string, companyId?: string | null) => ({ metadata: { role, companyId } })

test('SUPERADMIN opera en cualquier empresa, con o sin empresa en la sesión', () => {
  assert.equal(puedeOperarEnEmpresa(sesion('SUPERADMIN', null), 'emp-1'), true)
  assert.equal(puedeOperarEnEmpresa(sesion('SUPERADMIN', 'emp-2'), 'emp-1'), true)
})

test('el resto de roles opera solo en la empresa de su sesión', () => {
  for (const rol of ['ADMIN', 'EMPLEADO', 'RECEPCION', 'CAJERO']) {
    assert.equal(puedeOperarEnEmpresa(sesion(rol, 'emp-1'), 'emp-1'), true, `${rol} en su empresa`)
    assert.equal(puedeOperarEnEmpresa(sesion(rol, 'emp-1'), 'emp-2'), false, `${rol} en otra empresa`)
  }
})

test('una sesión sin empresa NO opera en ninguna (falla cerrado)', () => {
  for (const rol of ['ADMIN', 'EMPLEADO', 'RECEPCION', 'CLIENTE', 'PROVEEDOR']) {
    assert.equal(puedeOperarEnEmpresa(sesion(rol, null), 'emp-1'), false, `${rol} con companyId null`)
    assert.equal(puedeOperarEnEmpresa(sesion(rol, undefined), 'emp-1'), false, `${rol} con companyId undefined`)
    assert.equal(puedeOperarEnEmpresa(sesion(rol, ''), 'emp-1'), false, `${rol} con companyId vacío`)
  }
})

test('un recurso sin empresa tampoco se opera', () => {
  assert.equal(puedeOperarEnEmpresa(sesion('EMPLEADO', 'emp-1'), ''), false)
})

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

test('nadie vuelve a comprobar la empresa saltándose la sesión sin empresa', () => {
  const raiz = join(__dirname, '..', 'src')
  const abierto = /role !== 'SUPERADMIN'\s*&&\s*(?:user|session|sesion)\.metadata\.companyId\s*&&/
  const infractores = archivos(raiz).filter((a) => abierto.test(readFileSync(a, 'utf8'))).map((a) => relative(raiz, a))
  assert.deepEqual(infractores, [], 'usa puedeOperarEnEmpresa (falla cerrado) en vez de `role !== SUPERADMIN && companyId && distinta`')
})

test('los escáneres y los canjes usan la comprobación que falla cerrado', () => {
  const raiz = join(__dirname, '..')
  for (const f of ['src/modules/orders/escaner-actions.ts', 'src/modules/visitas/actions.ts', 'src/modules/ofertas/canjeActions.ts', 'src/modules/promociones/canjeActions.ts', 'src/modules/admin/actions.ts']) {
    assert.match(readFileSync(join(raiz, f), 'utf8'), /puedeOperarEnEmpresa\(user,/, `${f} usa puedeOperarEnEmpresa`)
  }
})
