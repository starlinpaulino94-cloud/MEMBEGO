import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPABILITIES, scopesDelManifiesto, validarManifiesto } from '@membego/contracts'

/**
 * PARK & TOURS · EL SEGUNDO SATÉLITE, Y LA PRUEBA DE QUE EL ALTA ES DATOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ VIGILA ESTO
 *
 * Conectar Park & Tours a MembeGo no tocó ni una línea del Core: son un
 * manifiesto (`examples/manifiestos/park-and-tours.json`) y un alta
 * (`prisma/migrations_manual/2026-09-conectar-park-and-tours.sql`). El acceso
 * —la tarjeta de /admin/integraciones y el icono del App Launcher— sale solo,
 * porque las dos superficies leen el registro y no una lista escrita a mano.
 *
 * Eso convierte a esos dos archivos de datos en la superficie que se puede
 * romper en silencio: aquí no hay compilador que avise, y un `urlBase` que se
 * quede desincronizado manda el token SSO a un dominio equivocado sin que nada
 * falle hasta que alguien pulse el botón.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE MIRA LA CAUSA, NO EL SÍNTOMA
 *
 * No se comprueba «la tarjeta aparece» —eso depende de una base de datos de
 * producción que esta suite no tiene—. Se comprueba lo que la haría aparecer
 * mal: que el manifiesto siga siendo válido para el registrador, que el SQL y
 * el manifiesto digan lo mismo, y que el SQL no se salte ninguna de las cuatro
 * cosas que su propio encabezado promete no hacer.
 */

const RAIZ = join(import.meta.dirname, '..')
const RUTA_MANIFIESTO = join(RAIZ, 'examples/manifiestos/park-and-tours.json')
const RUTA_SQL = join(RAIZ, 'prisma/migrations_manual/2026-09-conectar-park-and-tours.sql')

/**
 * SQL sin lo que explica el SQL.
 *
 * Existe por una lección que ya costó tres arreglos en esta suite: una guardia
 * que busca una cadena en el código la encuentra también en el comentario que
 * explica por qué esa cadena está prohibida, y entonces el archivo suspende por
 * documentarse bien. Se quitan los comentarios de línea y los de bloque; las
 * cadenas literales del SQL de este archivo no llevan `--` dentro, así que no
 * hay nada que proteger de un recorte de más.
 */
function sinComentariosSql(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '')
}

const manifiestoCrudo = JSON.parse(readFileSync(RUTA_MANIFIESTO, 'utf8')) as Record<string, unknown>
const sqlCompleto = readFileSync(RUTA_SQL, 'utf8')
const sql = sinComentariosSql(sqlCompleto)

// ── El manifiesto ───────────────────────────────────────────────────────────

/**
 * El registrador (`scripts/registrar-sistema.ts`) valida antes de escribir. Si
 * el manifiesto dejara de ser válido, el alta fallaría en el momento más caro:
 * con alguien delante de una consola de producción.
 */
test('el manifiesto de Park & Tours es válido para el registrador', () => {
  const v = validarManifiesto(manifiestoCrudo)
  assert.equal(v.ok, true, v.ok ? '' : `manifiesto inválido: ${v.errores.join(' · ')}`)
})

/**
 * Los scopes se DERIVAN de las capabilities; escribir uno a mano en el archivo
 * del satélite no concede nada. Esta prueba fija esa dirección para este
 * manifiesto concreto: si alguien añadiera `"scopes"` al JSON esperando que
 * hiciera algo, aquí se ve que no lo hace.
 */
