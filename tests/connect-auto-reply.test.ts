/**
 * Auto-reply de mensajería — pruebas unitarias de `buscarAutoReply`,
 * `buscarBienvenida`, `resolverUrlCatalogo` y del orquestador
 * `responderAutoReply` (portado a `src/modules/mensajeria/autoReply.ts`).
 *
 * Mockea `server-only` (módulo virtual de Next.js), `conEmpresa` (wrapper de
 * Prisma con RLS) y el conector `@/modules/connect/whatsapp` (lado de envío)
 * para aislar la lógica de keyword matching, bienvenida, catálogo y el orden
 * de respuesta. El envío real pasa por `mensajeria/salientes.ts` y se captura
 * al llegar al conector (donde `registro.origen === 'auto-reply'`).
 *
 * Ejecutar: npm test tests/connect-auto-reply.test.ts
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Mocks (se registran ANTES de importar el motor) ─────────────────────────

/**
 * Sustituye un módulo por un doble, metiéndolo en la caché de `require`.
 *
 * El `__esModule: true` no es adorno. La cadena real llega al conector por
 * `await import('@/modules/connect/whatsapp')`, y un `import()` dinámico de un
 * módulo CommonJS solo expone nombres sueltos si el objeto lleva esa marca;
 * sin ella el doble entra como `{ default: {...} }` y `enviarWhatsapp` queda
 * `undefined` —la prueba no falla por lo que vigila, falla por el atajo—.
 */
function mockModule(modulePath: string, mockExports: Record<string, unknown>) {
  const resolvedPath = require.resolve(modulePath)
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: { __esModule: true, ...mockExports },
    parent: null,
    children: [],
  } as unknown as NodeJS.Module
}

/** Envíos capturados al llegar al conector (mock de @/modules/connect/whatsapp). */
interface EnvioCapturado {
  companyId: string
  telefono: string
  texto: string
  origen: string | null
}

/** La tx mockeada: un doble de Prisma, no un PrismaClient. */
type TxMock = Record<string, unknown>

interface EntradaEnvio {
  companyId: string
  telefono: string
  texto: string
  registro?: { origen?: string }
}
interface ResultadoEnvio {
  ok: boolean
  mensajeId?: string
  motivo?: string
  detalle?: string
}

let envios: EnvioCapturado[] = []
let dbActual: TxMock
let conEmpresaErrorOnce: Error | null = null
let enviarWhatsappOverrideOnce: ((input: EntradaEnvio) => Promise<ResultadoEnvio>) | null = null

const mockEnviarWhatsapp = async (input: {
  companyId: string
  telefono: string
  texto: string
  registro?: { origen?: string }
}): Promise<{ ok: boolean; mensajeId?: string; motivo?: string; detalle?: string }> => {
  if (enviarWhatsappOverrideOnce) {
    const fn = enviarWhatsappOverrideOnce
    enviarWhatsappOverrideOnce = null
    return fn(input)
  }
  envios.push({
    companyId: input.companyId,
    telefono: input.telefono,
    texto: input.texto,
    origen: input.registro?.origen ?? null,
  })
  return { ok: true, mensajeId: 'wamid.mock.' + envios.length }
}

// El tenant se mockea completo: todos los nombres que usa la cadena real
// (`conEmpresa`, `sinEmpresa`, ...) para que los import estáticos resuelvan.
const mockConEmpresa = async (_companyId: string, fn: (tx: TxMock) => unknown): Promise<unknown> => {
  if (conEmpresaErrorOnce) {
    const err = conEmpresaErrorOnce
    conEmpresaErrorOnce = null
    throw err
  }
  return fn(dbActual)
}

mockModule('@/lib/tenant', {
  conEmpresa: mockConEmpresa,
  sinEmpresa: async (_motivo: string, fn: (tx: TxMock) => Promise<unknown>) => fn({}),
  conEmpresaOTodas: async (
    _companyId: string | null,
    _motivo: string,
    fn: (tx: TxMock) => Promise<unknown>
  ) => fn({}),
  conUsuario: async (_userId: string, fn: (tx: TxMock) => Promise<unknown>) => fn({}),
})

mockModule('server-only', {})

mockModule('@/modules/connect/whatsapp', {
  enviarWhatsapp: mockEnviarWhatsapp,
  enviarCuerpoWhatsapp: mockEnviarWhatsapp,
})

