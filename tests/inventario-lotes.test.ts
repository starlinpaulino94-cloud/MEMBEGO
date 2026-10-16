import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * INV-5a · LOTES Y VENCIMIENTO — guardias estáticas. Comprueban la FORMA de lo que no se puede comprobar ejecutándolo en una prueba
 * pura: que la migración es aditiva, idempotente y atómica, y que todo lo que vigila la base sigue escrito en ella.
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinNotasSql = (sql: string) => sql.replace(/^\s*--.*$/gm, '')

test('INV-5a.1 · la migración es ADITIVA (no borra ni reescribe nada), IDEMPOTENTE y de una sola transacción con lock_timeout', () => {
  const sql = sinNotasSql(leer('prisma/migrations/20261068_inventory_lots/migration.sql'))
  assert.match(sql, /^\s*BEGIN;\s*SET LOCAL lock_timeout = '5s';/, 'una sola transacción, y sin esperar indefinidamente un bloqueo')
  assert.match(sql, /COMMIT;\s*$/)
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT|INDEX)\b/i, 'no borra nada existente')
  assert.doesNotMatch(sql, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"(?!inventory_lot_balances")/i, 'no toca filas de nadie (solo el disparador mueve saldos por lote)')
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+"(inventory_levels|inventory_movements|catalog_variants|sucursales)"/i, 'no altera las tablas existentes: solo les añade índices únicos')
  // Todo CREATE es idempotente.
  for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?"[^"]+"/gi)) assert.ok(m[2], `índice sin IF NOT EXISTS: ${m[0]}`)
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(IF NOT EXISTS\s+)?"[^"]+"/gi)) assert.ok(m[1], `tabla sin IF NOT EXISTS: ${m[0]}`)
  const alteraciones = [...sql.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+ADD CONSTRAINT/gi)]
  assert.ok(alteraciones.length >= 14)
  assert.equal(alteraciones.length, [...sql.matchAll(/duplicate_object/g)].length, 'cada restricción se crea dentro de un bloque idempotente')
  // Los dos únicos cambios a tablas existentes: índices destino de las FK compuestas.
  const sobreExistentes = [...sql.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+IF NOT EXISTS\s+"[^"]+"\s+ON\s+"(inventory_levels|inventory_movements)"/gi)].map((m) => m[1])
  assert.deepEqual(sobreExistentes.sort(), ['inventory_levels', 'inventory_movements'])
  // Ningún identificador pasa de 63 caracteres (PostgreSQL los trunca sin avisar y la segunda aplicación ya no los encuentra).
  for (const m of sql.matchAll(/"([A-Za-z0-9_]{64,})"/g)) assert.fail(`identificador de más de 63 caracteres: ${m[1]}`)
})

