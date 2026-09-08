/**
 * Auto-reply engine — pruebas unitarias de `buscarAutoReply` y `esPrimerMensaje`.
 *
 * Mockea `server-only` (módulo virtual de Next.js) y `conEmpresa` (wrapper de
 * Prisma con RLS) para aislar la lógica de keyword matching y detección de
 * primer mensaje.
 *
 * Ejecutar: bun test tests/connect-auto-reply.test.ts
 */

import { test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

// ── Mocks ────────────────────────────────────────────────────────────────────

// `server-only` es un módulo virtual de Next.js que no existe en contexto de
// test. Lo registramos como no-op antes de cualquier import del módulo.
const mockConEmpresa = mock((_companyId: string, fn: Function) => fn({}))

// Captura el texto del último envío para asertar URL/contenido en los tests.
let ultimoEnvioTexto: string | null = null
const mockEnviarWhatsapp = mock(
  async (input: { texto: string }): Promise<unknown> => {
    ultimoEnvioTexto = input.texto
    return { ok: false, motivo: 'sin_conexion' }
  }
)

mock.module('server-only', () => ({}))
mock.module('@/lib/tenant', () => ({ conEmpresa: mockConEmpresa }))
mock.module('@/modules/connect/whatsapp', () => ({
  enviarWhatsapp: mockEnviarWhatsapp,
}))

// Import DESPUÉS de registrar los mocks para que resuelvan correctamente.
import {
  buscarAutoReply,
  buscarBienvenida,
  enviarAutoReply,
  esPrimerMensaje,
  resolverUrlCatalogo,
} from '../src/modules/connect/autoReply'

// ── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'emp-001'

function stubEnviarWhatsappOk(mensajeId = 'wa-msg-1') {
  mockEnviarWhatsapp.mockReset()
  mockEnviarWhatsapp.mockImplementation(async (input: { texto: string }) => {
    ultimoEnvioTexto = input.texto
    return { ok: true, mensajeId }
  })
}

function stubEnviarWhatsappFallo() {
  mockEnviarWhatsapp.mockReset()
  mockEnviarWhatsapp.mockImplementation(
    async (_input: { texto: string }) => {
      ultimoEnvioTexto = null
      return { ok: false, motivo: 'proveedor' }
    }
  )
}

function configAutoReply(overrides: Record<string, unknown> = {}) {
  return {
    id: (overrides.id as string) ?? `cfg-${Math.random().toString(36).slice(2, 8)}`,
    nombre: (overrides.nombre as string) ?? 'Test config',
    keywords: (overrides.keywords as string[]) ?? [],
    esBienvenida: (overrides.esBienvenida as boolean) ?? false,
    contenido: (overrides.contenido as string) ?? 'Hola, ¿en qué te ayudo?',
    tipoRespuesta: (overrides.tipoRespuesta as string) ?? 'TEXTO',
    catalogoPath: (overrides.catalogoPath as string | null) ?? null,
    orden: (overrides.orden as number) ?? 0,
  }
}

type ConfigAutoReply = ReturnType<typeof configAutoReply>

/**
 * Registra el mock de conEmpresa para que retorne la lista de configs dada,
 * ordenada por `orden` asc (como la query real).
 */
function stubConfigs(configs: ConfigAutoReply[]) {
  const ordered = [...configs].sort((a, b) => a.orden - b.orden)
  mockConEmpresa.mockImplementationOnce(async (_companyId: string, fn: Function) => {
    return fn({
      autoReplyConfig: {
        findMany: async () => ordered,
      },
      conversacion: {
        findFirst: async () => null,
      },
    })
  })
}

function stubConversaciones(existe: boolean) {
  mockConEmpresa.mockImplementationOnce(async (_companyId: string, fn: Function) => {
    return fn({
      autoReplyConfig: {
        findMany: async () => [],
      },
      conversacion: {
        findFirst: async () => (existe ? { id: 'conv-1' } : null),
      },
    })
  })
}

/**
 * Mock persistente de conEmpresa: cada llamada recibe el mismo `db`, así se
 * cubren las N llamadas que hace enviarAutoReply (company + mensaje + conversación).
 * Devuelve los registros creados/actualizados para asertarlos.
 */
function stubDbSaliente() {
  const registros: {
    mensajesCreados: Array<Record<string, unknown>>
    conversacionesActualizadas: Array<Record<string, unknown>>
  } = { mensajesCreados: [], conversacionesActualizadas: [] }

  mockConEmpresa.mockImplementation(async (_companyId: string, fn: Function) => {
    return fn({
      company: {
        findUnique: async () => ({ name: 'Test Co', slug: 'test-co' }),
      },
      autoReplyConfig: {
        findMany: async () => [],
        findFirst: async () => null,
      },
      conversacion: {
        findFirst: async () => null,
        update: async (args: { data: Record<string, unknown> }) => {
          registros.conversacionesActualizadas.push(args.data)
          return { id: 'conv-1' }
        },
      },
      mensaje: {
        create: async (args: { data: Record<string, unknown> }) => {
          registros.mensajesCreados.push(args.data)
          return { id: 'msg-1' }
        },
      },
    })
  })

  return registros
}

/** Mock persistente de una sola query (buscarBienvenida / resolverUrlCatalogo). */
function stubQueryUnica(db: Record<string, unknown>) {
  mockConEmpresa.mockImplementation(async (_companyId: string, fn: Function) => {
    return fn(db)
  })
}

// ── Tests: buscarAutoReply ───────────────────────────────────────────────────

beforeEach(() => {
  mockConEmpresa.mockReset()
  mockEnviarWhatsapp.mockReset()
  ultimoEnvioTexto = null
})

test('buscarAutoReply: match por keyword exacto', async () => {
  stubConfigs([
    configAutoReply({ keywords: ['reservar', 'cita'], nombre: 'Reservas' }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, 'Quiero reservar una cita')

  assert.ok(result, 'debería encontrar un match')
  assert.equal(result!.config.nombre, 'Reservas')
})

test('buscarAutoReply: match case-insensitive con normalización NFD', async () => {
  // "Reserva" → normalizado: "reserva" ∋ "reservar" → true (ambos normalizados)
  stubConfigs([
    configAutoReply({ keywords: ['reservar'], nombre: 'Reservas' }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, 'Quiero RESERVAR una mesa')

  assert.ok(result, 'debería matchear con mayúsculas y NFD')
  assert.equal(result!.config.nombre, 'Reservas')
})

test('buscarAutoReply: match con acentos en el texto', async () => {
  // "niño" como keyword cashea con "Niño" en el texto (NFD: "nino" includes "nino")
  stubConfigs([
    configAutoReply({ keywords: ['niño'], nombre: 'Niños' }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, 'Busco información sobre niños')

  assert.ok(result, 'debería matchear con acentos en el texto')
  assert.equal(result!.config.nombre, 'Niños')
})

test('buscarAutoReply: sin match retorna null', async () => {
  stubConfigs([
    configAutoReply({ keywords: ['reservar', 'cita'], nombre: 'Reservas' }),
    configAutoReply({ keywords: ['horario', 'abierto'], nombre: 'Horarios', orden: 1 }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, '¿Cuánto cuesta el servicio?')

  assert.equal(result, null, 'no debería matchear con keywords no relacionadas')
})

test('buscarAutoReply: múltiples configs → retorna la de mayor prioridad (menor orden)', async () => {
  stubConfigs([
    configAutoReply({ keywords: ['ayuda'], nombre: 'Soporte', orden: 10 }),
    configAutoReply({ keywords: ['ayuda'], nombre: 'Bienvenida urgente', orden: 1 }),
    configAutoReply({ keywords: ['ayuda'], nombre: 'FAQ genérico', orden: 5 }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, 'Necesito ayuda')

  assert.ok(result, 'debería encontrar un match')
  assert.equal(result!.config.nombre, 'Bienvenida urgente', 'debería retornar la de menor orden')
})

test('buscarAutoReply: skip configs con esBienvenida=true', async () => {
  stubConfigs([
    configAutoReply({ keywords: ['hola'], nombre: 'Saludo', esBienvenida: true, orden: 0 }),
    configAutoReply({ keywords: ['hola'], nombre: 'Hola normal', orden: 1 }),
  ])

  const result = await buscarAutoReply(COMPANY_ID, 'Hola!')

  assert.ok(result, 'debería encontrar match')
  assert.equal(result!.config.nombre, 'Hola normal', 'debería saltarse la de esBienvenida')
})

test('buscarAutoReply: skip configs con keywords vacías', async () => {
  stubConfigs([
    configAutoReply({ keywords: [], nombre: 'Sin keywords', orden: 0 }),
    configAutoReply({ keywords: ['oferta'], nombre: 'Ofertas', orden: 1 }),
  ])

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
  mockConEmpresa.mockImplementationOnce(async (_companyId: string, fn: Function) => {
    return fn({
      autoReplyConfig: { findMany: async () => [] },
      conversacion: { findFirst: async () => null },
    })
  })

  const result = await buscarAutoReply(COMPANY_ID, 'hola')
  assert.equal(result, null)
})

test('buscarAutoReply: error en DB retorna null (fire-and-safe)', async () => {
  mockConEmpresa.mockImplementationOnce(async () => {
    throw new Error('DB connection lost')
  })

  const result = await buscarAutoReply(COMPANY_ID, 'hola')
  assert.equal(result, null, 'no debería lanzar, retorna null')
})

// ── Tests: esPrimerMensaje ──────────────────────────────────────────────────

test('esPrimerMensaje: primera vez → true', async () => {
  stubConversaciones(false)

  const result = await esPrimerMensaje(COMPANY_ID, '+18095551234')

  assert.equal(result, true, 'sin conversaciones previas debería ser true')
})

test('esPrimerMensaje: segunda vez → false', async () => {
  stubConversaciones(true)

  const result = await esPrimerMensaje(COMPANY_ID, '+18095551234')

  assert.equal(result, false, 'con conversación existente debería ser false')
})

test('esPrimerMensaje: companyId vacío → false', async () => {
  const result = await esPrimerMensaje('', '+18095551234')
  assert.equal(result, false)
})

test('esPrimerMensaje: teléfono vacío → false', async () => {
  const result = await esPrimerMensaje(COMPANY_ID, '')
  assert.equal(result, false)
})

test('esPrimerMensaje: error en DB → true (catch retorna null, null===null)', async () => {
  mockConEmpresa.mockImplementationOnce(async () => {
    throw new Error('DB down')
  })

  const result = await esPrimerMensaje(COMPANY_ID, '+18095551234')
  assert.equal(result, true, 'con catch(() => null) → null === null → true')
})

// ── Tests: enviarAutoReply ───────────────────────────────────────────────────

const CONFIG_CATALOGO = {
  id: 'cfg-cat',
  nombre: 'Catálogo Excursiones',
  contenido: 'Mira nuestro catálogo de excursiones',
  tipoRespuesta: 'CATALOGO',
  catalogoPath: 'https://membego.com/cartown/catalogo',
}

const CONFIG_TEXTO = {
  id: 'cfg-txt',
  nombre: 'Horarios',
  contenido: 'Atendemos de 9 a 6.',
  tipoRespuesta: 'TEXTO',
  catalogoPath: null,
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

test('enviarAutoReply: CATALOGO con catalogoPath absoluto → texto incluye la URL', async () => {
  stubDbSaliente()
  stubEnviarWhatsappOk()

  const resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_CATALOGO, 'conv-1')

  assert.ok(resultado?.enviado)
  assert.equal(ultimoEnvioTexto, `${CONFIG_CATALOGO.contenido}\n${CONFIG_CATALOGO.catalogoPath}`)
})

test('enviarAutoReply: catalogoPath relativo → texto incluye NEXT_PUBLIC_APP_URL + path', async () => {
  stubDbSaliente()
  stubEnviarWhatsappOk()

  await conBaseUrl('https://app.membego.com', async () => {
    const resultado = await enviarAutoReply(
      COMPANY_ID,
      '+18095551234',
      { ...CONFIG_CATALOGO, catalogoPath: '/excursiones' },
      'conv-1'
    )

    assert.ok(resultado?.enviado)
    assert.equal(ultimoEnvioTexto, `${CONFIG_CATALOGO.contenido}\nhttps://app.membego.com/excursiones`)
  })
})

test('enviarAutoReply: tipo TEXTO → texto = contenido sin URL', async () => {
  stubDbSaliente()
  stubEnviarWhatsappOk()

  const resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_TEXTO, 'conv-1')

  assert.ok(resultado?.enviado)
  assert.equal(ultimoEnvioTexto, CONFIG_TEXTO.contenido)
})

test('enviarAutoReply: persiste Mensaje SALIENTE ENVIADO y actualiza conversación cuando el envío ok', async () => {
  const registros = stubDbSaliente()
  stubEnviarWhatsappOk('wa-abc')

  const resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_TEXTO, 'conv-1')

  assert.ok(resultado?.enviado)
  assert.equal(registros.mensajesCreados.length, 1)
  const mensaje = registros.mensajesCreados[0]
  assert.equal(mensaje.conversacionId, 'conv-1')
  assert.equal(mensaje.direccion, 'SALIENTE')
  assert.equal(mensaje.tipo, 'TEXTO')
  assert.equal(mensaje.contenido, CONFIG_TEXTO.contenido)
  assert.equal(mensaje.estado, 'ENVIADO')
  assert.equal(mensaje.proveedorMsgId, 'wa-abc')
  assert.deepEqual(mensaje.metadata, { whatsapp_auto_reply: CONFIG_TEXTO.nombre })

  assert.equal(registros.conversacionesActualizadas.length, 1)
  const update = registros.conversacionesActualizadas[0]
  assert.equal(update.ultimoMensaje, CONFIG_TEXTO.contenido)
  assert.ok(update.ultimaFecha instanceof Date)
})

test('enviarAutoReply: persiste SALIENTE FALLIDO y no lanza cuando enviarWhatsapp falla', async () => {
  const registros = stubDbSaliente()
  stubEnviarWhatsappFallo()

  let resultado: { config: unknown; enviado: boolean } | null | undefined
  await assert.doesNotReject(async () => {
    resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_TEXTO, 'conv-1')
  })

  assert.equal(resultado?.enviado, false)
  assert.equal(registros.mensajesCreados.length, 1)
  const mensaje = registros.mensajesCreados[0]
  assert.equal(mensaje.estado, 'FALLIDO')
  assert.equal(mensaje.proveedorMsgId, null)
})

test('enviarAutoReply: fallo del persist no afecta el resultado (fire-and-safe)', async () => {
  stubQueryUnica({
    company: { findUnique: async () => ({ name: 'Test Co', slug: 'test-co' }) },
    mensaje: {
      create: async () => {
        throw new Error('DB down')
      },
    },
  })
  stubEnviarWhatsappOk()

  let resultado: { config: unknown; enviado: boolean } | null | undefined
  await assert.doesNotReject(async () => {
    resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_TEXTO, 'conv-1')
  })

  assert.ok(resultado?.enviado, 'el resultado del envío se devuelve aunque el persist falle')
})

test('enviarAutoReply: sin conversacionId retorna null sin enviar', async () => {
  stubDbSaliente()
  stubEnviarWhatsappOk()

  const resultado = await enviarAutoReply(COMPANY_ID, '+18095551234', CONFIG_TEXTO, '')

  assert.equal(resultado, null)
  assert.equal(mockEnviarWhatsapp.mock.calls.length, 0, 'no debería llamar a enviarWhatsapp')
})

// ── Tests: buscarBienvenida ──────────────────────────────────────────────────

test('buscarBienvenida: devuelve la config esBienvenida activa', async () => {
  const bienvenida = configAutoReply({
    nombre: 'Bienvenida',
    esBienvenida: true,
    orden: 0,
  })
  stubQueryUnica({
    autoReplyConfig: { findFirst: async () => bienvenida },
  })

  const resultado = await buscarBienvenida(COMPANY_ID)

  assert.ok(resultado)
  assert.equal(resultado!.config.nombre, 'Bienvenida')
  assert.equal(resultado!.config.tipoRespuesta, 'TEXTO')
})

test('buscarBienvenida: sin config activa devuelve null', async () => {
  stubQueryUnica({
    autoReplyConfig: { findFirst: async () => null },
  })

  const resultado = await buscarBienvenida(COMPANY_ID)

  assert.equal(resultado, null)
})

test('buscarBienvenida: companyId vacío retorna null', async () => {
  const resultado = await buscarBienvenida('')
  assert.equal(resultado, null)
})

// ── Tests: resolverUrlCatalogo ───────────────────────────────────────────────

test('resolverUrlCatalogo: devuelve la URL de la config CATALOGO activa', async () => {
  stubQueryUnica({
    autoReplyConfig: {
      findMany: async () => [
        { catalogoPath: 'https://membego.com/tonis/catalogo' },
      ],
    },
  })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, 'https://membego.com/tonis/catalogo')
})

test('resolverUrlCatalogo: catalogoPath relativo se resuelve contra NEXT_PUBLIC_APP_URL', async () => {
  stubQueryUnica({
    autoReplyConfig: {
      findMany: async () => [{ catalogoPath: '/excursiones' }],
    },
  })

  await conBaseUrl('https://app.membego.com', async () => {
    const resultado = await resolverUrlCatalogo(COMPANY_ID)
    assert.equal(resultado, 'https://app.membego.com/excursiones')
  })
})

test('resolverUrlCatalogo: salta configs con catalogoPath vacío y usa la primera con URL', async () => {
  stubQueryUnica({
    autoReplyConfig: {
      findMany: async () => [
        { catalogoPath: null },
        { catalogoPath: '   ' },
        { catalogoPath: 'https://membego.com/cartown/catalogo' },
      ],
    },
  })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, 'https://membego.com/cartown/catalogo')
})

test('resolverUrlCatalogo: sin config CATALOGO devuelve null', async () => {
  stubQueryUnica({
    autoReplyConfig: { findMany: async () => [] },
  })

  const resultado = await resolverUrlCatalogo(COMPANY_ID)

  assert.equal(resultado, null)
})
