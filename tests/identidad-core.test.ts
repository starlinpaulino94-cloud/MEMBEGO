/**
 * VERIFICACIÓN DE IDENTIDAD · el núcleo puro.
 *
 * Cada prueba falla si vuelve el defecto que cierra. La base de datos está en
 * `tests/postgres/identidad.db.test.ts`; los guardias de código fuente, en
 * `tests/identidad-guardas.test.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CODIGOS_RAZON,
  ESTADOS_INTENTO,
  ESTADOS_INTENTO_ABIERTOS,
  ESTADOS_INTENTO_FINALES,
  ESTADOS_VERIFICACION,
  POLITICA_IDENTIDAD,
  calcularExpiracion,
  calcularHashDedupe,
  codigoPrincipal,
  debeAvisarRevalidacion,
  diasParaExpirar,
  esCodigoRazon,
  esEstadoAbierto,
  esEstadoFinal,
  estadoEfectivo,
  evaluarNuevoIntento,
  evaluarTransicion,
  mensajeParaUsuario,
  motivoEsVisible,
  puedeTransicionarVerificacion,
  resolverDecision,
  sumarMeses,
  type ContextoNuevoIntento,
} from '../src/modules/identidad/identidadCore'

const AHORA = new Date('2026-10-22T15:00:00Z')
const hace = (ms: number) => new Date(AHORA.getTime() - ms)
const MIN = 60_000
const DIA = 24 * 60 * MIN

// ── Los estados ─────────────────────────────────────────────────────────────

test('cada estado de intento es abierto o final, nunca los dos ni ninguno', () => {
  for (const e of ESTADOS_INTENTO) assert.equal(esEstadoAbierto(e) !== esEstadoFinal(e), true, e)
  assert.equal(ESTADOS_INTENTO_ABIERTOS.length + ESTADOS_INTENTO_FINALES.length, ESTADOS_INTENTO.length)
})

test('los estados abiertos son los mismos que el índice único parcial de la migración', () => {
  // Si estas listas se separan, el código dejaría abrir dos intentos a la vez (o bloquearía de más).
  const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261079_identidad_verificacion', 'migration.sql'), 'utf8')
  const indice = sql.slice(sql.indexOf('identidad_intentos_uno_abierto_uk'))
  const enSql = [...indice.slice(0, indice.indexOf(';')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(enSql, [...ESTADOS_INTENTO_ABIERTOS].sort())
})

// ── La máquina de estados del intento ───────────────────────────────────────

test('los estados solo avanzan: el camino normal es legal', () => {
  const camino = ['creada', 'iniciada', 'enviada', 'en_proceso', 'aprobada']
  for (let i = 0; i < camino.length - 1; i++) assert.equal(evaluarTransicion(camino[i], camino[i + 1]), 'aplicar', `${camino[i]}→${camino[i + 1]}`)
})

test('el proveedor puede decidir sin haber avisado de los pasos intermedios', () => {
  for (const desde of ['creada', 'iniciada', 'enviada', 'en_proceso']) {
    for (const final of ['aprobada', 'rechazada_reintentable', 'rechazada_definitiva']) {
      assert.equal(evaluarTransicion(desde, final), 'aplicar', `${desde}→${final}`)
    }
  }
})

test('EVENTOS FUERA DE ORDEN: un paso anterior que llega tarde no deshace nada', () => {
  assert.equal(evaluarTransicion('en_proceso', 'enviada'), 'ignorar_regresion')
  assert.equal(evaluarTransicion('enviada', 'iniciada'), 'ignorar_regresion')
  assert.equal(evaluarTransicion('en_proceso', 'creada'), 'ignorar_regresion')
  // Y tras una decisión final, cualquier estado abierto tardío se ignora (sin error).
  for (const final of ESTADOS_INTENTO_FINALES) {
    for (const abierto of ESTADOS_INTENTO_ABIERTOS) assert.equal(evaluarTransicion(final, abierto), 'ignorar_regresion', `${final}←${abierto}`)
  }
})

test('EVENTO DUPLICADO: el mismo estado dos veces es una repetición, no un cambio', () => {
  for (const e of ESTADOS_INTENTO) assert.equal(evaluarTransicion(e, e), 'repetida', e)
})

test('una decisión final NO la cambia otra distinta: queda prohibida (y se audita, la ve una persona)', () => {
  assert.equal(evaluarTransicion('aprobada', 'rechazada_definitiva'), 'prohibida')
  assert.equal(evaluarTransicion('rechazada_definitiva', 'aprobada'), 'prohibida')
  assert.equal(evaluarTransicion('rechazada_reintentable', 'aprobada'), 'prohibida')
  assert.equal(evaluarTransicion('cancelada', 'aprobada'), 'prohibida')
})

test('«reenvío requerido» y «en revisión»: se alcanzan desde cualquier paso, y de ellos se vuelve o se cierra', () => {
  for (const desde of ['creada', 'iniciada', 'enviada', 'en_proceso']) {
    assert.equal(evaluarTransicion(desde, 'reenvio_requerido'), 'aplicar', desde)
    assert.equal(evaluarTransicion(desde, 'en_revision'), 'aplicar', desde)
  }
  // El proveedor pide otra captura: la persona vuelve a enviar.
  assert.equal(evaluarTransicion('reenvio_requerido', 'enviada'), 'aplicar')
  assert.equal(evaluarTransicion('reenvio_requerido', 'en_proceso'), 'aplicar')
  assert.equal(evaluarTransicion('reenvio_requerido', 'aprobada'), 'aplicar')
  // Una persona está mirando el caso: un paso de captura tardío no lo mueve.
  assert.equal(evaluarTransicion('en_revision', 'enviada'), 'ignorar_regresion')
  assert.equal(evaluarTransicion('en_revision', 'aprobada'), 'aplicar')
  assert.equal(evaluarTransicion('en_revision', 'rechazada_definitiva'), 'aplicar')
})

test('un estado que no existe es ilegal, venga de donde venga', () => {
  assert.equal(evaluarTransicion('creada', 'verificada'), 'prohibida')
  assert.equal(evaluarTransicion('inventado', 'aprobada'), 'prohibida')
})

// ── La verificación global ──────────────────────────────────────────────────

test('transiciones de la verificación global', () => {
  const legales: [string, string][] = [
    ['no_verificada', 'verificada'],
    ['verificada', 'expirada'],
    ['verificada', 'revocada'],
    ['verificada', 'requiere_revalidacion'],
    ['expirada', 'verificada'],
    ['revocada', 'verificada'],
    ['requiere_revalidacion', 'verificada'],
    ['requiere_revalidacion', 'expirada'],
  ]
  for (const [d, h] of legales) assert.equal(puedeTransicionarVerificacion(d, h), true, `${d}→${h}`)
  // Nadie «revoca» a quien nunca se verificó, ni «expira» a quien no está verificado.
  assert.equal(puedeTransicionarVerificacion('no_verificada', 'revocada'), false)
  assert.equal(puedeTransicionarVerificacion('no_verificada', 'expirada'), false)
  assert.equal(puedeTransicionarVerificacion('revocada', 'expirada'), false)
  assert.equal(puedeTransicionarVerificacion('inventado', 'verificada'), false)
  for (const e of ESTADOS_VERIFICACION) assert.equal(puedeTransicionarVerificacion(e, 'no_verificada'), false, `${e}→no_verificada`)
})

// ── Fechas: verificación y expiración ───────────────────────────────────────

test('la expiración es calendario, no 30 días por mes: 31-ene + 1 mes = fin de febrero', () => {
  assert.equal(sumarMeses(new Date('2027-01-31T12:00:00Z'), 1).toISOString(), '2027-02-28T12:00:00.000Z')
  assert.equal(sumarMeses(new Date('2028-01-31T12:00:00Z'), 1).toISOString(), '2028-02-29T12:00:00.000Z')
  assert.equal(sumarMeses(new Date('2026-10-22T15:00:00Z'), 36).toISOString(), '2029-10-22T15:00:00.000Z')
  assert.equal(sumarMeses(new Date('2026-12-15T00:00:00Z'), 1).toISOString(), '2027-01-15T00:00:00.000Z')
})

test('una verificación vale 36 meses desde que se hace', () => {
  assert.equal(POLITICA_IDENTIDAD.validezMeses, 36)
  assert.equal(calcularExpiracion(AHORA).toISOString(), '2029-10-22T15:00:00.000Z')
})

test('una verificación vencida NO vale aunque el barrido diario todavía no la haya marcado', () => {
  const v = { estado: 'verificada', expiraEn: hace(1000) }
  assert.equal(estadoEfectivo(v, AHORA), 'expirada')
  assert.equal(estadoEfectivo({ estado: 'verificada', expiraEn: new Date(AHORA.getTime() + DIA) }, AHORA), 'verificada')
  // En revalidación pasa lo mismo: llegar a la fecha la expira.
  assert.equal(estadoEfectivo({ estado: 'requiere_revalidacion', expiraEn: hace(1) }, AHORA), 'expirada')
  // Justo en la fecha ya no vale.
  assert.equal(estadoEfectivo({ estado: 'verificada', expiraEn: AHORA }, AHORA), 'expirada')
  // Sin fila, o con un estado desconocido, es «no verificada»: nunca se asume lo contrario.
  assert.equal(estadoEfectivo(null, AHORA), 'no_verificada')
  assert.equal(estadoEfectivo({ estado: 'inventado', expiraEn: null }, AHORA), 'no_verificada')
  assert.equal(estadoEfectivo({ estado: 'revocada', expiraEn: new Date(AHORA.getTime() + DIA) }, AHORA), 'revocada')
})

test('el aviso de revalidación solo sale a quien sigue verificado y está a 30 días o menos', () => {
  const en = (dias: number) => ({ estado: 'verificada', expiraEn: new Date(AHORA.getTime() + dias * DIA) })
  assert.equal(debeAvisarRevalidacion(en(31), AHORA), false)
  assert.equal(debeAvisarRevalidacion(en(30), AHORA), true)
  assert.equal(debeAvisarRevalidacion(en(1), AHORA), true)
  assert.equal(debeAvisarRevalidacion({ estado: 'verificada', expiraEn: hace(DIA) }, AHORA), false, 'ya expiró: no es un aviso, es otro estado')
  assert.equal(debeAvisarRevalidacion({ estado: 'revocada', expiraEn: new Date(AHORA.getTime() + DIA) }, AHORA), false)
  assert.equal(diasParaExpirar(null, AHORA), null)
  assert.equal(diasParaExpirar(new Date(AHORA.getTime() + 10 * DIA), AHORA), 10)
})

// ── Los códigos de razón y los mensajes ─────────────────────────────────────

test('cada código tiene mensaje en español, y los de fraude no explican el motivo', () => {
  for (const [codigo, c] of Object.entries(CODIGOS_RAZON)) {
    assert.ok(c.mensaje.length > 20, codigo)
    assert.ok(c.mensaje.trim().endsWith('.'), `${codigo}: el mensaje debe terminar en punto`)
  }
  for (const fraude of ['SOSPECHA_DE_FRAUDE', 'SOSPECHA_DE_DOCUMENTO_ALTERADO'] as const) {
    assert.equal(CODIGOS_RAZON[fraude].visible, false, fraude)
    assert.equal(CODIGOS_RAZON[fraude].reintentable, false, fraude)
    // Decirle qué señal saltó es enseñarle a evitarla.
    assert.doesNotMatch(CODIGOS_RAZON[fraude].mensaje, /fraude|falsific|alterad|document/i, `${fraude}: el mensaje delata la señal`)
  }
})

test('MEMBEGO escribe los mensajes: un código que no está en el catálogo nunca se muestra crudo', () => {
  assert.equal(mensajeParaUsuario('LOW_FACE_MATCH_SIMILARITY'), CODIGOS_RAZON.RECHAZO_GENERICO.mensaje)
  assert.equal(mensajeParaUsuario(null), CODIGOS_RAZON.RECHAZO_GENERICO.mensaje)
  assert.equal(mensajeParaUsuario('ROSTRO_NO_COINCIDE'), CODIGOS_RAZON.ROSTRO_NO_COINCIDE.mensaje)
  assert.equal(esCodigoRazon('toString'), false, 'una propiedad heredada del objeto no es un código')
  assert.equal(esCodigoRazon('constructor'), false)
  assert.equal(motivoEsVisible('SOSPECHA_DE_FRAUDE'), false)
  assert.equal(motivoEsVisible('ROSTRO_NO_COINCIDE'), true)
})

test('con varios códigos manda el más grave, y los desconocidos se descartan', () => {
  assert.equal(codigoPrincipal(['ROSTRO_NO_COINCIDE', 'SOSPECHA_DE_FRAUDE']), 'SOSPECHA_DE_FRAUDE')
  assert.equal(codigoPrincipal(['DOCUMENTO_ILEGIBLE', 'PRUEBA_DE_VIDA_FALLIDA']), 'PRUEBA_DE_VIDA_FALLIDA')
  assert.equal(codigoPrincipal(['CODIGO_QUE_NO_EXISTE']), 'RECHAZO_GENERICO')
  assert.equal(codigoPrincipal([]), 'RECHAZO_GENERICO')
})

test('todo código del catálogo tiene un lugar en el orden de gravedad (no puede quedar sin elegirse)', () => {
  // Un código nuevo que se olvidara en la lista de gravedad caería siempre en el genérico.
  for (const codigo of Object.keys(CODIGOS_RAZON)) {
    assert.equal(codigoPrincipal([codigo]), codigo, `${codigo} no se puede elegir como principal`)
  }
})

test('la decisión se traduce: rechazo reintentable, definitivo, reenvío y revisión', () => {
  assert.deepEqual(resolverDecision({ resultado: 'rechazada', codigos: ['ROSTRO_NO_COINCIDE'] }), {
    estado: 'rechazada_reintentable',
    tipoRechazo: 'reintentable',
    codigoRazon: 'ROSTRO_NO_COINCIDE',
  })
  assert.deepEqual(resolverDecision({ resultado: 'rechazada', codigos: ['ROSTRO_NO_COINCIDE', 'MENOR_DE_EDAD'] }), {
    estado: 'rechazada_definitiva',
    tipoRechazo: 'definitivo',
    codigoRazon: 'MENOR_DE_EDAD',
  })
  // Un rechazo sin códigos conocidos es reintentable y genérico: nunca bloquea por una razón que no se sabe.
  assert.deepEqual(resolverDecision({ resultado: 'rechazada', codigos: ['X'] }), {
    estado: 'rechazada_reintentable',
    tipoRechazo: 'reintentable',
    codigoRazon: 'RECHAZO_GENERICO',
  })
  assert.deepEqual(resolverDecision({ resultado: 'reenvio_requerido', codigos: ['DOCUMENTO_ILEGIBLE'] }), {
    estado: 'reenvio_requerido',
    tipoRechazo: null,
    codigoRazon: 'DOCUMENTO_ILEGIBLE',
  })
  assert.deepEqual(resolverDecision({ resultado: 'en_revision' }), { estado: 'en_revision', tipoRechazo: null, codigoRazon: null })
  assert.deepEqual(resolverDecision({ resultado: 'aprobada' }), { estado: 'aprobada', tipoRechazo: null, codigoRazon: null })
  assert.deepEqual(resolverDecision({ resultado: 'en_proceso' }), { estado: 'en_proceso', tipoRechazo: null, codigoRazon: null })
})

// ── ¿Se puede empezar otro intento? ─────────────────────────────────────────

const base = (cambio: Partial<ContextoNuevoIntento> = {}): ContextoNuevoIntento => ({
  verificacion: null,
  hayIntentoAbierto: false,
  tieneConsentimientos: true,
  rechazos: [],
  ...cambio,
})

test('una persona sin nada pendiente y con consentimientos puede empezar', () => {
  assert.deepEqual(evaluarNuevoIntento(base(), AHORA), { permitido: true, esRevalidacion: false })
})

test('CUENTA PREVIAMENTE VERIFICADA: no se vuelve a verificar mientras valga', () => {
  const r = evaluarNuevoIntento(base({ verificacion: { estado: 'verificada', expiraEn: new Date(AHORA.getTime() + DIA) } }), AHORA)
  assert.deepEqual(r, { permitido: false, motivo: 'ya_verificada' })
  // Pero con la verificación vencida (aunque el barrido no la haya marcado) sí: es una revalidación.
  const vencida = evaluarNuevoIntento(base({ verificacion: { estado: 'verificada', expiraEn: hace(1) } }), AHORA)
  assert.deepEqual(vencida, { permitido: true, esRevalidacion: true })
  assert.deepEqual(evaluarNuevoIntento(base({ verificacion: { estado: 'requiere_revalidacion', expiraEn: null } }), AHORA), { permitido: true, esRevalidacion: true })
  assert.deepEqual(evaluarNuevoIntento(base({ verificacion: { estado: 'revocada', expiraEn: null } }), AHORA), { permitido: true, esRevalidacion: true })
})

test('DOS VERIFICACIONES SIMULTÁNEAS: con un intento abierto no se abre otro', () => {
  assert.deepEqual(evaluarNuevoIntento(base({ hayIntentoAbierto: true }), AHORA), { permitido: false, motivo: 'intento_abierto' })
})

test('sin los consentimientos no se captura nada', () => {
  assert.deepEqual(evaluarNuevoIntento(base({ tieneConsentimientos: false }), AHORA), { permitido: false, motivo: 'falta_consentimiento' })
})

test('REINTENTO DESPUÉS DEL RECHAZO: hay que esperar un poco, y luego se puede', () => {
  const rechazo = { resueltoAt: hace(2 * MIN), tipoRechazo: 'reintentable' }
  const r = evaluarNuevoIntento(base({ rechazos: [rechazo] }), AHORA)
  assert.equal(r.permitido, false)
  if (!r.permitido) {
    assert.equal(r.motivo, 'espera')
    assert.equal(r.esperarHasta?.getTime(), rechazo.resueltoAt.getTime() + POLITICA_IDENTIDAD.esperaTrasRechazoMs)
  }
  const luego = evaluarNuevoIntento(base({ rechazos: [{ resueltoAt: hace(6 * MIN), tipoRechazo: 'reintentable' }] }), AHORA)
  assert.deepEqual(luego, { permitido: true, esRevalidacion: false })
})

test('tres rechazos reintentables en la semana: ya no se reintenta solo, va a soporte', () => {
  const rechazos = [1, 2, 3].map((n) => ({ resueltoAt: hace(n * DIA), tipoRechazo: 'reintentable' }))
  assert.deepEqual(evaluarNuevoIntento(base({ rechazos }), AHORA), { permitido: false, motivo: 'demasiados_rechazos' })
  // Dos no bastan, y los de hace más de 7 días no cuentan.
  assert.equal(evaluarNuevoIntento(base({ rechazos: rechazos.slice(0, 2) }), AHORA).permitido, true)
  const viejos = [8, 9, 10].map((n) => ({ resueltoAt: hace(n * DIA), tipoRechazo: 'reintentable' }))
  assert.equal(evaluarNuevoIntento(base({ rechazos: viejos }), AHORA).permitido, true)
})

test('un rechazo DEFINITIVO bloquea, y solo el equipo lo desbloquea', () => {
  const rechazos = [{ resueltoAt: hace(30 * DIA), tipoRechazo: 'definitivo' }]
  assert.deepEqual(evaluarNuevoIntento(base({ rechazos }), AHORA), { permitido: false, motivo: 'bloqueada_por_rechazo_definitivo' })
  assert.equal(evaluarNuevoIntento(base({ rechazos, desbloqueoPorStaff: true }), AHORA).permitido, true)
})

test('el orden importa: lo que no se arregla esperando va antes que lo que sí', () => {
  // Verificada + intento abierto + sin consentimiento: lo primero que se dice es «ya verificada».
  const r = evaluarNuevoIntento(
    base({ verificacion: { estado: 'verificada', expiraEn: new Date(AHORA.getTime() + DIA) }, hayIntentoAbierto: true, tieneConsentimientos: false }),
    AHORA
  )
  assert.equal(r.permitido === false && r.motivo, 'ya_verificada')
  // Bloqueo definitivo antes que la espera.
  const b = evaluarNuevoIntento(
    base({ rechazos: [{ resueltoAt: hace(MIN), tipoRechazo: 'definitivo' }] }),
    AHORA
  )
  assert.equal(b.permitido === false && b.motivo, 'bloqueada_por_rechazo_definitivo')
})

// ── Dedupe por documento ────────────────────────────────────────────────────

test('el hash de dedupe es estable, normaliza el número y depende del pepper', () => {
  const pepper = 'a'.repeat(40)
  const doc = { tipoDocumento: 'cedula', numeroDocumento: '001-1234567-8', pais: 'do' }
  const h = calcularHashDedupe(pepper, doc)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(calcularHashDedupe(pepper, { ...doc, numeroDocumento: '00112345678' }), h, 'guiones y espacios no cambian el hash')
  assert.equal(calcularHashDedupe(pepper, { tipoDocumento: 'CEDULA', numeroDocumento: '001 1234567 8', pais: 'DO' }), h)
  assert.notEqual(calcularHashDedupe('b'.repeat(40), doc), h, 'otro pepper, otro hash: un volcado no permite probar cédulas')
  assert.notEqual(calcularHashDedupe(pepper, { ...doc, numeroDocumento: '00112345679' }), h)
  assert.notEqual(calcularHashDedupe(pepper, { ...doc, pais: 'CO' }), h)
  assert.doesNotMatch(h, /00112345678/)
})

test('sin pepper decente o sin número de documento no se calcula nada', () => {
  const doc = { tipoDocumento: 'cedula', numeroDocumento: '00112345678', pais: 'DO' }
  assert.throws(() => calcularHashDedupe('', doc), /pepper/)
  assert.throws(() => calcularHashDedupe('corto', doc), /pepper/)
  assert.throws(() => calcularHashDedupe('a'.repeat(40), { ...doc, numeroDocumento: '---' }), /vacío/)
})
