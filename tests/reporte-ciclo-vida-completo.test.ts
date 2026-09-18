import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * EL CICLO DE VIDA SE ENSEÑA ENTERO (reportes · Fase 3).
 *
 * El enum `MembresiaEventoTipo` tenía siete tipos y el reporte enseñaba cinco:
 * CREADA y RECHAZADA existían en la tabla y no se podían ni contar ni abrir. Al
 * estrenar AJUSTADA (Fase 2) el mismo drift habría vuelto a pasar. La regla que
 * estas guardias fijan: TODO tipo del enum tiene su pestaña en el detalle — la
 * fuente de verdad es el esquema, no una lista a mano que se queda atrás.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

/** Los valores del enum `MembresiaEventoTipo`, sin comentarios. */
function tiposDelEnum(): string[] {
  const src = leer('prisma/schema/membresias.prisma')
  const abre = src.indexOf('enum MembresiaEventoTipo {')
  assert.notEqual(abre, -1, 'no se encontró el enum en el esquema')
  const cuerpo = src.slice(abre, src.indexOf('\n}', abre))
  return cuerpo
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///'))
}

test('el detalle del ciclo de vida tiene pestaña para CADA tipo del enum', () => {
  const detalle = leer('src/app/(admin)/admin/reportes/membresias/detalle/page.tsx')
  const marca = 'const TIPOS = {'
  const cuerpo = detalle.slice(detalle.indexOf(marca), detalle.indexOf('} as const'))
  const sinPestana = tiposDelEnum().filter((t) => !new RegExp(`^\\s*${t}:`, 'm').test(cuerpo))
  assert.deepEqual(
    sinPestana,
    [],
    'estos tipos existen en la tabla pero el detalle no los puede abrir:\n' +
      sinPestana.map((t) => `  · ${t}`).join('\n') +
      '\nAñádelos a TIPOS en reportes/membresias/detalle/page.tsx'
  )
})

test('el reporte expone creadas, rechazadas y ajustadas como cifras propias', () => {
  const modulo = leer('src/modules/reportes/membresias.ts')
  for (const campo of ['creadas: Kpi', 'rechazadas: Kpi', 'ajustadas: Kpi']) {
    assert.ok(modulo.includes(campo), `falta ${campo} en ReporteMembresias`)
  }
  const vista = leer('src/components/reportes/ReporteMembresiasVista.tsx')
  assert.match(vista, /r\.ajustadas/, 'la vista no pinta los ajustes')
  assert.match(vista, /r\.creadas/, 'la vista no pinta las creadas')
  assert.match(vista, /r\.rechazadas/, 'la vista no pinta los rechazos')
})

test('el detalle evento-por-evento está enlazado a la vista, no escondido', () => {
  const vista = leer('src/components/reportes/ReporteMembresiasVista.tsx')
  assert.match(vista, /Ver el detalle evento por evento/, 'el enlace prominente al detalle desapareció')
})

test('un ajuste enseña QUÉ cambió (vigencia o lavados, antes → después)', () => {
  const detalle = leer('src/app/(admin)/admin/reportes/membresias/detalle/page.tsx')
  assert.match(detalle, /detalleAjuste/, 'no se lee el payload del ajuste')
  assert.match(detalle, /'VENCIMIENTO'/, 'no distingue el ajuste de vigencia')
  assert.match(detalle, /'LAVADOS'/, 'no distingue el ajuste de lavados')
})
