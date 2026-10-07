import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { actualizarItemEnTx, agregarVarianteEnTx, crearItemEnTx, eliminarVarianteEnTx } from '../../src/modules/catalog/service'
import { CatalogoError } from '../../src/modules/catalog/errores'
import {
  ajustarEnTx,
  configurarUmbralEnTx,
  consumirReservaEnTx,
  contarEnTx,
  danarEnTx,
  devolverEnTx,
  liberarReservaEnTx,
  recibirEnTx,
  reservarEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  venderEnTx,
  vencerReservasEnTx,
} from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { barridoInventario } from '../../src/modules/inventory/barrido'
import { alertasDeStockEnTx, detalleVarianteEnTx, historialDeVarianteEnTx, listarInventarioEnTx, reservasVivasEnTx } from '../../src/modules/inventory/queries'
import { MOVIMIENTOS_PERMITIDOS, TIPOS_DE_MOVIMIENTO, BUCKETS, cuadra, disponible, validarMovimiento } from '../../src/modules/inventory/domain'

/**
 * COMMERCE CORE · inventario con ledger contra PostgreSQL de verdad (Fase 2).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que `available` nunca queda negativo NI bajo concurrencia (varias
 *    reservas y ventas simultáneas de las últimas unidades);
 *  · que el ledger no se edita: UPDATE, DELETE y TRUNCATE los rechaza la base;
 *  · que la tabla de traslados del dominio y el CHECK de la base dicen lo mismo
 *    (las 144 combinaciones tipo × origen × destino);
 *  · que los contadores del saldo SIEMPRE cuadran con la suma del ledger y que
 *    `reserved` es igual a lo que suman las reservas vivas;
 *  · que una reserva vencida deja de apartar sin esperar al barrido;
 *  · que ninguna empresa ve ni toca el inventario de otra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const T0 = new Date('2030-01-01T10:00:00.000Z')
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000)

const ctx = { a: '', b: '', usuario: '', sucA1: '', sucA2: '', sucA3Inactiva: '', sucB: '', varA: '', varA2: '', varServicio: '', varB: '' }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) =>
      prisma.company.create({
        data: { name: `Inventario ${x} ${sufijo}`, slug: `inventario-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' },
        select: { id: true },
      })
    )
  )
  ctx.a = a.id
  ctx.b = b.id
  const u = await prisma.user.create({
    data: { supabaseId: `sb-inv-${sufijo}`, email: `inv-${sufijo}@prueba.test`, name: 'Inventario', role: 'SUPERADMIN' },
    select: { id: true },
  })
  ctx.usuario = u.id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Segunda')).id
  ctx.sucA3Inactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id

  const crear = async (companyId: string, name: string, type: 'PHYSICAL_PRODUCT' | 'SERVICE', sku: string) => {
    const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name, type, price: 100, sku }, como(ctx.usuario)))
    const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
    return v.id
  }
  ctx.varA = await crear(ctx.a, `Camiseta ${sufijo}`, 'PHYSICAL_PRODUCT', `INV-A-${sufijo}`)
  ctx.varA2 = await crear(ctx.a, `Gorra ${sufijo}`, 'PHYSICAL_PRODUCT', `INV-A2-${sufijo}`)
  ctx.varServicio = await crear(ctx.a, `Lavado ${sufijo}`, 'SERVICE', `INV-S-${sufijo}`)
  ctx.varB = await crear(ctx.b, `Ajeno ${sufijo}`, 'PHYSICAL_PRODUCT', `INV-B-${sufijo}`)
})

after(async () => {
  // El ledger no se borra (lo prohíbe la base). Para limpiar el rastro de la
  // prueba se desactivan los disparadores ordinarios solo en esta transacción:
  // `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "inventory_movements" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_reservations" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_levels" WHERE "companyId" IN (${Prisma.join(ids)})`
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

/** El error de dominio con su código, o falla la prueba si lo que pasó fue otra cosa. */
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un InventarioError y no falló')
}

const base = (varianteId: string, sucursalId: string) => ({ varianteId, sucursalId })
const nivelDe = (varianteId: string, sucursalId: string) =>
  prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } } })
const movimientosDe = (nivelId: string) => prisma.inventoryMovement.findMany({ where: { inventoryLevelId: nivelId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })

/** Las tres cuentas que SIEMPRE deben cuadrar: ledger, saldo y reservas vivas. */
async function verificarCuadre(nivelId: string) {
  const n = await prisma.inventoryLevel.findUniqueOrThrow({ where: { id: nivelId } })
  const movs = await movimientosDe(nivelId)
  assert.ok(cuadra(n, movs), `el saldo (${n.onHand}/${n.reserved}/${n.damaged}) no cuadra con el ledger`)
  const vivas = await prisma.inventoryReservation.aggregate({ where: { inventoryLevelId: nivelId, status: 'ACTIVE' }, _sum: { quantity: true } })
  assert.equal(n.reserved, vivas._sum.quantity ?? 0, 'reserved no es igual a la suma de las reservas ACTIVE')
  assert.ok(disponible(n) >= 0, 'available quedó negativo')
}

// ── Entradas y salidas ───────────────────────────────────────────────────────

test('1 · recibir crea el saldo, deja el asiento con el antes y el después, y audita', async () => {
  const r = await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: 10, motivo: 'Compra inicial' }, como(ctx.usuario)))
  assert.equal(r.repetido, false)
  assert.deepEqual(r.saldo, { onHand: 10, reserved: 0, damaged: 0, disponible: 10 })
  const movs = await movimientosDe(r.nivelId)
  assert.equal(movs.length, 1)
  assert.equal(movs[0].type, 'PURCHASE')
  assert.equal(movs[0].previousOnHand, 0)
  assert.equal(movs[0].newOnHand, 10)
  assert.equal(movs[0].sourceBucket, null)
  assert.equal(movs[0].destinationBucket, 'AVAILABLE')
  assert.equal(movs[0].userId, ctx.usuario)
  const audit = await prisma.auditLog.findFirst({ where: { companyId: ctx.a, accion: 'INVENTORY_STOCK_CHANGED', entidadId: r.nivelId } })
  assert.ok(audit, 'la entrada manual debe dejar rastro en la bitácora')
  await verificarCuadre(r.nivelId)
})

