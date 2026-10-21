import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  ORIGENES_CONSENTIMIENTO,
  RUTA_POLITICA_RENOVACION,
  TEXTOS_PUBLICADOS,
  TEXTO_VERSION_GUARDAR_MOVIL,
  TEXTO_VERSION_GUARDAR_WEB,
  TEXTO_VERSION_HEREDADO,
  TEXTO_VERSION_RENOVACION,
  TIPOS_CONSENTIMIENTO,
  esTipoConsentimiento,
  exigeAvisoPrevio,
  ipParaRegistro,
  partirTexto,
  periodoDelPlan,
  renderizarTexto,
  userAgentParaRegistro,
} from '../src/modules/pagos/consentimientosCore'
import { POLITICA_RENOVACION } from '../src/modules/pagos/renovacionPolitica'

/**
 * CONSENTIMIENTOS SOBRE LA TARJETA GUARDADA.
 *
 * Lo puro se EJECUTA (los textos, las versiones, lo que se guarda de la IP). Lo
 * que vive en módulos `server-only` o en componentes de Next/Expo, que no se
 * pueden importar aquí, se comprueba por su código — y cada prueba dice POR QUÉ
 * esa línea no puede desaparecer. El comportamiento contra una base real está en
 * `tests/postgres/consentimientos-pago.db.test.ts`.
 */

const raiz = join(__dirname, '..')

function leer(ruta: string): string {
  return readFileSync(join(raiz, ruta), 'utf8')
}

/** El código sin comentarios: un comentario que MENCIONA algo no cuenta como que lo haga. */
function fuente(ruta: string): string {
  return leer(ruta)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function trozo(src: string, desde: string, hasta?: string): string {
  const i = src.indexOf(desde)
  assert.ok(i >= 0, `no se encontró «${desde}»; si se movió a propósito, actualiza esta prueba`)
  if (!hasta) return src.slice(i)
  const j = src.indexOf(hasta, i + desde.length)
  assert.ok(j > i, `no se encontró «${hasta}» después de «${desde}»`)
  return src.slice(i, j)
}

const normaliza = (s: string) => s.replace(/\s+/g, ' ').trim()

const GUARDADO = 'src/modules/pagos/cardnetTokenGuardado.ts'
const MIGRACION = 'prisma/migrations/20261077_consentimientos_pago/migration.sql'
const PROMETE_AVISO = /avis(aremos|ará|o|amos|ar)\b|notific(aremos|ará|aci)|recordar/i
/** Un texto que remite a la Política de pagos promete lo que la política promete (el aviso incluido). */
const INCORPORA_POLITICA = /según las condiciones de renovación automática de la Política de pagos/

// ── Los dos consentimientos ─────────────────────────────────────────────────

test('hay DOS consentimientos distintos', () => {
  assert.deepEqual([...TIPOS_CONSENTIMIENTO], ['GUARDAR_TARJETA', 'RENOVACION_AUTOMATICA'])
  assert.equal(esTipoConsentimiento('GUARDAR_TARJETA'), true)
  assert.equal(esTipoConsentimiento('RENOVACION_AUTOMATICA'), true)
  assert.equal(esTipoConsentimiento('OTRO'), false)
  assert.equal(esTipoConsentimiento(undefined), false)
})

test('el origen es del cliente o heredado', () => {
  assert.deepEqual([...ORIGENES_CONSENTIMIENTO], ['CLIENTE', 'HEREDADO'])
})

test('ipParaRegistro: «unknown» y basura no se guardan como si fueran una IP', () => {
  // `getClientIdentifier` devuelve «unknown» sin x-forwarded-for. Guardarlo
  // dejaría un dato falso en un registro cuyo único valor es ser verdadero.
  assert.equal(ipParaRegistro('unknown'), null)
  assert.equal(ipParaRegistro(''), null)
  assert.equal(ipParaRegistro(null), null)
  assert.equal(ipParaRegistro('no-es-una-ip'), null)
  assert.equal(ipParaRegistro('999.1.1.1'), null)
  assert.equal(ipParaRegistro('190.80.12.5'), '190.80.12.5')
})

test('userAgentParaRegistro: se recorta, no infla el registro', () => {
  assert.equal(userAgentParaRegistro(null), null)
  assert.equal(userAgentParaRegistro('   '), null)
  assert.equal(userAgentParaRegistro('x'.repeat(1000))!.length, 300)
})

// ── Los textos ──────────────────────────────────────────────────────────────

test('cada versión publicada tiene su texto, y lo heredado NO lo tiene', () => {
  for (const v of [TEXTO_VERSION_GUARDAR_WEB, TEXTO_VERSION_GUARDAR_MOVIL, TEXTO_VERSION_RENOVACION]) {
    assert.ok(TEXTOS_PUBLICADOS[v], `la versión ${v} no tiene texto`)
  }
  // Fingir un texto para lo heredado sería fabricar evidencia.
  assert.ok(!(TEXTO_VERSION_HEREDADO in TEXTOS_PUBLICADOS))
})

test('el permiso de guardar dice, a propósito, que NO activa renovaciones', () => {
  for (const v of [TEXTO_VERSION_GUARDAR_WEB, TEXTO_VERSION_GUARDAR_MOVIL]) {
    assert.match(TEXTOS_PUBLICADOS[v], /no activa renovaciones automáticas/, v)
  }
})

test('cada superficie guarda con SU texto: el web y el móvil no dicen lo mismo', () => {
  const web = partirTexto(TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_WEB])
  const movil = partirTexto(TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_MOVIL])
  assert.equal(web.titulo, 'Guardar esta tarjeta para futuras compras.')
  assert.equal(movil.titulo, 'Guardar esta tarjeta para futuras compras.')
  assert.equal(
    web.detalle,
    'CardNET conserva el perfil de pago de forma segura. Este permiso no activa renovaciones automáticas.'
  )
  assert.equal(
    movil.detalle,
    'Tu tarjeta se guardará de forma segura en CardNET. Este permiso no activa renovaciones automáticas.'
  )
  assert.notEqual(TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_WEB], TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_MOVIL])
})

