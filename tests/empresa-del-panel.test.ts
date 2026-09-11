import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { companyFilter, empresaDelPanel } from '../src/modules/admin/queries'
import type { SessionUser } from '../src/types'

/**
 * EL CALLEJÓN SIN SALIDA DEL SUPERADMIN.
 *
 * `companyFilter` devuelve `undefined` para un superadmin porque significa
 * «todas las empresas», que es lo correcto para un agregado de plataforma. Diez
 * pantallas de UNA empresa lo usaban igual y luego cortaban con `if
 * (!companyId)`: el superadmin elegía su empresa en el conmutador y la pantalla
 * le pedía que eligiera una empresa en el conmutador. Hiciera lo que hiciera,
 * la respuesta no cambiaba.
 */

const usuario = (role: string, companyId: string | null): SessionUser =>
  ({ metadata: { role, companyId } }) as unknown as SessionUser

test('companyFilter le quita al superadmin la empresa que eligió (por diseño)', () => {
  // No es un fallo suyo: es su contrato. Por eso hace falta la otra función.
  assert.equal(companyFilter(usuario('SUPERADMIN', 'cartown')), undefined)
})

test('empresaDelPanel devuelve la empresa abierta, también para el superadmin', () => {
  assert.equal(empresaDelPanel(usuario('SUPERADMIN', 'cartown')), 'cartown')
  assert.equal(empresaDelPanel(usuario('ADMIN_EMPRESA', 'cartown')), 'cartown')
})

test('sin empresa abierta devuelve null, y el centinela también', () => {
  // `'__none__'` es lo que `companyFilter` usa para «no filtres por nada». Como
  // empresa abierta no significa nada, y colarlo produciría consultas contra
  // una empresa que no existe.
  assert.equal(empresaDelPanel(usuario('SUPERADMIN', null)), null)
  assert.equal(empresaDelPanel(usuario('ADMIN_EMPRESA', '__none__')), null)
})

/**
 * LA GUARDIA. Lo que falló no fue la lógica: fue que el idioma correcto había
 * que recordarlo, y en cuatro pantallas se olvidó. Esto lo vigila.
 */
test('ninguna pantalla de una empresa resuelve su empresa con companyFilter', () => {
  const raiz = join(__dirname, '..', 'src', 'app', '(admin)')
  const paginas: string[] = []
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (e === 'page.tsx') paginas.push(p)
    }
  }
  recorrer(raiz)

  const infractoras = paginas.filter((p) => {
    const src = readFileSync(p, 'utf8')
    // Una pantalla de UNA empresa se reconoce porque corta cuando no la hay.
    const esDeUnaEmpresa = src.includes('SinEmpresaActiva')
    return esDeUnaEmpresa && /const companyId = companyFilter\(user\)/.test(src)
  })

  assert.deepEqual(
    infractoras.map((p) => p.split('(admin)')[1]),
    [],
    'usa empresaDelPanel(user): con companyFilter, el superadmin no puede abrir estas pantallas'
  )
})
