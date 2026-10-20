import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * LA RAÍZ DE CADA PANEL LLEVA A ALGÚN SITIO (auditoría admin · 1.9).
 *
 * `/admin`, `/superadmin` y `/empleado` no tienen página: escribirlas a mano o
 * guardarlas como favorito daba 404. El proxy ya las trata como secciones
 * conocidas, así que basta con que el servidor las mande al inicio del panel.
 */

const config = readFileSync('next.config.ts', 'utf8')

for (const [raiz, destino] of [
  ['/admin', '/admin/dashboard'],
  ['/superadmin', '/superadmin/dashboard'],
  ['/empleado', '/empleado/scanner'],
] as const) {
  test(`${raiz} redirige a ${destino}`, () => {
    assert.match(config, new RegExp(`source:\\s*'${raiz}',\\s*destination:\\s*'${destino}'`))
    // El destino existe de verdad.
    const pagina = {
      '/admin/dashboard': 'src/app/(admin)/admin/dashboard/page.tsx',
      '/superadmin/dashboard': 'src/app/(superadmin)/superadmin/dashboard/page.tsx',
      '/empleado/scanner': 'src/app/(empleado)/empleado/scanner/page.tsx',
    }[destino]
    assert.ok(existsSync(pagina), `no existe ${pagina}`)
  })
}

test('el enlace de Membresías de plataforma a la ficha del cliente solo existe con esa empresa activa', () => {
  const pagina = readFileSync('src/app/(superadmin)/superadmin/membresias/page.tsx', 'utf8')
  assert.match(pagina, /m\.empresaId\s*===\s*empresaActiva/)
  // Nunca un enlace a /admin/clientes fuera de esa condición.
  const enlaces = pagina.match(/href=\{`\/admin\/clientes\//g) ?? []
  assert.equal(enlaces.length, 1)
})
