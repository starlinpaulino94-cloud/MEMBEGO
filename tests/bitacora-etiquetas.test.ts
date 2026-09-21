import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

// ─── Y TODO SUB-TIPO TAMBIÉN ─────────────────────────────────────────────────
//
// Varias acciones reutilizan NOTA_INTERNA como contenedor y distinguen la
// operación real en `payload.tipo`. Sin etiqueta, «extender la vigencia de una
// membresía» salía como `AJUSTE_VENCIMIENTO` en crudo bajo una «Nota interna» —
// ilegible e infiltrable justo para quien pregunta «¿cuándo le extendieron el
// lavado a este cliente?». Faltaban SIETE de trece.
//
// La fuente de verdad aquí no es un enum: es lo que el código ESCRIBE. Se
// recorren los módulos que crean filas de auditoría y se exige etiqueta para
// cada `tipo: 'EN_MAYUSCULAS'` que aparezca en ellos. Solo una dirección: una
// etiqueta sin escritor actual NO es fantasma —las filas históricas la siguen
// necesitando para leerse—.

/** Archivos .ts bajo `dir`, recursivo. */
function archivosTs(dir: string): string[] {
  const out: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) out.push(...archivosTs(ruta))
    else if (nombre.endsWith('.ts')) out.push(ruta)
  }
  return out
}

/**
 * El texto DENTRO de cada llamada `auditLog.create(...)` de un archivo.
 *
 * Acotar importa: los mismos archivos escriben `tipo:` en notificaciones y en
 * `registrarEventoMembresia`, que no son la bitácora. Se recorre con balance de
 * paréntesis desde el `(` de la llamada; el texto de un motivo con paréntesis
 * balanceados no lo rompe.
 */
function llamadasDeAuditoria(src: string): string[] {
  const bloques: string[] = []
  // `\s*` cubre el salto de línea: media base escribe `tx.auditLog\n.create(`.
  for (const m of src.matchAll(/auditLog\s*\.\s*create(?:Many)?\s*\(/g)) {
    const abre = m.index + m[0].length - 1
    let nivel = 0
    let j = abre
    for (; j < src.length; j++) {
      if (src[j] === '(') nivel++
      else if (src[j] === ')' && --nivel === 0) break
    }
    bloques.push(src.slice(abre, j + 1))
  }
  return bloques
}

/** Los `payload.tipo` EN MAYÚSCULAS escritos dentro de llamadas de auditoría. */
function subtiposEscritos(): Map<string, string> {
  const porTipo = new Map<string, string>()
  for (const ruta of archivosTs(join('src', 'modules'))) {
    const src = readFileSync(ruta, 'utf8')
    if (!/auditLog\s*\.\s*create/.test(src)) continue
    for (const bloque of llamadasDeAuditoria(src)) {
      for (const m of bloque.matchAll(/tipo: '([A-Z][A-Z0-9_]*)'/g)) {
        porTipo.set(m[1], ruta)
      }
    }
  }
  return porTipo
}

function clavesDeSubtipos(): string[] {
  const marca = 'export const SUBTIPO_LABEL: Record<string, string> = {'
  const abre = QUERIES.indexOf(marca)
  assert.notEqual(abre, -1, 'no se encontró `SUBTIPO_LABEL` en el módulo de auditoría')
  const cierra = QUERIES.indexOf('\n}', abre)
  const cuerpo = QUERIES.slice(abre + marca.length, cierra)
  return [...cuerpo.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1])
}

test('cada sub-tipo que el código escribe tiene su etiqueta legible', () => {
  const enElMapa = new Set(clavesDeSubtipos())
  const sinEtiqueta = [...subtiposEscritos()].filter(([tipo]) => !enElMapa.has(tipo))
  assert.deepEqual(
    sinEtiqueta.map(([tipo, ruta]) => `${tipo} (${ruta})`),
    [],
    'estos sub-tipos saldrían en crudo en la bitácora y no se podrían filtrar:\n' +
      sinEtiqueta.map(([tipo, ruta]) => `  · ${tipo} — escrito en ${ruta}`).join('\n') +
      '\nAñádelos a SUBTIPO_LABEL en src/modules/auditoria/queries.ts'
  )
})

test('los ajustes de membresía —el caso que motivó esto— están etiquetados por nombre', () => {
  const enElMapa = new Set(clavesDeSubtipos())
  for (const tipo of ['AJUSTE_VENCIMIENTO', 'AJUSTE_LAVADOS']) {
    assert.ok(enElMapa.has(tipo), `${tipo} tiene que tener etiqueta legible`)
  }
})

test('el filtro de la bitácora ofrece los sub-tipos, no solo las acciones', () => {
  // `opcionesDeAccion` mezcla ACCION_LABEL y SUBTIPO_LABEL (con el prefijo
  // `sub:`), y `getAuditoria` entiende ese prefijo filtrando por payload.tipo.
  assert.match(QUERIES, /export function opcionesDeAccion/)
  assert.match(QUERIES, /PREFIJO_SUBTIPO/)
  assert.match(QUERIES, /path: \['tipo'\], equals: subtipo/)
  const pagina = readFileSync(join('src', 'app', '(admin)', 'admin', 'actividad', 'page.tsx'), 'utf8')
  assert.match(pagina, /opcionesDeAccion\(\)/, 'el desplegable no usa la lista compartida')
})
