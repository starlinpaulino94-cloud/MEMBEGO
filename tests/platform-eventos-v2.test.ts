import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'
import { eventosDeSincronizacion } from '../src/modules/plataforma/proyecciones'
import {
  TIPO_INTERNO,
  TIPO_V2,
  VERSION_SOBRE,
  catalogoV2,
  clavesLegado,
  construirSobre,
  cuerpoDelSobre,
  eventosDeProyeccionSinEmisor,
  tipoV2,
} from '../src/modules/plataforma/eventos'
import {
  VENTANA_REPLAY_SEGUNDOS,
  clavePrivadaDesde,
  clavePublicaPem,
  firmaEd25519Valida,
  firmarEd25519,
  materialFirmado,
} from '../src/modules/plataforma/firma'
import { EN_CURSO, decidirClave, huellaDe } from '../src/modules/plataforma/idempotencia-nucleo'

/**
 * EVENTOS v2 (Fase 3): sobre, firma asimétrica e idempotencia.
 *
 * Todo lo que decide si un evento es auténtico, y si una escritura repetida
 * vuelve a ejecutarse, es puro y está aquí.
 */

const FILA = {
  id: 'evt_1',
  tipo: 'cliente.visita',
  companyId: 'emp_1',
  payload: { clienteId: 'cli_1', servicio: 'Lavado' },
  createdAt: new Date('2026-08-10T15:00:00.000Z'),
  traceId: 'trace_abc',
}

// ── El sobre ────────────────────────────────────────────────────────────────

test('el sobre lleva lo que el formato anterior no tenía', () => {
  const s = construirSobre(FILA)
  assert.equal(s.eventId, 'evt_1')
  assert.equal(s.eventType, 'visit.completed')
  assert.equal(s.version, VERSION_SOBRE)
  assert.equal(s.source, 'membego')
  assert.equal(s.traceId, 'trace_abc')
  assert.equal(s.customerId, 'cli_1')
})

test('`occurredAt` es cuándo ocurrió, no cuándo se envía', () => {
  // Un evento reintentado tres días después sigue diciendo su hora. Un satélite
  // que ordene su historia por esta fecha lo coloca donde va, no al final.
  const s = construirSobre(FILA)
  assert.equal(s.occurredAt, '2026-08-10T15:00:00.000Z')
})

test('sin traceId, el evento es su propio hilo', () => {
  // Las filas anteriores a la Fase 3 no lo tienen. Dejar el campo vacío
  // obligaría a cada satélite a ramificar; un hilo de uno es un hilo válido.
  const s = construirSobre({ ...FILA, traceId: null })
  assert.equal(s.traceId, 'evt_1')
})

/**
 * LA PRUEBA QUE PROTEGE PRODUCCIÓN.
 *
 * Car Wash está vivo y lee `tipo`, `payload`, `id` y `emitidoEn`. Si el cuerpo
 * pasara a ser solo el sobre v2, dejaría de reconocer sus eventos el minuto del
 * despliegue. Eso no es una regresión: es una parada.
 */
test('el cuerpo enviado sigue teniendo las claves del formato anterior', () => {
  const cuerpo = JSON.parse(cuerpoDelSobre(construirSobre(FILA))) as Record<string, unknown>

  assert.equal(cuerpo.id, 'evt_1')
  assert.equal(cuerpo.tipo, 'cliente.visita', 'el satélite de hoy compara con el nombre viejo')
  assert.deepEqual(cuerpo.payload, FILA.payload)
  assert.equal(cuerpo.emitidoEn, '2026-08-10T15:00:00.000Z')

  // Y las nuevas, para el que ya migró.
  assert.equal(cuerpo.eventType, 'visit.completed')
  assert.equal(cuerpo.legacyType, 'cliente.visita')
})

test('las claves de legado son duplicados, no datos distintos', () => {
  // Un satélite no puede leer dos verdades. Si `payload` y `data` divergieran,
  // dos integraciones del mismo evento harían cosas distintas.
  const s = construirSobre(FILA)
  const l = clavesLegado(s)
  assert.equal(l.id, s.eventId)
  assert.deepEqual(l.payload, s.data)
  assert.equal(l.emitidoEn, s.occurredAt)
  assert.equal(l.tipo, s.legacyType)
})

