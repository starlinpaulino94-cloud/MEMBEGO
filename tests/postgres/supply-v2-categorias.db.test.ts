import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import {
  crearCategoriaVehiculoEnTx,
  editarCategoriaVehiculoEnTx,
} from '../../src/modules/supply-v2/categories/service'
import { categoriasVehiculo, categoriasVehiculoActivas } from '../../src/modules/supply-v2/categories/queries'
import { casarCategoria } from '../../src/modules/supply-v2/core/categorias'

/**
 * MEMBEGO SUPPLY 2.0 · catálogo de categorías de vehículo contra PostgreSQL.
 *
 * Lo que solo se puede comprobar aquí: que los unique de la tabla den un
 * mensaje que diga QUÉ HACER en vez de «Unique constraint failed on the fields:
 * (`nivelTarifario`)», que la semilla esté donde debe, y que el rastro guarde el
 * antes y el después del nivel —que es lo que decide cobros—.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { admin: '', creada: '' }

/**
 * Niveles propios de esta corrida, calculados a partir del máximo que ya haya.
 *
 * NO son constantes. `nivelTarifario` es ÚNICO en toda la tabla y estas filas
 * no se borran al terminar, así que unos números fijos chocan con los que dejó
 * la corrida anterior: la primera vez pasa y la segunda falla. Es el mismo
 * problema que los contadores globales que ya se quitaron del resto de la
 * suite, y se arregla igual: pedirle a la base un hueco libre en vez de
 * suponerlo.
 */
const N = { uno: 0, dos: 0, tres: 0 }

before(async () => {
  const admin = await prisma.user.create({
    data: { supabaseId: `sb-cat-${sufijo}`, email: `cat-${sufijo}@prueba.test`, name: 'Admin', role: 'SUPERADMIN' },
    select: { id: true },
  })
  ctx.admin = admin.id

  const tope = await prisma.supplyV2VehicleCategory.aggregate({ _max: { nivelTarifario: true } })
  const base = (tope._max.nivelTarifario ?? 0) + 1
  N.uno = base
  N.dos = base + 1
  N.tres = base + 2
})

test('A · la semilla deja las cuatro categorías de referencia, con sus niveles', async () => {
  // No es una invención: es la enumeración que el esquema de `tipos_vehiculo`
  // ya declaraba como numeración de referencia del proyecto.
  const todas = await categoriasVehiculo()
  const porCode = new Map(todas.map((c) => [c.code, c]))
  for (const [code, nivel] of [
    ['SEDAN', 1],
    ['SUV', 2],
    ['PICKUP', 3],
    ['COMERCIAL', 4],
  ] as const) {
    const c = porCode.get(code)
    assert.ok(c, `falta la categoría ${code} de la semilla`)
    assert.equal(c!.nivelTarifario, nivel)
    assert.equal(c!.activo, true)
  }
})