// Import DESPUÉS de registrar los mocks para que resuelvan correctamente.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  buscarAutoReply,
  buscarBienvenida,
  resolverUrlCatalogo,
  responderAutoReply,
} = require('../src/modules/mensajeria/autoReply')
/* eslint-enable @typescript-eslint/no-require-imports */

// ── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'emp-001'

/** Fila de `AutoReplyConfig` como la devuelve Prisma (campos que lee el motor). */
interface FilaConfig {
  id: string
  nombre: string
  keywords: string[]
  esBienvenida: boolean
  contenido: string
  tipoRespuesta: string
  catalogoPath: string | null
  orden: number
}

function filaConfig(
  overrides: Partial<FilaConfig> = {}
): FilaConfig {
  return {
    id: overrides.id ?? `cfg-${Math.random().toString(36).slice(2, 8)}`,
    nombre: overrides.nombre ?? 'Test config',
    keywords: overrides.keywords ?? [],
    esBienvenida: overrides.esBienvenida ?? false,
    contenido: overrides.contenido ?? 'Hola, ¿en qué te ayudo?',
    tipoRespuesta: overrides.tipoRespuesta ?? 'TEXTO',
    catalogoPath: overrides.catalogoPath ?? null,
    orden: overrides.orden ?? 0,
  }
}

interface DbOpciones {
  /** Pool de configs para `findMany` general (buscarAutoReply), orden asc. */
  configs?: FilaConfig[]
  /** Pool de configs CATALOGO (`where.tipoRespuesta === 'CATALOGO'`). */
  catalogos?: Array<{ catalogoPath: string | null }>
  /** Resultado de `findFirst` (buscarBienvenida). */
  bienvenida?: FilaConfig | null
  empresa?: { name: string; slug: string } | null
  conversacion?: {
    id: string
    canal: string
    ultimoEntranteAt: Date | null
    contacto: { idExterno: string }
  } | null
}

/**
 * Tx mockeada con las consultas que hace la cadena real:
 * autoReply (findMany/findFirst sobre `autoReplyConfig`, `company`) y
 * salientes (`conversacion.findFirst` para resolver la ventana de 24 h).
 */
function conDb(opts: DbOpciones = {}) {
  return {
    autoReplyConfig: {
      findMany: async (args?: { where?: { tipoRespuesta?: string } }) => {
        if (args?.where?.tipoRespuesta === 'CATALOGO') return opts.catalogos ?? []
        return [...(opts.configs ?? [])].sort((a, b) => a.orden - b.orden)
      },
      findFirst: async () => opts.bienvenida ?? null,
    },
    company: {
      findUnique: async () =>
        opts.empresa ?? { name: 'Test Co', slug: 'test-co' },
    },
    conversacion: {
      findFirst: async () =>
        opts.conversacion ?? {
          id: 'conv-1',
          canal: 'WHATSAPP',
          ultimoEntranteAt: new Date(),
          contacto: { idExterno: '+18095551234' },
        },
    },
  }
}

