import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { rutaDePlan } from '../src/modules/comercio/rutas'
import { destinoInterno, destinoParaRol } from '../src/lib/auth/destino-seguro'
import { ROLE_HOME } from '../src/types'

/**
 * SEPARACIÓN LANDING · APP — F6: cierre. Los dos cabos sueltos que dejaron las fases.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('la ficha de un plan tiene su ruta por espacio: consulta en la landing, la de la app dentro de /cliente', () => {
  assert.equal(rutaDePlan('publico', 'p1'), '/plan/p1')
  assert.equal(rutaDePlan('app', 'p1'), '/cliente/planes/p1')
  const destino = rutaDePlan('app', 'p1')
  assert.equal(destinoInterno(destino), destino)
  assert.equal(destinoParaRol(destino, 'CLIENTE', ROLE_HOME.CLIENTE), destino)
  assert.equal(destinoParaRol(destino, 'ADMINISTRADOR', ROLE_HOME.ADMINISTRADOR), ROLE_HOME.ADMINISTRADOR)
})

test('el slide de plan del inicio sale del mapa único de rutas, y la API móvil conserva su valor por defecto', () => {
  const hero = sinComentarios('src/modules/home/hero-publico.ts')
  assert.match(hero, /href = rutaDePlan\(espacio, plan\.id\)/)
  assert.doesNotMatch(hero, /`\/plan\//, 'ya no escribe la ruta pública a mano')
  assert.match(hero, /espacio: Espacio = 'publico'/)
  assert.doesNotMatch(sinComentarios('src/app/api/v1/cliente/inicio/route.ts'), /'app'/, 'la API de la app móvil no pasa el espacio de la web')
  assert.ok(existsSync('src/app/(cliente)/cliente/planes/[planId]/page.tsx'), 'la ficha de la app existe')
})

test('BuscadorExcursiones, que no estaba montado en ninguna pantalla, ya no existe; el buscador unificado se queda', () => {
  assert.equal(existsSync('src/components/cliente/inicio/BuscadorExcursiones.tsx'), false)
  assert.ok(existsSync('src/components/cliente/inicio/BuscadorUnificado.tsx'))
})
