import { test, describe } from 'node:test'
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { sellar, parsearClavesMaestras } from '../src/modules/connect/cifrado'

/**
 * INTEGRATION TESTS — Webhook de Meta + Auto-Reply (Fase 3).
 *
 * Prueba el flujo completo: payload de Meta → webhook POST → Lead +
 * Conversacion + Mensaje + auto-reply (o no).
 *
 * Mocks: Prisma (globalThis.prisma), enviarWhatsapp (@/modules/connect/whatsapp),
 * encrypt (credenciales). NO se toca la ruta; se llama el POST handler real con
 * datos simulados y firma válida.
 */

// ── Entorno de prueba ──────────────────────────────────────────────────────

const SECRETO = 'test-webhook-secret'
process.env.META_APP_SECRET = SECRETO
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-verify-token'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

// Clave maestra de cifrado para credenciales de prueba
const testKey = randomBytes(32).toString('base64')
process.env.CONNECT_CLAVES_MAESTRAS = `1:${testKey}`

// ── Credencial cifrada de prueba ───────────────────────────────────────────

const CREDENCIAL_WHATSAPP = JSON.stringify({
  token: 'test-meta-token-permanente',
  phoneNumberId: '106540352242922',
  numeroVisible: '+1 809 555 1234',
})

const claves = parsearClavesMaestras(`1:${testKey}`)
const sellado = sellar(claves, CREDENCIAL_WHATSAPP, 'credencial:conexion-test-001:API_KEY')

// ── Tracking de llamadas ───────────────────────────────────────────────────

interface LlamadaTx {
  modelo: string
  operacion: string
  args?: unknown
}

interface LlamadaFetch {
  url: string
  method?: string
  body?: string
}

interface LlamadaEnvio {
  telefono: string
  texto: string
}

let txCalls: LlamadaTx[] = []
let fetchCalls: LlamadaFetch[] = []
let originalFetch: typeof globalThis.fetch

// ── Mock enviarWhatsapp ─────────────────────────────────────────────────────

// La ruta (route.ts:9 y autoReply.ts) importa `enviarWhatsapp` de
// `@/modules/connect/whatsapp`. Este archivo registra su PROPIO mock del módulo
// ANTES de importar la ruta: bun comparte el registro de `mock.module` entre los
// archivos que corren en el mismo worker, y el que registra
// tests/connect-auto-reply.test.ts deja `enviarWhatsapp` sin implementación
// (su beforeEach hace mockReset) → la ruta recibiría `undefined` y lanzaría
// TypeError. Con el mock propio, este archivo no depende de aquel registro.

let whatsappCalls: LlamadaEnvio[] = []
let enviarWhatsappFalla = false

async function enviarWhatsappMock(input: {
  companyId: string
  telefono: string
  texto: string
}): Promise<{ ok: boolean; mensajeId?: string; motivo?: string }> {
  whatsappCalls.push({ telefono: input.telefono, texto: input.texto })
  if (enviarWhatsappFalla) return { ok: false, motivo: 'proveedor' }
  return { ok: true, mensajeId: 'wamid.mock.' + Date.now() }
}