/** Corre `fn` con NEXT_PUBLIC_APP_URL fijo y restaura el env al terminar. */
async function conBaseUrl(base: string, fn: () => Promise<void>) {
  const previo = process.env.NEXT_PUBLIC_APP_URL
  process.env.NEXT_PUBLIC_APP_URL = base
  try {
    await fn()
  } finally {
    if (previo === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = previo
  }
}

beforeEach(() => {
  dbActual = conDb()
  envios = []
  conEmpresaErrorOnce = null
  enviarWhatsappOverrideOnce = null
})

// ── Tests: buscarAutoReply ───────────────────────────────────────────────────

test('buscarAutoReply: match por keyword exacto', async () => {
  dbActual = conDb({
    configs: [filaConfig({ keywords: ['reservar', 'cita'], nombre: 'Reservas' })],
  })

  const result = await buscarAutoReply(COMPANY_ID, 'Quiero reservar una cita')

  assert.ok(result, 'debería encontrar un match')
  assert.equal(result!.config.nombre, 'Reservas')
})

test('buscarAutoReply: match case-insensitive con normalización NFD', async () => {
  dbActual = conDb({
    configs: [filaConfig({ keywords: ['reservar'], nombre: 'Reservas' })],
  })

  const result = await buscarAutoReply(COMPANY_ID, 'Quiero RESERVAR una mesa')

  assert.ok(result, 'debería matchear con mayúsculas y NFD')
  assert.equal(result!.config.nombre, 'Reservas')
})

test('buscarAutoReply: match con acentos en el texto', async () => {
  dbActual = conDb({
    configs: [filaConfig({ keywords: ['niño'], nombre: 'Niños' })],
  })

  const result = await buscarAutoReply(COMPANY_ID, 'Busco información sobre niños')

  assert.ok(result, 'debería matchear con acentos en el texto')
  assert.equal(result!.config.nombre, 'Niños')
})

test('buscarAutoReply: sin match retorna null', async () => {
  dbActual = conDb({
    configs: [
      filaConfig({ keywords: ['reservar', 'cita'], nombre: 'Reservas' }),
      filaConfig({ keywords: ['horario', 'abierto'], nombre: 'Horarios', orden: 1 }),
    ],
  })

  const result = await buscarAutoReply(COMPANY_ID, '¿Cuánto cuesta el servicio?')

  assert.equal(result, null, 'no debería matchear con keywords no relacionadas')
})

test('buscarAutoReply: múltiples configs → retorna la de mayor prioridad (menor orden)', async () => {
  dbActual = conDb({
    configs: [
      filaConfig({ keywords: ['ayuda'], nombre: 'Soporte', orden: 10 }),
      filaConfig({ keywords: ['ayuda'], nombre: 'Bienvenida urgente', orden: 1 }),
      filaConfig({ keywords: ['ayuda'], nombre: 'FAQ genérico', orden: 5 }),
    ],
  })

  const result = await buscarAutoReply(COMPANY_ID, 'Necesito ayuda')

  assert.ok(result, 'debería encontrar un match')
  assert.equal(result!.config.nombre, 'Bienvenida urgente', 'debería retornar la de menor orden')
})

test('buscarAutoReply: skip configs con esBienvenida=true', async () => {
  dbActual = conDb({
    configs: [
      filaConfig({ keywords: ['hola'], nombre: 'Saludo', esBienvenida: true, orden: 0 }),
      filaConfig({ keywords: ['hola'], nombre: 'Hola normal', orden: 1 }),
    ],
  })

  const result = await buscarAutoReply(COMPANY_ID, 'Hola!')

  assert.ok(result, 'debería encontrar match')
  assert.equal(result!.config.nombre, 'Hola normal', 'debería saltarse la de esBienvenida')
})

test('buscarAutoReply: skip configs con keywords vacías', async () => {
  dbActual = conDb({
    configs: [
      filaConfig({ keywords: [], nombre: 'Sin keywords', orden: 0 }),
      filaConfig({ keywords: ['oferta'], nombre: 'Ofertas', orden: 1 }),
    ],
  })

  const result = await buscarAutoReply(COMPANY_ID, '¿Hay ofertas?')

  assert.ok(result, 'debería encontrar match')
  assert.equal(result!.config.nombre, 'Ofertas')
})

test('buscarAutoReply: companyId vacío retorna null', async () => {
  const result = await buscarAutoReply('', 'hola')
  assert.equal(result, null)
})

test('buscarAutoReply: texto vacío retorna null', async () => {
  const result = await buscarAutoReply(COMPANY_ID, '')
  assert.equal(result, null)
})

test('buscarAutoReply: sin configs activas retorna null', async () => {
  dbActual = conDb({ configs: [] })

  const result = await buscarAutoReply(COMPANY_ID, 'hola')
  assert.equal(result, null)
})

test('buscarAutoReply: error en DB retorna null (fire-and-safe)', async () => {
  conEmpresaErrorOnce = new Error('DB connection lost')

  const result = await buscarAutoReply(COMPANY_ID, 'hola')
  assert.equal(result, null, 'no debería lanzar, retorna null')
})

// ── Tests: buscarBienvenida ──────────────────────────────────────────────────

test('buscarBienvenida: devuelve la config esBienvenida activa', async () => {
  dbActual = conDb({
    bienvenida: filaConfig({ nombre: 'Bienvenida', esBienvenida: true, orden: 0 }),
  })

  const resultado = await buscarBienvenida(COMPANY_ID)

  assert.ok(resultado)
  assert.equal(resultado!.config.nombre, 'Bienvenida')
  assert.equal(resultado!.config.tipoRespuesta, 'TEXTO')
})

test('buscarBienvenida: sin config activa devuelve null', async () => {
  dbActual = conDb({ bienvenida: null })

  const resultado = await buscarBienvenida(COMPANY_ID)

  assert.equal(resultado, null)
})

test('buscarBienvenida: companyId vacío retorna null', async () => {
  const resultado = await buscarBienvenida('')
  assert.equal(resultado, null)
})

// ── Tests: resolverUrlCatalogo ───────────────────────────────────────────────

test('resolverUrlCatalogo: devuelve la URL de la config CATALOGO activa', async () => {
  dbActual = conDb({
    catalogos: [{ catalogoPath: 'https://membego.com/tonis/catalogo' }],
  })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, 'https://membego.com/tonis/catalogo')
})

