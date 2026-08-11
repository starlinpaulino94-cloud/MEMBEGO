/**
 * FASE 7b · VERIFICACIÓN CONTRA POSTGRES Y HTTP REALES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ AÑADE ESTO A LAS PRUEBAS DE `tests/`
 *
 * Las de `tests/` prueban las decisiones con dobles: rápido, y no cruzan nada.
 * Esto cruza las dos cosas que las fases anteriores nunca cruzaron:
 *
 *  · Una base de datos SEPARADA de verdad, con su esquema aplicado.
 *  · Una petición HTTP real, firmada por el código del CORE y verificada por
 *    el del SATÉLITE. No por mi idea de cómo firma el Core: por su función.
 *
 * Si las dos mitades del contrato se hubieran separado, aquí se ve. Es la única
 * forma de saberlo sin desplegar.
 *
 * Uso:
 *   RESTAURANT_DATABASE_URL=... npx tsx scripts/verificar-satelite-restaurante.mts
 */

import { generateKeyPairSync } from 'node:crypto'
import { PrismaClient } from '../apps/restaurant/node_modules/.prisma/restaurant/index.js'
import { firmarEd25519 } from '../src/modules/plataforma/firma'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
} from '@membego/contracts'
import { crearServidor } from '../apps/restaurant/src/servidor'
import { reconciliar, seEstaQuedandoAtras, type AlmacenReconciliacion } from '../apps/restaurant/src/reconciliacion'
import { MembegoClient } from '@membego/platform-sdk'
import { createServer } from 'node:http'
import type { AlmacenProyeccion } from '../apps/restaurant/src/proyeccion'
import type { AlmacenInboxPersistente } from '../apps/restaurant/src/webhook'

const db = new PrismaClient()
let fallos = 0
let hechas = 0

