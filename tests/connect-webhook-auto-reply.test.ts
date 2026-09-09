import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'

/**
 * INTEGRATION TESTS — entrante de WhatsApp + Auto-reply (pipeline de
 * mensajería, tras la reconciliación con main).
 *
 * Prueba el flujo del webhook a partir del punto donde vive el auto-reply en
 * la arquitectura reconciliada: `entrantes.ts` persiste el mensaje y, si no es
 * duplicado, llama a `trasEntrante`; `trasEntrante` dispara `responderAutoReply`
 * (hook real, portado de la ruta de la rama) solo para WHATSAPP de texto.
 *
 * Mocks: `conEmpresa` (@/lib/tenant, tx Prisma), `resolverContacto`
 * (@/modules/mensajeria/contactos) —fuente de la señal `nuevo`/`esNueva`—,
 * `registrarProspectoDesdeEntrante` (@/modules/crm/prospectos),
 * `emitirMensajeRecibido`/`emitirProspectoCreado` (@/modules/mensajeria/eventos)
 * y `responderAutoReply` (@/modules/mensajeria/autoReply, cuya lógica ya se
 * cubre en connect-auto-reply.test.ts). CORREN REALES `entrantes.ts` y
 * `trasEntrante.ts`.
 */

// ── Entorno ─────────────────────────────────────────────────────────────────

const COMPANY_ID = 'company-test-001'
const CONVERSACION_ID = 'conv-test-001'
const ACTIVO_ID = 'activo-whatsapp-001'
const CONTACTO_ID = 'contacto-test-001'
const FROM = '18095551234'
const TELEFONO = FROM

// ── Mocks (se registran ANTES de importar entrantes/trasEntrante) ───────────

function mockModule(modulePath: string, mockExports: Record<string, unknown>) {
  const resolvedPath = require.resolve(modulePath)
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: mockExports,
    parent: null,
    children: [],
  } as unknown as NodeJS.Module
}

// TX mockeada: el upsert de conversación devuelve un id; `mensaje.create`
// registra y (si `duplicadoSiguiente`) lanza P2002, como haría el UNIQUE
// (canal, idExterno) con un wamid repetido.
let duplicadoSiguiente = false
const mensajesEntrantes: Array<{ direccion: string; idExterno: string }> = []
const updatesConversacion: Array<{ data: Record<string, unknown> }> = []

const txMensajeria = {
  conversacion: {
    upsert: async () => ({
      id: CONVERSACION_ID,
      ultimoEntranteAt: null,
      ultimoMensajeAt: null,
    }),
    update: async (args: { data: Record<string, unknown> }) => {
      updatesConversacion.push(args)
      return { id: CONVERSACION_ID }
    },
  },
  mensaje: {
    create: async (args: { data: { direccion: string; idExterno: string } }) => {
      if (duplicadoSiguiente) {
        duplicadoSiguiente = false
        // `entrantes` solo reconoce el P2002 real de Prisma como duplicado.
        throw new Prisma.PrismaClientKnownRequestError('Duplicate', {
          code: 'P2002',
          clientVersion: '6.0.0',
        } as never)
      }
      mensajesEntrantes.push({ direccion: args.data.direccion, idExterno: args.data.idExterno })
      return { id: 'msg-' + mensajesEntrantes.length }
    },
  },
}

const mockConEmpresa = async (_companyId: string, fn: (tx: any) => any): Promise<any> =>
  fn(txMensajeria)

mockModule('@/lib/tenant', {
  conEmpresa: mockConEmpresa,
  sinEmpresa: async (_motivo: string, fn: (tx: any) => Promise<any>) => fn({}),
  conEmpresaOTodas: async (
    _companyId: string | null,
    _motivo: string,
    fn: (tx: any) => Promise<any>
  ) => fn({}),
  conUsuario: async (_userId: string, fn: (tx: any) => Promise<any>) => fn({}),
})

// El contacto nuevo/existente: fuente de `esNueva` para el auto-reply.
let contactoNuevo = true
const mockResolverContacto = async () => ({
  id: CONTACTO_ID,
  clienteId: null,
  nuevo: contactoNuevo,
})
mockModule('@/modules/mensajeria/contactos', {
  resolverContacto: mockResolverContacto,
})

// Lado CRM/eventos/auto-reply: se aíslan para observar el orden del hook.
const orden: string[] = []
let prospectoFalla = false
const mockRegistrarProspecto = async () => {
  if (prospectoFalla) {
    prospectoFalla = false
    throw new Error('CRM caído')
  }
  orden.push('prospecto')
  return { creado: true, id: 'prospecto-001' }
}
mockModule('@/modules/crm/prospectos', {
  registrarProspectoDesdeEntrante: mockRegistrarProspecto,
})

const mockEmitirRecibido = async () => {
  orden.push('mensajeRecibido')
}
const mockEmitirProspectoCreado = async () => {
  orden.push('prospectoCreado')
}
mockModule('@/modules/mensajeria/eventos', {
  emitirMensajeRecibido: mockEmitirRecibido,
  emitirProspectoCreado: mockEmitirProspectoCreado,
})

interface LlamadaAutoReply {
  companyId: string
  conversacionId: string
  texto: string
  telefono: string
  esNueva: boolean
}
const llamadasAutoReply: LlamadaAutoReply[] = []
const mockResponderAutoReply = async (input: LlamadaAutoReply) => {
  orden.push('auto-reply')
  llamadasAutoReply.push(input)
}
mockModule('@/modules/mensajeria/autoReply', {
  responderAutoReply: mockResponderAutoReply,
})

mockModule('server-only', {})

// Import DESPUÉS de registrar los mocks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registrarEntranteWhatsapp } = require('../src/modules/mensajeria/entrantes')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { trasEntrante } = require('../src/modules/mensajeria/trasEntrante')