test('2 · un producto que no controla inventario no lleva existencias', async () => {
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varServicio, ctx.sucA1), cantidad: 1 }, como(null)))), 'SIN_CONTROL_DE_INVENTARIO')
})

test('3 · cantidades, motivos y sucursales inválidos se rechazan antes de tocar nada', async () => {
  const c = (n: number) => enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: n }, como(null)))
  for (const mala of [0, -1, 1.5, Number.NaN, 2_000_000]) assert.equal(await codigoDe(c(mala)), 'CANTIDAD_INVALIDA', String(mala))
  assert.equal(await codigoDe(enA((tx) => danarEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: 1 }, como(null)))), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cambio: -1, motivo: '   ' }, como(null)))), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cambio: 0, motivo: 'x' }, como(null)))), 'CANTIDAD_INVALIDA')
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA3Inactiva), cantidad: 1 }, como(null)))), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base('no-existe', ctx.sucA1), cantidad: 1 }, como(null)))), 'VARIANTE_NO_ENCONTRADA')
})

test('4 · available nunca queda negativo: vender de más se rechaza y no escribe nada', async () => {
  const antes = await nivelDe(ctx.varA, ctx.sucA1)
  const movsAntes = (await movimientosDe(antes.id)).length
  assert.equal(await codigoDe(enA((tx) => venderEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: 11 }, como(null)))), 'STOCK_INSUFICIENTE')
  const despues = await nivelDe(ctx.varA, ctx.sucA1)
  assert.equal(despues.onHand, antes.onHand)
  assert.equal((await movimientosDe(antes.id)).length, movsAntes)
  const ok = await enA((tx) => venderEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: 4 }, como(null)))
  assert.deepEqual(ok.saldo, { onHand: 6, reserved: 0, damaged: 0, disponible: 6 })
  await verificarCuadre(antes.id)
})

test('5 · lo apartado no se puede vender como si estuviera libre', async () => {
  const v = ctx.varA2
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 10 }, como(null)))
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 8, ahora: T0 }, como(null)))
  assert.equal(await codigoDe(enA((tx) => venderEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 3, ahora: T0 }, como(null)))), 'STOCK_INSUFICIENTE')
  const ok = await enA((tx) => venderEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 2, ahora: T0 }, como(null)))
  assert.deepEqual(ok.saldo, { onHand: 8, reserved: 8, damaged: 0, disponible: 0 })
  await verificarCuadre(ok.nivelId)
})

test('6 · devolver, dañar y resolver lo dañado mueven la cubeta correcta', async () => {
  const v = ctx.varA
  await enA((tx) => devolverEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 2 }, como(null)))
  assert.equal((await nivelDe(v, ctx.sucA1)).onHand, 8)
  const d = await enA((tx) => danarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 3, motivo: 'Se mojaron' }, como(ctx.usuario)))
  assert.deepEqual(d.saldo, { onHand: 5, reserved: 0, damaged: 3, disponible: 5 })
  const rec = await enA((tx) => resolverDanadoEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 1, destino: 'VENDIBLE', motivo: 'Se secaron' }, como(null)))
  assert.deepEqual(rec.saldo, { onHand: 6, reserved: 0, damaged: 2, disponible: 6 })
  const baja = await enA((tx) => resolverDanadoEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 2, destino: 'BAJA', motivo: 'Irrecuperables' }, como(null)))
  assert.deepEqual(baja.saldo, { onHand: 6, reserved: 0, damaged: 0, disponible: 6 })
  assert.equal(await codigoDe(enA((tx) => resolverDanadoEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 1, destino: 'BAJA', motivo: 'x' }, como(null)))), 'STOCK_INSUFICIENTE')
  await verificarCuadre(d.nivelId)
})

test('7 · ajustar sube o baja lo vendible y exige motivo', async () => {
  const v = ctx.varA
  const sube = await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cambio: 4, motivo: 'Sobrante en bodega' }, como(null)))
  assert.equal(sube.saldo.onHand, 10)
  const baja = await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cambio: -10, motivo: 'Robo' }, como(null)))
  assert.equal(baja.saldo.onHand, 0)
  assert.equal(await codigoDe(enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cambio: -1, motivo: 'otro' }, como(null)))), 'STOCK_INSUFICIENTE')
  await verificarCuadre(sube.nivelId)
})

test('8 · el conteo físico calcula la diferencia; sin diferencia no escribe; no baja de lo apartado', async () => {
  const v = ctx.varA
  const r = await enA((tx) => contarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), conteo: 12 }, como(ctx.usuario)))
  assert.equal(r.diferencia, 12)
  assert.equal(r.saldo.onHand, 12)
  const mov = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: r.movimientoId } })
  assert.equal(mov.reason, 'Conteo físico')
  assert.equal(mov.referenceType, 'STOCK_COUNT')
  const igual = await enA((tx) => contarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), conteo: 12 }, como(null)))
  assert.equal(igual.diferencia, 0)
  assert.equal(igual.movimientoId, '')
  assert.equal((await movimientosDe(r.nivelId)).filter((m) => m.type === 'ADJUSTMENT' && m.reason === 'Conteo físico').length, 1)
  // Con 5 apartadas, no se puede contar 3.
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), cantidad: 5, ahora: T0 }, como(null)))
  assert.equal(await codigoDe(enA((tx) => contarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), conteo: 3, ahora: T0 }, como(null)))), 'CONTEO_BAJO_APARTADO')
  const ok = await enA((tx) => contarEnTx(tx, ctx.a, { ...base(v, ctx.sucA1), conteo: 6, ahora: T0 }, como(null)))
  assert.equal(ok.saldo.disponible, 1)
  await verificarCuadre(r.nivelId)
})

// ── Aislamiento ──────────────────────────────────────────────────────────────

test('9 · una empresa no mueve ni ve el inventario de otra', async () => {
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varB, ctx.sucA1), cantidad: 1 }, como(null)))), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucB), cantidad: 1 }, como(null)))), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => recibirEnTx(tx, ctx.b, { ...base(ctx.varA, ctx.sucB), cantidad: 1 }, como(null)))), 'VARIANTE_NO_ENCONTRADA')
  // Una reserva de A no se libera desde B aunque B conozca su id.
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(ctx.varA, ctx.sucA1), cantidad: 1, ahora: T0 }, como(null)))
  assert.equal(await codigoDe(enB((tx) => liberarReservaEnTx(tx, ctx.b, r.reservaId, { ahora: T0 }, como(null)))), 'RESERVA_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => consumirReservaEnTx(tx, ctx.b, r.reservaId, { ahora: T0 }, como(null)))), 'RESERVA_NO_ENCONTRADA')
  await enA((tx) => liberarReservaEnTx(tx, ctx.a, r.reservaId, { ahora: T0 }, como(null)))
})