test('LO QUE SE REGISTRA ES LO QUE MUESTRA LA PANTALLA WEB', () => {
  // Si alguien cambia el texto de la casilla sin cambiar la versión, el registro
  // diría «aceptó la versión X» sobre un texto que no es X. Si esta prueba
  // falla: añade una versión nueva en consentimientosCore.ts, no edites la vieja.
  const { titulo, detalle } = partirTexto(TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_WEB])
  const pantalla = normaliza(fuente('src/components/membresia/PagoTokenCardnet.tsx'))
  assert.ok(
    pantalla.includes(titulo.replace(/\.$/, '')),
    `la pantalla web ya no dice «${titulo}»: el texto registrado como «${TEXTO_VERSION_GUARDAR_WEB}» dejó de ser el que se muestra`
  )
  assert.ok(
    pantalla.includes(normaliza(detalle)),
    `la pantalla web ya no dice «${detalle}»: el texto registrado como «${TEXTO_VERSION_GUARDAR_WEB}» dejó de ser el que se muestra`
  )
})

test('LO QUE SE REGISTRA ES LO QUE MUESTRA LA APP MÓVIL', () => {
  // La app (Expo) es otro paquete y tiene su propio texto. Esta prueba es lo que
  // impide que los dos se separen sin que nadie se entere.
  const { titulo, detalle } = partirTexto(TEXTOS_PUBLICADOS[TEXTO_VERSION_GUARDAR_MOVIL])
  const pantalla = normaliza(fuente('apps/client/src/components/pagos/cardnet/primitives.tsx'))
  assert.ok(
    pantalla.includes(titulo.replace(/\.$/, '')),
    `la app ya no dice «${titulo}»: el texto registrado como «${TEXTO_VERSION_GUARDAR_MOVIL}» dejó de ser el que se muestra`
  )
  assert.ok(
    pantalla.includes(normaliza(detalle)),
    `la app ya no dice «${detalle}»: el texto registrado como «${TEXTO_VERSION_GUARDAR_MOVIL}» dejó de ser el que se muestra`
  )
})