test('resolverUrlCatalogo: catalogoPath relativo se resuelve contra NEXT_PUBLIC_APP_URL', async () => {
  dbActual = conDb({ catalogos: [{ catalogoPath: '/excursiones' }] })

  await conBaseUrl('https://app.membego.com', async () => {
    const resultado = await resolverUrlCatalogo(COMPANY_ID)
    assert.equal(resultado, 'https://app.membego.com/excursiones')
  })
})

test('resolverUrlCatalogo: salta configs con catalogoPath vacío y usa la primera con URL', async () => {
  dbActual = conDb({
    catalogos: [
      { catalogoPath: null },
      { catalogoPath: '   ' },
      { catalogoPath: 'https://membego.com/cartown/catalogo' },
    ],
  })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, 'https://membego.com/cartown/catalogo')
})

test('resolverUrlCatalogo: sin config CATALOGO devuelve null', async () => {
  dbActual = conDb({ catalogos: [] })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, null)
})

// ── Tests: responderAutoReply (orquestación + envío) ────────────────────────

const CONFIG_TEXTO = filaConfig({
  id: 'cfg-txt',
  nombre: 'Horarios',
  contenido: 'Atendemos de 9 a 6, {nombre_empresa}.',
})

const CONFIG_CATALOGO = filaConfig({
  id: 'cfg-cat',
  nombre: 'Catálogo Excursiones',
  contenido: 'Mira nuestro catálogo de excursiones',
  tipoRespuesta: 'CATALOGO',
  catalogoPath: 'https://membego.com/cartown/catalogo',
})

const TELEFONO = '+18095551234'
const CONVERSACION_ID = 'conv-1'

test('responderAutoReply: keyword matcheado envía el contenido con variables resueltas y origen auto-reply', async () => {
  dbActual = conDb({
    configs: [filaConfig({ ...CONFIG_TEXTO, keywords: ['horario'] })],
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: '¿Cuál es su horario?',
    telefono: TELEFONO,
    esNueva: false,
  })

  assert.equal(envios.length, 1, 'debería enviar una sola vez')
  assert.equal(envios[0]!.texto, 'Atendemos de 9 a 6, Test Co.', 'debería resolver {nombre_empresa}')
  assert.equal(envios[0]!.origen, 'auto-reply', 'el envío debe marcarse como auto-reply')
  assert.equal(envios[0]!.companyId, COMPANY_ID)
  assert.equal(envios[0]!.telefono, TELEFONO)
})

test('responderAutoReply: keyword CATALOGO con catalogoPath absoluto anexa la URL', async () => {
  dbActual = conDb({
    configs: [filaConfig({ ...CONFIG_CATALOGO, keywords: ['catalogo'] })],
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'Quiero ver el catalogo de excursiones',
    telefono: TELEFONO,
    esNueva: false,
  })

  assert.equal(envios.length, 1)
  assert.equal(
    envios[0]!.texto,
    `${CONFIG_CATALOGO.contenido}\n${CONFIG_CATALOGO.catalogoPath}`,
    'debería anexar la URL absoluta del catálogo'
  )
})

test('responderAutoReply: keyword CATALOGO con path relativo resuelve contra NEXT_PUBLIC_APP_URL', async () => {
  dbActual = conDb({
    configs: [
      filaConfig({
        ...CONFIG_CATALOGO,
        catalogoPath: '/excursiones',
        keywords: ['catalogo'],
      }),
    ],
  })

  await conBaseUrl('https://app.membego.com', async () => {
    await responderAutoReply({
      companyId: COMPANY_ID,
      conversacionId: CONVERSACION_ID,
      texto: 'Quiero ver el catalogo de excursiones',
      telefono: TELEFONO,
      esNueva: false,
    })

    assert.equal(envios.length, 1)
    assert.equal(envios[0]!.texto, `${CONFIG_CATALOGO.contenido}\nhttps://app.membego.com/excursiones`)
  })
})

test('responderAutoReply: en primer mensaje el keyword vence a la bienvenida', async () => {
  dbActual = conDb({
    configs: [filaConfig({ ...CONFIG_TEXTO, keywords: ['reservar'] })],
    bienvenida: filaConfig({
      nombre: 'Bienvenida',
      contenido: '¡Bienvenido a {nombre_empresa}!',
      esBienvenida: true,
    }),
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'quiero reservar una mesa',
    telefono: TELEFONO,
    esNueva: true,
  })

  assert.equal(envios.length, 1, 'un solo envío')
  assert.equal(envios[0]!.texto, 'Atendemos de 9 a 6, Test Co.', 'debería ganar el contenido del keyword')
})