test('10 · la base rechaza un saldo que mezcle la variante de una empresa con la sucursal de otra', async () => {
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_levels" ("id","companyId","catalogVariantId","locationId","updatedAt")
      VALUES (${`mezcla-${sufijo}`}, ${ctx.a}, ${ctx.varA}, ${ctx.sucB}, now())`,
    /foreign key|violates/i
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_levels" ("id","companyId","catalogVariantId","locationId","updatedAt")
      VALUES (${`mezcla2-${sufijo}`}, ${ctx.b}, ${ctx.varA}, ${ctx.sucB}, now())`,
    /foreign key|violates/i
  )
})

// ── Reglas de la base ────────────────────────────────────────────────────────

test('11 · la base rechaza saldos imposibles aunque se escriba por fuera del servicio', async () => {
  const n = await nivelDe(ctx.varA, ctx.sucA1)
  for (const [col, valor] of [['onHand', -1], ['damaged', -1], ['reserved', n.onHand + 1], ['lowStockThreshold', -1]] as const) {
    await assert.rejects(
      prisma.$executeRawUnsafe(`UPDATE "inventory_levels" SET "${col}" = ${valor} WHERE "id" = '${n.id}'`),
      /inventory_levels_saldos|check/i,
      col
    )
  }
})

test('12 · el ledger es inmutable: UPDATE, DELETE y TRUNCATE los rechaza la base', async () => {
  const n = await nivelDe(ctx.varA, ctx.sucA1)
  const [m] = await movimientosDe(n.id)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_movements" SET "quantity" = 999 WHERE "id" = ${m.id}`, /inventory_movements_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_movements" SET "reason" = 'editado' WHERE "id" = ${m.id}`, /inventory_movements_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_movements" WHERE "id" = ${m.id}`, /inventory_movements_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_movements"'), /inventory_movements_inmutable/)
  await assert.rejects(prisma.inventoryMovement.update({ where: { id: m.id }, data: { quantity: 1 } }), /inmutable/)
  await assert.rejects(prisma.inventoryMovement.deleteMany({ where: { id: m.id } }), /inmutable/)
  const intacto = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: m.id } })
  assert.equal(intacto.quantity, m.quantity)
})

test('13 · la tabla de traslados del dominio y el CHECK de la base dicen lo mismo (144 combinaciones)', async () => {
  const n = await nivelDe(ctx.varA, ctx.sucA1)
  const origenes = [null, ...BUCKETS]
  const aceptadasPorLaBase: string[] = []
  const aceptadasPorElDominio: string[] = []
  class Fin extends Error {}
  await prisma
    .$transaction(async (tx) => {
      // Dentro de la transacción el ledger sí admite INSERT; no hay nada que
      // deshacer porque al final se aborta toda.
      for (const type of TIPOS_DE_MOVIMIENTO) {
        for (const src of origenes) {
          for (const dst of origenes) {
            const clave = `${type}:${src ?? '-'}>${dst ?? '-'}`
            if (validarMovimiento({ type, sourceBucket: src, destinationBucket: dst, quantity: 1, reason: 'x' }) === null) aceptadasPorElDominio.push(clave)
            await tx.$executeRawUnsafe('SAVEPOINT combo')
            try {
              await tx.$executeRawUnsafe(
                `INSERT INTO "inventory_movements" ("id","companyId","inventoryLevelId","type","sourceBucket","destinationBucket","quantity","previousOnHand","newOnHand","reason")
                 VALUES ('combo-${sufijo}-${aceptadasPorElDominio.length}-${aceptadasPorLaBase.length}-${Math.random().toString(36).slice(2)}', '${ctx.a}', '${n.id}', '${type}', ${src ? `'${src}'` : 'NULL'}, ${dst ? `'${dst}'` : 'NULL'}, 1, 0, 0, 'x')`
              )
              aceptadasPorLaBase.push(clave)
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT combo')
            } catch {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT combo')
            }
          }
        }
      }
      throw new Fin()
    })
    .catch((e) => {
      if (!(e instanceof Fin)) throw e
    })
  assert.equal(TIPOS_DE_MOVIMIENTO.length * origenes.length * origenes.length, 144)
  assert.deepEqual(aceptadasPorLaBase.sort(), aceptadasPorElDominio.sort())
  const total = Object.values(MOVIMIENTOS_PERMITIDOS).reduce((s, l) => s + l.length, 0)
  assert.equal(aceptadasPorElDominio.length, total, 'cada traslado permitido es una combinación aceptada')
  assert.ok(total > 0)
})

