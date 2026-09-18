import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * OPERACIÓN · FILTRO POR SUCURSAL Y EMPLEADO (reportes · Fase 4).
 *
 * El peligro de un filtro no es que falte: es que se aplique A MEDIAS. El
 * módulo mezcla consultas de Prisma con SQL crudo, y si mañana alguien añade
 * una consulta sobre `visits` sin el fragmento del filtro, esa cifra saldría
 * SIN recortar dentro de un reporte que dice estar filtrado — un número
 * mentiroso con etiqueta honesta. Estas guardias fijan las reglas del pacto.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const modulo = () => leer('src/modules/reportes/operacion.ts')

/** Los bloques `tx.$queryRaw\`...\`` del módulo, con su cuerpo SQL. */
function consultasCrudas(src: string): string[] {
  const bloques: string[] = []
  const re = /\$queryRaw[^`]*`/g
  while (re.exec(src)) {
    const fin = src.indexOf('`', re.lastIndex)
    bloques.push(src.slice(re.lastIndex, fin))
    re.lastIndex = fin + 1
  }
  return bloques
}

test('TODA consulta cruda sobre visits en rango lleva el fragmento del filtro', () => {
  const sql = consultasCrudas(modulo()).filter(
    (b) => b.includes('FROM "visits"') && b.includes('"fechaVisita"')
  )
  assert.ok(sql.length >= 3, `se esperaban al menos 3 consultas en rango y hay ${sql.length}`)
  for (const b of sql) {
    assert.ok(
      b.includes('${filtroSql(filtro)}'),
      'una consulta cruda sobre visits quedó SIN el filtro; con un filtro activo esa cifra saldría sin recortar:\n' +
        b.trim().slice(0, 200)
    )
  }
})

test('el filtro crudo va parametrizado, nunca pegado al texto con Prisma.raw', () => {
  const src = modulo()
  const cuerpo = src.slice(src.indexOf('function filtroSql'), src.indexOf('async function totales'))
  assert.match(cuerpo, /Prisma\.sql`AND "sucursalId" = \$\{/, 'la sucursal no viaja como parámetro')
  assert.match(cuerpo, /Prisma\.sql`AND "empleadoId" = \$\{/, 'el empleado no viaja como parámetro')
  assert.ok(!cuerpo.includes('Prisma.raw'), 'un id de la URL dentro de Prisma.raw es una inyección')
})

test('filtrar por empleado exige ver_empleados EN LA CONSULTA, no en la pantalla', () => {
  // La ruta de exportación reusa la misma función: si el permiso solo se
  // comprobara en el desplegable, el corte por persona saldría por el archivo.
  assert.match(
    modulo(),
    /pedido\.empleadoId && verEmpleados/,
    'resolverFiltro ya no descarta el filtro por empleado sin permiso'
  )
})

test('un id que no resuelve DENTRO de la empresa no filtra', () => {
  const src = modulo()
  const cuerpo = src.slice(src.indexOf('async function resolverFiltro'), src.indexOf('async function seguro'))
  assert.match(cuerpo, /id: pedido\.sucursalId, companyId/, 'la sucursal no se valida contra la empresa')
  assert.match(
    cuerpo,
    /empresasAcceso: \{ some: \{ companyId \} \}/,
    'el empleado no se valida por los dos caminos de acceso'
  )
})

test('con filtro los QR ni se consultan, y la vista y el CSV lo dicen', () => {
  assert.match(
    modulo(),
    /filtro\s*\n?\s*\? Promise\.resolve\(\{\} as Record<string, number>\)/,
    'el módulo consulta los QR aun con filtro; la bitácora no los puede recortar'
  )
  const vista = leer('src/components/reportes/ReporteOperacionVista.tsx')
  assert.match(vista, /r\.filtro \?/, 'la vista ya no distingue el reporte filtrado')
  const csv = leer('src/app/(admin)/admin/reportes/operacion/export/route.ts')
  assert.match(csv, /OMITIDO - no se pueden filtrar/, 'el CSV filtrado calla que los QR no van')
})

test('la exportación se lleva el MISMO filtro que la pantalla', () => {
  const csv = leer('src/app/(admin)/admin/reportes/operacion/export/route.ts')
  assert.match(csv, /sucursalId: sp\.sucursal/, 'el export ignora ?sucursal=')
  assert.match(csv, /empleadoId: sp\.empleado/, 'el export ignora ?empleado=')
  assert.match(csv, /Filtro por sucursal/, 'el bloque de alcance no declara el filtro')
})

test('el desplegable de personas lista PERSONAL, nunca clientes', () => {
  const page = leer('src/app/(admin)/admin/reportes/operacion/page.tsx')
  assert.match(
    page,
    /role: \{ not: 'CLIENTE' \}/,
    'la lista de empleados del filtro traería también a los clientes'
  )
})

test('los enlaces arrastran el filtro APLICADO, no el pedido', () => {
  // Un id inventado en la URL no debe sobrevivir pegado a los presets ni
  // colarse en el enlace de exportación: lo que viaja es lo que se validó.
  const page = leer('src/app/(admin)/admin/reportes/operacion/page.tsx')
  assert.match(page, /r\.filtro\?\.sucursal/, 'los enlaces no salen del filtro aplicado')
  const form = leer('src/components/reportes/FiltroOperacionForm.tsx')
  assert.match(form, /aria-label="Filtrar por sucursal"/, 'el desplegable de sucursal no tiene nombre accesible')
  assert.match(form, /aria-label="Filtrar por empleado"/, 'el desplegable de empleado no tiene nombre accesible')
})
