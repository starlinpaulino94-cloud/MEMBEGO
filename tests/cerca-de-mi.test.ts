import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * EL MAPA DISTINGUE SEGUIR DE SER CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PASABA
 *
 * «Cerca de mí» marcaba una sola relación: el seguimiento (`CompanyFollow`).
 * Un negocio donde la persona lleva un año siendo clienta —con su historial,
 * sus beneficios y su membresía— se le ofrecía en el mapa exactamente igual
 * que uno que no ha pisado nunca.
 *
 * Es la misma corrección que la fase 6 hizo en el perfil de empresa, ahora en
 * la pantalla donde se descubre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTAS GUARDIAS NO PUEDEN VER
 *
 * La búsqueda es SQL crudo con dos motores y JOINs que se arman a trozos.
 * TypeScript no mira dentro de esa cadena y un regex tampoco: un JOIN sin su
 * condición compila igual y devuelve filas de más. Eso se comprueba
 * EJECUTÁNDOLO, en `scripts/verificar-cerca-de-mi.mts` — donde quitar el
 * acotado por persona hace fallar la comprobación de aislamiento.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const QUERIES = 'src/modules/geo/cercanos/queries.ts'

test('la ficha de cliente se cruza por la PERSONA', () => {
  const src = leer(QUERIES)
  assert.match(
    src,
    /LEFT JOIN "clientes" cl ON cl\."companyId" = c\.id AND cl\."supabaseId" = \$\{supabaseId\}/,
    'El JOIN tiene que acotarse por `supabaseId`. Sin esa condición, cualquier ' +
      'ficha de cualquier persona marca el negocio como propio.'
  )
  assert.match(
    src,
    /supabaseId\?: string \| null/,
    'La identidad de la persona viaja aparte del `userId`: seguir vive en ' +
      '`company_follows` (por User) y ser cliente en `clientes` (por persona).'
  )
})

test('sin sesión la respuesta tiene la misma forma', () => {
  // El mapa es público. Si la columna desapareciera sin sesión, la UI tendría
  // dos contratos que mantener y el primer `undefined` se colaría en una
  // condición.
  const src = leer(QUERIES)
  assert.match(
    src,
    /: Prisma\.sql`false AS "esCliente"`/,
    'Sin sesión se devuelve `false`, no se omite la columna.'
  )
})

test('las dos búsquedas del mapa marcan lo mismo', () => {
  /**
   * Radio y rectángulo son dos consultas distintas para la misma pantalla: la
   * primera al abrir, la segunda al arrastrar. Si solo una llevara las marcas,
   * las insignias aparecerían y desaparecerían al mover el mapa, y nadie
   * relacionaría eso con haber arrastrado.
   */
  const src = leer(QUERIES)
  const veces = src.match(/columnaCliente\(supabaseId\)/g) ?? []
  assert.equal(
    veces.length,
    2,
    'Las dos consultas —por radio y por rectángulo— tienen que pedir la marca.'
  )
  const joins = src.match(/joinsSucursales\(filtros, ahora, userId, supabaseId\)/g) ?? []
  assert.equal(joins.length, 2, 'Y las dos tienen que traer el JOIN que la alimenta.')
})

test('el mapa enseña la relación más fuerte primero', () => {
  const ui = leer('src/components/geo/MapaCercaDeMi.tsx')
  const i = ui.indexOf('Ya eres cliente')
  const j = ui.indexOf('Favorita')
  assert.ok(i > 0, 'Falta la marca de «ya eres cliente» en la tarjeta del mapa.')
  assert.ok(
    i < j,
    'Ser cliente es una relación más fuerte que seguir: va delante.'
  )
})

test('la API le pasa la identidad de la persona a la búsqueda', () => {
  const ruta = leer('src/app/api/geo/cercanos/route.ts')
  assert.match(
    ruta,
    /supabaseId: sessionUser\?\.supabaseId \?\? null/,
    'Sin esto, la consulta recibe siempre `null` y la marca nunca se enciende ' +
      '— el fallo silencioso perfecto: todo compila y nada cambia.'
  )
})