test('todo evento del bus tiene nombre v2 en forma `recurso.accion`', () => {
  for (const interno of EVENTOS_REENVIADOS) {
    const v2 = tipoV2(interno)
    assert.notEqual(v2, interno, `"${interno}" no se renombró`)
    assert.match(v2, /^[a-z]+\.[a-z_]+$/, `"${v2}" no tiene forma de identificador de protocolo`)
  }
})

test('el mapa de nombres es biyectivo', () => {
  // Dos eventos internos con el mismo nombre v2 harían indistinguibles dos
  // cosas distintas en el satélite.
  assert.equal(Object.keys(TIPO_INTERNO).length, Object.keys(TIPO_V2).length)
  for (const [interno, v2] of Object.entries(TIPO_V2)) {
    assert.equal(TIPO_INTERNO[v2], interno)
  }
})

test('un tipo desconocido pasa tal cual en vez de perderse', () => {
  // La sonda del panel manda `membego.ping`, que no está en el catálogo. Si el
  // mapeo lo convirtiera en undefined, la prueba del webhook enviaría un evento
  // sin tipo.
  assert.equal(tipoV2('membego.ping'), 'membego.ping')
})

/**
 * Une la Fase 1a con esta: el contrato de proyección declara qué eventos
 * necesita un satélite para mantener sus copias al día. Los que el bus todavía
 * no emite se listan a propósito — que salgan aquí es la manera de que sea una
 * decisión visible y no una sorpresa a los tres meses.
 */
test('los eventos de proyección sin emisor están identificados', () => {
  const huerfanos = eventosDeProyeccionSinEmisor()
  const emitidos = catalogoV2()

  // Los que SÍ se emiten tienen que coincidir con el contrato al carácter.
  for (const e of eventosDeSincronizacion()) {
    assert.ok(
      emitidos.includes(e) || huerfanos.includes(e),
      `"${e}" no está ni emitido ni declarado como pendiente`
    )
  }
  // Estos dos son los que el contrato exige Y el bus ya emite.
  assert.ok(emitidos.includes('customer.created'))
  assert.ok(emitidos.includes('membership.activated'))
  // Y estos, los que faltan. Si algún día se emiten, la lista se vacía sola.
  assert.ok(huerfanos.includes('company.updated'))
})

// ── Firma Ed25519 ───────────────────────────────────────────────────────────

const { privateKey } = generateKeyPairSync('ed25519')
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const CLAVE = clavePrivadaDesde(PRIV_PEM)
const PUB_PEM = clavePublicaPem(CLAVE)!

test('una firma legítima verifica', () => {
  const ts = 1_000_000
  const cuerpo = cuerpoDelSobre(construirSobre(FILA))
  const firma = firmarEd25519(CLAVE, ts, 'evt_1', cuerpo)!
  assert.ok(firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo, firma, ts))
})

test('la clave privada no sale al publicar la pública', () => {
  assert.ok(PUB_PEM.includes('BEGIN PUBLIC KEY'))
  assert.ok(!PUB_PEM.includes('PRIVATE'))
})

/**
 * LA PRUEBA QUE JUSTIFICA EL CAMBIO DE ALGORITMO.
 *
 * Con el HMAC compartido, quien puede verificar puede firmar: cada satélite
 * guarda el mismo secreto. Con Ed25519, tener la pública no permite fabricar
 * nada — y eso es lo único que cambia, pero lo cambia todo cuando hay cientos
 * de sistemas guardando copias.
 */
test('con la clave pública NO se puede firmar', () => {
  const ts = 1_000_000
  const cuerpo = 'lo que sea'
  // Un impostor con la pública solo puede probar bytes al azar.
  const inventada = Buffer.alloc(64, 7).toString('base64')
  assert.equal(firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo, inventada, ts), false)
})

test('cambiar el cuerpo invalida la firma', () => {
  const ts = 1_000_000
  const cuerpo = cuerpoDelSobre(construirSobre(FILA))
  const firma = firmarEd25519(CLAVE, ts, 'evt_1', cuerpo)!
  assert.equal(firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo + ' ', firma, ts), false)
})

