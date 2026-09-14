/**
 * Ámbito empresarial explícito (P1A).
 *
 * El rol NUNCA decide el alcance: las páginas /admin operan la empresa activa
 * de la sesión o redirigen. Sin empresa no hay vista global implícita.
 * Los guards fallan cerrados: sin lectura de permisos, sin acceso.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { destinoSinEmpresa } from '../src/lib/auth/company-context'

const RAIZ = join(__dirname, '..')

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), 'utf8')
}

function paginasAdmin(): string[] {
  const base = join(RAIZ, 'src/app/(admin)')
  const salida: string[] = []
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const ruta = join(dir, e)
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta)
      } else if (e === 'page.tsx') {
        salida.push(ruta)
      }
    }
  }
  recorrer(base)
  return salida
}

// ── Destinos sin empresa: nunca /login (bucle con el middleware) ─────────────

test('superadmin sin empresa va al selector de plataforma', () => {
  assert.equal(destinoSinEmpresa('SUPERADMIN'), '/superadmin/empresas')
})

test('staff sin empresa ve pantalla explícita, no datos ni bucle', () => {
  for (const rol of ['ADMIN_EMPRESA', 'ADMINISTRADOR', 'EMPLEADO', 'MARKETING', 'SUPERVISOR']) {
    assert.equal(destinoSinEmpresa(rol), '/admin/sin-empresa')
  }
})

// ── Ninguna página /admin usa el filtro global ni el envoltorio dual ─────────

test('ninguna página /admin importa companyFilter', () => {
  const malas = paginasAdmin().filter((p) => readFileSync(p, 'utf8').includes('companyFilter'))
  assert.deepEqual(malas, [])
})

test('ninguna página /admin usa conEmpresaOTodas', () => {
  const malas = paginasAdmin().filter((p) => readFileSync(p, 'utf8').includes('conEmpresaOTodas'))
  assert.deepEqual(malas, [])
})

test('solo dos páginas declaran lectura cross-tenant, ambas con selección explícita', () => {
  // metodos-pago/nuevo: el superadmin elige la empresa dueña (id+nombre);
  // la acción valida con resolveCompanyId. perfil: selector ?empresa=<id>
  // para superadmin + estados explícitos sin empresa (nunca global).
  // Cualquier otra página con sinEmpresa es una renuncia no documentada.
  const permitidas = new Set([
    join(RAIZ, 'src/app/(admin)/admin/metodos-pago/nuevo/page.tsx'),
    join(RAIZ, 'src/app/(admin)/admin/perfil/page.tsx'),
  ])
  const malas = paginasAdmin().filter(
    (p) => readFileSync(p, 'utf8').includes('sinEmpresa(') && !permitidas.has(p)
  )
  assert.deepEqual(malas, [])
})

// ── Guards fail-closed: el error de lectura niega, no hereda ─────────────────

test('usuarioPuedeFuncion niega cuando la lectura falla o la fila falta', () => {
  const src = leer('src/lib/auth/guards.ts')
  assert.match(src, /catch \{\s*return false\s*\}/)
  assert.match(src, /if \(!fila\) return false/)
})

test('requireSection niega cuando la lectura falla o la fila falta', () => {
  const src = leer('src/lib/auth/guards.ts')
  assert.match(src, /catch \{\s*return null\s*\}/)
  assert.match(src, /if \(!fila\) return null/)
})

test('tieneCapacidad falla cerrada ante errores', () => {
  const src = leer('src/modules/capacidades/resolver.ts')
  assert.match(src, /\} catch \{\s*return false\s*\}/)
  assert.doesNotMatch(src, /return true\n  \}\n\}/)
})

// ── requireCompanyContext verifica existencia y redirige ─────────────────────

test('requireCompanyContext verifica la empresa y redirige sin ella', () => {
  const src = leer('src/lib/auth/company-context.ts')
  assert.match(src, /export async function requireCompanyContext/)
  assert.match(src, /company\.findUnique/)
  assert.match(src, /redirect\(destinoSinEmpresa/)
})
