import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import {
  MAX_IMAGENES_POR_ITEM,
  asignarCategoriasEnTx,
  crearCategoriaEnTx,
  eliminarCategoriaEnTx,
  eliminarImagenEnTx,
  exigirCupoDeImagen,
  listarCategoriasEnTx,
  ponerPortadaEnTx,
  prefijoImagenesItem,
  registrarImagenEnTx,
} from '../../src/modules/catalog/medios'
import { obtenerItemEnTx } from '../../src/modules/catalog/queries'
import { CatalogoError } from '../../src/modules/catalog/errores'

/**
 * COMMERCE CORE · catálogo — imágenes y categorías contra PostgreSQL (F1.2).
 *
 * El servicio no sube archivos (eso lo hace la Server Action, que necesita
 * Storage y sesión): aquí se comprueba lo que decide la BASE y el servicio —
 * rutas que no son de este ítem, cupo, orden de portada, aislamiento entre
 * empresas y la integridad de las categorías—. `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ctx = { a: '', b: '', usuario: '', itemA: '', itemB: '' }

const enA = <T>(fn: (tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: (tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<T>) => conEmpresa(ctx.b, fn)

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof CatalogoError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un CatalogoError y no falló')
}

const nuevoItem = (empresa: 'a' | 'b', nombre: string) =>
  conEmpresa(ctx[empresa], (tx) =>
    crearItemEnTx(tx, ctx[empresa], { name: `${nombre} ${sufijo}`, type: 'SERVICE', price: 100 }, como(ctx.usuario))
  )

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) =>
      prisma.company.create({
        data: { name: `Medios ${x} ${sufijo}`, slug: `medios-${x}-${sufijo}`, type: 'restaurante', ciudad: 'Santo Domingo' },
        select: { id: true },
      })
    )
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (
    await prisma.user.create({
      data: { supabaseId: `sb-med-${sufijo}`, email: `med-${sufijo}@prueba.test`, name: 'Medios', role: 'SUPERADMIN' },
      select: { id: true },
    })
  ).id
  ctx.itemA = (await nuevoItem('a', 'Base A')).id
  ctx.itemB = (await nuevoItem('b', 'Base B')).id
})

after(async () => {
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: [ctx.a, ctx.b] } } })
  await prisma.catalogCategory.deleteMany({ where: { companyId: { in: [ctx.a, ctx.b] } } })
})

const ruta = (empresa: string, item: string, archivo: string) => `${prefijoImagenesItem(empresa, item)}${archivo}`

// ── Imágenes ─────────────────────────────────────────────────────────────────

test('1 · una imagen se registra con posición correlativa y deja bitácora', async () => {
  const x = await enA((tx) => registrarImagenEnTx(tx, ctx.a, ctx.itemA, ruta(ctx.a, ctx.itemA, '1.jpg'), null, como(ctx.usuario)))
  const y = await enA((tx) => registrarImagenEnTx(tx, ctx.a, ctx.itemA, ruta(ctx.a, ctx.itemA, '2.jpg'), '  Frente ', como(ctx.usuario)))
  assert.deepEqual([x.position, y.position], [0, 1])
  const fila = await prisma.catalogItemImage.findUniqueOrThrow({ where: { id: y.id } })
  assert.equal(fila.alt, 'Frente')
  assert.equal(fila.companyId, ctx.a)
  const audit = await prisma.auditLog.findFirst({ where: { accion: 'CATALOG_ITEM_UPDATED', entidadId: ctx.itemA }, orderBy: { createdAt: 'desc' } })
  assert.equal((audit?.payload as { cambio: string }).cambio, 'imagen_agregada')
})

test('2 · una ruta que no es de ESTA empresa y de ESTE ítem se rechaza', async () => {
  const otra = await nuevoItem('a', 'Otro ítem')
  for (const mala of [
    ruta(ctx.b, ctx.itemA, 'x.jpg'), // empresa ajena
    ruta(ctx.a, otra.id, 'x.jpg'), // ítem distinto
    `${ctx.a}/excursiones/${ctx.itemA}/x.jpg`, // otro módulo
    `${prefijoImagenesItem(ctx.a, ctx.itemA)}../../${ctx.b}/x.jpg`, // escape
    'x.jpg',
  ]) {
    assert.equal(await codigoDe(enA((tx) => registrarImagenEnTx(tx, ctx.a, ctx.itemA, mala, null, como(ctx.usuario)))), 'IMAGEN_INVALIDA', mala)
  }
})

test('3 · el cupo de imágenes se agota y se avisa ANTES de subir', async () => {
  const it = await nuevoItem('a', 'Cupo')
  for (let i = 0; i < MAX_IMAGENES_POR_ITEM; i++) {
    await enA((tx) => registrarImagenEnTx(tx, ctx.a, it.id, ruta(ctx.a, it.id, `${i}.jpg`), null, como(ctx.usuario)))
  }
  assert.equal(await codigoDe(enA((tx) => exigirCupoDeImagen(tx, ctx.a, it.id))), 'IMAGENES_LLENAS')
  assert.equal(
    await codigoDe(enA((tx) => registrarImagenEnTx(tx, ctx.a, it.id, ruta(ctx.a, it.id, 'extra.jpg'), null, como(ctx.usuario)))),
    'IMAGENES_LLENAS'
  )
})

test('4 · «hacer portada» pone la elegida primero y conserva el orden del resto', async () => {
  const it = await nuevoItem('a', 'Portada')
  const ids: string[] = []
  for (const n of ['a', 'b', 'c']) {
    ids.push((await enA((tx) => registrarImagenEnTx(tx, ctx.a, it.id, ruta(ctx.a, it.id, `${n}.jpg`), null, como(ctx.usuario)))).id)
  }
  await enA((tx) => ponerPortadaEnTx(tx, ctx.a, ids[2], como(ctx.usuario)))
  const d = await enA((tx) => obtenerItemEnTx(tx, ctx.a, it.id))
  assert.deepEqual(d.images.map((i) => i.id), [ids[2], ids[0], ids[1]])
  assert.deepEqual(d.images.map((i) => i.position), [0, 1, 2])
})

test('5 · quitar una imagen devuelve su ruta (para borrar el archivo) y una empresa ajena no puede', async () => {
  const it = await nuevoItem('a', 'Quitar')
  const p = ruta(ctx.a, it.id, 'z.jpg')
  const img = await enA((tx) => registrarImagenEnTx(tx, ctx.a, it.id, p, null, como(ctx.usuario)))
  assert.equal(await codigoDe(enB((tx) => eliminarImagenEnTx(tx, ctx.b, img.id, como(ctx.usuario)))), 'IMAGEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => ponerPortadaEnTx(tx, ctx.b, img.id, como(ctx.usuario)))), 'IMAGEN_NO_ENCONTRADA')
  assert.equal(await prisma.catalogItemImage.count({ where: { id: img.id } }), 1)
  const r = await enA((tx) => eliminarImagenEnTx(tx, ctx.a, img.id, como(ctx.usuario)))
  assert.equal(r.path, p)
  assert.equal(await prisma.catalogItemImage.count({ where: { id: img.id } }), 0)
})

test('6 · un ítem archivado o de Supply no recibe ni pierde imágenes', async () => {
  const it = await nuevoItem('a', 'Cerrado')
  const img = await enA((tx) => registrarImagenEnTx(tx, ctx.a, it.id, ruta(ctx.a, it.id, 'k.jpg'), null, como(ctx.usuario)))
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'ARCHIVED', como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => exigirCupoDeImagen(tx, ctx.a, it.id))), 'ITEM_ARCHIVADO')
  assert.equal(await codigoDe(enA((tx) => eliminarImagenEnTx(tx, ctx.a, img.id, como(ctx.usuario)))), 'ITEM_ARCHIVADO')
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'DRAFT', como(ctx.usuario)))
  await prisma.catalogItem.update({ where: { id: it.id }, data: { source: 'SUPPLY' } })
  assert.equal(await codigoDe(enA((tx) => exigirCupoDeImagen(tx, ctx.a, it.id))), 'ITEM_SOLO_LECTURA')
})

// ── Categorías ───────────────────────────────────────────────────────────────

test('7 · crear categorías: slug sin acentos, duplicado por nombre sin distinguir mayúsculas, slug libre si solo cambia el acento', async () => {
  const c1 = await enA((tx) => crearCategoriaEnTx(tx, ctx.a, `Café ${sufijo}`))
  assert.match(c1.slug, /^cafe-/)
  assert.equal(await codigoDe(enA((tx) => crearCategoriaEnTx(tx, ctx.a, `CAFÉ ${sufijo}`))), 'CATEGORIA_DUPLICADA')
  const c2 = await enA((tx) => crearCategoriaEnTx(tx, ctx.a, `Cafe ${sufijo}`))
  assert.equal(c2.slug, `${c1.slug}-2`, 'mismo slug, nombre distinto: sufijo')
  assert.equal(await codigoDe(enA((tx) => crearCategoriaEnTx(tx, ctx.a, '   '))), 'CATEGORIA_INVALIDA')
  assert.equal(await codigoDe(enA((tx) => crearCategoriaEnTx(tx, ctx.a, 'x'.repeat(81)))), 'CATEGORIA_INVALIDA')
  // La otra empresa puede llamar igual a la suya.
  await enB((tx) => crearCategoriaEnTx(tx, ctx.b, `Café ${sufijo}`))
})

test('8 · seis altas SIMULTÁNEAS de la misma categoría: una gana y las demás reciben «ya existe», sin errores de base', async () => {
  const nombre = `Simultánea ${sufijo}`
  const r = await Promise.allSettled(Array.from({ length: 6 }, () => enA((tx) => crearCategoriaEnTx(tx, ctx.a, nombre))))
  const ok = r.filter((x) => x.status === 'fulfilled')
  const malas = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1)
  assert.ok(malas.every((m) => m.reason instanceof CatalogoError && m.reason.codigo === 'CATEGORIA_DUPLICADA'), 'solo errores de dominio')
})

test('9 · asignar categorías deja EXACTAMENTE ese conjunto, y rechaza las de otra empresa', async () => {
  const it = await nuevoItem('a', 'Asignar')
  const [x, y] = await Promise.all(['Uno', 'Dos'].map((n) => enA((tx) => crearCategoriaEnTx(tx, ctx.a, `${n} ${sufijo}`))))
  const ajena = await enB((tx) => crearCategoriaEnTx(tx, ctx.b, `Ajena ${sufijo}`))

  await enA((tx) => asignarCategoriasEnTx(tx, ctx.a, it.id, [x.id, y.id, x.id], como(ctx.usuario)))
  assert.equal((await enA((tx) => obtenerItemEnTx(tx, ctx.a, it.id))).categories.length, 2, 'repetidos no cuentan')
  await enA((tx) => asignarCategoriasEnTx(tx, ctx.a, it.id, [y.id], como(ctx.usuario)))
  assert.deepEqual((await enA((tx) => obtenerItemEnTx(tx, ctx.a, it.id))).categories.map((c) => c.categoryId), [y.id])

  assert.equal(await codigoDe(enA((tx) => asignarCategoriasEnTx(tx, ctx.a, it.id, [y.id, ajena.id], como(ctx.usuario)))), 'CATEGORIA_NO_ENCONTRADA')
  assert.deepEqual((await enA((tx) => obtenerItemEnTx(tx, ctx.a, it.id))).categories.map((c) => c.categoryId), [y.id], 'el rechazo no deja el ítem a medias')

  await enA((tx) => asignarCategoriasEnTx(tx, ctx.a, it.id, [], como(ctx.usuario)))
  assert.equal((await enA((tx) => obtenerItemEnTx(tx, ctx.a, it.id))).categories.length, 0)
})

test('10 · borrar una categoría quita la etiqueta pero NO borra los ítems; una empresa ajena no puede borrarla', async () => {
  const it = await nuevoItem('a', 'Con etiqueta')
  const c = await enA((tx) => crearCategoriaEnTx(tx, ctx.a, `Temporal ${sufijo}`))
  await enA((tx) => asignarCategoriasEnTx(tx, ctx.a, it.id, [c.id], como(ctx.usuario)))
  const lista = await enA((tx) => listarCategoriasEnTx(tx, ctx.a))
  assert.equal(lista.find((x) => x.id === c.id)?._count.items, 1)

  assert.equal(await codigoDe(enB((tx) => eliminarCategoriaEnTx(tx, ctx.b, c.id))), 'CATEGORIA_NO_ENCONTRADA')
  await enA((tx) => eliminarCategoriaEnTx(tx, ctx.a, c.id))
  assert.equal(await prisma.catalogItem.count({ where: { id: it.id } }), 1)
  assert.equal(await prisma.catalogItemCategory.count({ where: { categoryId: c.id } }), 0)
  assert.equal((await enB((tx) => listarCategoriasEnTx(tx, ctx.b))).some((x) => x.id === c.id), false)
})