test('las capabilities de Park & Tours existen y derivan scopes', () => {
  const caps = manifiestoCrudo.capabilities as string[]
  assert.ok(Array.isArray(caps) && caps.length > 0, 'el manifiesto declara capabilities')
  for (const c of caps) {
    assert.ok((CAPABILITIES as readonly string[]).includes(c), `capability desconocida: ${c}`)
  }
  assert.ok(!('scopes' in manifiestoCrudo), 'los scopes NO se declaran: se derivan')

  const v = validarManifiesto(manifiestoCrudo)
  assert.equal(v.ok, true)
  if (!v.ok) return
  const scopes = scopesDelManifiesto(v.manifiesto)
  assert.ok(scopes.includes('benefits:redeem'), 'BENEFIT_REDEMPTION concede benefits:redeem')
  assert.ok(scopes.includes('qr:validate'), 'QR_VALIDATION concede qr:validate')
})

// ── El manifiesto y el alta dicen lo mismo ──────────────────────────────────

/**
 * LA DESINCRONIZACIÓN QUE NADIE VERÍA.
 *
 * El manifiesto es lo que el satélite entrega; el SQL es lo que se escribe en
 * la base. Son dos archivos con los mismos cuatro valores dentro, y nada los
 * ata salvo esto. Que se separen no rompe ninguna compilación: simplemente, el
 * botón lleva a otro sitio —o a ninguno— y el token SSO se entrega en un
 * dominio que no es el del satélite.
 */
test('el alta SQL registra exactamente lo que dice el manifiesto', () => {
  const literales = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
  const contiene = (v: string) => literales.includes(v)

  for (const clave of ['slug', 'nombre', 'urlBase', 'webhookUrl'] as const) {
    const valor = manifiestoCrudo[clave] as string | undefined
    if (!valor) continue
    assert.ok(
      contiene(valor),
      `el SQL no contiene el ${clave} del manifiesto ("${valor}"): uno de los dos se movió`
    )
  }

  for (const vertical of manifiestoCrudo.businessTypes as string[]) {
    assert.ok(contiene(vertical), `el SQL no registra el vertical "${vertical}" del manifiesto`)
  }
})

// ── Las cuatro promesas del encabezado del SQL ──────────────────────────────

/**
 * PROMESA 1: no cambia el vertical de ninguna empresa.
 *
 * `companies.tipoNegocioCodigo` decide qué módulos ve una empresa en el menú y
 * a qué sistemas entra. Un alta que lo escribiera reconfiguraría un negocio de
 * paso, y el rastro quedaría dentro de un archivo titulado «conectar Park &
 * Tours». Se lee, se compara, y si no cuadra el SQL para.
 */