test('14 · un ajuste o un daño sin motivo lo rechaza la base', async () => {
  const n = await nivelDe(ctx.varA, ctx.sucA1)
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_movements" ("id","companyId","inventoryLevelId","type","destinationBucket","quantity","previousOnHand","newOnHand")
      VALUES (${`sinmotivo-${sufijo}`}, ${ctx.a}, ${n.id}, 'ADJUSTMENT', 'AVAILABLE', 1, 0, 1)`,
    /inventory_movements_motivo|check/i
  )
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('15 · 20 reservas simultáneas de 5 unidades: ganan exactamente 5, el resto no encuentra stock', async () => {
  const suc = await sucursalLimpia(`conc-${sufijo}`)
  const v = ctx.varA2
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5 }, como(null)))
  const resultados = await Promise.allSettled(
    Array.from({ length: 20 }, () => enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, ahora: T0 }, como(null))))
  )
  const ganadas = resultados.filter((r) => r.status === 'fulfilled').length
  const perdidas = resultados.filter((r) => r.status === 'rejected' && r.reason instanceof InventarioError && r.reason.codigo === 'STOCK_INSUFICIENTE').length
  assert.equal(ganadas, 5)
  assert.equal(perdidas, 15)
  const n = await nivelDe(v, suc)
  assert.equal(n.reserved, 5)
  assert.equal(disponible(n), 0)
  await verificarCuadre(n.id)
})

test('16 · dos ventas simultáneas de la última unidad: solo una gana', async () => {
  const v = ctx.varA
  const s = ctx.sucA2
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, s), cantidad: 1 }, como(null)))
  const r = await Promise.allSettled([1, 2].map(() => enA((tx) => venderEnTx(tx, ctx.a, { ...base(v, s), cantidad: 1 }, como(null)))))
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1)
  const n = await nivelDe(v, s)
  assert.equal(n.onHand, 0)
  await verificarCuadre(n.id)
})

test('17 · la misma clave de idempotencia, aunque llegue 5 veces a la vez, mueve el stock una sola vez', async () => {
  const v = ctx.varA
  const s = ctx.sucA2
  const antes = (await nivelDe(v, s)).onHand
  const clave = `recepcion-${sufijo}`
  const r = await Promise.all(Array.from({ length: 5 }, () => enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, s), cantidad: 7, idempotencyKey: clave }, como(null)))))
  assert.equal(r.filter((x) => !x.repetido).length, 1)
  assert.equal(r.filter((x) => x.repetido).length, 4)
  assert.equal(new Set(r.map((x) => x.movimientoId)).size, 1)
  assert.equal((await nivelDe(v, s)).onHand, antes + 7)
  // La misma clave para OTRA operación es un error, no un reintento.
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, s), cantidad: 8, idempotencyKey: clave }, como(null)))), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(enA((tx) => venderEnTx(tx, ctx.a, { ...base(v, s), cantidad: 7, idempotencyKey: clave }, como(null)))), 'CLAVE_REUTILIZADA')
})

test('18 · transferencias cruzadas A→B y B→A en paralelo no se interbloquean y conservan el total', async () => {
  const v = ctx.varA2
  const [s1, s2] = [ctx.sucA1, ctx.sucA2]
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, s1), cantidad: 50 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, s2), cantidad: 50 }, como(null)))
  const totalAntes = (await nivelDe(v, s1)).onHand + (await nivelDe(v, s2)).onHand
  const tareas = Array.from({ length: 24 }, (_, i) =>
    enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: i % 2 ? s1 : s2, destinoId: i % 2 ? s2 : s1, cantidad: 1 + (i % 3), ahora: T0 }, como(null)))
  )
  const r = await Promise.allSettled(tareas)
  for (const x of r) if (x.status === 'rejected') assert.ok(x.reason instanceof InventarioError, `fallo inesperado: ${String(x.reason)}`)
  const a = await nivelDe(v, s1)
  const b = await nivelDe(v, s2)
  assert.equal(a.onHand + b.onHand, totalAntes, 'una transferencia no crea ni destruye unidades')
  await verificarCuadre(a.id)
  await verificarCuadre(b.id)
})

// ── Transferencias ───────────────────────────────────────────────────────────

test('19 · transferir mueve las dos patas con la misma referencia; si falla, no mueve ninguna', async () => {
  const v = ctx.varA
  const [s1, s2] = [ctx.sucA1, ctx.sucA2]
  await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, s1), cambio: 20, motivo: 'Para transferir' }, como(null)))
  const a0 = await nivelDe(v, s1)
  const b0 = await nivelDe(v, s2)
  const t = await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s2, cantidad: 6, motivo: 'Reabasto' }, como(ctx.usuario)))
  assert.equal((await nivelDe(v, s1)).onHand, a0.onHand - 6)
  assert.equal((await nivelDe(v, s2)).onHand, b0.onHand + 6)
  const patas = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, referenceType: 'TRANSFER', referenceId: t.transferenciaId } })
  assert.deepEqual(patas.map((p) => p.type).sort(), ['TRANSFER_IN', 'TRANSFER_OUT'])
  assert.ok(await prisma.auditLog.findFirst({ where: { companyId: ctx.a, accion: 'INVENTORY_TRANSFERRED', entidadId: t.salida.nivelId } }))

  // Falla: más de lo que hay. Ninguna pata se escribe.
  const a1 = await nivelDe(v, s1)
  const movs1 = (await movimientosDe(a1.id)).length
  const movs2 = (await movimientosDe(b0.id)).length
  assert.equal(await codigoDe(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s2, cantidad: a1.onHand + 1 }, como(null)))), 'STOCK_INSUFICIENTE')
  assert.equal((await movimientosDe(a1.id)).length, movs1)
  assert.equal((await movimientosDe(b0.id)).length, movs2)

  assert.equal(await codigoDe(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s1, cantidad: 1 }, como(null)))), 'MISMA_SUCURSAL')
  assert.equal(await codigoDe(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: ctx.sucA3Inactiva, cantidad: 1 }, como(null)))), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: ctx.sucB, cantidad: 1 }, como(null)))), 'SUCURSAL_NO_ENCONTRADA')

  // Idempotente.
  const clave = `transf-${sufijo}`
  const x = await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s2, cantidad: 1, idempotencyKey: clave }, como(null)))
  const y = await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s2, cantidad: 1, idempotencyKey: clave }, como(null)))
  assert.equal(x.repetido, false)
  assert.equal(y.repetido, true)
  assert.equal(y.transferenciaId, x.transferenciaId)
  assert.equal((await nivelDe(v, s1)).onHand, a1.onHand - 1)
  await verificarCuadre(a0.id)
  await verificarCuadre(b0.id)
})

test('20 · lo apartado no se transfiere', async () => {
  const v = ctx.varA
  const [s1, s2] = [ctx.sucA1, ctx.sucA2]
  const n = await nivelDe(v, s1)
  const libres = disponible(n)
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, s1), cantidad: libres, ahora: T0, ttlMinutos: 60 }, como(null)))
  assert.equal(await codigoDe(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: s1, destinoId: s2, cantidad: 1, ahora: T0 }, como(null)))), 'STOCK_INSUFICIENTE')
  await verificarCuadre(n.id)
})

// ── Reservas con TTL ─────────────────────────────────────────────────────────

async function sucursalLimpia(nombre: string) {
  const s = await prisma.sucursal.create({ data: { companyId: ctx.a, nombre }, select: { id: true } })
  return s.id
}

test('21 · una reserva vencida deja de apartar SIN esperar al barrido: otra puede usar esas unidades', async () => {
  const suc = await sucursalLimpia(`ttl-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 3 }, como(null)))
  const r1 = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 3, ttlMinutos: 10, ahora: T0, referencia: { tipo: 'ORDER', id: 'pedido-1' } }, como(null)))
  assert.equal(r1.expiresAt.getTime(), minutos(10).getTime())
  assert.equal(await codigoDe(enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, ahora: minutos(5) }, como(null)))), 'STOCK_INSUFICIENTE')
  // A los 11 minutos la primera ya venció: la segunda encuentra stock.
  const r2 = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, ahora: minutos(11) }, como(null)))
  assert.equal(r2.saldo.reserved, 2)
  assert.equal(r2.saldo.disponible, 1)
  const vieja = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: r1.reservaId } })
  assert.equal(vieja.status, 'EXPIRED')
  assert.ok(vieja.resolvedAt)
  const liberacion = await prisma.inventoryMovement.findFirst({ where: { companyId: ctx.a, type: 'RESERVATION_RELEASE', referenceId: r1.reservaId } })
  assert.ok(liberacion, 'el vencimiento deja su asiento')
  assert.equal(liberacion.userId, null, 'lo venció el sistema, no una persona')
  await verificarCuadre(r2.nivelId)
})