test('los textos de GUARDAR no prometen un aviso que ese permiso no da', () => {
  for (const v of [TEXTO_VERSION_GUARDAR_WEB, TEXTO_VERSION_GUARDAR_MOVIL]) {
    assert.doesNotMatch(TEXTOS_PUBLICADOS[v], PROMETE_AVISO, v)
  }
})

test('la renovación (v1) es corta: autoriza el cobro sin confirmar e incorpora la Política de pagos', () => {
  // Decisión del dueño (21-10-2026): la casilla no repite las condiciones. Las
  // condiciones completas (aviso, intentos, cómo desactivar) viven en /privacy, y
  // `tests/politicas-pagos.test.ts` obliga a que sus cifras sean las de
  // `POLITICA_RENOVACION` (que aquí solo se importa para que ese vínculo conste).
  const texto = TEXTOS_PUBLICADOS[TEXTO_VERSION_RENOVACION]
  assert.equal(TEXTO_VERSION_RENOVACION, 'renovacion-v1')
  assert.match(texto, /Autorizo a \{empresa\} a cobrar a esta tarjeta el precio vigente del plan \(hoy \{monto\}\) \{periodo\}/)
  assert.match(texto, /sin confirmar cada cobro/)
  assert.match(texto, INCORPORA_POLITICA)
  assert.match(texto, /Puedo desactivarlo cuando quiera/)
  assert.ok(texto.length <= 320, `el texto volvió a crecer (${texto.length} caracteres): las condiciones van en la política`)
  assert.doesNotMatch(texto, /\d+ intentos|avisará/, 'las cifras y promesas van en la política, no en la casilla')
  assert.equal(RUTA_POLITICA_RENOVACION, '/privacy#renovacion-automatica')
  assert.ok(POLITICA_RENOVACION.maxRechazosPorCiclo >= 1)
})

test('lo que exige el cobro coincide con lo que prometen los textos', () => {
  // Un texto que dice «me avisarán» solo es verdad si el cobro no sale sin
  // aviso. Si un texto promete y no está en la lista, se cobra sin avisar; si
  // está en la lista y no promete, se detienen cobros sin motivo.
  for (const [version, texto] of Object.entries(TEXTOS_PUBLICADOS)) {
    assert.equal(
      exigeAvisoPrevio(version),
      PROMETE_AVISO.test(texto) || INCORPORA_POLITICA.test(texto),
      `${version}: promesa de aviso y exigencia del cobro no coinciden`
    )
  }
  // Lo heredado nunca lo prometió.
  assert.equal(exigeAvisoPrevio(TEXTO_VERSION_HEREDADO), false)
  assert.equal(exigeAvisoPrevio(null), false)
  assert.equal(exigeAvisoPrevio(undefined), false)
})

test('el texto de renovar dice cuánto, cada cuánto, que es sin confirmar cada cobro y cómo pararlo', () => {
  const t = renderizarTexto(TEXTO_VERSION_RENOVACION, {
    empresa: 'Lavado Express',
    monto: 'RD$1,600',
    periodo: 'cada 30 días',
  })
  assert.match(t, /Lavado Express/)
  assert.match(t, /RD\$1,600/)
  assert.match(t, /cada 30 días/)
  assert.match(t, /sin confirmar cada cobro/)
  assert.match(t, /Puedo desactivarlo cuando quiera/)
})