mock.module('@/modules/connect/whatsapp', () => ({
  enviarWhatsapp: enviarWhatsappMock,
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────

function createMockTx(opts?: { existeConversacion?: boolean }) {
  return {
    $queryRaw: async () => [],
    conector: {
      findUnique: async (args: any) => {
        txCalls.push({ modelo: 'conector', operacion: 'findUnique', args })
        return { id: 'conector-whatsapp-123' }
      },
    },
    conexionEmpresa: {
      findUnique: async (args: any) => {
        txCalls.push({ modelo: 'conexionEmpresa', operacion: 'findUnique', args })
        return { id: 'conexion-test-001', companyId: 'company-test-001' }
      },
      findFirst: async (args: any) => {
        txCalls.push({ modelo: 'conexionEmpresa', operacion: 'findFirst', args })
        return { id: 'conexion-test-001' }
      },
      update: async (args: any) => {
        txCalls.push({ modelo: 'conexionEmpresa', operacion: 'update', args })
        return {}
      },
    },
    company: {
      findUnique: async (args: any) => {
        txCalls.push({ modelo: 'company', operacion: 'findUnique', args })
        return { slug: 'empresa-test', name: 'Empresa Test' }
      },
    },
    lead: {
      upsert: async (args: any) => {
        txCalls.push({ modelo: 'lead', operacion: 'upsert', args })
        return { id: 'lead-test-001' }
      },
    },
    conversacion: {
      findFirst: async (args: any) => {
        txCalls.push({ modelo: 'conversacion', operacion: 'findFirst', args })
        return opts?.existeConversacion ? { id: 'conv-existente' } : null
      },
      create: async (args: any) => {
        txCalls.push({ modelo: 'conversacion', operacion: 'create', args })
        return { id: 'conv-test-001' }
      },
      update: async (args: any) => {
        txCalls.push({ modelo: 'conversacion', operacion: 'update', args })
        return {}
      },
    },
    mensaje: {
      findFirst: async (args: any) => {
        txCalls.push({ modelo: 'mensaje', operacion: 'findFirst', args })
        return null
      },
      create: async (args: any) => {
        txCalls.push({ modelo: 'mensaje', operacion: 'create', args })
        return {}
      },
    },
    autoReplyConfig: {
      findMany: async (args: any): Promise<any[]> => {
        txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findMany', args })
        return []
      },
      findFirst: async (args: any): Promise<any> => {
        txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findFirst', args })
        return null
      },
    },
    registroConector: {
      create: async (args: any) => {
        txCalls.push({ modelo: 'registroConector', operacion: 'create', args })
        return {}
      },
    },
    credencialConexion: {
      findFirst: async (args: any) => {
        txCalls.push({ modelo: 'credencialConexion', operacion: 'findFirst', args })
        return { sellado, keyVersion: 1, expiresAt: null }
      },
    },
  }
}

// ── Payload helpers ────────────────────────────────────────────────────────

function firmar(cuerpo: string): string {
  return `sha256=${createHmac('sha256', SECRETO).update(cuerpo, 'utf8').digest('hex')}`
}

function buildTextPayload(opts: {
  wabaId?: string
  from?: string
  text?: string
  msgId?: string
  timestamp?: string
}) {
  return {
    entry: [
      {
        id: opts.wabaId ?? '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                {
                  from: opts.from ?? '18095551234',
                  id: opts.msgId ?? 'wamid.test.001',
                  timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: opts.text ?? 'Hola, quiero information' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function makeRequest(cuerpo: string): NextRequest {
  const firma = firmar(cuerpo)
  return new NextRequest('http://localhost:3000/api/connect/meta/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': firma,
    },
    body: cuerpo,
  })
}

// ── Setup/teardown ─────────────────────────────────────────────────────────

let currentTxFactory: (opts?: { existeConversacion?: boolean }) => any = createMockTx

function applyTenantMock() {
  mock.module('@/lib/tenant', () => ({
    conEmpresa: async (_companyId: string, fn: (tx: any) => Promise<any>) => fn(currentTxFactory()),
    sinEmpresa: async (_motivo: string, fn: (tx: any) => Promise<any>) => fn(currentTxFactory()),
    conEmpresaOTodas: async (
      _companyId: string | null | undefined,
      _motivo: string,
      fn: (tx: any) => Promise<any>,
    ) => fn(currentTxFactory()),
    conUsuario: async (_userId: string, fn: (tx: any) => Promise<any>) => fn(currentTxFactory()),
  }))
}

function setupMocks() {
  txCalls = []
  fetchCalls = []
  whatsappCalls = []
  enviarWhatsappFalla = false
  currentTxFactory = createMockTx

  applyTenantMock()

  originalFetch = globalThis.fetch
  // @types/bun amplía el tipo global de fetch con overloads que hacen que una
  // arrow genérica no sea asignable a `typeof fetch` → cast explícito.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    fetchCalls.push({
      url,
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.mock.' + Date.now() }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

function teardownMocks() {
  globalThis.fetch = originalFetch
  mock.restore()
}

// ── Dynamic import del route handler ───────────────────────────────────────

// Se importa DESPUÉS de configurar globalThis.prisma para queobtenerCliente()
// devuelva nuestro mock en vez de intentar conectar a Postgres.
let POST: (req: any) => Promise<Response>

describe('webhook auto-reply integration', () => {
  describe('setup', () => {
    test('POST handler loads with mock Prisma', async () => {
      setupMocks()
      const mod = await import('../src/app/api/connect/meta/webhook/route')
      POST = mod.POST
      teardownMocks()
      assert.ok(POST, 'POST handler should be exported')
    })
  })

  describe('firma y seguridad', () => {
    test('sin META_APP_SECRET devuelve 404', async () => {
      const prev = process.env.META_APP_SECRET
      delete process.env.META_APP_SECRET
      try {
        // Need fresh import to pick up env change
        const mod = await import('../src/app/api/connect/meta/webhook/route')
        const req = new NextRequest('http://localhost/api/connect/meta/webhook', {
          method: 'POST',
          body: '{}',
        })
        const res = await mod.POST(req)
        assert.equal(res.status, 404)
      } finally {
        process.env.META_APP_SECRET = prev
      }
    })

    test('firma inválida devuelve 403', async () => {
      setupMocks()
      const mod = await import('../src/app/api/connect/meta/webhook/route')
      const cuerpo = '{"entry":[]}'
      const req = new NextRequest('http://localhost/api/connect/meta/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        },
        body: cuerpo,
      })
      const res = await mod.POST(req)
      assert.equal(res.status, 403)
      teardownMocks()
    })
  })

  describe('flujo de mensajes entrantes', () => {
    test('mensaje de texto crea Lead + Conversacion + Mensaje', async () => {
      setupMocks()
      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'Hola, necesito ayuda' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const body = await res.json()
      assert.equal(body.ok, true)

      // Verificar Lead upsert
      const leadCalls = txCalls.filter((c) => c.modelo === 'lead' && c.operacion === 'upsert')
      assert.equal(leadCalls.length, 1, 'debería crear/upsert un Lead')

      // Verificar Conversacion create
      const convCreate = txCalls.filter(
        (c) => c.modelo === 'conversacion' && c.operacion === 'create'
      )
      assert.equal(convCreate.length, 1, 'debería crear una Conversacion')

      // Verificar Mensaje create
      const msgCreate = txCalls.filter(
        (c) => c.modelo === 'mensaje' && c.operacion === 'create'
      )
      assert.equal(msgCreate.length, 1, 'debería crear un Mensaje')

      teardownMocks()
    })

    test('auto-reply se envía cuando el keyword matchea', async () => {
      setupMocks()

      currentTxFactory = () => {
        const tx = createMockTx()
        tx.autoReplyConfig.findMany = async (args: any) => {
          txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findMany', args })
          return [
            {
              id: 'ar-001',
              nombre: 'Saludo',
              keywords: ['hola', 'buenos dias'],
              esBienvenida: false,
              contenido: '¡Hola! Bienvenido a {nombre_empresa}. ¿En qué te puedo ayudar?',
              tipoRespuesta: 'TEXTO',
              catalogoPath: null,
            },
          ]
        }
        return tx
      }

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'Hola, quiero reservar' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      // Verificar que buscarAutoReply consultó configs
      const arCalls = txCalls.filter(
        (c) => c.modelo === 'autoReplyConfig' && c.operacion === 'findMany'
      )
      assert.ok(arCalls.length >= 1, 'debería consultar autoReplyConfig')

      // Verificar que enviarWhatsapp fue llamado (mock) con el auto-reply resuelto
      assert.ok(whatsappCalls.length >= 1, 'debería llamar a enviarWhatsapp para enviar')
      assert.match(whatsappCalls[0].texto, /Empresa Test/, 'debería resolver {nombre_empresa}')

      teardownMocks()
    })

    test('auto-reply NO se envía cuando no matchea keyword', async () => {
      setupMocks()

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'asdfghjkl random text' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      // Verificar que buscarAutoReply consultó configs
      const arCalls = txCalls.filter(
        (c) => c.modelo === 'autoReplyConfig' && c.operacion === 'findMany'
      )
      assert.ok(arCalls.length >= 1, 'debería consultar autoReplyConfig')

      // Verificar que NO se llamó a enviarWhatsapp (no hubo envío)
      assert.equal(whatsappCalls.length, 0, 'NO debería enviar WhatsApp sin match')

      teardownMocks()
    })

    test('intención de excursiones envía catálogo cuando no hay auto-reply match y no es primer mensaje', async () => {
      setupMocks()

      currentTxFactory = () => createMockTx({ existeConversacion: true })

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'Quiero ver las excursiones disponibles' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const companyCalls = txCalls.filter(
        (c) => c.modelo === 'company' && c.operacion === 'findUnique'
      )
      assert.ok(companyCalls.length >= 1, 'debería buscar slug de empresa para catálogo')

      assert.ok(whatsappCalls.length >= 1, 'debería enviar catálogo por WhatsApp')
      assert.match(
        whatsappCalls[0].texto,
        /http:\/\/localhost:3000\/empresas\/empresa-test\/excursiones/,
        'debería usar el slug de la empresa en la URL del catálogo'
      )

      teardownMocks()
    })

    test('primer mensaje sin keyword envía bienvenida y persiste SALIENTE', async () => {
      setupMocks()

      currentTxFactory = () => {
        const tx = createMockTx()
        tx.autoReplyConfig.findFirst = async (args: any) => {
          txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findFirst', args })
          return {
            id: 'welcome-001',
            nombre: 'Bienvenida',
            contenido: '¡Bienvenido a {nombre_empresa}! Cuéntanos cómo podemos ayudarte.',
            tipoRespuesta: 'TEXTO',
            catalogoPath: null,
          }
        }
        return tx
      }

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'Hola, soy nuevo' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const salientes = txCalls.filter(
        (c) => c.modelo === 'mensaje' && c.operacion === 'create'
      )
      assert.ok(
        salientes.some((c) => (c.args as any).data?.direccion === 'SALIENTE'),
        'debería persistir un mensaje SALIENTE de bienvenida'
      )
      const saliente = salientes.find((c) => (c.args as any).data?.direccion === 'SALIENTE')
      assert.match((saliente?.args as any).data.contenido, /Empresa Test/, 'debería resolver {nombre_empresa}')

      assert.ok(whatsappCalls.length >= 1, 'debería enviar la bienvenida por WhatsApp')

      teardownMocks()
    })

    test('primer mensaje con keyword gana el auto-reply de keywords (no el welcome)', async () => {
      setupMocks()

      currentTxFactory = () => {
        const tx = createMockTx()
        tx.autoReplyConfig.findMany = async (args: any): Promise<any[]> => {
          txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findMany', args })
          return [
            {
              id: 'ar-keyword',
              nombre: 'Reserva',
              keywords: ['reservar'],
              esBienvenida: false,
              contenido: '¡Claro! Reserva tu {nombre_empresa} aquí.',
              tipoRespuesta: 'TEXTO',
              catalogoPath: null,
            },
          ]
        }
        return tx
      }

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'quiero reservar una mesa' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const findFirst = txCalls.filter(
        (c) => c.modelo === 'autoReplyConfig' && c.operacion === 'findFirst'
      )
      assert.equal(findFirst.length, 0, 'no debería buscar bienvenida cuando gana el keyword')

      const saliente = txCalls.find(
        (c) => c.modelo === 'mensaje' && c.operacion === 'create' && (c.args as any).data?.direccion === 'SALIENTE'
      )
      assert.match((saliente?.args as any).data.contenido, /Reserva tu Empresa Test/, 'debería usar el contenido del keyword')

      teardownMocks()
    })

    test('mensaje posterior con intención de excursión sin match usa catálogo de config con URL', async () => {
      setupMocks()

      currentTxFactory = () => {
        const tx = createMockTx({ existeConversacion: true })
        tx.autoReplyConfig.findMany = async (args: any): Promise<any[]> => {
          txCalls.push({ modelo: 'autoReplyConfig', operacion: 'findMany', args })
          if ((args as any).where?.tipoRespuesta === 'CATALOGO') {
            return [{ catalogoPath: '/excursiones/ofertas' }]
          }
          return []
        }
        return tx
      }

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'Quiero ver las excursiones disponibles' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const companyCalls = txCalls.filter(
        (c) => c.modelo === 'company' && c.operacion === 'findUnique'
      )
      assert.equal(companyCalls.length, 0, 'no debería resolver por slug cuando la config tiene URL')

      assert.ok(whatsappCalls.length >= 1, 'debería enviar catálogo por WhatsApp')
      assert.match(
        whatsappCalls[0].texto,
        /http:\/\/localhost:3000\/excursiones\/ofertas/,
        'debería usar la URL de la config'
      )

      teardownMocks()
    })

    test('mensaje posterior sin intención no envía nada', async () => {
      setupMocks()

      currentTxFactory = () => createMockTx({ existeConversacion: true })

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const payload = buildTextPayload({ text: 'texto aleatorio sin intencion' })
      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const salientes = txCalls.filter(
        (c) => c.modelo === 'mensaje' && c.operacion === 'create' && (c.args as any).data?.direccion === 'SALIENTE'
      )
      assert.equal(salientes.length, 0, 'no debería enviar nada sin intención')

      assert.equal(whatsappCalls.length, 0, 'no debería llamar a enviarWhatsapp')

      teardownMocks()
    })

    test('múltiples mensajes en un solo payload procesa todos', async () => {
      setupMocks()

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      // Payload con dos mensajes
      const payload = {
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '18095551234',
                      id: 'wamid.multi.001',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'Primer mensaje' },
                    },
                    {
                      from: '18095551234',
                      id: 'wamid.multi.002',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'Segundo mensaje' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      // Verificar que se crearon 2 mensajes
      const msgCreates = txCalls.filter(
        (c) => c.modelo === 'mensaje' && c.operacion === 'create'
      )
      assert.equal(msgCreates.length, 2, 'debería crear 2 Mensajes')

      // Verificar 2 leads upsert (uno por mensaje, mismo teléfono = idempotente)
      const leadCalls = txCalls.filter((c) => c.modelo === 'lead' && c.operacion === 'upsert')
      assert.ok(leadCalls.length >= 2, 'debería hacer upsert del Lead por cada mensaje')

      teardownMocks()
    })

    test('payload sin mensajes de texto se procesa sin error', async () => {
      setupMocks()

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      // Payload con cambio account_update (sin mensajes)
      const payload = {
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                field: 'account_update',
                value: { something: 'changed' },
              },
            ],
          },
        ],
      }

      const cuerpo = JSON.stringify(payload)
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      // No debería crear leads ni mensajes
      const leadCalls = txCalls.filter((c) => c.modelo === 'lead')
      const msgCalls = txCalls.filter((c) => c.modelo === 'mensaje')
      assert.equal(leadCalls.length, 0, 'no debería crear leads')
      assert.equal(msgCalls.length, 0, 'no debería crear mensajes')

      teardownMocks()
    })

    test('payload malformado se acepta (para que Meta no reintente)', async () => {
      setupMocks()

      const mod = await import('../src/app/api/connect/meta/webhook/route')

      const cuerpo = '{ esto no es JSON valido }'
      const req = makeRequest(cuerpo)

      const res = await mod.POST(req)
      assert.equal(res.status, 200)

      const body = await res.json()
      assert.equal(body.ok, true)

      teardownMocks()
    })
  })
})
