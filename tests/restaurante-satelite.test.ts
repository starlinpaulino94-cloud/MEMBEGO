import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { aplicarEvento, desfase, type AlmacenProyeccion } from '../apps/restaurant/src/proyeccion'
import { cobrarComanda, type AlmacenOperacion } from '../apps/restaurant/src/operacion'
import { entrarPorSso, puede, type SesionRestaurante } from '../apps/restaurant/src/sso'
import type { SobreEvento } from '@membego/contracts'

/**
 * FASE 7b · EL RESTAURANTE COMO SATÉLITE DE VERDAD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ESTÁ PROBANDO, Y POR QUÉ NO SE PROBÓ ANTES
 *
 * Las seis fases anteriores construyeron el aparato entero —API, eventos
 * firmados, SDK, SSO, alta de clientes— y lo validaron CON LA RED
 * DESCONECTADA: Car Wash pide por el contrato, pero con `clienteLocal()`, que
 * llama en proceso. Funciona, y no dice nada sobre lo que pasa cuando hay red
 * en medio.
 *
 * Aquí hay red, hay una base aparte y hay una copia local que puede ir
 * atrasada. Lo que estas pruebas cubren es exactamente lo que el cliente
 * en-proceso hacía invisible.
 */

// ── Dobles ──────────────────────────────────────────────────────────────────

function almacenFalso() {
  const filas = new Map<string, { vigenteDesde: Date; nombre: string }>()
  const almacen: AlmacenProyeccion = {
    async vigenciaDe(id) {
      return filas.get(id)?.vigenteDesde ?? null
    },
    async guardar(f) {
      filas.set(f.customerId, { vigenteDesde: f.vigenteDesde, nombre: f.nombre })
    },
  }
  return { almacen, filas }
}