test('el alta no escribe nunca en companies', () => {
  const escrituras = sql.match(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?companies"?/gi)
  assert.equal(
    escrituras,
    null,
    `el alta escribe en companies: ${escrituras?.join(', ')}. El vertical se elige en el panel.`
  )
})

/**
 * PROMESA 2: no emite la credencial OAuth2 desde SQL.
 *
 * `credenciales_sistema.clientSecretHash` guarda un scrypt, y un scrypt no se
 * calcula en SQL. Un INSERT aquí solo podría dejar un hash inventado: una
 * credencial que existe, que el panel cuenta, y con la que el satélite no puede
 * autenticarse jamás. La emite `scripts/registrar-sistema.ts`, que sí sabe
 * hashear, y el encabezado del alta dice cómo.
 */
test('el alta no inventa credenciales OAuth2', () => {
  const escrituras = sql.match(/\b(?:INSERT\s+INTO|UPDATE)\s+"?credenciales_sistema"?/gi)
  assert.equal(
    escrituras,
    null,
    'el alta escribe credenciales: su secreto se guarda con scrypt y eso no se hace en SQL'
  )
})

/**
 * PROMESA 3: no rota el secreto, ni reactiva, ni cambia las políticas de un
 * sistema que ya estaba dado de alta.
 *
 * El `ON CONFLICT` es la línea peligrosa del archivo: es la que se ejecuta la
 * SEGUNDA vez, sobre una fila que ya está en producción y funcionando. Pisar
 * ahí `secreto` dejaría al satélite sin poder verificar ni un token —con su
 * `.env` intacto y sin ningún error que apunte aquí—.
 */
test('reregistrar solo actualiza nombre y URLs', () => {
  const bloque = sql.match(/ON\s+CONFLICT\s*\(\s*"slug"\s*\)\s*DO\s+UPDATE\s+SET([\s\S]*?);/i)
  assert.ok(bloque, 'no se encontró el ON CONFLICT del alta del sistema')
  const columnas = [...bloque[1].matchAll(/"([A-Za-z]+)"\s*=/g)].map((m) => m[1]).sort()
  assert.deepEqual(
    columnas,
    ['nombre', 'urlBase', 'urlWebhook'],
    'el reregistro toca columnas que no son suyas (secreto, estado, activo o las políticas)'
  )
})

/**
 * PROMESA 4: no reactiva un sistema SUSPENDED ni RETIRED.
 *
 * Lo que lo garantiza es que el archivo no contiene NINGUNA escritura de
 * `estado` fuera del INSERT inicial: sin un UPDATE que lo toque, un sistema
 * parado sigue parado por construcción y no por disciplina.
 */
test('el alta no cambia el estado de un sistema que ya existía', () => {
  const updates = sql.match(/UPDATE\s+"sistemas_conectados"[\s\S]*?;/gi)
  assert.equal(updates, null, 'hay un UPDATE sobre sistemas_conectados: podría reactivar un sistema parado')
})

/**
 * EL CHECK DE 20260803 EXIGE `(estado = 'ACTIVE') = activo`.
 *
 * Dos columnas que dicen lo mismo se separan siempre, y aquí la base lo impide:
 * un INSERT que ponga `'ACTIVE'` sin `true` no falla en revisión, falla en
 * producción a mitad del alta. Se comprueba que van juntos en la misma lista de
 * valores.
 */
test('el INSERT del sistema mantiene estado y activo coherentes', () => {
  assert.match(
    sql,
    /'ACTIVE',\s*true/,
    "el INSERT no empareja 'ACTIVE' con activo = true: el CHECK lo rechazaría"
  )
  assert.equal(
    sql.match(/'(?:DRAFT|SUSPENDED|RETIRED)'\s*,\s*true/),
    null,
    'hay un estado no-ACTIVE emparejado con activo = true'
  )
})

/**
 * UN ALTA NO BORRA NADA.
 *
 * `2026-09-limpiar-carwash-duplicado.sql` existe porque el alta del PRIMER
 * satélite se hizo a mano y dejó una fila de más. La lección no fue «hay que
 * borrar mejor», fue «un archivo de alta se corre con menos miedo que uno que
 * borra». Este no borra, y esta prueba es lo que lo mantiene así.
 */
test('el alta no contiene ninguna sentencia destructiva', () => {
  const destructivas = sql.match(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/gi)
  assert.equal(destructivas, null, `el alta contiene: ${destructivas?.join(', ')}`)
})

/**
 * IDEMPOTENCIA, COMPROBADA COMO SE COMPRUEBA AQUÍ: contando, no recordando.
 *
 * Las cuatro tablas que el alta escribe tienen que llevar su cláusula de
 * conflicto. Sin una de ellas, la segunda pasada revienta por clave duplicada a
 * mitad de camino y deja el alta hecha a medias — que es peor que no hecha,
 * porque parece que está.
 */
test('las cuatro escrituras del alta son idempotentes', () => {
  for (const tabla of ['tipos_negocio', 'sistemas_conectados', 'sistemas_tipos_negocio', 'empresas_sistemas']) {
    const insert = sql.match(new RegExp(`INSERT\\s+INTO\\s+"${tabla}"[\\s\\S]*?;`, 'i'))
    assert.ok(insert, `el alta no escribe en ${tabla}`)
    assert.match(
      insert[0],
      /ON\s+CONFLICT/i,
      `el INSERT sobre ${tabla} no tiene ON CONFLICT: la segunda pasada fallaría`
    )
  }
})
