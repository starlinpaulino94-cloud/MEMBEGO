import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_SECTIONS } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION, SECCION_LABELS } from '../src/lib/auth/funciones'

/**
 * MEMBEGO CONNECT · Fase 4 — el panel de integraciones de la empresa.
 *
 * Lo que se vigila aquí es sobre todo HONESTIDAD: que cada interruptor del
 * módulo de Permisos tenga su guardia cableada, y que la pantalla no prometa
 * lo que todavía no existe.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const ACCIONES = leer('src/modules/connect/adminActions.ts')

test('panel: la sección existe y tiene etiqueta legible', () => {
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('integraciones'))
  assert.equal(SECCION_LABELS.integraciones, 'Integraciones')
})

test('panel: cada función listada tiene su guardia REALMENTE cableada', () => {
  // La regla de honestidad del módulo de Permisos: si una función aparece en
  // el panel, su `requireSection('integraciones', <codigo>)` tiene que existir.
  // Sin esto, el panel diría «negado» y la acción pasaría igual.
  // El número crece con las fases (la 6 añadió conectar y desconectar). Lo que
  // NO puede crecer es la distancia entre lo que se lista y lo que se cumple:
  // se recorre la lista viva, no un número escrito a mano.
  const funciones = FUNCIONES_POR_SECCION.integraciones ?? []
  assert.ok(funciones.length >= 4)
  for (const f of funciones) {
    assert.ok(
      ACCIONES.includes(`requireSection('integraciones', '${f.codigo}')`),
      `la función «${f.label}» (${f.codigo}) no tiene guardia cableada`
    )
  }
})

test('panel: ninguna acción acepta el companyId del formulario', () => {
  // Un companyId que viaja por el navegador es una sugerencia, no una
  // autorización. Todas salen del usuario autenticado.
  assert.ok(!/formData\.get\('companyId'\)/.test(ACCIONES))
  // Cada acción usa la empresa de la sesión —unas por nombre y otras por
  // posición, da igual—: lo que se cuenta es que ninguna la tome de otro sitio.
  const usos = ACCIONES.match(/user\.metadata\.companyId/g) ?? []
  const acciones = ACCIONES.match(/^export async function \w+Action/gm) ?? []
  assert.ok(acciones.length >= 4)
  // Un uso real por acción (la comprobación previa va con `?.`, que no cuenta).
  assert.ok(usos.length >= acciones.length, 'toda acción toma la empresa de la sesión')
})

test('panel: solo se ofrecen permisos de LECTURA', () => {
  // Los recursos de escritura de la API v1 exigen credencial de satélite:
  // ofrecer aquí `benefits:redeem` sería listar un permiso que la guardia va a
  // rechazar después.
  assert.match(ACCIONES, /\.filter\(\(s\) => s\.endsWith\(':read'\)\)/)
  const panel = leer('src/components/connect/ClavesApiPanel.tsx')
  const valores = [...panel.matchAll(/valor: '([^']+)'/g)].map((m) => m[1])
  assert.ok(valores.length > 0)
  for (const v of valores) assert.ok(v.endsWith(':read'), `${v} no es de lectura`)
})

test('panel: el catálogo se lee de la base y el vacío se dice', () => {
  // La Fase 6 sustituyó `CatalogoConectores` por `AplicacionesPanel`; la Fase 10
  // lo sustituyó por la rejilla. La exigencia sigue siendo la misma: no hay una
  // lista de conectores escrita en el componente —la construye el servidor— y
  // cuando no queda nada que enseñar se dice en vez de disimularlo.
  const src = leer('src/components/connect/CatalogoIntegraciones.tsx')
  assert.match(src, /entradas: EntradaCatalogo\[\]/)
  assert.match(src, /filtradas\.length === 0/)
  assert.match(src, /Nada coincide con esa búsqueda/)
  // La rejilla no decide nada por su cuenta: el estado y el botón vienen
  // calculados del servidor.
  const tarjeta = leer('src/components/connect/TarjetaIntegracion.tsx')
  assert.match(tarjeta, /entrada\.accion !== null/)
})

test('panel: la clave nueva se enseña una vez y la pantalla lo advierte', () => {
  const src = leer('src/components/connect/ClavesApiPanel.tsx')
  assert.match(src, /no se puede volver a ver/i)
  // Y el fallo de `clipboard` no puede esconder la clave: sigue a la vista.
  assert.match(src, /\.catch\(\(\) => setCopiado\(false\)\)/)
})

test('panel: la página no se abre sin empresa', () => {
  const src = leer('src/app/(admin)/admin/integraciones/page.tsx')
  assert.match(src, /await requireSection\('integraciones'\)/)
  assert.match(src, /if \(!user\?\.metadata\.companyId\) redirect\(/)
})

test('panel: pausado y apagado se distinguen en pantalla', () => {
  const src = leer('src/components/connect/WebhooksPanel.tsx')
  assert.match(src, /Pausado por ti/)
  assert.match(src, /Apagado por fallos/)
})