test('22 · consumir una reserva viva la convierte en venta; una vencida ya no se puede cobrar', async () => {
  const suc = await sucursalLimpia(`cons-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 10 }, como(null)))
  const viva = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 4, ttlMinutos: 10, ahora: T0, referencia: { tipo: 'ORDER', id: 'pedido-7' } }, como(null)))
  const c = await enA((tx) => consumirReservaEnTx(tx, ctx.a, viva.reservaId, { ahora: minutos(5) }, como(null)))
  assert.equal(c.repetido, false)
  assert.deepEqual(c.saldo, { onHand: 6, reserved: 0, damaged: 0, disponible: 6 })
  const mov = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: c.movimientoId ?? '' } })
  assert.equal(mov.type, 'SALE')
  assert.equal(mov.sourceBucket, 'RESERVED')
  assert.equal(mov.referenceType, 'ORDER')
  assert.equal(mov.referenceId, 'pedido-7')
  // Cobrar dos veces: el segundo no vende nada más.
  const otra = await enA((tx) => consumirReservaEnTx(tx, ctx.a, viva.reservaId, { ahora: minutos(6) }, como(null)))
  assert.equal(otra.repetido, true)
  assert.equal((await nivelDe(v, suc)).onHand, 6)
  assert.equal(await codigoDe(enA((tx) => liberarReservaEnTx(tx, ctx.a, viva.reservaId, { ahora: minutos(6) }, como(null)))), 'RESERVA_CONSUMIDA')

  const caduca = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, ttlMinutos: 10, ahora: T0 }, como(null)))
  assert.equal(await codigoDe(enA((tx) => consumirReservaEnTx(tx, ctx.a, caduca.reservaId, { ahora: minutos(10) }, como(null)))), 'RESERVA_VENCIDA')
  // El intento fallido deshizo su propia transacción (incluido el vencimiento):
  // la reserva sigue ACTIVE hasta que alguien la venza, y entonces se libera.
  assert.equal(await enA((tx) => vencerReservasEnTx(tx, ctx.a, minutos(10))), 1)
  assert.equal((await nivelDe(v, suc)).reserved, 0)
  assert.equal(await codigoDe(enA((tx) => consumirReservaEnTx(tx, ctx.a, caduca.reservaId, { ahora: minutos(11) }, como(null)))), 'RESERVA_VENCIDA')
  await verificarCuadre((await nivelDe(v, suc)).id)
})

test('23 · liberar devuelve lo apartado, es inofensivo repetido y no toca lo vendido', async () => {
  const suc = await sucursalLimpia(`lib-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5 }, como(null)))
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5, ahora: T0 }, como(null)))
  const l = await enA((tx) => liberarReservaEnTx(tx, ctx.a, r.reservaId, { motivo: 'Pedido cancelado', ahora: T0 }, como(ctx.usuario)))
  assert.equal(l.estado, 'RELEASED')
  assert.equal(l.saldo.disponible, 5)
  const otra = await enA((tx) => liberarReservaEnTx(tx, ctx.a, r.reservaId, { ahora: T0 }, como(ctx.usuario)))
  assert.equal(otra.repetido, true)
  assert.equal(otra.saldo.disponible, 5)
  assert.equal(await codigoDe(enA((tx) => consumirReservaEnTx(tx, ctx.a, r.reservaId, { ahora: T0 }, como(null)))), 'RESERVA_LIBERADA')
  await verificarCuadre((await nivelDe(v, suc)).id)
})

test('24 · reservar es idempotente por clave y valida la vigencia', async () => {
  const suc = await sucursalLimpia(`res-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5 }, como(null)))
  const clave = `res-${sufijo}`
  const x = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, idempotencyKey: clave, ahora: T0 }, como(null)))
  const y = await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, idempotencyKey: clave, ahora: T0 }, como(null)))
  assert.equal(x.repetido, false)
  assert.equal(y.repetido, true)
  assert.equal(y.reservaId, x.reservaId)
  assert.equal((await nivelDe(v, suc)).reserved, 2)
  for (const ttl of [0, -5, 1.5, 7 * 24 * 60 + 1]) {
    assert.equal(await codigoDe(enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, ttlMinutos: ttl, ahora: T0 }, como(null)))), 'TTL_INVALIDO', String(ttl))
  }
  assert.equal(await codigoDe(enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, ctx.sucA3Inactiva), cantidad: 1, ahora: T0 }, como(null)))), 'SUCURSAL_INACTIVA')
})

test('25 · reservar sin stock no deja una reserva huérfana aunque se atrape el error', async () => {
  const suc = await sucursalLimpia(`huer-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1 }, como(null)))
  await enA(async (tx) => {
    try {
      await reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, ahora: T0 }, como(null))
    } catch {
      /* se atrapa dentro de la MISMA transacción */
    }
  })
  const n = await nivelDe(v, suc)
  assert.equal(await prisma.inventoryReservation.count({ where: { inventoryLevelId: n.id } }), 0)
  await verificarCuadre(n.id)
})