test('renderizarTexto no deja ninguna llave a la vista, ni cuando falta un valor', () => {
  for (const v of Object.keys(TEXTOS_PUBLICADOS)) {
    assert.doesNotMatch(renderizarTexto(v, { empresa: 'X', monto: 'Y', periodo: 'Z' }), /[{}]/, v)
    assert.doesNotMatch(renderizarTexto(v), /[{}]|undefined|null/, `${v} sin valores`)
  }
  assert.match(renderizarTexto(TEXTO_VERSION_RENOVACION), /esta empresa/)
  assert.match(renderizarTexto(TEXTO_VERSION_RENOVACION), /el precio de tu plan/)
  assert.match(renderizarTexto(TEXTO_VERSION_RENOVACION), /en cada período/)
})

test('renderizarTexto lanza con una versión que no existe', () => {
  // Mostrar un texto y registrar otro es el fallo que este módulo existe para impedir.
  assert.throws(() => renderizarTexto('no-existe-v9'), /no existe/)
})

test('partirTexto: título + detalle es el texto original, entero', () => {
  for (const [version, texto] of Object.entries(TEXTOS_PUBLICADOS)) {
    const { titulo, detalle } = partirTexto(texto)
    assert.equal(`${titulo} ${detalle}`.trim(), texto, version)
    assert.ok(titulo.endsWith('.'), `${version}: el título es la primera frase`)
  }
  assert.deepEqual(partirTexto('Sin punto'), { titulo: 'Sin punto', detalle: '' })
})

test('periodoDelPlan: solo lo que el cobro hace de verdad', () => {
  assert.equal(periodoDelPlan(30), 'cada 30 días')
  assert.equal(periodoDelPlan(1), 'cada día')
  // Sin vigencia conocida no se inventa un número.
  for (const raro of [null, undefined, 0, -5, 2.5]) assert.equal(periodoDelPlan(raro as number), null)
})

// ── El registro está enganchado a TODO lo que guarda una tarjeta ────────────

const GUARDAR = () => trozo(fuente(GUARDADO), 'export async function guardarTarjeta(', 'async function guardarFila(')

test('guardarTarjeta exige el consentimiento: no es opcional', () => {
  // Un parámetro opcional se olvida; uno obligatorio hace que el compilador
  // señale a quien lo olvide.
  const entrada = trozo(fuente(GUARDADO), 'export interface GuardarTarjetaInput', 'export async function guardarTarjeta(')
  assert.match(entrada, /consentimiento: ContextoConsentimiento/)
  assert.doesNotMatch(entrada, /consentimiento\?:/)
})

test('guardarTarjeta registra el consentimiento en la MISMA transacción que la tarjeta', () => {
  const src = GUARDAR()
  const fila = src.indexOf('guardarFila(tx,')
  const consentimiento = src.indexOf("otorgarConsentimiento(tx, {")
  assert.ok(fila > 0, 'la fila de la tarjeta ya no se escribe dentro de la transacción')
  assert.ok(consentimiento > fila, 'el consentimiento se registra antes (o fuera) de la tarjeta')
  assert.match(src.slice(consentimiento), /tipo: 'GUARDAR_TARJETA'/)
  assert.match(src.slice(consentimiento), /tarjetaId: tarjeta\.id/)
  assert.match(src.slice(consentimiento), /contexto: input\.consentimiento/)
  // Si entre una cosa y otra hubiera otra transacción, un fallo dejaría una
  // tarjeta guardada sin su constancia, o la constancia sin la tarjeta.
  assert.doesNotMatch(src.slice(fila, consentimiento), /conEmpresa\(|sinEmpresa\(/)
})

/** Todos los archivos de `src` (sin node_modules). */
function archivosDeSrc(dir = join(raiz, 'src')): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...archivosDeSrc(ruta))
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta)
  }
  return salida
}