test('responderAutoReply: bienvenida solo en el primer mensaje (esNueva=true)', async () => {
  dbActual = conDb({
    bienvenida: filaConfig({
      nombre: 'Bienvenida',
      contenido: '¡Bienvenido a {nombre_empresa}! Cuéntanos cómo ayudarte.',
      esBienvenida: true,
    }),
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'Hola, soy nuevo',
    telefono: TELEFONO,
    esNueva: true,
  })

  assert.equal(envios.length, 1)
  assert.equal(
    envios[0]!.texto,
    '¡Bienvenido a Test Co! Cuéntanos cómo ayudarte.',
    'debería enviar la bienvenida con {nombre_empresa} resuelto'
  )
})

test('responderAutoReply: sin keyword y sin esNueva no se envía bienvenida', async () => {
  dbActual = conDb({
    configs: [filaConfig({ keywords: ['reservar'], nombre: 'Reservas' })],
    bienvenida: filaConfig({
      nombre: 'Bienvenida',
      contenido: '¡Bienvenido a {nombre_empresa}!',
      esBienvenida: true,
    }),
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'Hola, soy nuevo',
    telefono: TELEFONO,
    esNueva: false,
  })

  assert.equal(envios.length, 0, 'la bienvenida es solo para el primer contacto')
})

test('responderAutoReply: intención de excursiones sin config CATALOGO usa el slug de la empresa', async () => {
  dbActual = conDb({
    empresa: { name: 'Cartown', slug: 'cartown' },
    catalogos: [],
  })

  await conBaseUrl('http://localhost:3000', async () => {
    await responderAutoReply({
      companyId: COMPANY_ID,
      conversacionId: CONVERSACION_ID,
      texto: 'Quiero ver las excursiones disponibles',
      telefono: TELEFONO,
      esNueva: false,
    })

    assert.equal(envios.length, 1, 'debería enviar el catálogo de respaldo')
    assert.match(
      envios[0]!.texto,
      /http:\/\/localhost:3000\/empresas\/cartown\/excursiones/,
      'debería armar la URL de catálogo con el slug de la empresa'
    )
  })
})

test('responderAutoReply: intención de excursiones usa la URL de la config CATALOGO cuando existe', async () => {
  dbActual = conDb({
    catalogos: [{ catalogoPath: 'https://membego.com/cartown/catalogo' }],
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'Quiero ver las excursiones disponibles',
    telefono: TELEFONO,
    esNueva: false,
  })

  assert.equal(envios.length, 1)
  assert.match(
    envios[0]!.texto,
    /https:\/\/membego.com\/cartown\/catalogo/,
    'debería usar la URL de la config, no el slug'
  )
})

test('responderAutoReply: sin keyword, sin esNueva y sin intención no envía nada', async () => {
  dbActual = conDb({
    configs: [filaConfig({ keywords: ['reservar'], nombre: 'Reservas' })],
  })

  await responderAutoReply({
    companyId: COMPANY_ID,
    conversacionId: CONVERSACION_ID,
    texto: 'texto aleatorio sin intención',
    telefono: TELEFONO,
    esNueva: false,
  })

  assert.equal(envios.length, 0, 'no debería enviar nada')
})

test('responderAutoReply: error en el envío no se propaga (fire-and-safe)', async () => {
  dbActual = conDb({
    configs: [filaConfig({ ...CONFIG_TEXTO, keywords: ['horario'] })],
  })
  enviarWhatsappOverrideOnce = async () => {
    return { ok: false, motivo: 'proveedor' } as never
  }

  await assert.doesNotReject(async () => {
    await responderAutoReply({
      companyId: COMPANY_ID,
      conversacionId: CONVERSACION_ID,
      texto: '¿Cuál es su horario?',
      telefono: TELEFONO,
      esNueva: false,
    })
  })
})

test('responderAutoReply: texto vacío no lanza y no envía', async () => {
  await assert.doesNotReject(async () => {
    await responderAutoReply({
      companyId: COMPANY_ID,
      conversacionId: CONVERSACION_ID,
      texto: '',
      telefono: TELEFONO,
      esNueva: false,
    })
  })
  assert.equal(envios.length, 0)
})