function comprobar(descripcion: string, condicion: boolean, detalle = '') {
  hechas++
  if (condicion) {
    console.log(`  ✓ ${descripcion}`)
  } else {
    fallos++
    console.log(`  ✗ ${descripcion}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

// ── Los almacenes reales, contra la base del satélite ───────────────────────

const proyeccion: AlmacenProyeccion = {
  async vigenciaDe(customerId) {
    const f = await db.clienteProyectado.findUnique({
      where: { customerId },
      select: { vigenteDesde: true },
    })
    return f?.vigenteDesde ?? null
  },
  async guardar(f) {
    await db.clienteProyectado.upsert({
      where: { customerId: f.customerId },
      create: f,
      update: {
        nombre: f.nombre,
        telefono: f.telefono,
        email: f.email,
        vigenteDesde: f.vigenteDesde,
      },
    })
  },
}

/** La reconciliación necesita dos cosas más de la base propia. */
const reconciliacion: AlmacenReconciliacion = {
  ...proyeccion,
  async masViejas(limite) {
    const filas = await db.clienteProyectado.findMany({
      orderBy: { vigenteDesde: 'asc' },
      take: limite,
      select: { customerId: true, companyId: true, vigenteDesde: true },
    })
    return filas
  },
  async olvidar(customerId) {
    await db.clienteProyectado.delete({ where: { customerId } }).catch(() => {})
  },
}

const inbox: AlmacenInboxPersistente = {
  async yaVisto(eventId) {
    return (await db.eventoRecibido.count({ where: { eventId } })) > 0
  },
  async marcar(e) {
    await db.eventoRecibido.create({ data: e }).catch(() => {})
  },
}

// ── El Core firma con SU código ─────────────────────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const clavePublicaPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function sobre(over: Record<string, unknown> = {}) {
  const base = {
    eventId: `ev-${Math.random().toString(36).slice(2)}`,
    eventType: 'customer.created',
    version: 1,
    occurredAt: '2026-08-11T10:00:00.000Z',
    companyId: 'emp-1',
    customerId: 'cli-1',
    source: 'membego',
    traceId: 'tr-1',
    data: { cliente: { nombre: 'Ana', telefono: '+18095551234' } },
    ...over,
  }
  // Claves de legado: viajan en el mismo cuerpo.
  return {
    ...base,
    id: base.eventId,
    tipo: 'cliente.registrado',
    payload: base.data,
    emitidoEn: base.occurredAt,
  }
}

/** Emite como emite MembeGo: cuerpo crudo + firma sobre esos bytes. */
async function emitir(url: string, cuerpoObjeto: Record<string, unknown>, romperFirma = false) {
  const cuerpo = JSON.stringify(cuerpoObjeto)
  const timestamp = Math.floor(Date.now() / 1000)
  const eventId = String(cuerpoObjeto.eventId)
  const firma = firmarEd25519(privateKey, timestamp, eventId, cuerpo)!
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CABECERA_TIMESTAMP]: String(timestamp),
      [CABECERA_EVENTO]: eventId,
      [CABECERA_FIRMA]: romperFirma ? firma.replace(/^./, 'A') : firma,
    },
    body: cuerpo,
  })
}

/**
 * UN CORE DE MENTIRA, PERO POR HTTP DE VERDAD.
 *
 * Sirve `/oauth/token` y `/customers/:id` como los sirve MembeGo. Lo que se
 * comprueba con esto no es el Core —ese ya tiene sus pruebas— sino que el
 * SATÉLITE recorre el camino entero: pedir token, mandarlo, leer el DTO y
 * escribir la proyección. Un cliente falso en memoria se saltaría justo eso.
 */
function coreDeMentira(clientes: Map<string, { nombre: string; telefono: string | null }>) {
  const pedidos: string[] = []
  const servidor = createServer((req, res) => {
    const responder = (codigo: number, cuerpo: unknown) => {
      res.writeHead(codigo, { 'content-type': 'application/json' })
      res.end(JSON.stringify(cuerpo))
    }
    const url = req.url ?? ''
    if (url.includes('/oauth/token')) {
      pedidos.push('token')
      return responder(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
    }
    const m = url.match(/\/customers\/([^/?]+)/)
    if (m) {
      const id = decodeURIComponent(m[1])
      pedidos.push(`customer:${id}`)
      const c = clientes.get(id)
      if (!c) {
        return responder(404, { error: { code: 'NOT_FOUND', message: 'No existe' } })
      }
      // Los nombres del CONTRATO, no los que uno recuerda. Este doble decía
      // `name`/`phone` y le daba la razón a la misma equivocación del satélite:
      // 22 comprobaciones en verde con el campo mal. Lo paró `tsc`.
      return responder(200, { id, nombre: c.nombre, telefono: c.telefono, email: '' })
    }
    responder(404, { error: { code: 'NOT_FOUND', message: 'ruta' } })
  })
  return { servidor, pedidos }
}

// ── Ejecución ───────────────────────────────────────────────────────────────

async function main() {
  await db.eventoRecibido.deleteMany()
  await db.clienteProyectado.deleteMany()

  const servidor = crearServidor({ clavePublicaPem, inbox, proyeccion })
  await new Promise<void>((r) => servidor.listen(0, r))
  const puerto = (servidor.address() as { port: number }).port
  const url = `http://127.0.0.1:${puerto}/webhooks/membego`
  console.log(`\nSatélite escuchando en :${puerto} · base propia, HTTP real\n`)

  console.log('FIRMA — la calcula el Core, la verifica el satélite')
  const evento1 = sobre()
  const r1 = await emitir(url, evento1)
  comprobar('un evento firmado por el Core se acepta', r1.status === 200, `status ${r1.status}`)

  const r2 = await emitir(url, sobre(), true)
  comprobar('una firma manipulada se rechaza con 400', r2.status === 400, `status ${r2.status}`)

  const antesDeCuerpoAlterado = await db.clienteProyectado.count()
  const alterado = sobre({ customerId: 'intruso' })
  const cuerpo = JSON.stringify(alterado)
  const ts = Math.floor(Date.now() / 1000)
  const firmaDeOtro = firmarEd25519(privateKey, ts, 'otro-id', cuerpo)!
  const r3 = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CABECERA_TIMESTAMP]: String(ts),
      [CABECERA_EVENTO]: String(alterado.eventId),
      [CABECERA_FIRMA]: firmaDeOtro,
    },
    body: cuerpo,
  })
  comprobar('una firma de OTRO evento no sirve para este', r3.status === 400, `status ${r3.status}`)
  comprobar(
    'el intruso no entró en la proyección',
    (await db.clienteProyectado.count()) === antesDeCuerpoAlterado
  )

  console.log('\nPROYECCIÓN — persistida de verdad')
  const ana = await db.clienteProyectado.findUnique({ where: { customerId: 'cli-1' } })
  comprobar('el cliente quedó en la base del satélite', ana?.nombre === 'Ana', `nombre=${ana?.nombre}`)
  comprobar('guardó `vigenteDesde` del evento, no la hora de guardado',
    ana?.vigenteDesde.toISOString() === '2026-08-11T10:00:00.000Z',
    `vigenteDesde=${ana?.vigenteDesde.toISOString()}`)

  console.log('\nINBOX — el reintento es normal, no un fallo')
  const rDup = await emitir(url, evento1)
  const cuerpoDup = (await rDup.json()) as { duplicado: boolean }
  comprobar('el mismo eventId reintentado responde 200', rDup.status === 200)
  comprobar('y se reconoce como duplicado', cuerpoDup.duplicado === true)
  comprobar(
    'no dejó una segunda fila en el inbox',
    (await db.eventoRecibido.count({ where: { eventId: evento1.eventId } })) === 1
  )

  console.log('\nORDEN — lo que el cliente en-proceso hacía invisible')
  await emitir(url, sobre({ occurredAt: '2026-08-11T10:05:00.000Z', data: { cliente: { nombre: 'Ana María' } } }))
  await emitir(url, sobre({ occurredAt: '2026-08-11T10:02:00.000Z', data: { cliente: { nombre: 'Ana (viejo)' } } }))
  const tras = await db.clienteProyectado.findUnique({ where: { customerId: 'cli-1' } })
  comprobar(
    'un reintento tardío de un evento viejo NO pisa al nuevo',
    tras?.nombre === 'Ana María',
    `quedó "${tras?.nombre}" — un dato viejo pisando a uno nuevo, sin error ni log`
  )

  console.log('\nRECONCILIACIÓN — lo que arregla un webhook que no llegó nunca')
  // Una copia de hace tres días: el evento se perdió y nada la ha tocado.
  await db.clienteProyectado.update({
    where: { customerId: 'cli-1' },
    data: { nombre: 'Ana (copia vieja)', vigenteDesde: new Date(Date.now() - 72 * 3600 * 1000) },
  })
  const catalogoCore = new Map([['cli-1', { nombre: 'Ana Actualizada', telefono: '+18099990000' }]])
  const { servidor: core, pedidos } = coreDeMentira(catalogoCore)
  await new Promise<void>((r) => core.listen(0, r))
  const puertoCore = (core.address() as { port: number }).port

  const membego = new MembegoClient({
    baseUrl: `http://127.0.0.1:${puertoCore}`,
    clientId: 'id',
    clientSecret: 'secreto',
  })

  const resumen = await reconciliar(membego, reconciliacion, { presupuesto: 10 })
  comprobar('la copia vieja se refrescó contra el Core', resumen.actualizadas === 1, JSON.stringify(resumen))
  comprobar('el SDK pidió token antes de leer', pedidos[0] === 'token', pedidos.join(', '))
  const refrescada = await db.clienteProyectado.findUnique({ where: { customerId: 'cli-1' } })
  comprobar(
    'la base del satélite quedó con el dato del Core',
    refrescada?.nombre === 'Ana Actualizada',
    `nombre=${refrescada?.nombre}`
  )
  comprobar(
    'una copia recién refrescada ya no gasta presupuesto',
    (await reconciliar(membego, reconciliacion, { presupuesto: 10 })).revisadas === 0
  )

  // El cliente desapareció del Core.
  catalogoCore.delete('cli-1')
  await db.clienteProyectado.update({
    where: { customerId: 'cli-1' },
    data: { vigenteDesde: new Date(Date.now() - 72 * 3600 * 1000) },
  })
  const trasBorrado = await reconciliar(membego, reconciliacion, { presupuesto: 10 })
  comprobar('un cliente que ya no está en el Core se olvida', trasBorrado.olvidadas === 1)
  comprobar(
    'y desaparece de la base del satélite',
    (await db.clienteProyectado.count({ where: { customerId: 'cli-1' } })) === 0
  )
  comprobar('la tarea sabe que no se está quedando atrás', seEstaQuedandoAtras(trasBorrado) === false)
  core.close()

  console.log('\nAISLAMIENTO — la base del satélite es suya')
  const tablas = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname='public' order by tablename`
  )
  const nombres = tablas.map((t) => t.tablename)
  comprobar(
    'solo existen las tablas del satélite',
    nombres.join(',') === 'clientes_proyectados,comandas,eventos_recibidos,mesas',
    nombres.join(', ')
  )
  for (const ajena of ['clientes', 'memberships', 'promociones', 'companies']) {
    comprobar(`no existe la tabla \`${ajena}\` de MembeGo`, !nombres.includes(ajena))
  }

  servidor.close()
  await db.$disconnect()

  console.log(`\n${fallos === 0 ? '✓' : '✗'} ${hechas - fallos}/${hechas} comprobaciones`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
