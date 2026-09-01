import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCION_ESTADO,
  CLASES_ERROR,
  CLASES_QUE_PIDEN_RECONECTAR,
  CLASES_TRANSITORIAS,
  ESTADOS_INTEGRACION,
  ETIQUETA_ESTADO,
  decidirEstadoIntegracion,
  esClaseError,
  permiteConectar,
  type SenalesIntegracion,
} from '../src/modules/connect/proveedores/tipos'
import {
  PROVEEDORES,
  estaImplementado,
  problemasDelRegistro,
  proveedorDe,
  slugsDisponibles,
} from '../src/modules/connect/proveedores/indice'
import { METADATOS_PREVISTOS, metadatosDe } from '../src/modules/connect/proveedores/metadatos'

/**
 * MEMBEGO CONNECT · Fase 10 (Framework de integraciones).
 *
 * Lo que se prueba de verdad es la REGLA: qué ve una empresa según cinco
 * señales independientes. Lo que no se puede ejecutar sin base de datos se
 * vigila leyendo el fuente, igual que en el resto de la suite.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')

const SENALES: SenalesIntegracion = {
  implementado: true,
  publicado: true,
  configuradoEnDespliegue: true,
  permitidoPorPlan: true,
  conexion: null,
}

// ─── La regla de los cinco factores ──────────────────────────────────────────

test('catálogo: lo no implementado es PRÓXIMAMENTE, digan lo que digan las demás señales', () => {
  // Las otras cuatro en verde y una conexión inventada: sigue sin poder
  // conectarse. Es la garantía de que un logo no puede convertirse en un botón.
  const estado = decidirEstadoIntegracion({
    implementado: false,
    publicado: true,
    configuradoEnDespliegue: true,
    permitidoPorPlan: true,
    conexion: { estado: 'CONNECTED', claseError: null, degradada: false },
  })
  assert.equal(estado, 'PROXIMAMENTE')
  assert.equal(permiteConectar(estado), false)
  assert.equal(ACCION_ESTADO[estado], null)
})

test('catálogo: implementado + configurado + con cupo = DISPONIBLE', () => {
  assert.equal(decidirEstadoIntegracion(SENALES), 'DISPONIBLE')
  assert.ok(permiteConectar('DISPONIBLE'))
})

test('catálogo: sin configuración de despliegue no se ofrece, y sin plan tampoco', () => {
  assert.equal(
    decidirEstadoIntegracion({ ...SENALES, configuradoEnDespliegue: false }),
    'NO_DISPONIBLE'
  )
  assert.equal(decidirEstadoIntegracion({ ...SENALES, permitidoPorPlan: false }), 'SIN_PLAN')
  for (const e of ['NO_DISPONIBLE', 'SIN_PLAN'] as const) {
    assert.equal(permiteConectar(e), false)
    assert.equal(ACCION_ESTADO[e], null)
  }
})

test('catálogo: una conexión VIVA gana a las señales de plataforma y de plan', () => {
  // Si retirar un permiso del plan escondiera una conexión ya hecha, la empresa
  // se quedaría con un token vivo que no puede ni ver ni apagar.
  const estado = decidirEstadoIntegracion({
    ...SENALES,
    configuradoEnDespliegue: false,
    permitidoPorPlan: false,
    conexion: { estado: 'CONNECTED', claseError: null, degradada: false },
  })
  assert.equal(estado, 'CONECTADA')
  assert.equal(ACCION_ESTADO[estado], 'Gestionar')
})

test('catálogo: una conexión DESCONECTADA no ocupa sitio — vuelve a ser conectable', () => {
  assert.equal(
    decidirEstadoIntegracion({
      ...SENALES,
      conexion: { estado: 'DISCONNECTED', claseError: null, degradada: false },
    }),
    'DISPONIBLE'
  )
})

test('catálogo: el alta a medias se puede continuar, no se empieza de cero', () => {
  const estado = decidirEstadoIntegracion({
    ...SENALES,
    conexion: { estado: 'PENDING', claseError: null, degradada: false },
  })
  assert.equal(estado, 'ALTA_SIN_TERMINAR')
  assert.equal(ACCION_ESTADO[estado], 'Continuar')
  assert.ok(permiteConectar(estado))
})

test('catálogo: AUTH y PERMISSIONS piden reconectar; el resto de fallos, no', () => {
  const con = (claseError: (typeof CLASES_ERROR)[number]) =>
    decidirEstadoIntegracion({
      ...SENALES,
      conexion: { estado: 'ERROR', claseError, degradada: false },
    })

  assert.equal(con('AUTH'), 'REAUTORIZAR')
  assert.equal(con('PERMISSIONS'), 'REAUTORIZAR')
  assert.equal(ACCION_ESTADO['REAUTORIZAR'], 'Reconectar')

  // Un límite de cuota NO es una cuenta rota: pedir reconectar por un 429 sería
  // mandar a la persona a arreglar algo que no está roto.
  for (const c of ['RATE_LIMIT', 'NETWORK', 'PROVIDER', 'CONFIGURATION', 'UNKNOWN'] as const) {
    assert.equal(con(c), 'CON_PROBLEMAS', `${c} no debería pedir reconectar`)
  }
})

test('catálogo: conectada pero fallando reciente = requiere atención, no error', () => {
  assert.equal(
    decidirEstadoIntegracion({
      ...SENALES,
      conexion: { estado: 'CONNECTED', claseError: null, degradada: true },
    }),
    'REQUIERE_ATENCION'
  )
})

test('vocabulario: todo estado tiene etiqueta humana y decisión de botón', () => {
  for (const e of ESTADOS_INTEGRACION) {
    assert.equal(typeof ETIQUETA_ESTADO[e], 'string', `${e} sin etiqueta`)
    assert.ok(ETIQUETA_ESTADO[e].length > 0, `${e} con etiqueta vacía`)
    // `null` es una decisión válida (no hay botón); `undefined` sería un olvido.
    assert.ok(e in ACCION_ESTADO, `${e} sin decisión de botón`)
  }
})

test('vocabulario: las clases transitorias y las que piden reconectar no se solapan', () => {
  for (const c of CLASES_TRANSITORIAS) {
    assert.ok(
      !CLASES_QUE_PIDEN_RECONECTAR.includes(c),
      `${c} no puede ser transitoria y pedir reconexión a la vez`
    )
  }
  for (const c of [...CLASES_TRANSITORIAS, ...CLASES_QUE_PIDEN_RECONECTAR]) {
    assert.ok(esClaseError(c))
  }
  assert.equal(esClaseError('INVENTADA'), false)
})

// ─── El registro ─────────────────────────────────────────────────────────────

test('registro: sano — metadata e implementación no se han separado', () => {
  assert.deepEqual(problemasDelRegistro(), [])
})

test('registro: lo previsto NO tiene implementación, y por tanto no se conecta', () => {
  assert.ok(METADATOS_PREVISTOS.length >= 11, 'faltan integraciones previstas en el catálogo')
  for (const m of METADATOS_PREVISTOS) {
    assert.equal(estaImplementado(m.slug), false, `${m.slug} está en previstos y tiene código`)
    assert.equal(proveedorDe(m.slug), null)
  }
})

test('registro: Google Calendar no se ofrece sin las variables de su app', () => {
  const previo = process.env.GOOGLE_OAUTH_CLIENT_ID
  const previoSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  delete process.env.GOOGLE_OAUTH_CLIENT_ID
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
  try {
    assert.ok(!slugsDisponibles().includes('google-calendar'))
    // Y dice qué falta, para que se pueda arreglar.
    assert.match(proveedorDe('google-calendar')!.queFalta, /GOOGLE_OAUTH_CLIENT_ID/)
  } finally {
    if (previo) process.env.GOOGLE_OAUTH_CLIENT_ID = previo
    if (previoSecret) process.env.GOOGLE_OAUTH_CLIENT_SECRET = previoSecret
  }
})

test('registro: WhatsApp declara su alta manual como PROVISIONAL', () => {
  // Si alguien quita esta marca, el apaño se convierte en la arquitectura por
  // olvido — y la interfaz deja de avisar de que esto va a cambiar.
  const wa = proveedorDe('whatsapp')
  assert.ok(wa?.autorizacion.provisional, 'WhatsApp perdió la marca de provisional')
  assert.match(wa.autorizacion.provisional.sustituyePor, /Embedded Signup/)
})

test('registro: ninguna marca declara logo verificado sin el archivo comprobado', () => {
  // El flag no es estético: afirma que la licencia se comprobó. Mientras no se
  // haya hecho, tiene que estar en false para todas.
  for (const p of PROVEEDORES) {
    const m = metadatosDe(p.metadatos.slug)!
    assert.equal(
      m.marca.logoVerificado,
      false,
      `${p.metadatos.slug} afirma tener logo verificado; ¿se comprobó su licencia?`
    )
  }
})

// ─── Guardias estructurales ──────────────────────────────────────────────────

test('guardia: crearConexion exige implementación, no solo fila publicada', () => {
  const src = leer('src/modules/connect/registro.ts')
  // Ocultar un botón no prohíbe nada: la comprobación tiene que estar aquí.
  assert.match(src, /const proveedor = proveedorDe\(input\.conectorSlug\)/)
  assert.match(src, /if \(!proveedor \|\| !proveedor\.disponible\(\)\)/)
  // Y una integración adaptada nunca crea fila: su estado vive en otro sitio.
  assert.match(src, /if \(proveedor\.clase === 'ADAPTADA'\) return \{ ok: false/)
})

test('adaptadores: solo leen — ni escriben ni crean conexiones', () => {
  const src = leer('src/modules/connect/proveedores/adaptadores.ts')
  for (const escritura of ['.create(', '.update(', '.upsert(', '.delete(', 'crearConexion']) {
    assert.ok(!src.includes(escritura), `un adaptador estaría escribiendo: ${escritura}`)
  }
})

test('adaptadores: CardNET pide las MISMAS llaves que el subsistema de pagos', () => {
  // Si las dos condiciones se separan, el catálogo diría que se puede cobrar
  // con tarjeta cuando el cobro real no está configurado.
  const pagos = leer('src/lib/payments/cardnet-tokens.ts')
  const proveedor = leer('src/modules/connect/proveedores/cardnet.ts')
  for (const llave of ['CARDNET_TOKENS_PUBLIC_KEY', 'CARDNET_TOKENS_PRIVATE_KEY']) {
    assert.match(pagos, new RegExp(llave))
    assert.match(proveedor, new RegExp(llave))
  }
})

test('catálogo: una sola función ensambla lo que ven todas las pantallas', () => {
  const src = leer('src/modules/connect/catalogo.ts')
  // El detalle NO recalcula: pasa por el mismo ensamblador. Una segunda ruta de
  // cálculo sería una segunda verdad.
  assert.match(src, /const todas = await catalogoDeEmpresa\(companyId\)/)
  const pagina = leer('src/app/(admin)/admin/integraciones/page.tsx')
  assert.match(pagina, /catalogoDeEmpresa\(user\.metadata\.companyId\)/)
})

test('catálogo: DRAFT y RETIRED no se enseñan; SUSPENDED solo si ya está conectada', () => {
  const src = leer('src/modules/connect/catalogo.ts')
  assert.match(src, /if \(estadoFila === 'DRAFT' \|\| estadoFila === 'RETIRED'\) continue/)
  assert.match(src, /if \(estadoFila === 'SUSPENDED' && !tieneConexionViva\) continue/)
})

test('desarrolladores: las herramientas técnicas salieron del catálogo', () => {
  const catalogo = leer('src/app/(admin)/admin/integraciones/page.tsx')
  for (const panel of ['ClavesApiPanel', 'WebhooksPanel', 'GuiaDesarrolladores', 'ActividadConnect']) {
    assert.ok(!catalogo.includes(panel), `${panel} sigue en la pantalla del usuario de negocio`)
  }
  // Pero NO se retiraron: viven enteros en su propia página.
  const devs = leer('src/app/(admin)/admin/integraciones/desarrolladores/page.tsx')
  for (const panel of ['ClavesApiPanel', 'WebhooksPanel', 'GuiaDesarrolladores', 'ActividadConnect']) {
    assert.ok(devs.includes(panel), `${panel} se perdió en la mudanza`)
  }
})

// ─── Migración ───────────────────────────────────────────────────────────────

const MIGRACION = leer('prisma/migrations/20260903_connect_framework/migration.sql')

test('migración: aditiva e idempotente — no borra ni modifica nada', () => {
  assert.match(MIGRACION, /ADD COLUMN IF NOT EXISTS "claseError"/)
  assert.match(MIGRACION, /ON CONFLICT \("slug"\) DO NOTHING/)
  for (const destructivo of ['DROP TABLE', 'DROP COLUMN', 'DELETE FROM', 'TRUNCATE']) {
    assert.ok(!MIGRACION.includes(destructivo), `la migración contiene ${destructivo}`)
  }
  // Un UPDATE cambiaría datos existentes: tampoco.
  assert.ok(!/^\s*UPDATE /m.test(MIGRACION))
})

test('migración: claseError tiene vocabulario cerrado también en la base', () => {
  assert.match(MIGRACION, /conexiones_empresa_clase_error_valida/)
  for (const clase of CLASES_ERROR) {
    assert.ok(MIGRACION.includes(`'${clase}'`), `la base no acepta la clase ${clase}`)
  }
  // NULL vale: una conexión sana no tiene clase de error.
  assert.match(MIGRACION, /"claseError" IS NULL OR/)
})

test('migración: lo previsto nace en DRAFT — el superadmin decide qué se publica', () => {
  for (const slug of METADATOS_PREVISTOS.map((m) => m.slug)) {
    const fila = MIGRACION.split('\n').find((l) => l.includes(`'${slug}'`))
    assert.ok(fila, `falta la siembra de ${slug}`)
    assert.match(fila, /'DRAFT'/, `${slug} no nace en DRAFT`)
  }
})