// ── Helpers ──────────────────────────────────────────────────────────────────

function payloadWhatsapp(opts: {
  msgId: string
  texto?: string
  tipo?: string
  from?: string
}) {
  const ahora = Math.floor(Date.now() / 1000)
  const message: Record<string, unknown> = {
    from: opts.from ?? FROM,
    id: opts.msgId,
    timestamp: String(ahora),
    type: opts.tipo ?? 'text',
  }
  if ((opts.tipo ?? 'text') === 'text') {
    message.text = { body: opts.texto ?? 'Hola' }
  }
  return {
    metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
    contacts: [{ profile: { name: 'Ana' }, wa_id: opts.from ?? FROM }],
    message,
  }
}

function eventoDe(msgId: string, texto?: string) {
  return {
    id: `evento-${msgId}`,
    companyId: COMPANY_ID,
    activoId: ACTIVO_ID,
    claveDedupe: `wa:msg:${msgId}`,
    campo: 'messages',
    payload: payloadWhatsapp({ msgId, texto }),
    timestamp: new Date(),
  }
}

function inputTrasEntrante(opts: {
  canal?: string
  tipo?: string
  texto?: string | null
  nuevo?: boolean
}) {
  const texto = 'texto' in opts ? (opts.texto ?? null) : 'Quiero reservar una mesa'
  return {
    companyId: COMPANY_ID,
    canal: opts.canal ?? 'WHATSAPP',
    conversacionId: CONVERSACION_ID,
    contacto: { id: CONTACTO_ID, clienteId: null, nuevo: opts.nuevo ?? true },
    nombre: 'Ana',
    telefono: TELEFONO,
    tipo: opts.tipo ?? 'text',
    texto,
    timestamp: new Date(),
  }
}

beforeEach(() => {
  contactoNuevo = true
  duplicadoSiguiente = false
  prospectoFalla = false
  mensajesEntrantes.length = 0
  updatesConversacion.length = 0
  llamadasAutoReply.length = 0
  orden.length = 0
})

// ── Flujo entrante → auto-reply ─────────────────────────────────────────────

test('un mensaje de texto entrante dispara exactamente un auto-reply con esNueva del contacto', async () => {
  const result = await registrarEntranteWhatsapp(eventoDe('wamid.in.001', 'Quiero reservar') as any)

  assert.equal(result, 'entrante text')
  assert.equal(mensajesEntrantes.length, 1, 'debería persistir el entrante')

  assert.equal(llamadasAutoReply.length, 1, 'debería disparar un solo auto-reply')
  const llamada = llamadasAutoReply[0]!
  assert.equal(llamada.companyId, COMPANY_ID)
  assert.equal(llamada.conversacionId, CONVERSACION_ID)
  assert.equal(llamada.texto, 'Quiero reservar')
  assert.equal(llamada.telefono, TELEFONO)
  assert.equal(llamada.esNueva, true, 'primer contacto → esNueva=true')

  // Orden del hook: prospecto → evento recibido → auto-reply → evento creado.
  assert.deepEqual(orden, ['prospecto', 'mensajeRecibido', 'auto-reply', 'prospectoCreado'])
})

test('un wamid duplicado no vuelve a disparar el auto-reply', async () => {
  const ev = eventoDe('wamid.dup.001', 'Quiero reservar')

  const primero = await registrarEntranteWhatsapp(ev as any)
  assert.equal(primero, 'entrante text')
  assert.equal(llamadasAutoReply.length, 1)

  // El mismo payload llega dos veces: el UNIQUE (canal, idExterno) truena y
  // `entrantes` lo trata como duplicado (deshace el no leído y NO llama a
  // trasEntrante).
  duplicadoSiguiente = true
  const segundo = await registrarEntranteWhatsapp(ev as any)

  assert.equal(segundo, 'duplicado')
  assert.equal(llamadasAutoReply.length, 1, 'el duplicado no debería re-disparar el auto-reply')
  assert.equal(mensajesEntrantes.length, 1, 'solo debería persistirse una vez')
})

// ── Gating del hook en trasEntrante ─────────────────────────────────────────

test('trasEntrante: un canal distinto a WHATSAPP no dispara auto-reply', async () => {
  await trasEntrante(inputTrasEntrante({ canal: 'MESSENGER' }) as any)

  assert.equal(llamadasAutoReply.length, 0, 'el auto-reply es solo WhatsApp')
})

test('trasEntrante: un mensaje que no es texto no dispara auto-reply', async () => {
  await trasEntrante(inputTrasEntrante({ tipo: 'image', texto: 'mi foto' }) as any)

  assert.equal(llamadasAutoReply.length, 0, 'el auto-reply es solo para texto')
})

test('trasEntrante: texto null no dispara auto-reply', async () => {
  await trasEntrante(inputTrasEntrante({ tipo: 'text', texto: null }) as any)

  assert.equal(llamadasAutoReply.length, 0)
})

test('trasEntrante: contacto ya existente llega con esNueva=false (no bienvenida)', async () => {
  await trasEntrante(inputTrasEntrante({ nuevo: false }) as any)

  assert.equal(llamadasAutoReply.length, 1)
  assert.equal(llamadasAutoReply[0]!.esNueva, false, 'la señal esNueva debe propagarse desde el contacto')
})

test('trasEntrante: nunca lanza aunque el CRM falle (fire-and-safe)', async () => {
  prospectoFalla = true

  let rechazo: unknown = null
  try {
    await trasEntrante(inputTrasEntrante({}) as any)
  } catch (e) {
    rechazo = e
  }
  assert.equal(rechazo, null, 'trasEntrante debe tragar el fallo del CRM')
})