test('26 · el barrido vence todas las caducadas de la empresa y es idempotente', async () => {
  const suc = await sucursalLimpia(`barr-${sufijo}`)
  const v1 = ctx.varA
  const v2 = ctx.varA2
  // El barrido es de TODA la empresa: primero se limpia lo que dejaron las
  // pruebas anteriores, y esta trabaja mucho después para no mezclarse.
  await enA((tx) => vencerReservasEnTx(tx, ctx.a, minutos(100)))
  const inicio = minutos(1000)
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v1, suc), cantidad: 6 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v2, suc), cantidad: 6 }, como(null)))
  for (const v of [v1, v2]) {
    await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, ttlMinutos: 5, ahora: inicio }, como(null)))
    await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, ttlMinutos: 500, ahora: inicio }, como(null)))
  }
  const sweep = new Date(inicio.getTime() + 60 * 60_000)
  const n = await enA((tx) => vencerReservasEnTx(tx, ctx.a, sweep))
  assert.equal(n, 2)
  assert.equal(await enA((tx) => vencerReservasEnTx(tx, ctx.a, sweep)), 0)
  for (const v of [v1, v2]) {
    const nivel = await nivelDe(v, suc)
    assert.equal(nivel.reserved, 1, 'solo queda la de 500 minutos')
    await verificarCuadre(nivel.id)
  }
})

// ── Configuración y propiedad ────────────────────────────────────────────────

test('27 · el umbral de stock bajo se fija, se audita y no escribe si no cambia', async () => {
  const suc = await sucursalLimpia(`umb-${sufijo}`)
  const v = ctx.varA
  const r = await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(v, suc), umbral: 4 }, como(ctx.usuario)))
  assert.equal(r.umbral, 4)
  assert.equal((await nivelDe(v, suc)).lowStockThreshold, 4)
  const n = () => prisma.auditLog.count({ where: { companyId: ctx.a, accion: 'INVENTORY_CONFIGURED', entidadId: r.nivelId } })
  assert.equal(await n(), 1)
  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(v, suc), umbral: 4 }, como(ctx.usuario)))
  assert.equal(await n(), 1, 'sin cambio no hay rastro')
  assert.equal(await codigoDe(enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(v, suc), umbral: -1 }, como(null)))), 'UMBRAL_INVALIDO')
  assert.equal(await codigoDe(enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(ctx.varServicio, suc), umbral: 1 }, como(null)))), 'SIN_CONTROL_DE_INVENTARIO')
})

test('28 · propiedad: 300 operaciones al azar (con vencimientos) dejan el ledger, el saldo y las reservas cuadrados', async () => {
  const suc = await sucursalLimpia(`prop-${sufijo}`)
  const dest = await sucursalLimpia(`prop2-${sufijo}`)
  const v = ctx.varA2
  // PRNG con semilla fija: si falla, se reproduce.
  let semilla = 0x9e3779b9
  const azar = () => {
    semilla = (Math.imul(semilla ^ (semilla >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0
    return semilla / 0x1_0000_0000
  }
  const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1))
  let reloj = 0
  const reservasVivas: string[] = []
  let aceptadas = 0
  for (let i = 0; i < 300; i++) {
    reloj += entero(0, 6)
    const ahora = minutos(reloj)
    const cantidad = entero(1, 6)
    const op = entero(0, 9)
    try {
      await enA(async (tx) => {
        if (op === 0) await recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: entero(1, 15), ahora }, como(null))
        else if (op === 1) await venderEnTx(tx, ctx.a, { ...base(v, suc), cantidad, ahora }, como(null))
        else if (op === 2) await danarEnTx(tx, ctx.a, { ...base(v, suc), cantidad, motivo: 'azar', ahora }, como(null))
        else if (op === 3) await resolverDanadoEnTx(tx, ctx.a, { ...base(v, suc), cantidad, destino: azar() < 0.5 ? 'VENDIBLE' : 'BAJA', motivo: 'azar', ahora }, como(null))
        else if (op === 4) await ajustarEnTx(tx, ctx.a, { ...base(v, suc), cambio: azar() < 0.5 ? cantidad : -cantidad, motivo: 'azar', ahora }, como(null))
        else if (op === 5) {
          const r = await reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad, ttlMinutos: entero(1, 30), ahora }, como(null))
          reservasVivas.push(r.reservaId)
        } else if (op === 6 && reservasVivas.length) await liberarReservaEnTx(tx, ctx.a, reservasVivas[entero(0, reservasVivas.length - 1)], { ahora }, como(null))
        else if (op === 7 && reservasVivas.length) await consumirReservaEnTx(tx, ctx.a, reservasVivas[entero(0, reservasVivas.length - 1)], { ahora }, como(null))
        else if (op === 8) await transferirEnTx(tx, ctx.a, { varianteId: v, origenId: suc, destinoId: dest, cantidad, ahora }, como(null))
        else if (op === 9) await contarEnTx(tx, ctx.a, { ...base(v, suc), conteo: entero(0, 40), ahora }, como(null))
      })
      aceptadas++
    } catch (e) {
      if (!(e instanceof InventarioError)) throw e
    }
  }
  assert.ok(aceptadas > 100, `la mezcla debe aceptar una parte sustancial (aceptó ${aceptadas})`)
  const n = await nivelDe(v, suc)
  await verificarCuadre(n.id)
  await verificarCuadre((await nivelDe(v, dest)).id)
})

// ── Enganches con el catálogo ────────────────────────────────────────────────

async function codigoDeCatalogo(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof CatalogoError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un CatalogoError y no falló')
}

/** Un producto físico con tres variantes (la 1.ª es la «Estándar» renombrada). */
async function itemConVariantes(nombre: string) {
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: nombre, type: 'PHYSICAL_PRODUCT', price: 50 }, como(ctx.usuario)))
  for (const n of ['Mediana', 'Grande']) await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: n, price: 60 }, como(ctx.usuario)))
  const vs = await prisma.catalogVariant.findMany({ where: { catalogItemId: r.id }, orderBy: { position: 'asc' }, select: { id: true, name: true } })
  return { itemId: r.id, variantes: vs }
}

test('29 · una variante con historial de inventario no se borra; una sin movimientos sí', async () => {
  const { variantes } = await itemConVariantes(`Borrable ${sufijo}`)
  const [conHistorial, soloUmbral] = [variantes[1].id, variantes[2].id]
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(conHistorial, ctx.sucA1), cantidad: 2 }, como(null)))
  assert.equal(await codigoDeCatalogo(enA((tx) => eliminarVarianteEnTx(tx, ctx.a, conHistorial, como(ctx.usuario)))), 'VARIANTE_CON_INVENTARIO')
  assert.ok(await prisma.catalogVariant.findUnique({ where: { id: conHistorial } }))

  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(soloUmbral, ctx.sucA1), umbral: 3 }, como(null)))
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: soloUmbral } }), 1)
  await enA((tx) => eliminarVarianteEnTx(tx, ctx.a, soloUmbral, como(ctx.usuario)))
  assert.equal(await prisma.catalogVariant.count({ where: { id: soloUmbral } }), 0)
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: soloUmbral } }), 0, 'el saldo sin historial se fue con la variante')
})

