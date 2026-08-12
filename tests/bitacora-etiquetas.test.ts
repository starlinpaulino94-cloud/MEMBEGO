import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TODA ACCIÓN REGISTRADA TIENE NOMBRE.
 *
 * La bitácora traduce `accion` con `ACCION_LABEL`, y lo que no está en el mapa
 * sale en crudo: `SUPERADMIN_OTORGADO`, en mayúsculas y con guiones bajos. Eso
 * ya sería feo; lo grave es lo otro: la pantalla de Auditoría construye su
 * desplegable de filtros recorriendo ese mismo mapa, así que una acción sin
 * etiqueta tampoco se puede BUSCAR.
 *
 * Cuando se encontró, faltaban trece de treinta y tres. Entre ellas las tres de
 * privilegio —otorgar superadmin, retirarlo y entrar como otro usuario—, que
 * son justo las que alguien va a buscar cuando pase algo. El mapa no se quedó
 * atrás por descuido: se quedó atrás porque NADA avisaba.
 *
 * Esta guardia lee el enum del esquema, que es la fuente de verdad, y exige
 * correspondencia EXACTA en las dos direcciones:
 *
 *  · falta una etiqueta → la acción nueva sale en crudo y no se puede filtrar.
 *  · sobra una etiqueta → o se escribió mal, o quedó el fantasma de un valor
 *    que ya no existe, y aparece en el desplegable sin devolver jamás una fila.
 */

const ESQUEMA = readFileSync(join('prisma', 'schema', 'identidad.prisma'), 'utf8')
const QUERIES = readFileSync(join('src', 'modules', 'auditoria', 'queries.ts'), 'utf8')

/** Los valores del enum `AuditAccion`, sin comentarios `///` ni `//`. */
function valoresDelEnum(): string[] {
  const abre = ESQUEMA.indexOf('enum AuditAccion {')
  assert.notEqual(abre, -1, 'no se encontró `enum AuditAccion` en el esquema')
  const cierra = ESQUEMA.indexOf('\n}', abre)
  const cuerpo = ESQUEMA.slice(abre + 'enum AuditAccion {'.length, cierra)
  return cuerpo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
}

/** Las claves de `ACCION_LABEL`. Se lee como TEXTO a propósito. */
function clavesDelMapa(): string[] {
  // Importar el módulo arrastraría `@/lib/prisma` y con él un PrismaClient que
  // el runner no tiene por qué poder construir. Aquí solo hace falta la lista.
  const marca = 'export const ACCION_LABEL: Record<string, string> = {'
  const abre = QUERIES.indexOf(marca)
  assert.notEqual(abre, -1, 'no se encontró `ACCION_LABEL` en el módulo de auditoría')
  const cierra = QUERIES.indexOf('\n}', abre)
  const cuerpo = QUERIES.slice(abre + marca.length, cierra)
  return [...cuerpo.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1])
}

test('cada acción del enum tiene su etiqueta legible', () => {
  const enElMapa = new Set(clavesDelMapa())
  const sinEtiqueta = valoresDelEnum().filter((v) => !enElMapa.has(v))
  assert.deepEqual(
    sinEtiqueta,
    [],
    'estas acciones saldrían en crudo en la bitácora y no se podrían filtrar:\n' +
      sinEtiqueta.map((v) => `  · ${v}`).join('\n') +
      '\nAñádelas a ACCION_LABEL en src/modules/auditoria/queries.ts'
  )
})

test('ninguna etiqueta apunta a una acción que no existe', () => {
  const enElEnum = new Set(valoresDelEnum())
  const fantasmas = clavesDelMapa().filter((k) => !enElEnum.has(k))
  assert.deepEqual(
    fantasmas,
    [],
    'estas etiquetas no corresponden a ningún valor de `AuditAccion` ' +
      '(¿un typo, o un valor retirado del esquema?):\n' +
      fantasmas.map((v) => `  · ${v}`).join('\n')
  )
})

/**
 * Y las tres de privilegio, nombradas UNA A UNA.
 *
 * La guardia de arriba ya las cubriría, pero cubrirlas por regla general y
 * cubrirlas por nombre no es lo mismo: si mañana alguien decide que el mapa se
 * genera solo, o afloja la comparación, estas tres tienen que seguir cayendo.
 * Son las que convierten la bitácora en una prueba de quién hizo qué.
 */
test('las acciones de privilegio están etiquetadas por nombre', () => {
  const enElMapa = new Set(clavesDelMapa())
  for (const accion of [
    'SUPERADMIN_OTORGADO',
    'SUPERADMIN_RETIRADO',
    'ENTRAR_COMO_GENERADO',
    'ENTRAR_COMO_USADO',
  ]) {
    assert.ok(enElMapa.has(accion), `${accion} tiene que tener etiqueta legible`)
  }
})
