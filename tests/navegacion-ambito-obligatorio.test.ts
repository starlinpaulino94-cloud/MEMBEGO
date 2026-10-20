import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { menuEnUnaColumna, visibleWorkspaces } from '../src/components/layout/nav-config'
import { SCANNER_ROLES } from '../src/types'

/**
 * EL ÁMBITO DEL MENÚ ES OBLIGATORIO (auditoría admin · FE-01).
 *
 * `(empleado)/layout.tsx` no pasaba `scope`, y «sin ámbito» significa «no
 * filtrar». `SCANNER_ROLES` incluye al SUPERADMIN, así que quien abría
 * `/empleado/scanner` veía Plataforma y Empresa en dos iconos del riel: la
 * mezcla que el filtro de ámbito existe para impedir.
 */

test('un SUPERADMIN en el mostrador ve UNA columna, no el riel de dos iconos', () => {
  const sinAmbito = visibleWorkspaces({ role: 'SUPERADMIN' })
  // La forma del defecto, para que la prueba pueda fallar de verdad.
  assert.ok(sinAmbito.length > 1 && !menuEnUnaColumna(sinAmbito))

  const conAmbito = visibleWorkspaces({ role: 'SUPERADMIN', scope: 'COMPANY' })
  assert.deepEqual(conAmbito.map((w) => w.id), ['empresa'])
  assert.ok(menuEnUnaColumna(conAmbito))
})

test('fijar el ámbito COMPANY no cambia el menú de nadie más en el mostrador', () => {
  for (const role of SCANNER_ROLES.filter((r) => r !== 'SUPERADMIN')) {
    const antes = visibleWorkspaces({ role }).map((w) => w.id)
    const despues = visibleWorkspaces({ role, scope: 'COMPANY' }).map((w) => w.id)
    assert.deepEqual(despues, antes, `el rol ${role} perdería espacios al fijar el ámbito`)
  }
})

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/layout\.tsx$/.test(p)) acc.push(p)
  }
  return acc
}

test('todo layout que construye el menú declara su ámbito', () => {
  const layouts = archivos('src/app').filter((f) =>
    /contextoDeNavegacion\(/.test(readFileSync(f, 'utf8'))
  )
  // Hoy: admin, empleado y superadmin. Si aparece uno nuevo, entra en esta prueba solo.
  assert.ok(layouts.length >= 3, 'esperaba al menos los layouts de admin, empleado y superadmin')
  for (const f of layouts) {
    const src = readFileSync(f, 'utf8')
    const llamada = src.slice(src.indexOf('contextoDeNavegacion('))
    const argumentos = llamada.slice(0, llamada.indexOf('})') + 2)
    assert.match(argumentos, /scope:\s*'(COMPANY|PLATFORM)'/, `${f} no declara el ámbito del menú`)
  }
})

test('contextoDeNavegacion no acepta una llamada sin ámbito', () => {
  const src = readFileSync('src/modules/navegacion/contexto.ts', 'utf8')
  // `scope: ScopeNav` sin `?` en los parámetros de la función.
  assert.match(src, /\n\s*scope:\s*ScopeNav\n/)
  assert.doesNotMatch(src, /\n\s*scope\?:\s*ScopeNav\n\s*permisos/)
})