test('INV-5a.1 · la base hace cumplir que los lotes suman lo que hay y que el saldo por lote lo mueve ella', () => {
  const sql = sinNotasSql(leer('prisma/migrations/20261068_inventory_lots/migration.sql'))
  // Disparadores diferidos (se comprueban al terminar la transacción) y sus cinco puertas.
  for (const [nombre, tabla] of [
    ['inventory_levels_lotes_suman', 'inventory_levels'],
    ['inventory_lot_balances_lotes_suman', 'inventory_lot_balances'],
    ['inventory_lot_tracking_lotes_suman', 'inventory_lot_tracking'],
    ['inventory_movements_repartido', 'inventory_movements'],
    ['inventory_movement_lots_repartido', 'inventory_movement_lots'],
  ] as const) {
    const re = new RegExp(`CREATE CONSTRAINT TRIGGER "${nombre}"\\s+AFTER [A-Za-z ,"]+ ON "${tabla}"\\s+DEFERRABLE INITIALLY DEFERRED\\s+FOR EACH ROW`)
    assert.match(sql, re, nombre)
  }
  assert.match(sql, /UPDATE OF "onHand", "reserved", "damaged" ON "inventory_levels"/, 'el saldo de la sucursal vigila sus tres contadores')
  // Las comprobaciones RELEEN el saldo con su id y suman con COALESCE (una suma NULL ni acepta ni rechaza: lo dejaría pasar).
  assert.match(sql, /FROM "inventory_levels" WHERE "id" = p_saldo/)
  assert.match(sql, /coalesce\(sum\("onHand"\), 0\), coalesce\(sum\("reserved"\), 0\), coalesce\(sum\("damaged"\), 0\)/)
  assert.match(sql, /b_on <> v_on OR b_res <> v_res OR b_dan <> v_dan/, 'las TRES cubetas')
  assert.match(sql, /v_repartido <> v_cantidad/, 'el reparto de un movimiento suma su cantidad')
  // El saldo por lote: nace en cero y solo lo mueve el disparador de la apertura o del reparto.
  assert.match(sql, /CREATE TRIGGER "inventory_lot_balances_nacen_en_cero"\s+BEFORE INSERT/)
  assert.match(sql, /CREATE TRIGGER "inventory_lot_balances_solo_disparador"\s+BEFORE UPDATE/)
  assert.match(sql, /CREATE TRIGGER "inventory_movement_lots_aplicar"\s+AFTER INSERT ON "inventory_movement_lots"/)
  assert.match(sql, /CREATE TRIGGER "inventory_lot_openings_aplicar"\s+AFTER INSERT ON "inventory_lot_openings"/)
  // Historia inmutable: repartos, aperturas, lotes y su TRUNCATE.
  for (const t of ['inventory_movement_lots', 'inventory_lot_openings', 'inventory_lots', 'inventory_lot_balances', 'inventory_lot_tracking']) {
    assert.match(sql, new RegExp(`BEFORE TRUNCATE ON "${t}"`), `TRUNCATE de ${t}`)
  }
  assert.match(sql, /CREATE TRIGGER "inventory_movement_lots_sin_cambios"\s+BEFORE UPDATE OR DELETE ON "inventory_movement_lots"/)
  assert.match(sql, /"inventory_lots_catalogVariantId_codigo_key"\s+ON "inventory_lots" \("catalogVariantId", upper\("code"\)\)/, 'un código por producto sin distinguir mayúsculas')
  assert.match(sql, /"inventory_lots_legacy_key"\s+ON "inventory_lots" \("catalogVariantId"\) WHERE "legacy"/, 'un solo «SIN LOTE» por producto')
  // FK compuestas con la empresa: el reparto cuelga de un movimiento DE ESE saldo y el saldo por lote hereda variante y empresa.
  assert.match(sql, /"inventory_movement_lots_movement_level_company_fkey"\s+FOREIGN KEY \("movementId", "inventoryLevelId", "companyId"\) REFERENCES "inventory_movements"\("id", "inventoryLevelId", "companyId"\)/)
  assert.match(sql, /"inventory_lot_balances_level_variant_company_fkey"\s+FOREIGN KEY \("inventoryLevelId", "catalogVariantId", "companyId"\) REFERENCES "inventory_levels"\("id", "catalogVariantId", "companyId"\)/)
  assert.match(sql, /"inventory_lot_balances_lotId_catalogVariantId_companyId_fkey"\s+FOREIGN KEY \("lotId", "catalogVariantId", "companyId"\) REFERENCES "inventory_lots"\("id", "catalogVariantId", "companyId"\)/)
  // Todas RESTRICT: con historial no se borra nada.
  assert.doesNotMatch(sql, /ON DELETE (CASCADE|SET NULL)/i)
})

test('INV-5a.1 · la migración está sellada, el esquema de Prisma la refleja y /api/health avisa si falta', () => {
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261068_inventory_lots/)
  const prisma = leer('prisma/schema/inventario.prisma')
  for (const modelo of ['InventoryLotTracking', 'InventoryLot', 'InventoryLotBalance', 'InventoryLotOpening', 'InventoryMovementLot']) {
    assert.match(prisma, new RegExp(`model ${modelo} \\{`), modelo)
  }
  for (const tabla of ['inventory_lot_tracking', 'inventory_lots', 'inventory_lot_balances', 'inventory_lot_openings', 'inventory_movement_lots']) {
    assert.match(prisma, new RegExp(`@@map\\("${tabla}"\\)`), tabla)
  }
  assert.match(prisma, /@@unique\(\[id, catalogVariantId, companyId\]\)/, 'destinos de las FK compuestas')
  assert.match(prisma, /@@unique\(\[id, inventoryLevelId, companyId\]\)/)
  assert.match(leer('src/app/api/health/route.ts'), /'inventory_movement_lots\.esquema', to_regclass\('public\.inventory_movement_lots'\) IS NOT NULL/)
})