function evento(over: Partial<SobreEvento> = {}): SobreEvento {
  return {
    eventId: 'ev-1',
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
}

// ── La copia y el orden ─────────────────────────────────────────────────────

test('un evento viejo NO pisa a uno nuevo', async () => {
  const { almacen, filas } = almacenFalso()

  await aplicarEvento(almacen, evento({ occurredAt: '2026-08-11T10:05:00.000Z', data: { cliente: { nombre: 'Ana María' } } }))
  const tarde = await aplicarEvento(
    almacen,
    evento({ eventId: 'ev-2', occurredAt: '2026-08-11T10:00:00.000Z', data: { cliente: { nombre: 'Ana' } } })
  )

  assert.deepEqual(tarde, { aplicado: false, motivo: 'evento-viejo' })
  assert.equal(
    filas.get('cli-1')?.nombre,
    'Ana María',
    'El reintento de un evento de las 10:00 aterrizó después del de las 10:05 y ' +
      'le devolvió el nombre anterior al cliente. No falla nada: solo un dato ' +
      'viejo pisando a uno nuevo, sin error ni log.'
  )
})

test('dos eventos del mismo instante no dependen de quién llegue último', async () => {
  const { almacen } = almacenFalso()
  const mismoInstante = '2026-08-11T10:00:00.000Z'

  await aplicarEvento(almacen, evento({ occurredAt: mismoInstante }))
  const segundo = await aplicarEvento(almacen, evento({ eventId: 'ev-2', occurredAt: mismoInstante }))

  assert.equal(
    segundo.aplicado,
    false,
    'Con `>=` en vez de `>`, dos eventos del mismo instante se aplican los dos y ' +
      'gana el último en llegar — el no-determinismo que la comparación existe ' +
      'para quitar.'
  )
})

test('la proyección ignora lo que no sabe guardar', async () => {
  const { almacen } = almacenFalso()
  const r = await aplicarEvento(almacen, evento({ eventType: 'membership.activated' }))
  assert.deepEqual(
    r,
    { aplicado: false, motivo: 'tipo-ignorado' },
    'Guardar aquí lo que trae una membresía sería empezar a tener saldos en la ' +
      'copia, que es justo lo que no puede pasar.'
  )
})

test('el desfase de la copia es un número que se puede enseñar', () => {
  const ahora = new Date('2026-08-11T10:12:00.000Z')
  assert.equal(desfase(new Date('2026-08-11T10:00:00.000Z'), ahora), 12 * 60 * 1000)
  assert.equal(desfase(null, ahora), null, 'Sin fila no hay desfase que enseñar.')
})

// ── La regla que sostiene la arquitectura ───────────────────────────────────

function operacionFalsa() {
  const cerradas: { id: string; total: number; redemptionId: string | null }[] = []
  const almacen: AlmacenOperacion = {
    async vigenciaDe() {
      return null
    },
    async guardar() {},
    async abrirComanda(mesaId) {
      return { id: 'com-1', mesaId, customerId: null }
    },
    async asignarCliente() {},
    async cerrarComanda(id, total, redemptionId) {
      cerradas.push({ id, total, redemptionId })
    },
  }
  return { almacen, cerradas }
}

test('si el Core rechaza el canje, se cobra completo y se dice por qué', async () => {
  const { almacen, cerradas } = operacionFalsa()
  const llamadas: string[] = []
  const membego = {
    async redeem() {
      llamadas.push('redeem')
      throw new Error('La membresía no tiene usos disponibles.')
    },
    async recordTransaction() {
      llamadas.push('recordTransaction')
      return {}
    },
  }

  const r = await cobrarComanda(membego as never, almacen, {
    id: 'com-1',
    companyId: 'emp-1',
    customerId: 'cli-1',
    membershipId: 'mem-1',
    totalCentavos: 95000,
  })

  assert.equal(r.redemptionId, null)
  assert.match(r.canjeRechazado ?? '', /usos disponibles/)
  assert.equal(
    cerradas[0].total,
    95000,
    'La comanda debe cobrarse COMPLETA cuando el canje no se aplica. Cobrar con ' +
      'descuento un beneficio que el Core rechazó es regalar dinero y no ' +
      'enterarse hasta cuadrar caja.'
  )
})

test('el canje se pide ANTES de cerrar la comanda', async () => {
  const { almacen } = operacionFalsa()
  const orden: string[] = []
  const membego = {
    async redeem() {
      orden.push('canje')
      return { redemptionId: 'red-1' }
    },
    async recordTransaction() {
      orden.push('venta')
      return {}
    },
  }
  const almacenConOrden: AlmacenOperacion = {
    ...almacen,
    async cerrarComanda() {
      orden.push('cierre')
    },
  }

  await cobrarComanda(membego as never, almacenConOrden, {
    id: 'com-1',
    companyId: 'emp-1',
    customerId: 'cli-1',
    membershipId: 'mem-1',
    totalCentavos: 95000,
  })

  assert.ok(
    orden.indexOf('canje') < orden.indexOf('cierre'),
    'Cerrando primero, un fallo del canje deja la comanda cobrada COMO SI se ' +
      'hubiera aplicado el beneficio. Al revés queda un canje consumido y una ' +
      'comanda abierta: visible y arreglable. De los dos desastres, ese avisa.'
  )
})

test('la clave de idempotencia es la comanda, no la llamada', async () => {
  const { almacen } = operacionFalsa()
  const claves: string[] = []
  const membego = {
    async redeem(_p: unknown, clave: string) {
      claves.push(clave)
      return { redemptionId: 'red-1' }
    },
    async recordTransaction() {
      return {}
    },
  }
  const comanda = {
    id: 'com-77',
    companyId: 'emp-1',
    customerId: 'cli-1',
    membershipId: 'mem-1',
    totalCentavos: 95000,
  }

  await cobrarComanda(membego as never, almacen, comanda)
  await cobrarComanda(membego as never, almacen, comanda)

  assert.deepEqual(
    claves,
    ['comanda-com-77', 'comanda-com-77'],
    'Dos cobros de la MISMA comanda tienen que mandar la misma clave. Con una ' +
      'clave nueva por llamada, un reintento consume el beneficio dos veces por ' +
      'una sola comida.'
  )
})

test('una venta que no se registra no impide cobrar', async () => {
  const { almacen, cerradas } = operacionFalsa()
  const membego = {
    async redeem() {
      return { redemptionId: 'red-1' }
    },
    async recordTransaction() {
      throw new Error('MembeGo no responde')
    },
  }

  await cobrarComanda(membego as never, almacen, {
    id: 'com-1',
    companyId: 'emp-1',
    customerId: 'cli-1',
    membershipId: 'mem-1',
    totalCentavos: 95000,
  })
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(
    cerradas.length,
    1,
    'El cliente ya pagó. Bloquear el cobro porque un sistema de informes no ' +
      'responde sería dejar de facturar por analítica.'
  )
})

// ── SSO ─────────────────────────────────────────────────────────────────────

const sesionBase: SesionRestaurante = {
  usuarioId: 'u-1',
  nombre: 'Luis',
  email: 'luis@ejemplo.com',
  companyId: 'emp-1',
  puesto: 'MESERO',
  returnUrl: null,
  expiraEn: new Date('2026-08-11T11:00:00.000Z'),
}

test('el puesto del restaurante NO se deduce del rol de MembeGo', async () => {
  const membego = {
    async redeemSso() {
      return {
        sub: 'u-1',
        email: 'jefa@ejemplo.com',
        nombre: 'Jefa',
        membegoRole: 'ADMIN_EMPRESA',
        systemRole: null,
        permisos: null,
        companyId: 'emp-1',
        returnUrl: null,
        expiresAt: '2026-08-11T11:00:00.000Z',
      }
    },
  }
  const sesion = await entrarPorSso(membego as never, 'tok')

  assert.equal(sesion.puesto, null)
  assert.equal(
    puede(sesion, 'comanda.cobrar'),
    false,
    'Un ADMIN_EMPRESA sin puesto asignado aquí NO puede cobrar. Deducir el ' +
      'puesto del rol de MembeGo mete a quien administra campañas en la caja ' +
      'sin que nadie se lo haya dado.'
  )
})

test('un puesto que este sistema no conoce se trata como sin puesto', async () => {
  const membego = {
    async redeemSso() {
      return {
        sub: 'u-2',
        email: 'x@ejemplo.com',
        nombre: null,
        membegoRole: 'CAJERO',
        systemRole: 'Mesero jefe',
        permisos: null,
        companyId: 'emp-1',
        returnUrl: null,
        expiresAt: '2026-08-11T11:00:00.000Z',
      }
    },
  }
  const sesion = await entrarPorSso(membego as never, 'tok')
  assert.equal(
    sesion.puesto,
    null,
    'MembeGo transporta cadena libre y no la interpreta. Denegar por no ' +
      'reconocerla es correcto; caerse, no.'
  )
})

test('cada puesto puede lo suyo y nada más', () => {
  assert.equal(puede(sesionBase, 'comanda.crear'), true)
  assert.equal(
    puede(sesionBase, 'comanda.cobrar'),
    false,
    'Un mesero no cobra. Lo que no está en la lista, no se puede.'
  )
  assert.equal(puede({ ...sesionBase, puesto: 'CAJA' }, 'comanda.cobrar'), true)
  assert.equal(puede({ ...sesionBase, puesto: 'COCINA' }, 'cliente.identificar'), false)
})

// ── La frontera, como estructura ────────────────────────────────────────────

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('el satélite tiene su propia base y no toca la de MembeGo', () => {
  const esquema = leer('apps/restaurant/prisma/schema.prisma')
  assert.match(
    esquema,
    /env\("RESTAURANT_DATABASE_URL"\)/,
    'La base del satélite tiene que ser SUYA. Apuntar a la de MembeGo convierte ' +
      '«Shared Data Contracts» en «Shared Database» con más pasos.'
  )
  for (const tabla of ['model Cliente ', 'model Membership', 'model Promocion']) {
    assert.ok(
      !esquema.includes(tabla),
      `El satélite declaró ${tabla.trim()}: eso es apropiarse de una tabla del ` +
        'Core. Lo único que puede tener de allí es una proyección de lectura.'
    )
  }
})

test('la copia local no guarda nada que se pueda gastar', () => {
  const esquema = leer('apps/restaurant/prisma/schema.prisma')
  const proyeccion = esquema.slice(
    esquema.indexOf('model ClienteProyectado'),
    esquema.indexOf('model EventoRecibido')
  )
  for (const campo of ['saldo', 'usosRestantes', 'usos', 'creditos', 'puntos']) {
    assert.ok(
      !new RegExp(`\\b${campo}\\b`, 'i').test(proyeccion),
      `La proyección guarda \`${campo}\`. Un dato gastable en la copia local ` +
        'invita a decidir con él, y un webhook lento basta para regalar un ' +
        'beneficio ya consumido en otro local.'
    )
  }
})

test('el satélite no importa nada del monolito', () => {
  for (const archivo of [
    'apps/restaurant/src/proyeccion.ts',
    'apps/restaurant/src/operacion.ts',
    'apps/restaurant/src/webhook.ts',
    'apps/restaurant/src/sso.ts',
  ]) {
    assert.ok(existsSync(archivo), `Falta ${archivo}`)
    const src = leer(archivo)
    for (const prohibido of ["from '@/", 'from "@/', "from '@membego/ui"]) {
      assert.ok(
        !src.includes(prohibido),
        `${archivo} importa del monolito (${prohibido}). Un satélite que puede ` +
          'importar del Core no está separado: comparte código, y con él, ' +
          'despliegues.'
      )
    }
    assert.ok(
      !/@prisma\/client'|from 'prisma/.test(src),
      `${archivo} habla con Prisma directamente. El dominio se prueba sin base; ` +
        'la persistencia entra por interfaz.'
    )
  }
})

test('el inbox del satélite es persistente, no en memoria', () => {
  const esquema = leer('apps/restaurant/prisma/schema.prisma')
  assert.match(
    esquema,
    /model EventoRecibido/,
    'El inbox tiene que sobrevivir a un reinicio: reiniciar es justo cuando ' +
      'MembeGo está reintentando lo que quedó sin responder. Un inbox en ' +
      'memoria se vacía y todo se reprocesa.'
  )
})