test('el timestamp y el eventId están DENTRO de lo firmado', () => {
  // Si viajaran fuera, cualquiera que capturara un webhook podría reenviarlo
  // mañana con una hora nueva y la ventana anti-replay no serviría de nada.
  const cuerpo = 'x'
  const firma = firmarEd25519(CLAVE, 1_000_000, 'evt_1', cuerpo)!
  assert.equal(firmaEd25519Valida(PUB_PEM, 1_000_001, 'evt_1', cuerpo, firma, 1_000_001), false)
  assert.equal(firmaEd25519Valida(PUB_PEM, 1_000_000, 'evt_2', cuerpo, firma, 1_000_000), false)
  assert.match(materialFirmado(7, 'e', 'c'), /^7\.e\.c$/)
})

test('fuera de la ventana no vale ni con la firma correcta', () => {
  const ts = 1_000_000
  const cuerpo = 'x'
  const firma = firmarEd25519(CLAVE, ts, 'evt_1', cuerpo)!
  const justo = ts + VENTANA_REPLAY_SEGUNDOS
  assert.ok(firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo, firma, justo))
  assert.equal(firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo, firma, justo + 1), false)
  // También hacia atrás: un reloj adelantado no es una excusa para aceptar.
  assert.equal(
    firmaEd25519Valida(PUB_PEM, ts, 'evt_1', cuerpo, firma, ts - VENTANA_REPLAY_SEGUNDOS - 1),
    false
  )
})

test('sin clave configurada NO se firma, y no se rompe', () => {
  // Es el estado por defecto: los eventos siguen saliendo con el HMAC de
  // siempre. Fallar aquí dejaría de entregar webhooks a satélites que nunca
  // pidieron la firma nueva.
  assert.equal(clavePrivadaDesde(undefined), null)
  assert.equal(clavePrivadaDesde(''), null)
  assert.equal(firmarEd25519(null, 1, 'e', 'c'), null)
  assert.equal(clavePublicaPem(null), null)
})

test('una clave que no es Ed25519 se rechaza en vez de usarse', () => {
  const { privateKey: rsa } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = rsa.export({ type: 'pkcs8', format: 'pem' }).toString()
  assert.equal(clavePrivadaDesde(pem), null, 'solo Ed25519')
  assert.equal(clavePrivadaDesde('esto no es una clave'), null)
})

test('la clave se acepta en base64, que es como sobrevive a un panel', () => {
  // Un PEM tiene saltos de línea y muchos paneles de despliegue los convierten
  // en literales `\n`. Sin esto, la clave «está puesta» y no funciona.
  const b64 = Buffer.from(PRIV_PEM, 'utf8').toString('base64')
  assert.ok(clavePrivadaDesde(b64))
  assert.ok(clavePrivadaDesde(PRIV_PEM.replace(/\n/g, '\\n')))
})

// ── Idempotencia ────────────────────────────────────────────────────────────

test('la huella distingue un reintento de otra operación', () => {
  const a = JSON.stringify({ customerId: 'c1', benefitId: 'b1' })
  const b = JSON.stringify({ customerId: 'c1', benefitId: 'b2' })
  assert.equal(huellaDe(a), huellaDe(a))
  assert.notEqual(huellaDe(a), huellaDe(b))
  assert.match(huellaDe(a), /^[0-9a-f]{64}$/)
})

test('mismo cuerpo y mismo endpoint = reintento: se devuelve lo guardado', () => {
  const h = huellaDe('{"a":1}')
  assert.equal(decidirClave({ endpoint: '/redemptions', huellaPeticion: h, estadoHttp: 200 }, '/redemptions', h), 'REPETIDA')
})

/**
 * LA QUE IMPORTA. Aceptar una clave reutilizada en silencio devolvería la
 * respuesta de OTRA operación como si fuera la de esta: un canje que nunca
 * ocurrió, contestado con un «hecho». Es un fallo que se lee como un acierto.
 */
test('misma clave con otro cuerpo NO es un reintento', () => {
  const previa = { endpoint: '/redemptions', huellaPeticion: huellaDe('{"a":1}'), estadoHttp: 200 }
  assert.equal(decidirClave(previa, '/redemptions', huellaDe('{"a":2}')), 'REUSADA')
})

