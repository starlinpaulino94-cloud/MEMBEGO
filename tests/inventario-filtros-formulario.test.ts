import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * INVENTARIO · LOS FORMULARIOS DE FILTROS Y «QUITAR FILTROS» — guardia estática.
 *
 * El formulario de filtros de cada pantalla es un `<form method="get">` con campos NO controlados (`defaultValue`) y «Quitar filtros» es un
 * `<Link>`: Next navega sin recargar y React conserva el mismo árbol, así que la lista se repinta sin filtros pero el formulario sigue
 * enseñando lo que se eligió, y volver a pulsar «Filtrar» re-aplica el filtro que se acababa de quitar. La cura es una `key` en el
 * formulario que cambie con los filtros de la URL (React lo monta de nuevo con los valores por defecto de la URL nueva). Esta prueba
 * exige que NINGUNA pantalla de /admin/inventario con «Quitar filtros» vuelva a tener un formulario de filtros sin esa `key`.
 * El comportamiento, recorriendo las 14 pantallas en el navegador: `tests/e2e/inventario-admin.spec.ts`.
 *
 * Ejecutar: npm test
 */

const RAIZ = 'src/app/(admin)/admin/inventario'

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) return paginas(ruta)
    return nombre === 'page.tsx' ? [ruta] : []
  })
}

const conQuitarFiltros = paginas(RAIZ).filter((ruta) => readFileSync(ruta, 'utf8').includes('Quitar filtros'))

test('INV · se conocen las 14 pantallas con «Quitar filtros» (si aparece una nueva, esta prueba la cubre sola; si desaparece una, se avisa)', () => {
  assert.equal(conQuitarFiltros.length, 14, conQuitarFiltros.join('\n'))
})

test('INV · el formulario de filtros de cada pantalla lleva una `key` que cambia con la URL (si no, «Quitar filtros» deja el formulario con lo anterior)', () => {
  for (const ruta of conQuitarFiltros) {
    const src = readFileSync(ruta, 'utf8')
    const formularios = [...src.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]).filter((etiqueta) => /method="get"/.test(etiqueta))
    assert.ok(formularios.length >= 1, `${ruta}: no hay formulario de filtros (method="get")`)
    for (const etiqueta of formularios) {
      assert.match(etiqueta, /\bkey=\{[^}]+\}/, `${ruta}: el formulario de filtros no tiene \`key\`: ${etiqueta}`)
    }
  }
})

test('INV · la `key` sale de los filtros (no de algo fijo ni de un contador): si fuera una constante, el formulario nunca se volvería a montar', () => {
  for (const ruta of conQuitarFiltros) {
    const src = readFileSync(ruta, 'utf8')
    const etiqueta = [...src.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]).find((e) => /method="get"/.test(e))!
    const clave = etiqueta.match(/\bkey=\{([^}]+)\}/)![1].trim()
    assert.ok(!/^['"`][^$]*['"`]$/.test(clave), `${ruta}: la key es una cadena fija: ${clave}`)
    assert.ok(!/^\d+$/.test(clave), `${ruta}: la key es un número fijo: ${clave}`)
    // Debe nombrar algo que existe en la página (una variable de filtros) y no un literal suelto.
    assert.match(clave, /consulta|\bq\b|estado|sucursal/, `${ruta}: la key no parece venir de los filtros: ${clave}`)
  }
})