test('B · crear una categoría deja rastro con su nivel', async () => {
  const r = await sinEmpresa('prueba', (tx) =>
    crearCategoriaVehiculoEnTx(
      tx,
      { code: `PATANA_${sufijo.toUpperCase()}`, nombre: `Patana ${sufijo}`, nivelTarifario: N.uno, orden: 90 },
      como(ctx.admin)
    )
  )
  ctx.creada = r.id
  const rastro = await prisma.auditLog.findFirst({
    where: { accion: 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', entidadId: r.id },
    orderBy: { createdAt: 'desc' },
  })
  assert.ok(rastro, 'crear una categoría tiene que dejar rastro: decide cuánto se cobra')
  const payload = rastro!.payload as Record<string, unknown>
  assert.equal(payload.que, 'CREADA')
  assert.equal(payload.nivelTarifario, N.uno)
})

test('C · un NIVEL OCUPADO se explica, no se escupe el error de Prisma', async () => {
  // Es el error más fácil de cometer aquí, porque es justo lo que alguien
  // intenta al reordenar el catálogo. Sin traducir, el mensaje sería «Unique
  // constraint failed on the fields: (`nivelTarifario`)»: cierto e inútil.
  await assert.rejects(
    sinEmpresa('prueba', (tx) =>
      crearCategoriaVehiculoEnTx(
        tx,
        { code: `OTRA_${sufijo.toUpperCase()}`, nombre: `Otra ${sufijo}`, nivelTarifario: N.uno },
        como(ctx.admin)
      )
    ),
    (e: Error) => {
      assert.match(e.message, /Ya hay una categoría en ese nivel tarifario/)
      // Y dice qué hacer, no solo qué pasó.
      assert.match(e.message, /cambia el nivel de la otra primero/)
      return true
    }
  )
  // Lo mismo al EDITAR hacia un nivel ya tomado: la semilla tiene el 2 (SUV).
  await assert.rejects(
    sinEmpresa('prueba', (tx) => editarCategoriaVehiculoEnTx(tx, ctx.creada, { nivelTarifario: 2 }, como(ctx.admin))),
    /Ya hay una categoría en ese nivel tarifario/
  )
})

test('C2 · un código o un nombre repetidos también se explican', async () => {
  await assert.rejects(
    sinEmpresa('prueba', (tx) =>
      crearCategoriaVehiculoEnTx(tx, { code: 'SEDAN', nombre: `Repe ${sufijo}`, nivelTarifario: N.dos }, como(ctx.admin))
    ),
    /Ya existe una categoría con ese código/
  )
  await assert.rejects(
    sinEmpresa('prueba', (tx) =>
      crearCategoriaVehiculoEnTx(tx, { code: `X_${sufijo.toUpperCase()}`, nombre: 'Sedán', nivelTarifario: N.dos }, como(ctx.admin))
    ),
    /Ya existe una categoría con ese nombre/
  )
})

test('D · reenviar los mismos valores no es un cambio: no toca nada ni audita', async () => {
  const antes = await prisma.auditLog.count({
    where: { accion: 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', entidadId: ctx.creada },
  })
  const actual = await prisma.supplyV2VehicleCategory.findUniqueOrThrow({ where: { id: ctx.creada } })
  const r = await sinEmpresa('prueba', (tx) =>
    editarCategoriaVehiculoEnTx(
      tx,
      ctx.creada,
      { nombre: actual.nombre, nivelTarifario: actual.nivelTarifario, orden: actual.orden },
      como(ctx.admin)
    )
  )
  assert.deepEqual(r.cambios, [])
  assert.equal(
    await prisma.auditLog.count({ where: { accion: 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', entidadId: ctx.creada } }),
    antes,
    'un no-op no debe ensuciar la bitácora'
  )
})

test('E · mover el nivel guarda el ANTES y el DESPUÉS, no solo «cambió»', async () => {
  // «Cambió el nivel» no sirve para reconstruir por qué una compra cobró lo que
  // cobró. El rastro tiene que decir de dónde a dónde.
  const r = await sinEmpresa('prueba', (tx) =>
    editarCategoriaVehiculoEnTx(tx, ctx.creada, { nivelTarifario: N.tres }, como(ctx.admin))
  )
  assert.deepEqual(r.cambios, ['nivel tarifario'])
  const rastro = await prisma.auditLog.findFirstOrThrow({
    where: { accion: 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', entidadId: ctx.creada },
    orderBy: { createdAt: 'desc' },
  })
  const payload = rastro.payload as Record<string, unknown>
  assert.equal(payload.nivelAntes, N.uno)
  assert.equal(payload.nivelDespues, N.tres)
})

test('F · desactivar NO borra, y deja de resolver precios', async () => {
  // La baja es lógica porque una oferta publicada puede tener un precio colgado
  // de esta categoría: borrarla reescribiría el pasado.
  await sinEmpresa('prueba', (tx) => editarCategoriaVehiculoEnTx(tx, ctx.creada, { activo: false }, como(ctx.admin)))

  const fila = await prisma.supplyV2VehicleCategory.findUnique({ where: { id: ctx.creada } })
  assert.ok(fila, 'la fila sigue ahí: la baja es lógica');
  assert.equal(fila!.activo, false)

  // Y el efecto que importa: ya no resuelve su nivel.
  const activas = await categoriasVehiculoActivas()
  assert.equal(activas.some((c) => c.id === ctx.creada), false, 'una desactivada no sale entre las activas')
  assert.equal(casarCategoria(activas, N.tres).origen, 'SIN_CORRESPONDENCIA')
  // La administración sí la sigue viendo, para poder reactivarla.
  assert.equal((await categoriasVehiculo()).some((c) => c.id === ctx.creada), true)

  // Reactivarla la devuelve al juego.
  await sinEmpresa('prueba', (tx) => editarCategoriaVehiculoEnTx(tx, ctx.creada, { activo: true }, como(ctx.admin)))
  assert.equal(casarCategoria(await categoriasVehiculoActivas(), N.tres).categoria?.id, ctx.creada)
})

test('G · las categorías de la semilla resuelven de punta a punta contra la base', async () => {
  // La prueba de que el catálogo real y la regla pura encajan: los niveles que
  // el esquema de `tipos_vehiculo` usa como referencia resuelven a la categoría
  // que les toca.
  const activas = await categoriasVehiculoActivas()
  assert.equal(casarCategoria(activas, 1).categoria?.code, 'SEDAN')
  assert.equal(casarCategoria(activas, 2).categoria?.code, 'SUV')
  assert.equal(casarCategoria(activas, 3).categoria?.code, 'PICKUP')
  assert.equal(casarCategoria(activas, 4).categoria?.code, 'COMERCIAL')
  // Un nivel que nadie mapeó cae al base y lo dice, en vez de redondear.
  assert.equal(casarCategoria(activas, 50).origen, 'SIN_CORRESPONDENCIA')
})