test('la misma clave en otra ruta tampoco es un reintento', () => {
  // Dos operaciones distintas con la misma clave son dos operaciones, no una.
  const h = huellaDe('{"a":1}')
  assert.equal(decidirClave({ endpoint: '/visits', huellaPeticion: h, estadoHttp: 200 }, '/redemptions', h), 'REUSADA')
})

test('mientras la primera trabaja, la segunda espera en vez de ejecutar', () => {
  const h = huellaDe('{"a":1}')
  assert.equal(
    decidirClave({ endpoint: '/redemptions', huellaPeticion: h, estadoHttp: EN_CURSO }, '/redemptions', h),
    'EN_CURSO'
  )
})

// ── Guardias ────────────────────────────────────────────────────────────────

test('el despacho ya no escribe el estado terminal viejo', () => {
  // `FALLIDO` sobrevive solo donde se LEE (el panel cuenta los dos nombres
  // mientras haya filas antiguas). Escribirlo otra vez partiría la cola en dos
  // estados que significan lo mismo.
  const src = readFileSync(join('src', 'modules', 'integraciones', 'despacho.ts'), 'utf8')
  assert.ok(!/estado:\s*'FALLIDO'/.test(src), 'el despacho no puede volver a escribir FALLIDO')
  assert.ok(src.includes("const DESCARTADO = 'DEAD_LETTER'"))
})

test('el panel cuenta los dos nombres del estado terminal', () => {
  // Contar solo el nuevo haría desaparecer de la vista media cola el día del
  // despliegue, justo cuando alguien está mirando por qué no salen los eventos.
  const src = readFileSync(join('src', 'modules', 'integraciones', 'panel.ts'), 'utf8')
  assert.match(src, /cuenta\('DEAD_LETTER'\)\s*\+\s*cuenta\('FALLIDO'\)/)
  assert.match(src, /in:\s*\['DEAD_LETTER',\s*'FALLIDO'\]/)
})

test('la migración renombra el estado terminal y lo acota', () => {
  const sql = readFileSync(
    join('prisma', 'migrations', '20260805_eventos_v2_idempotencia', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /UPDATE "eventos_salientes" SET "estado" = 'DEAD_LETTER' WHERE "estado" = 'FALLIDO'/)
  assert.match(sql, /CHECK \("estado" IN \('PENDIENTE','ENVIADO','DEAD_LETTER'\)\)/)
  // El backfill ANTES del CHECK, o la propia migración se lo encuentra a medias.
  assert.ok(
    sql.indexOf("SET \"estado\" = 'DEAD_LETTER'") < sql.indexOf('eventos_salientes_estado_valido'),
    'el backfill tiene que ir antes del CHECK'
  )
})

test('la clave de idempotencia es única POR SISTEMA, no global', () => {
  // Global, dos satélites con la clave «1» se pisarían — y uno leería la
  // respuesta guardada del otro, que contiene datos de otra empresa.
  const sql = readFileSync(
    join('prisma', 'migrations', '20260805_eventos_v2_idempotencia', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /UNIQUE INDEX[\s\S]*?ON "claves_idempotencia"\("sistemaId","clave"\)/)
  // Y no un único global sobre `clave`, que es el error fácil de cometer.
  assert.ok(!/UNIQUE INDEX[^\n]*ON "claves_idempotencia"\("clave"\)/.test(sql))
})

test('evaluar beneficios no escribe nada', () => {
  // Es un POST porque lleva contexto y su respuesta no se puede cachear, pero
  // no consume: si algún día alguien le mete un update, esta prueba lo para.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'benefits', 'evaluate', 'route.ts'),
    'utf8'
  )
  for (const escritura of ['.update(', '.create(', '.delete(', '.updateMany(', '.upsert(']) {
    assert.ok(!src.includes(escritura), `evaluate no puede llamar a ${escritura}`)
  }
  assert.ok(src.includes('reserved: false'), 'la respuesta debe decir que no reserva nada')
})

test('la evaluación usa el motor de canje que ya existe', () => {
  // Reimplementar las reglas aquí garantizaría que el mostrador y el satélite
  // den respuestas distintas sobre el mismo cliente, y que nadie sepa cuál vale.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'benefits', 'evaluate', 'route.ts'),
    'utf8'
  )
  assert.ok(src.includes('validarConsumoCompra'))
  assert.ok(src.includes('zonaHoraria'), 'los días y horas se evalúan en la hora del negocio')
})
