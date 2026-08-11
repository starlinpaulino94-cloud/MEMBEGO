import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * DESCUBRIR: BUSCAR OFERTAS Y VER LAS MEMBRESÍAS DE TODOS LOS NEGOCIOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ARREGLÓ
 *
 * 1 · «Vigente» significaba dos cosas distintas. El feed del cliente entendía
 *     `vigenciaHasta: null` como «no caduca»; la vitrina pública escribía
 *     `vigenciaHasta: { gt: now }`, que en SQL descarta los nulos. Una oferta
 *     permanente salía en el inicio y desaparecía al buscarla.
 *
 * 2 · No se podía buscar. El feed curado no tenía ni buscador ni categorías:
 *     para encontrar algo concreto había que recorrer seis secciones.
 *
 * 3 · «Planes» eran los de la empresa activa. Quien todavía no era cliente de
 *     nadie pedía ver membresías y recibía un estado vacío.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTAS PRUEBAS SON GUARDIAS DE TEXTO
 *
 * Que las consultas DEVUELVAN lo correcto se comprueba ejecutándolas contra
 * PostgreSQL en `scripts/verificar-descubrimiento.mts` — con su control
 * negativo en cada caso, y comprobado por mutación: al revertir la corrección
 * de vigencia, cuatro comprobaciones fallan.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function tsDe(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...tsDe(p))
    else if (/\.tsx?$/.test(e)) acc.push(p)
  }
  return acc
}

test('«vigente» tiene UNA sola definición, y admite las que no caducan', () => {
  /**
   * `vigenciaHasta` es opcional: `null` = no caduca. Comparar contra NULL en
   * SQL no da verdadero, así que `{ gt: now }` borra en silencio todas las
   * permanentes. El fallo no produce ningún error: el negocio ve su oferta
   * publicada, el cliente la ve en su inicio, y el buscador dice que no existe.
   */
  const culpables: string[] = []
  for (const f of [...tsDe('src/modules'), ...tsDe('src/app')]) {
    const src = leer(f)
    // Se examina CADA aparición, no el archivo entero: la forma correcta
    // —`OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }]`—
    // contiene una comparación por dentro, así que buscar la comparación en el
    // archivo marca como culpables a los que están bien. (Escrito primero así;
    // señaló seis archivos correctos y ninguno equivocado.)
    const re = /vigenciaHasta:\s*\{\s*(gt|gte):\s*now\s*([,}])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const antes = src.slice(Math.max(0, m.index - 60), m.index)
      // Su rama `null` justo delante: es la forma correcta.
      if (/vigenciaHasta:\s*null\s*\}\s*,\s*\{\s*$/.test(antes)) continue
      // `{ gte: now, lte: … }` es un RANGO («expiran pronto»), no un filtro de
      // vigencia: ahí sí se piden a propósito las que tienen fecha.
      if (m[2] === ',') continue
      culpables.push(`${f}  →  ${src.slice(m.index, m.index + 45).trim()}`)
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'Volvió el filtro que descarta las promociones sin fecha de fin:\n  ' +
      culpables.join('\n  ') +
      '\nUsa `promocionVigente()` de src/modules/promociones/vigencia.ts.'
  )
})

test('el OR de la búsqueda no pisa al OR de la vigencia', () => {
  /**
   * Prisma no fusiona dos claves iguales del mismo objeto: si el texto añade
   * su propio `OR` al lado del de la vigencia, se queda con el último y el
   * buscador empieza a servir ofertas caducadas. Comprobado por mutación:
   * sacar el `AND` hace fallar «la búsqueda NO devuelve la caducada».
   */
  const src = leer('src/modules/marketplace/queries.ts')
  const vitrina = src.slice(
    src.indexOf('export async function getPromotionsPublic'),
    src.indexOf('export async function getFeaturedPromotions')
  )
  assert.match(
    vitrina,
    /\.\.\.\(search && \{\s*AND: \[/,
    'El OR del texto tiene que ir dentro de AND, o anula la vigencia.'
  )
})

test('buscar ofertas vive en la URL', () => {
  // GET y no estado de cliente: la búsqueda se comparte, «atrás» funciona y
  // recargar no la pierde. Mismo criterio que ya seguía Explorar.
  const src = leer('src/app/(cliente)/cliente/promociones/page.tsx')
  assert.match(src, /<form action="\/cliente\/promociones" role="search">/)
  assert.match(src, /name="q"/, 'Sin campo de texto no hay buscador.')
  assert.match(src, /params\.categoria/, 'La categoría también va en la URL.')
  assert.match(
    src,
    /buscarEnMisEmpresas/,
    'Sin esto, buscar el nombre de una oferta PRIVADA que la persona tiene ' +
      'delante en su inicio contestaría «sin resultados».'
  )
})

test('los filtros no se borran entre sí', () => {
  // Cambiar de categoría conservando lo escrito. Un chip que borra la búsqueda
  // obliga a reescribirla en cada intento.
  const src = leer('src/app/(cliente)/cliente/promociones/page.tsx')
  const href = src.slice(src.indexOf('const hrefCon'), src.indexOf('const categoriaActiva'))
  assert.match(href, /if \(q\) qs\.set\('q', q\)/, 'El chip debe conservar el texto buscado.')
})

test('«Planes» ya no significa «los planes de la empresa activa»', () => {
  const src = leer('src/app/(cliente)/cliente/planes/page.tsx')
  assert.match(
    src,
    /const verTodos = todos === '1'/,
    'Falta el modo catálogo global (`?todos=1`).'
  )
  assert.match(
    src,
    /verTodos \|\| !user\.metadata\.clienteId \|\| !user\.metadata\.companyId/,
    'Quien todavía no es cliente de nadie tiene que ver el catálogo global, no ' +
      'un estado vacío: pidió ver membresías y la plataforma sí tiene.'
  )
  assert.ok(
    !/SinEmpresaTodavia/.test(src),
    'Volvió el estado vacío a la pantalla de planes.'
  )
  assert.match(
    src,
    /\/cliente\/planes\?todos=1/,
    'Sin un enlace desde el catálogo de su empresa, el global no se alcanza.'
  )
})

test('el catálogo global enseña, no contrata', () => {
  /**
   * El precio que le corresponde a una persona depende de la categoría de su
   * vehículo y de su historial en ESE negocio: lo decide `planesElegibles` con
   * su ficha delante. Un botón de comprar aquí enseñaría un precio que puede
   * no ser el suyo, así que cada tarjeta lleva al perfil de la empresa.
   */
  const src = leer('src/components/cliente/CatalogoPlanesGlobal.tsx')
  assert.ok(
    !/planesElegibles|comprar|contratar/i.test(src),
    'El catálogo global no debe decidir elegibilidad ni cobrar.'
  )
  assert.match(src, /\/cliente\/empresas\/\$\{empresa\.slug\}/, 'Cada plan lleva a su negocio.')
  assert.match(
    src,
    /formatMoney\(p\.precio, \{\s*moneda: empresa\.moneda/,
    'Cada precio con la moneda de SU negocio: 900 pesos mexicanos enseñados ' +
      'como dominicanos no es un detalle de formato.'
  )
  assert.match(src, /desde/, 'Es precio de catálogo, no una oferta personal.')
})