test('30 · dejar de controlar inventario con existencias se rechaza; con cero, se permite', async () => {
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `Control ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10 }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v.id, ctx.sucA1), cantidad: 3 }, como(null)))
  const apagar = () => enA((tx) => actualizarItemEnTx(tx, ctx.a, r.id, { capabilities: { trackInventory: false } }, como(ctx.usuario)))
  assert.equal(await codigoDeCatalogo(apagar()), 'ITEM_CON_EXISTENCIAS')
  await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v.id, ctx.sucA1), cambio: -3, motivo: 'Se vendió todo' }, como(null)))
  await apagar()
  assert.equal(await codigoDe(enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v.id, ctx.sucA1), cantidad: 1 }, como(null)))), 'SIN_CONTROL_DE_INVENTARIO')
  // El historial sigue ahí: apagar el control no borra nada.
  assert.equal((await movimientosDe((await nivelDe(v.id, ctx.sucA1)).id)).length, 2)
})

// ── Lecturas del panel ───────────────────────────────────────────────────────

test('31 · la lista solo trae productos que controlan inventario, con saldo por sucursal y estado', async () => {
  const { variantes } = await itemConVariantes(`Listado ${sufijo}`)
  const [uno, dos, tres] = variantes.map((x) => x.id)
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(uno, ctx.sucA1), cantidad: 10 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(uno, ctx.sucA2), cantidad: 5 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(dos, ctx.sucA1), cantidad: 2 }, como(null)))
  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(dos, ctx.sucA1), umbral: 5 }, como(null)))
  // La tercera no tiene saldo en ningún lado → agotada.

  const todo = await enA((tx) => listarInventarioEnTx(tx, ctx.a, { q: `Listado ${sufijo}` }))
  assert.equal(todo.total, 3)
  const porId = new Map(todo.filas.map((f) => [f.varianteId, f]))
  assert.equal(porId.get(uno)?.onHand, 15)
  assert.equal(porId.get(uno)?.estado, 'OK')
  assert.equal(porId.get(uno)?.sucursales.length, 2)
  assert.equal(porId.get(dos)?.estado, 'BAJO')
  assert.equal(porId.get(tres)?.estado, 'AGOTADO')
  assert.equal(porId.get(tres)?.sucursales.length, 0)
  // Lo que pide atención va primero.
  assert.deepEqual(todo.filas.map((f) => f.estado), ['AGOTADO', 'BAJO', 'OK'])

  const bajos = await enA((tx) => listarInventarioEnTx(tx, ctx.a, { q: `Listado ${sufijo}`, estado: 'BAJO' }))
  assert.deepEqual(bajos.filas.map((f) => f.varianteId), [dos])
  const enSucursal2 = await enA((tx) => listarInventarioEnTx(tx, ctx.a, { q: `Listado ${sufijo}`, sucursalId: ctx.sucA2 }))
  assert.equal(enSucursal2.filas.find((f) => f.varianteId === uno)?.onHand, 5)
  assert.equal(enSucursal2.filas.find((f) => f.varianteId === dos)?.estado, 'AGOTADO', 'sin saldo en esa sucursal')

  // Un servicio no aparece aunque esté en el catálogo.
  const servicios = await enA((tx) => listarInventarioEnTx(tx, ctx.a, { q: `Lavado ${sufijo}` }))
  assert.equal(servicios.total, 0)
  // Y la otra empresa no ve nada de esto.
  const deB = await enB((tx) => listarInventarioEnTx(tx, ctx.b, { q: `Listado ${sufijo}` }))
  assert.equal(deB.total, 0)
})

test('32 · las alertas son los saldos que llegaron a su umbral; sin umbral no hay alerta', async () => {
  const { variantes } = await itemConVariantes(`Alerta ${sufijo}`)
  const [a, b, c] = variantes.map((x) => x.id)
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(a, ctx.sucA1), cantidad: 3 }, como(null)))
  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(a, ctx.sucA1), umbral: 3 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(b, ctx.sucA1), cantidad: 50 }, como(null)))
  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(b, ctx.sucA1), umbral: 3 }, como(null)))
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(c, ctx.sucA1), cantidad: 1 }, como(null)))
  await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(c, ctx.sucA1), cambio: -1, motivo: 'Se vendió' }, como(null)))
  await enA((tx) => configurarUmbralEnTx(tx, ctx.a, { ...base(c, ctx.sucA1), umbral: 2 }, como(null)))

  const r = await enA((tx) => alertasDeStockEnTx(tx, ctx.a, 1000))
  const mias = r.alertas.filter((x) => x.itemNombre === `Alerta ${sufijo}`)
  assert.deepEqual(mias.map((x) => [x.varianteId, x.estado]).sort(), [[a, 'BAJO'], [c, 'AGOTADO']].sort())
  assert.ok(!mias.some((x) => x.varianteId === b), '50 con umbral 3 no alerta')
  // Agotado primero.
  assert.ok(r.alertas.findIndex((x) => x.estado === 'AGOTADO') < r.alertas.findIndex((x) => x.estado === 'BAJO'))
  assert.equal((await enA((tx) => alertasDeStockEnTx(tx, ctx.a, 1))).alertas.length, 1)
  assert.equal((await enB((tx) => alertasDeStockEnTx(tx, ctx.b, 100))).total, 0)
})

test('33 · el detalle muestra todas las sucursales activas y el historial pagina por cursor, de lo nuevo a lo viejo', async () => {
  const v = ctx.varA2
  const d = await enA((tx) => detalleVarianteEnTx(tx, ctx.a, v))
  assert.ok(d)
  assert.equal(d.controlaInventario, true)
  assert.ok(d.sucursales.some((s) => s.sucursalId === ctx.sucA1))
  assert.ok(!d.sucursales.some((s) => s.sucursalId === ctx.sucA3Inactiva), 'una sucursal cerrada sin existencias no estorba')
  assert.equal(await enB((tx) => detalleVarianteEnTx(tx, ctx.b, v)), null, 'otra empresa no ve la variante')

  // El historial de varA2 tiene más de 25 movimientos tras las pruebas de propiedad.
  const p1 = await enA((tx) => historialDeVarianteEnTx(tx, ctx.a, v))
  assert.equal(p1.filas.length, 25)
  assert.ok(p1.siguiente)
  const p2 = await enA((tx) => historialDeVarianteEnTx(tx, ctx.a, v, p1.siguiente))
  const ids1 = new Set(p1.filas.map((f) => f.id))
  assert.ok(p2.filas.length > 0)
  assert.ok(p2.filas.every((f) => !ids1.has(f.id)), 'las páginas no se repiten')
  const todos = [...p1.filas, ...p2.filas]
  for (let i = 1; i < todos.length; i++) assert.ok(todos[i - 1].creadoEn.getTime() >= todos[i].creadoEn.getTime(), 'del más reciente al más antiguo')
  assert.equal((await enA((tx) => historialDeVarianteEnTx(tx, ctx.a, v, 'basura'))).filas.length, 25, 'un cursor roto vuelve a la primera página en vez de fallar')
  assert.equal((await enB((tx) => historialDeVarianteEnTx(tx, ctx.b, v))).filas.length, 0)
})

test('34 · las reservas vivas de una variante se listan con su vencimiento; las vencidas no', async () => {
  const suc = await sucursalLimpia(`vivas-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5 }, como(null)))
  const ahora = new Date()
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 2, ttlMinutos: 30, ahora, referencia: { tipo: 'ORDER', id: 'p-vivas' } }, como(null)))
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, ttlMinutos: 1, ahora: new Date(ahora.getTime() - 3_600_000) }, como(null)))
  const vivas = (await enA((tx) => reservasVivasEnTx(tx, ctx.a, v, ahora))).filter((r) => r.sucursalNombre === `vivas-${sufijo}`)
  assert.equal(vivas.length, 1)
  assert.equal(vivas[0].cantidad, 2)
  assert.equal(vivas[0].referenciaTipo, 'ORDER')
})