// ── El servicio: quién escribe lotes y cómo ──────────────────────────────────

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** El cuerpo de una función (o `async function`) del archivo, hasta la siguiente declaración de primer nivel. */
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}
function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivosTs(ruta) : /\.(ts|tsx)$/.test(n) ? [ruta] : []
  })
}

test('INV-5a · las filas de lotes (saldos, aperturas y repartos) solo las escribe el servicio de inventario, y los repartos solo sus dos puertas', () => {
  const dueños = new Map<string, string[]>()
  for (const ruta of archivosTs('src')) {
    const t = sinComentarios(leer(ruta))
    for (const modelo of ['inventoryMovementLot', 'inventoryLotBalance', 'inventoryLotOpening', 'inventoryLot', 'inventoryLotTracking']) {
      if (new RegExp(`\\.${modelo}\\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\\(`).test(t)) dueños.set(modelo, [...(dueños.get(modelo) ?? []), ruta])
    }
  }
  for (const [modelo, rutas] of dueños) assert.deepEqual(rutas, ['src/modules/inventory/service.ts'], `${modelo} se escribe fuera del servicio de inventario`)
  assert.deepEqual([...dueños.keys()].sort(), ['inventoryLot', 'inventoryLotBalance', 'inventoryLotOpening', 'inventoryLotTracking', 'inventoryMovementLot'])
  // Los repartos: una sola función los escribe, y la llaman las dos puertas del ledger.
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  assert.equal([...svc.matchAll(/inventoryMovementLot\.createMany\(/g)].length, 1)
  assert.match(cuerpoDe(svc, 'escribirRepartos'), /inventoryMovementLot\.createMany/)
  assert.match(cuerpoDe(svc, 'escribirMovimiento'), /escribirRepartos\(/)
  assert.match(cuerpoDe(svc, 'escribirMovimientosPorLote'), /escribirRepartos\(/)
  // Los saldos por lote se crean en cero (la base los mueve): nunca con un contador en la creación.
  assert.doesNotMatch(cuerpoDe(svc, 'escribirRepartos'), /onHand|reserved|damaged/)
  // Y nadie edita un saldo por lote desde la aplicación.
  assert.doesNotMatch(svc, /inventory_lot_balances"?\s+SET/i)
})

test('INV-5a · las dos puertas del ledger exigen el reparto a un producto con lotes y lo prohíben a uno sin lotes', () => {
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  const una = cuerpoDe(svc, 'escribirMovimiento')
  assert.match(una, /politicaDeLotes\(tx, companyId, nivel\.catalogVariantId\)/)
  assert.match(una, /fallo\('REPARTO_FALTANTE'/)
  assert.match(una, /sumaDeReparto\(meta\.reparto\) !== m\.quantity/, 'la suma del reparto es la cantidad')
  assert.match(una, /fallo\('LOTES_NO_APLICAN'/)
  const lote = cuerpoDe(svc, 'escribirMovimientosPorLote')
  assert.match(lote, /nivelesConLotes\(/)
  assert.match(lote, /fallo\('REPARTO_FALTANTE'/)
  assert.match(lote, /sumaDeReparto\(i\.meta\.reparto\) !== i\.movimiento\.quantity/)
  assert.match(lote, /fallo\('LOTES_NO_APLICAN'/)
})

test('INV-5a · el candado de empresa: compartido en cada bloqueo de saldos y ANTES de ellos; exclusivo al activar', () => {
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  const bloquear = cuerpoDe(svc, 'bloquear')
  const iCandado = bloquear.indexOf('candadoDeLotes(tx, companyId, false)')
  const iBloqueo = bloquear.indexOf('FOR UPDATE')
  assert.ok(iCandado >= 0 && iBloqueo > iCandado, 'el candado de lotes va antes del FOR UPDATE de los saldos')
  const candado = cuerpoDe(svc, 'candadoDeLotes')
  assert.match(candado, /pg_advisory_xact_lock\(hashtextextended\(\$\{llave\}, 0\)\)/, 'exclusivo')
  assert.match(candado, /pg_advisory_xact_lock_shared\(hashtextextended\(\$\{llave\}, 0\)\)/, 'compartido')
  assert.match(candado, /`inventory_lots:\$\{companyId\}`/, 'uno por empresa')
  const activar = cuerpoDe(svc, 'activarLotesEnTx')
  assert.ok(activar.indexOf('candadoDeLotes(tx, companyId, true)') >= 0 && activar.indexOf('candadoDeLotes(tx, companyId, true)') < activar.indexOf('bloquear(tx, companyId, ids)'), 'exclusivo, y antes de bloquear los saldos')
  // Lo que se recordó del producto se olvida al activar: antes de leer y después de escribir.
  assert.equal([...activar.matchAll(/politicasPorTx\.get\(tx\)\?\.delete\(variante\.id\)/g)].length, 2)
})

test('INV-5a · activar los lotes: precondiciones, apertura íntegra y rastro', () => {
  const activar = cuerpoDe(sinComentarios(leer('src/modules/inventory/service.ts')), 'activarLotesEnTx')
  for (const codigo of ['ACTIVAR_CON_CONTEO_ABIERTO', 'ACTIVAR_CON_TRANSFERENCIA', 'ACTIVAR_RESERVAS_DESCUADRADAS']) assert.match(activar, new RegExp(`'${codigo}'`), codigo)
  // INV-5b2: una orden de compra abierta ya no impide activar (los lotes se dicen al recibir).
  assert.doesNotMatch(activar, /ACTIVAR_CON_ORDEN_DE_COMPRA|inventoryPurchaseOrderLine/, 'una orden de compra abierta no bloquea la activación')
  assert.match(activar, /status: 'OPEN'/)
  assert.match(activar, /status: \{ in: \['SENT', 'PARTIAL'\] \}/)
  assert.match(activar, /vencerDeNivel\(/, 'las reservas caducadas se vencen antes de copiar lo apartado')
  // La apertura copia las TRES cubetas, tal cual.
  assert.match(activar, /onHand: n\.onHand, reserved: n\.reserved, damaged: n\.damaged/)
  assert.match(activar, /legacy: true/)
  assert.match(activar, /tipo: e\.series === true \? 'SERIES' : 'LOTES'/, 'deja rastro en la bitácora (lotes o series)')
})

test('INV-5a · los flujos que todavía no reparten por lote se niegan a tocar un producto con lotes', () => {
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  // INV-5b3: el conteo de una sesión ya cuenta por lote; INV-5b4: las transferencias (directa y con envío) también. Queda el conteo suelto de la ficha.
  for (const f of ['contarEnTx']) {
    assert.match(cuerpoDe(svc, f), /exigirSinLotes\(/, f)
  }
  for (const f of ['registrarConteoProductoEnTx', 'importarConteoEnTx', 'aplicarConteoEnTx', 'transferirEnTx', 'enviarTrasladoEnTx', 'recibirTrasladoEnTx', 'cancelarTrasladoEnTx']) {
    assert.doesNotMatch(cuerpoDe(svc, f), /exigirSinLotes\(/, `${f}: ya trabaja por lote`)
  }
  // INV-5b2: la orden de compra YA trabaja con lotes (se pide por producto y los lotes se dicen al recibir): no se niega.
  assert.doesNotMatch(sinComentarios(leer('src/modules/inventory/compras-service.ts')), /exigirSinLotes/, 'orden de compra: ya no se niega')
  const imp = sinComentarios(leer('src/modules/inventory/importar.ts'))
  assert.match(cuerpoDe(imp, 'informeDeImportacionEnTx'), /exigirSinLotes\(/, 'la revisión de entradas por archivo')
  assert.doesNotMatch(cuerpoDe(imp, 'informeDeConteoImportadoEnTx'), /exigirSinLotes\(/, 'la revisión de un conteo por archivo ya trae el lote de cada fila')
  const sin = cuerpoDe(svc, 'exigirSinLotes')
  assert.match(sin, /fallo\('LOTES_NO_SOPORTADO'/)
})

test('INV-5a · lo que lee y reparte FEFO: vender, apartar, cobrar, liberar, devolver y mover usan el mismo plan puro', () => {
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  const resolver = cuerpoDe(svc, 'resolverReparto')
  assert.match(resolver, /repartirFefo\(lotes, cantidad, await hoyDeEmpresa\(tx, companyId, ahora\)\)/, 'FEFO con el día de la empresa')
  assert.match(resolver, /repartoDeDevolucion\(await vendidoPorLote\(/)
  assert.match(resolver, /validarRepartoSalida\(/)
  assert.match(resolver, /fallo\('LOTES_FALTAN'/, 'una compra dice su lote')
  assert.match(cuerpoDe(svc, 'cerrarReserva'), /repartoDeReserva\(tx, companyId, r\)/, 'liberar y vencer una reserva')
  assert.match(cuerpoDe(svc, 'reservarEnTx'), /resolverReparto\(/)
  const consumir = cuerpoDe(svc, 'consumirReservaEnTx')
  assert.match(consumir, /planDeConsumo\(/)
  assert.match(consumir, /fallo\('LOTES_VENCIDOS'/)
  assert.match(cuerpoDe(svc, 'hoyDeEmpresa'), /diaLocal\(ahora, c\?\.zonaHoraria \?\? ''\)/, 'el día de la empresa, no el del servidor')
  for (const f of ['moverSimple']) assert.match(cuerpoDe(svc, f), /resolverReparto\(/, f)
  const mover = cuerpoDe(svc, 'moverEntreLotesEnTx')
  assert.equal([...mover.matchAll(/motivoCodigo: MOTIVO_REASIGNACION_DE_LOTE/g)].length, 2, 'las dos patas llevan el motivo del sistema')
  assert.match(mover, /validarMovimientoEntreLotes\(/)
})

test('INV-5a · el barrido vence lotes además de reservas, y una reasignación de lote no cuenta como merma', () => {
  const b = leer('src/modules/inventory/barrido.ts')
  assert.match(b, /vencerLotesEnTx\(tx, companyId, ahora\)/)
  assert.match(b, /import \{ vencerLotesEnTx, vencerReservasEnTx \} from '\.\/service'/)
  assert.match(cuerpoDe(sinComentarios(leer('src/modules/inventory/service.ts')), 'vencerLotesEnTx'), /l\."expiresOn" < \$\{hoy\}::date/, 'vencido = su día ya pasó')
  const m = leer('src/modules/inventory/mermas-queries.ts')
  assert.match(m, /AND m\."reasonCode" IS DISTINCT FROM \$\{MOTIVO_REASIGNACION_DE_LOTE\}/)
  // El motivo del sistema no sale en ningún selector.
  assert.match(leer('src/modules/inventory/motivos.ts'), /export const MOTIVOS_DEL_SISTEMA/)
})

test('INV-5a · borrar una variante sin movimientos borra también sus lotes, antes de sus saldos', () => {
  const c = sinComentarios(leer('src/modules/catalog/service.ts'))
  const i = (t: string) => c.indexOf(t)
  const orden = ['inventoryLotOpening.deleteMany', 'inventoryLotBalance.deleteMany', 'inventoryLot.deleteMany', 'inventoryLotTracking.deleteMany', 'inventoryLevel.deleteMany'].map(i)
  assert.ok(orden.every((n) => n >= 0), 'las cinco limpiezas')
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'en ese orden: aperturas, saldos por lote, lotes, activación y, al final, los saldos')
})

test('INV-5a · las acciones pasan los lotes a quien los reparte y activar / mover piden la función «ajustar»', () => {
  const a = sinComentarios(leer('src/modules/inventory/actions.ts'))
  assert.match(a, /costo: e\.costo, lotes: e\.lotes \}/, 'entrada')
  assert.match(a, /idempotencyKey: clave\(e\.clave\), lotes: e\.lotes \}, ctx\)/, 'devolución')
  assert.equal([...a.matchAll(/lotesSalida: e\.lotesSalida/g)].length, 3, 'daño, resolver lo dañado y ajuste')
  assert.match(a, /lotes: e\.lotes, lotesSalida: e\.lotesSalida/, 'ajuste: sobrante y faltante')
  assert.match(cuerpoDe(a, 'activarLotesInventario'), /contexto\('ajustar'\)/)
  assert.match(cuerpoDe(a, 'moverEntreLotesInventario'), /operar\('ajustar'/)
  assert.match(a, /\.\.\.\(l\?\.lotes === undefined \|\| l\?\.lotes === null \? \{\} : \{ lotes: l\.lotes as never \}\)/, 'las líneas de una entrada llevan sus lotes')
})

test('INV-5a · las pantallas: la ficha lee los lotes aparte y sin romperse, ofrece activarlos, y un producto con lotes se transfiere por lote', () => {
  const p = sinComentarios(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(p, /lotesDeVarianteEnTx\(tx, companyId, varianteId\)/)
  assert.match(p, /console\.error\('\[admin-inventario-ficha\] los lotes no están disponibles'/, 'en su propio try')
  assert.match(p, /lotes && !lotes\.lleva && puedeAjustar/)
  assert.match(p, /<ActivarLotesCard varianteId=/)
  assert.doesNotMatch(p, /puedeTransferir && !lotes\?\.lleva/, 'INV-5b4: lo que lleva lotes SÍ se transfiere')
  assert.match(p, /lotesPorSucursal=\{lotes\?\.lleva \? lotes\.porSucursal : undefined\}/, 'el formulario recibe los lotes de cada sucursal')
  assert.match(p, /lotes=\{lotes\?\.lleva \?/, 'la tarjeta de cada sucursal recibe los lotes')
  const t = leer('src/components/inventario/SucursalInventarioCard.tsx')
  assert.match(t, /!\(lotes && o\.valor === 'CONTEO'\)/, 'sin conteo suelto con lotes')
  assert.match(t, /moverEntreLotesInventario\(/)
  assert.match(t, /lotesSalida: \[\{ loteId: loteSalida, cantidad: numero \}\]/)
  const e = leer('src/components/inventario/EntradaMultipleForm.tsx')
  assert.match(e, /validarLotesDeLinea\(lote, cuerpo\[i\]\.cantidad, \{ exigirVencimiento: lineas\[i\]\.exigeVencimiento, series: lineas\[i\]\.llevaSeries \}\)/, 'el formulario valida con las mismas reglas del servidor')
  const act = leer('src/components/inventario/ActivarLotesCard.tsx')
  assert.match(act, /no se puede deshacer/i, 'avisa que es de un solo sentido')
  assert.match(act, /setConfirmando\(true\)/, 'en dos pasos')
})

test('INV-5a · el reparto de una reserva resta lo que ya se liberó de ella: apartar suma, liberar resta', () => {
  // Hoy ninguna ruta pública lee el reparto de una reserva con liberaciones previas (el cambio de lote al cobrar lo escribe y lo
  // consume en la misma transacción), así que esto no se puede ejercitar desde fuera; lo fija la forma de la consulta.
  const svc = sinComentarios(leer('src/modules/inventory/service.ts'))
  const cuerpo = cuerpoDe(svc, 'repartoDeReserva')
  assert.match(cuerpo, /CASE WHEN m\."type" = 'RESERVATION' THEN ml\."quantity" ELSE -ml\."quantity" END/, 'la liberación resta')
  assert.match(cuerpo, /m\."type" IN \('RESERVATION', 'RESERVATION_RELEASE'\)/, 'solo apartados y liberaciones de esa reserva')
  assert.match(cuerpo, /m\."referenceType" = 'RESERVATION' AND m\."referenceId" = \$\{r\.id\}/, 'de ESA reserva')
})