test('quien llama a guardarTarjeta pasa lo que el cliente aceptó, y es EL texto de su superficie', () => {
  const llamadores = archivosDeSrc()
    .filter((f) => /\bguardarTarjeta\(\{/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(raiz, f).split('\\').join('/'))
    .filter((f) => f !== GUARDADO)
    .sort()
  // Si aparece un llamador nuevo, esta lista lo hace visible: tiene que pasar su
  // consentimiento y decidir bajo qué texto.
  assert.deepEqual(llamadores, [
    'src/app/api/pagos/cardnet-token/activar/route.ts',
    'src/app/api/pagos/cardnet-token/confirmar/route.ts',
    'src/app/api/pagos/cardnet-token/guardar/route.ts',
    'src/modules/pagos/cardnetClienteCompra.ts',
  ])
  const esperado: Record<string, string> = {
    'src/app/api/pagos/cardnet-token/activar/route.ts': 'TEXTO_VERSION_GUARDAR_WEB',
    'src/app/api/pagos/cardnet-token/confirmar/route.ts': 'TEXTO_VERSION_GUARDAR_WEB',
    'src/app/api/pagos/cardnet-token/guardar/route.ts': 'TEXTO_VERSION_GUARDAR_WEB',
    'src/modules/pagos/cardnetClienteCompra.ts': 'TEXTO_VERSION_GUARDAR_MOVIL',
  }
  for (const f of llamadores) {
    const src = fuente(f)
    const llamada = trozo(src, 'guardarTarjeta({')
    assert.match(llamada, /consentimiento:\s*\{/, `${f}: no pasa el consentimiento`)
    assert.match(
      llamada,
      new RegExp(`textoVersion:\\s*${esperado[f]}`),
      `${f}: registra otro texto que el de su pantalla (${esperado[f]})`
    )
  }
})

test('las rutas web registran de dónde llegó la aceptación; el móvil no inventa lo que no tiene', () => {
  for (const f of [
    'src/app/api/pagos/cardnet-token/activar/route.ts',
    'src/app/api/pagos/cardnet-token/confirmar/route.ts',
    'src/app/api/pagos/cardnet-token/guardar/route.ts',
  ]) {
    const llamada = trozo(fuente(f), 'consentimiento: {', '}')
    assert.match(llamada, /ip: id/, `${f}: no registra la IP`)
    assert.match(llamada, /userAgent: req\.headers\.get\('user-agent'\)/, `${f}: no registra el agente`)
  }
  // La sesión móvil no conserva la IP ni el agente de la petición: se dejan
  // vacíos en vez de poner la IP del servidor, que sería un dato falso.
  const movil = trozo(fuente('src/modules/pagos/cardnetClienteCompra.ts'), 'consentimiento: {', '}')
  assert.match(movil, /ip: null/)
  assert.match(movil, /userAgent: null/)
})

test('otorgarConsentimiento toma su propio candado por cliente: no depende de quien lo llama', () => {
  const src = fuente('src/modules/pagos/consentimientos.ts')
  const f = trozo(src, 'export async function otorgarConsentimiento(', 'export interface FiltroConsentimientos')
  const candado = f.indexOf('pg_advisory_xact_lock')
  assert.ok(candado > 0, 'sin candado, dos peticiones a la vez dejan dos consentimientos vigentes')
  assert.match(f, /consentimiento:\$\{input\.clienteId\}/, 'el candado tiene que ser por cliente')
  assert.ok(candado < f.indexOf('findFirst'), 'se consulta antes de tomar el candado')
})

test('el registro de consentimientos solo inserta: lo único que se modifica es revocadoAt', () => {
  const src = fuente('src/modules/pagos/consentimientos.ts')
  assert.doesNotMatch(src, /consentimientoPago\.delete/)
  // Los updates solo ponen `revocadoAt`.
  for (const m of src.matchAll(/consentimientoPago\.update(?:Many)?\(\{[\s\S]*?\n\s*\}\)/g)) {
    assert.match(m[0], /data:\s*\{\s*revocadoAt:/, `un update toca algo más que revocadoAt: ${m[0].slice(0, 80)}`)
  }
})

// ── El cobro automático y el consentimiento ─────────────────────────────────

const RENOVACION = () =>
  trozo(
    fuente(GUARDADO),
    'export async function renovarMembresiaPorTarjeta',
    'export async function membresiasARenovar'
  )

test('la renovación exige un consentimiento vigente ANTES de cobrar', () => {
  const src = RENOVACION()
  const guarda = src.indexOf("consentimientoVigente(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId })")
  assert.ok(guarda > 0, 'autoRenovar por sí solo vuelve a bastar para cobrar')
  assert.ok(guarda < src.indexOf('cobrarConCredencialGuardada('))
  assert.match(src, /\.catch\(\(\) => null\)/, 'si no se puede comprobar el consentimiento, NO se cobra')
  assert.match(src, /if \(!consentimiento\) \{\s*return \{ estado: 'omitida'/)
})

test('la renovación no cobra una tarjeta de otro cliente', () => {
  const src = RENOVACION()
  assert.match(src, /tarjeta\.clienteId !== m\.clienteId/)
  assert.ok(src.indexOf('tarjeta.clienteId !== m.clienteId') < src.indexOf('cobrarConCredencialGuardada('))
})

test('quitar una tarjeta retira sus consentimientos y los de las renovaciones que la usaban', () => {
  const src = trozo(fuente(GUARDADO), 'export async function eliminarTarjeta(', 'async function apagarRenovacionPorFallo')
  assert.match(src, /revocarConsentimientos\(tx, \{ tarjetaId: id \}\)/)
  assert.match(src, /revocarConsentimientos\(tx, \{ tipo: 'RENOVACION_AUTOMATICA', membershipId: m\.id \}\)/)
  // Los ids de las membresías se leen ANTES de soltar la tarjeta: después ya no
  // se sabría cuáles renovaban con ella.
  assert.ok(src.indexOf('tx.membership.findMany') < src.indexOf('tarjetaTokenizadaId: null'))
})

test('apagar la renovación retira su consentimiento, en los tres sitios que la apagan', () => {
  for (const ruta of [
    'src/modules/membresia/actions.ts',
    'src/modules/admin/actions.ts',
    'src/modules/admin/planActions.ts',
  ]) {
    const src = fuente(ruta)
    assert.match(
      src,
      /revocarConsentimientos\(tx,\s*\{\s*tipo:\s*'RENOVACION_AUTOMATICA'/,
      `${ruta}: apaga autoRenovar sin retirar el consentimiento`
    )
  }
})

// ── La migración ────────────────────────────────────────────────────────────

test('la migración existe y su sello de SUMAS.txt es el de ESTE archivo', () => {
  assert.ok(existsSync(join(raiz, MIGRACION)))
  const suma = createHash('sha256').update(readFileSync(join(raiz, MIGRACION))).digest('hex')
  assert.match(
    leer('prisma/migrations/SUMAS.txt'),
    new RegExp(`^${suma}  20261077_consentimientos_pago$`, 'm'),
    'el sello no coincide: la migración se editó después de sellarse (o no se selló)'
  )
})

test('la migración es aditiva: no borra ni vacía nada', () => {
  const sql = fuente(MIGRACION).replace(/^\s*--.*$/gm, '')
  for (const destructivo of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /TRUNCATE/i, /DELETE\s+FROM/i, /DROP\s+INDEX/i, /ALTER\s+TABLE\s+"tarjetas_tokenizadas"/i]) {
    assert.doesNotMatch(sql, destructivo, `la migración contiene ${destructivo}`)
  }
})

test('la migración es idempotente: todo lo que crea lo hace con guarda', () => {
  const sql = leer(MIGRACION).replace(/^\s*--.*$/gm, '')
  const sinGuarda = (patron: RegExp, guarda: RegExp, que: string) => {
    for (const m of sql.matchAll(patron)) {
      assert.match(m[0], guarda, `${que} sin guarda: ${m[0].slice(0, 80)}…`)
    }
  }
  sinGuarda(/CREATE TABLE[^(]*/gi, /IF NOT EXISTS/i, 'CREATE TABLE')
  sinGuarda(/CREATE (UNIQUE )?INDEX[^"]*"[^"]*"/gi, /IF NOT EXISTS/i, 'CREATE INDEX')
  // Las restricciones van dentro de un DO con comprobación en pg_constraint.
  assert.equal(
    (sql.match(/ADD CONSTRAINT/gi) ?? []).length,
    (sql.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/gi) ?? []).length,
    'hay restricciones añadidas sin comprobar si ya existen'
  )
  // Y los dos rellenos no duplican si se vuelve a correr.
  assert.equal((sql.match(/INSERT INTO "consentimientos_pago"/g) ?? []).length, 2)
  assert.equal((sql.match(/AND NOT EXISTS \(/g) ?? []).length, 2)
})

test('la migración crea los dos índices parciales que sostienen «un consentimiento vigente»', () => {
  const sql = leer(MIGRACION)
  for (const indice of ['consentimientos_pago_vigente_tarjeta_uk', 'consentimientos_pago_vigente_membresia_uk']) {
    assert.match(sql, new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${indice}"[\\s\\S]*?WHERE`), `falta ${indice}`)
  }
  // Después de rellenar, para que su creación no pueda fallar.
  assert.ok(sql.indexOf('INSERT INTO "consentimientos_pago"') < sql.indexOf('_vigente_tarjeta_uk'))
})

test('la migración hereda los consentimientos con la marca de que no hay texto exacto', () => {
  const sql = leer(MIGRACION)
  assert.ok(sql.includes(`'${TEXTO_VERSION_HEREDADO}'`), 'la versión heredada de la migración no coincide con la del código')
  assert.ok(sql.includes("'HEREDADO'"))
  assert.match(sql, /'GUARDAR_TARJETA'/)
  assert.match(sql, /'RENOVACION_AUTOMATICA'/)
  // Lo que importa: las renovaciones que HOY funcionan no se detienen al exigir consentimiento.
  assert.match(sql, /JOIN "tarjetas_tokenizadas" t ON t\."id" = m\."tarjetaTokenizadaId" AND t\."activa"\s+WHERE m\."autoRenovar"/)
})

test('la migración activa RLS, que es la convención del repo', () => {
  assert.match(leer(MIGRACION), /ALTER TABLE "consentimientos_pago" ENABLE ROW LEVEL SECURITY/)
})

test('los valores de tipo y origen de la migración son los del código', () => {
  const sql = leer(MIGRACION)
  for (const tipo of TIPOS_CONSENTIMIENTO) assert.ok(sql.includes(`'${tipo}'`), `la migración no conoce ${tipo}`)
  for (const origen of ORIGENES_CONSENTIMIENTO) assert.ok(sql.includes(`'${origen}'`), `la migración no conoce ${origen}`)
})

test('el esquema declara lo que la migración crea', () => {
  const pagos = leer('prisma/schema/pagos.prisma')
  const modelo = trozo(pagos, 'model ConsentimientoPago {', '@@map("consentimientos_pago")')
  for (const campo of ['companyId', 'clienteId', 'tipo', 'tarjetaId', 'membershipId', 'origen', 'textoVersion', 'otorgadoAt', 'revocadoAt', 'ipAddress', 'userAgent']) {
    assert.match(modelo, new RegExp(`\\b${campo}\\b`), `falta ${campo} en ConsentimientoPago`)
  }
  // Las cuatro relaciones inversas, que Prisma exige.
  assert.match(leer('prisma/schema/identidad.prisma'), /consentimientosPago\s+ConsentimientoPago\[\]/)
  assert.match(leer('prisma/schema/clientes.prisma'), /consentimientosPago\s+ConsentimientoPago\[\]/)
  const membresias = leer('prisma/schema/membresias.prisma')
  assert.match(membresias, /consentimientosPago\s+ConsentimientoPago\[\]/)
  assert.match(membresias, /consentimientos\s+ConsentimientoPago\[\]/)
})
