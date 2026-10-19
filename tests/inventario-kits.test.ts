import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CANTIDAD_MAXIMA } from '../src/modules/inventory/domain'
import { MAX_COMPONENTES_POR_KIT, disponibilidadDeKit, unidadesParaKits, validarReceta } from '../src/modules/inventory/kits'

/**
 * INV-5d · KITS — las reglas PURAS y las guardias estáticas (migración, servicio, lecturas, pedidos, caja, catálogo, acciones y pantallas).
 * El comportamiento contra PostgreSQL está en `tests/postgres/inventory-kits.db.test.ts`.
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}

const c = (varianteId: unknown, cantidad: unknown) => ({ varianteId, cantidad })
const codigo = (r: { ok: boolean; codigo?: string }) => (r.ok ? 'OK' : r.codigo)

test('INV-5d · la receta: al menos un componente, sin repetir, cantidades enteras y el kit no se contiene a sí mismo', () => {
  const ok = validarReceta([c('b', 2), c('a', 1)], 'kit')
  assert.ok(ok.ok)
  assert.deepEqual(ok.ok && ok.receta, [{ varianteId: 'a', cantidad: 1 }, { varianteId: 'b', cantidad: 2 }], 'sale ordenada por id (el orden en que se aparta)')
  assert.equal(codigo(validarReceta([], 'kit')), 'RECETA_VACIA')
  assert.equal(codigo(validarReceta(undefined, 'kit')), 'RECETA_VACIA')
  assert.equal(codigo(validarReceta('a', 'kit')), 'RECETA_VACIA')
  assert.equal(codigo(validarReceta([c('a', 1), c('a', 2)], 'kit')), 'COMPONENTE_REPETIDO')
  assert.equal(codigo(validarReceta([c('kit', 1)], 'kit')), 'KIT_ES_SU_COMPONENTE')
  for (const mala of [0, -1, 1.5, '2', null, undefined, NaN, CANTIDAD_MAXIMA + 1]) assert.equal(codigo(validarReceta([c('a', mala)], 'kit')), 'CANTIDAD_INVALIDA', String(mala))
  assert.equal(codigo(validarReceta([c('a', CANTIDAD_MAXIMA)], 'kit')), 'OK', 'el tope exacto cabe')
  for (const mala of ['', null, 7, undefined]) assert.equal(codigo(validarReceta([c(mala, 1)], 'kit')), 'COMPONENTE_INVALIDO', String(mala))
  assert.equal(codigo(validarReceta([null], 'kit')), 'COMPONENTE_INVALIDO')
  const muchos = Array.from({ length: MAX_COMPONENTES_POR_KIT + 1 }, (_, i) => c(`v${i}`, 1))
  assert.equal(codigo(validarReceta(muchos, 'kit')), 'RECETA_LARGA')
  assert.equal(codigo(validarReceta(muchos.slice(0, MAX_COMPONENTES_POR_KIT), 'kit')), 'OK')
})

test('INV-5d · unidades que piden N kits: cantidad por kit × kits, dentro del máximo de un movimiento', () => {
  const receta = [{ varianteId: 'a', cantidad: 2 }, { varianteId: 'b', cantidad: 5 }]
  const r = unidadesParaKits(receta, 3)
  assert.deepEqual(r.ok && r.unidades, [{ varianteId: 'a', cantidad: 6 }, { varianteId: 'b', cantidad: 15 }])
  for (const mala of [0, -2, 1.5, NaN]) assert.equal(codigo(unidadesParaKits(receta, mala)), 'CANTIDAD_INVALIDA', String(mala))
  assert.equal(codigo(unidadesParaKits(receta, CANTIDAD_MAXIMA)), 'CANTIDAD_INVALIDA', '5 × el máximo se pasa')
  assert.equal(codigo(unidadesParaKits([{ varianteId: 'a', cantidad: 1 }], CANTIDAD_MAXIMA)), 'OK')
})

test('INV-5d · cuántos kits alcanzan: el mínimo de lo disponible entre lo que lleva cada kit, hacia abajo', () => {
  const receta = [{ varianteId: 'a', cantidad: 2 }, { varianteId: 'b', cantidad: 3 }]
  assert.deepEqual(disponibilidadDeKit(receta, new Map([['a', 10], ['b', 7]])), { kits: 2, limitante: 'b' }, '10/2 = 5 y 7/3 = 2')
  assert.deepEqual(disponibilidadDeKit(receta, new Map([['a', 1], ['b', 100]])), { kits: 0, limitante: 'a' }, 'con 1 de a no se arma ni uno')
  assert.deepEqual(disponibilidadDeKit(receta, new Map([['a', 4]])), { kits: 0, limitante: 'b' }, 'un componente que no se conoce cuenta cero')
  assert.deepEqual(disponibilidadDeKit(receta, new Map([['a', -5], ['b', 9]])), { kits: 0, limitante: 'a' }, 'lo negativo no resta de más')
  assert.deepEqual(disponibilidadDeKit(receta, new Map([['a', 6], ['b', 9]])).kits, 3, 'si empatan, alcanzan 3')
  assert.deepEqual(disponibilidadDeKit([], new Map([['a', 5]])), { kits: 0, limitante: null }, 'sin receta no hay kit')
  assert.equal(disponibilidadDeKit([{ varianteId: 'a', cantidad: 1 }], new Map([['a', 7]])).kits, 7)
})

// ── Guardias estáticas ───────────────────────────────────────────────────────

test('INV-5d · la migración: aditiva, la receta no se anida y lo apartado por un kit es evidencia', () => {
  const m = leer('prisma/migrations/20261072_inventory_kits/migration.sql')
  const codigoSql = m.replace(/--.*$/gm, '')
  assert.doesNotMatch(codigoSql, /DROP TABLE|DROP COLUMN|TRUNCATE TABLE|DELETE FROM|ALTER TABLE "(?!inventory_kit_)/i, 'solo crea; no toca tablas existentes')
  assert.match(m, /SET LOCAL lock_timeout = '5s'/)
  assert.match(codigoSql, /CREATE TABLE IF NOT EXISTS "inventory_kit_components"/)
  assert.match(codigoSql, /CREATE TABLE IF NOT EXISTS "inventory_kit_reservations"/)
  assert.match(codigoSql, /CHECK \("kitVariantId" <> "componentVariantId" AND "quantity" BETWEEN 1 AND 1000000\)/)
  assert.match(codigoSql, /ON "inventory_kit_components" \("kitVariantId", "componentVariantId"\)/, 'un componente una sola vez por kit')
  assert.match(codigoSql, /CREATE CONSTRAINT TRIGGER "inventory_kit_components_sin_anidar"[\s\S]*DEFERRABLE INITIALLY DEFERRED/)
  assert.match(codigoSql, /k\."kitVariantId" = NEW\."componentVariantId"/, 'el componente no es kit')
  assert.match(codigoSql, /k\."componentVariantId" = NEW\."kitVariantId"/, 'el kit no es componente')
  assert.match(codigoSql, /ON "inventory_kit_reservations" \("reservationId"\)/, 'una reserva, un vínculo')
  assert.match(codigoSql, /"companyId", "referenceType", "referenceId", "kitVariantId", "componentVariantId"/, 'un kit aparta cada componente una vez por pedido')
  assert.match(codigoSql, /BEFORE UPDATE OR DELETE ON "inventory_kit_reservations"[\s\S]*inventory_lot_inmutable/)
  assert.match(codigoSql, /BEFORE TRUNCATE ON "inventory_kit_reservations"[\s\S]*inventory_lot_sin_truncate/)
  for (const fk of ['kit_company', 'component_company', 'reservation_company']) assert.match(codigoSql, new RegExp(`inventory_kit_reservations_${fk}_fkey`))
  assert.equal([...codigoSql.matchAll(/ON DELETE RESTRICT/g)].length, 7, 'todo RESTRICT: nada de la historia se borra en cascada')
  const prisma = leer('prisma/schema/inventario.prisma')
  assert.match(prisma, /model InventoryKitComponent \{/)
  assert.match(prisma, /model InventoryKitReservation \{/)
})

test('INV-5d · el servicio de recetas: reglas del kit y de los componentes, con el kit bloqueado y bitácora', () => {
  const svc = sinComent(leer('src/modules/inventory/kits-service.ts'))
  const g = cuerpoDe(svc, 'guardarRecetaDeKitEnTx')
  assert.match(g, /validarReceta\(e\.componentes, kitId\)/)
  assert.match(g, /fallo\('KIT_DE_SUPPLY'/)
  assert.match(g, /trackInventory\) \{\s*fallo\('KIT_CONTROLA_INVENTARIO'/)
  assert.match(g, /fallo\('KIT_ES_COMPONENTE'/)
  assert.match(g, /fallo\('COMPONENTE_ES_KIT'/)
  assert.match(g, /fallo\('COMPONENTE_SIN_INVENTARIO'/)
  assert.ok(g.indexOf("fallo('COMPONENTE_ES_KIT'") < g.indexOf("fallo('COMPONENTE_SIN_INVENTARIO'"), 'un kit como componente se dice «es un kit», no «no controla inventario»')
  assert.ok(g.indexOf('bloquearVariante(') < g.indexOf('inventoryKitComponent.deleteMany'), 'las ediciones de un kit se turnan')
  assert.match(g, /if \(igual\) return \{[^}]*sinCambios: true \}/, 'la misma receta no cambia nada ni deja rastro')
  assert.ok(g.indexOf('if (igual)') < g.indexOf('auditarInventario('), 'sin cambios no hay bitácora')
  assert.match(g, /tipo: 'KIT_RECETA'/)
  assert.match(cuerpoDe(svc, 'quitarRecetaDeKitEnTx'), /fallo\('KIT_SIN_RECETA'/)
})

test('INV-5d · apartar, vender, liberar y devolver un kit mueven los COMPONENTES por las puertas de siempre', () => {
  const svc = sinComent(leer('src/modules/inventory/kits-service.ts'))
  const r = cuerpoDe(svc, 'reservarKitEnTx')
  assert.match(r, /if \(previas\.length > 0\) return \{ reservaIds: previas\.map\(\(p\) => p\.reservationId\), repetido: true \}/, 'reintentar no aparta dos veces')
  assert.match(r, /fallo\('KIT_SIN_RECETA'/)
  assert.match(r, /reservarEnTx\(/)
  assert.match(r, /idempotencyKey: `\$\{e\.claveBase\}:\$\{e\.kitVarianteId\}:\$\{u\.varianteId\}`/, 'cada componente con su clave')
  assert.match(r, /inventoryKitReservation\.create/)
  assert.match(r, /err\.codigo === 'STOCK_INSUFICIENTE'/, 'el mensaje dice qué kit y qué componente')
  const c1 = cuerpoDe(svc, 'consumirKitsDeReferenciaEnTx')
  assert.match(c1, /consumirReservaEnTx\(/)
  assert.match(c1, /RESERVA_VENCIDA[\s\S]*RESERVA_LIBERADA/)
  assert.match(c1, /venderEnTx\(/, 'si la reserva ya no sirve, vende de lo disponible')
  assert.match(c1, /fallo\('STOCK_YA_NO_ALCANZA'/)
  assert.match(cuerpoDe(svc, 'liberarKitsDeReferenciaEnTx'), /liberarReservaEnTx\(/)
  const d = cuerpoDe(svc, 'devolverKitsDeReferenciaEnTx')
  assert.match(d, /devolverEnTx\(/)
  assert.match(d, /cantidad: f\.quantity/, 'devuelve lo que se apartó, no lo que diga la receta de hoy')
  assert.match(d, /:reembolso`/)
  // Consumir, liberar y devolver trabajan sobre la FOTO de lo apartado (la tabla), no sobre la receta de hoy.
  for (const nombre of ['consumirKitsDeReferenciaEnTx', 'liberarKitsDeReferenciaEnTx', 'devolverKitsDeReferenciaEnTx']) assert.match(cuerpoDe(svc, nombre), /filasDeReferencia\(/, nombre)
  assert.doesNotMatch(cuerpoDe(svc, 'filasDeReferencia'), /inventoryKitComponent/)
})

test('INV-5d · los pedidos apartan, venden, liberan y devuelven los kits; el carrito y la caja enseñan lo que alcanza', () => {
  const o = sinComent(leer('src/modules/orders/service.ts'))
  const crear = cuerpoDe(o, 'crearPedidoEnTx')
  assert.match(crear, /recetasDeKitsEnTx\(tx, companyId, unidas\.map/)
  assert.match(crear, /!normalizarCapacidades\(v\.item\.type, v\.item\.capabilities\)\.trackInventory && kits\.has\(v\.id\)/, 'solo lo que no controla inventario por su cuenta y tiene receta')
  assert.match(crear, /reservarKitEnTx\(/)
  assert.match(crear, /claveBase: `pedido:\$\{pedido\.id\}`/)
  assert.equal([...o.matchAll(/await venderKits\(tx, companyId, p, ahora, ctx\)/g)].length, 2, 'se vende al cerrar por QR y al cerrar por fuera')
  assert.match(cuerpoDe(o, 'cancelarPedidoEnTx'), /liberarKitsDeReferenciaEnTx\(/)
  assert.match(cuerpoDe(o, 'reembolsarPedidoEnTx'), /if \(e\.devolverAlInventario\) \{[\s\S]*devolverKitsDeReferenciaEnTx\(/, 'devolver los kits depende de devolver al inventario')
  const ck = sinComent(leer('src/modules/checkout/service.ts'))
  assert.match(ck, /disponibilidadDeKitsEnTx\(/)
  assert.match(ck, /: \(kits\.get\(v\.id\)\?\.kits \?\? null\)/)
  const pos = sinComent(leer('src/modules/pos/service.ts'))
  assert.match(pos, /disponibilidadDeKitsEnTx\(/)
  assert.match(pos, /: \(kits\.get\(v\.id\)\?\.kits \?\? null\)/)
})

test('INV-5d · el catálogo no deja romper un kit', () => {
  const cat = sinComent(leer('src/modules/catalog/service.ts'))
  assert.match(cat, /fallo\('ITEM_ES_KIT'/)
  assert.match(cat, /fallo\('ITEM_EN_KITS'/)
  assert.match(cat, /fallo\('VARIANTE_EN_KITS'/)
  assert.match(cat, /inventoryKitComponent\.deleteMany\(\{ where: \{ companyId, kitVariantId: actual\.id \} \}\)/, 'la receta de un kit sin ventas se va con él')
})

test('INV-5d · las lecturas solo LEEN, acotan por empresa y el buscador no ofrece lo que controla inventario', () => {
  const q = sinComent(leer('src/modules/inventory/kits-queries.ts'))
  assert.doesNotMatch(q, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|DELETE\s+FROM/i, 'una lectura no escribe')
  const lecturas = [...q.matchAll(/tx\.(\w+)\.(findFirst|findMany|count)\(\{\s*where: \{(?=([\s\S]{0,120}))/g)]
  assert.ok(lecturas.length >= 6)
  for (const [llamada, , , donde] of lecturas) assert.match(donde, /companyId/, `una consulta no filtra por empresa → ${llamada.slice(0, 80)}…`)
  assert.match(q, /\.filter\(\(v\) => !normalizarCapacidades\(v\.item\.type, v\.item\.capabilities\)\.trackInventory\)/)
  assert.match(q, /kitsDondeEntra: \{ none: \{\} \}/, 'un componente no es candidato a kit')
  assert.match(q, /if \(t\.length < 2\) return \[\]/)
})

test('INV-5d · las acciones piden «ajustar» antes de tocar la base y las pantallas usan la acción', () => {
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  for (const nombre of ['guardarRecetaDeKit', 'quitarRecetaDeKit', 'buscarCandidatosAKit']) {
    const f = cuerpoDe(a, nombre)
    assert.match(f, /await contexto\('ajustar'\)/, nombre)
    assert.ok(f.indexOf("contexto('ajustar')") < f.indexOf('conEmpresa('), `${nombre} autoriza antes de tocar la base`)
  }
  assert.match(cuerpoDe(a, 'guardarRecetaDeKit'), /componentes: entrada\.componentes/)
  const form = sinComent(leer('src/components/inventario/KitForm.tsx'))
  assert.match(form, /guardarRecetaDeKit\(\{ kitVarianteId: kit\.varianteId, componentes: filas\.map/)
  assert.match(form, /setConfirmando\(true\)/, 'quitar la receta pide confirmar')
  const pagina = sinComent(leer('src/app/(admin)/admin/inventario/kits/page.tsx'))
  assert.match(pagina, /requireRole\(ADMIN_ROLES\)/)
  assert.match(pagina, /<NavegacionInventario actual="kits" \/>/)
  assert.match(pagina, /\{puedeAjustar && \(\s*<Card>/, 'armar un kit solo se ofrece a quien puede ajustar')
  assert.match(pagina, /\{puedeAjustar && <KitEditable/)
  const nav = sinComent(leer('src/components/inventario/NavegacionInventario.tsx'))
  assert.match(nav, /id: 'kits', etiqueta: 'Kits', href: '\/admin\/inventario\/kits'/)
  const ficha = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(ficha, /kitsDondeEntraEnTx\(tx, companyId, varianteId\)/)
})