// ── Barrido del cron ─────────────────────────────────────────────────────────

test('35 · el barrido del cron vence las reservas caducadas de todas las empresas y es idempotente', async () => {
  const sucB = await prisma.sucursal.create({ data: { companyId: ctx.b, nombre: `barr-b-${sufijo}` }, select: { id: true } })
  const sucA = await sucursalLimpia(`barr-a-${sufijo}`)
  const ahora = new Date()
  const pasado = new Date(ahora.getTime() - 2 * 3_600_000)
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(ctx.varA, sucA), cantidad: 4 }, como(null)))
  await enB((tx) => recibirEnTx(tx, ctx.b, { ...base(ctx.varB, sucB.id), cantidad: 4 }, como(null)))
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(ctx.varA, sucA), cantidad: 3, ttlMinutos: 5, ahora: pasado }, como(null)))
  await enB((tx) => reservarEnTx(tx, ctx.b, { ...base(ctx.varB, sucB.id), cantidad: 2, ttlMinutos: 5, ahora: pasado }, como(null)))
  const r = await barridoInventario(ahora)
  assert.ok(r.reservasVencidas >= 2)
  assert.equal(r.empresasConError, 0)
  assert.equal((await nivelDe(ctx.varA, sucA)).reserved, 0)
  assert.equal((await nivelDe(ctx.varB, sucB.id)).reserved, 0)
  const otra = await barridoInventario(ahora)
  assert.equal(otra.reservasVencidas, 0, 'idempotente')
  await verificarCuadre((await nivelDe(ctx.varA, sucA)).id)
  await verificarCuadre((await nivelDe(ctx.varB, sucB.id)).id)
})

// ── Endurecimiento: idempotencia con dirección y referencias acotadas ───────

test('36 · la misma clave con la dirección contraria (sobrante vs faltante) no es un reintento', async () => {
  const suc = await sucursalLimpia(`dir-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 10 }, como(null)))
  const clave = `dir-${sufijo}`
  const mas = await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, suc), cambio: 3, motivo: 'Sobrante', idempotencyKey: clave }, como(null)))
  assert.equal(mas.saldo.onHand, 13)
  // Mismo tipo y misma cantidad, pero baja en vez de subir: es OTRA operación.
  assert.equal(await codigoDe(enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, suc), cambio: -3, motivo: 'Faltante', idempotencyKey: clave }, como(null)))), 'CLAVE_REUTILIZADA')
  assert.equal((await nivelDe(v, suc)).onHand, 13)
  // El reintento legítimo sigue siendo inofensivo.
  const otra = await enA((tx) => ajustarEnTx(tx, ctx.a, { ...base(v, suc), cambio: 3, motivo: 'Sobrante', idempotencyKey: clave }, como(null)))
  assert.equal(otra.repetido, true)
  assert.equal((await nivelDe(v, suc)).onHand, 13)
})

test('37 · una referencia sin tipo, o con tipo o id desmesurados, se rechaza antes de tocar nada', async () => {
  const suc = await sucursalLimpia(`ref-${sufijo}`)
  const v = ctx.varA
  await enA((tx) => recibirEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 5 }, como(null)))
  const malas = [{ tipo: '', id: 'x' }, { tipo: 'ORDER', id: '' }, { tipo: 'T'.repeat(41), id: 'x' }, { tipo: 'ORDER', id: 'i'.repeat(121) }]
  for (const referencia of malas) {
    assert.equal(await codigoDe(enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, referencia, ahora: T0 }, como(null)))), 'REFERENCIA_INVALIDA')
    assert.equal(await codigoDe(enA((tx) => venderEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, referencia }, como(null)))), 'REFERENCIA_INVALIDA')
  }
  const n = await nivelDe(v, suc)
  assert.equal(n.reserved, 0)
  assert.equal(n.onHand, 5)
  assert.equal(await prisma.inventoryReservation.count({ where: { inventoryLevelId: n.id } }), 0)
  // Una buena pasa.
  await enA((tx) => reservarEnTx(tx, ctx.a, { ...base(v, suc), cantidad: 1, referencia: { tipo: 'ORDER', id: 'pedido-ok' }, ahora: T0 }, como(null)))
})
