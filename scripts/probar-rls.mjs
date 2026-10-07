#!/usr/bin/env node
/**
 * PRUEBA DE AISLAMIENTO ENTRE EMPRESAS  (auditoría de producción · A-01)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ COMPRUEBA, Y POR QUÉ HACE FALTA UNA PRUEBA Y NO UN DOCUMENTO
 *
 * Las políticas de `2026-07-rls-capa2-aislamiento.sql` se deducen del esquema:
 * 80 tablas por su columna `companyId` y 29 más siguiendo claves foráneas. Eso
 * es cómodo, pero también significa que **nadie las ha leído una por una**. Un
 * EXISTS mal montado en la ronda 1 se propaga a 28 tablas sin que nadie lo note,
 * y el resultado es una base que parece aislada y no lo está.
 *
 * Por eso esto no comprueba que las políticas EXISTAN. Comprueba que una
 * empresa no ve a la otra, sembrando dos empresas de verdad y mirando qué
 * devuelve la base.
 *
 * Los seis casos:
 *
 *   1. Lectura directa    — con el contexto en la empresa A, `select * from
 *                           clientes` SIN `where` no devuelve nada de B.
 *                           Este es EL caso: el `where` olvidado.
 *   2. Lectura por hija   — `visits` no tiene `companyId`; llega al inquilino
 *                           a través de `clientes`. Se comprueba que el camino
 *                           deducido funciona.
 *   3. Escritura cruzada  — la empresa A no puede insertar una fila marcada
 *                           como de B. Sin esto, RLS solo sería un filtro de
 *                           lectura.
 *   4. Modificación cruzada — A no puede tocar filas de B con un `update` sin
 *                           `where`, que es como se corrompen datos ajenos.
 *   5. Omnisciente        — la válvula de escape sigue viendo todo, porque el
 *                           superadmin, el marketplace público y el cron la
 *                           necesitan.
 *   6. Sin contexto       — si nadie declaró empresa, no se ve NADA. Fallo
 *                           cerrado: un olvido no debe abrir la puerta.
 *   7. Inicio comercial   — `home_revisiones` (Nivel 0) y `home_bloques`
 *                           (Nivel N, por `revisionId`): lo que compone la
 *                           pantalla que ve el cliente no cruza empresas, ni
 *                           leyéndola ni colgando un bloque de una revisión
 *                           ajena.
 *   8-9. Supply          — el derecho/pedido es de quien lo cumple, no de la
 *                           ficha del cliente; el cobro de la plataforma no es
 *                           de ningún inquilino.
 *   10. Catálogo          — `catalog_*` (Commerce Core): ítems, variantes y
 *                           categorías no cruzan empresas, ni leyendo, ni
 *                           escribiendo, ni colgando una variante de un ítem
 *                           ajeno (FK compuesta).
 *   11. Inventario        — `inventory_*` (Commerce Core · Fase 2): saldos,
 *                           movimientos y reservas no cruzan empresas, ni se
 *                           puede juntar la variante de una con la sucursal
 *                           de otra, y el ledger no se edita ni con el
 *                           contexto correcto.
 *   12. Pedidos Membego   — `membego_orders` y sus hijas (Commerce Core · Fase 3):
 *                           pedidos, líneas y atribución no cruzan empresas, ni
 *                           se puede juntar el cliente de una con la sucursal
 *                           de otra, y las líneas no se editan ni con el
 *                           contexto correcto.
 *   13. Merchant Billing  — `merchant_*` (Commerce Core · Fase 4): la cuenta, el
 *                           libro y los cortes de una empresa no los ve ni los
 *                           toca otra, y el libro no se edita ni con el contexto
 *                           correcto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   DATABASE_URL="postgresql://postgres@host:5432/base" npm run rls:probar
 *
 * Necesita un rol con permiso para `SET ROLE membego_app`, es decir el dueño
 * de las tablas. Crea sus datos con identificadores propios y los borra al
 * terminar, incluso si falla.
 *
 * NO LO CORRAS CONTRA PRODUCCIÓN. Escribe filas. Úsalo contra una base de
 * prueba o la del CI. Se niega a arrancar si la URL huele a Supabase.
 */

import { execFileSync } from 'node:child_process'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

const URL = process.env.DATABASE_URL
if (!URL) {
  console.error(`${C.mal}✗${C.off} Falta DATABASE_URL.`)
  process.exit(1)
}

// Guarda: esta prueba ESCRIBE. Contra la base real sería sembrar basura en
// producción, y peor: los `delete` de limpieza correrían allí.
if (/supabase\.(co|com)|pooler\.supabase/i.test(URL) && process.env.RLS_PERMITIR_REMOTA !== 'si') {
  console.error(
    `${C.mal}✗${C.off} La URL apunta a Supabase y esta prueba escribe filas.\n` +
    `  Úsala contra una base de prueba. Si de verdad sabes lo que haces:\n` +
    `  RLS_PERMITIR_REMOTA=si`
  )
  process.exit(1)
}

/** Ejecuta SQL y devuelve la salida cruda. Lanza si psql falla. */
function sql(texto) {
  return execFileSync('psql', [URL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', texto], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Ejecuta SQL con la válvula omnisciente abierta, y COMMIT.
 *
 * La siembra y la limpieza crean y borran DOS empresas: eso no lo hace ningún
 * inquilino, lo hace el superadmin. Con RLS de verdad encendido, hacerlo sin la
 * válvula falla —`new row violates row-level security policy for table
 * "companies"`— y la prueba no llega ni a empezar.
 *
 * Commit y no rollback, al contrario que `comoInquilino`: lo sembrado tiene que
 * seguir ahí cuando corran las comprobaciones.
 */
function comoOmnisciente(texto) {
  return sql(`begin; set local app.omnisciente = 'on'; ${texto} commit;`)
}

/**
 * Ejecuta SQL como `membego_app` con un contexto de empresa, dentro de una
 * transacción que SIEMPRE se deshace.
 *
 * `SET LOCAL` es deliberado: el ajuste muere con la transacción. Con `SET` a
 * secas se quedaría pegado a la conexión y, con un pool por delante, la
 * siguiente petición heredaría la empresa de la anterior. Ese es el fallo
 * clásico de RLS con pooler, y así no puede ocurrir.
 */
function comoInquilino(companyId, consulta, { omnisciente = false } = {}) {
  const contexto = omnisciente
    ? `set local app.omnisciente = 'on';`
    : companyId === null
      ? ''
      : `set local app.company_id = '${companyId}';`
  const crudo = sql(`begin; set local role membego_app; ${contexto} ${consulta} rollback;`)

  // psql imprime la etiqueta de CADA sentencia (BEGIN, SET, ROLLBACK…) en la
  // misma salida que el resultado. Sin quitarlas, la comprobación compara
  // "BEGIN\nSET\n1\nROLLBACK" contra "1" y falla aunque el aislamiento sea
  // correcto — que es exactamente lo que pasó la primera vez.
  return crudo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|SET|RESET|INSERT \d|UPDATE \d|DELETE \d)$/.test(l))
    .join('\n')
}

/** Igual, pero se espera que FALLE (permiso denegado). Devuelve true si falló. */
function fallaComoInquilino(companyId, consulta) {
  try {
    comoInquilino(companyId, consulta)
    return false
  } catch {
    return true
  }
}

/**
 * ¿Existe este disparador? Las reglas que protegen el ledger y las líneas de un
 * pedido viven en las MIGRACIONES (Prisma no sabe expresarlas), y CI crea esta
 * base con `db push`, que no las trae: ahí esas comprobaciones no aplican y se
 * omiten diciéndolo. Las cubren los tests contra PostgreSQL (`npm run test:db`),
 * que sí parten de `migrate deploy`.
 */
function hayDisparador(nombre) {
  return sql(`select count(*) from pg_trigger where tgname = '${nombre}' and not tgisinternal;`).trim() === '1'
}

function omitir(nombre, motivo) {
  console.log(`${C.dim}  - ${nombre} (omitida: ${motivo})${C.off}`)
}

const A = 'rlsprueba_a'
const B = 'rlsprueba_b'
let pasadas = 0
let fallos = 0

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++
    console.log(`${C.ok}  ✓${C.off} ${nombre}`)
  } else {
    fallos++
    console.log(`${C.mal}  ✗ ${nombre}${C.off}`)
    if (detalle) console.log(`${C.dim}     ${detalle}${C.off}`)
  }
}

function limpiar() {
  // En orden inverso a la siembra: las hijas antes que las madres, o las
  // claves foráneas lo impiden.
  try {
    // El ledger de inventario no se borra (lo prohíbe un disparador): para limpiar
    // lo sembrado se desactivan los disparadores ordinarios en ESTA transacción.
    sql(`begin; set local session_replication_role = replica;
         delete from deal_claims where id in ('${A}_dc', '${B}_dc');
         delete from deals where id in ('${A}_dl', '${B}_dl');
         delete from order_attributions where id in ('${A}_doa', '${B}_doa');
         delete from membego_order_lines where id in ('${A}_dol', '${B}_dol');
         delete from membego_orders where id in ('${A}_do', '${B}_do');
         delete from merchant_statements where id in ('${A}_ms', '${B}_ms');
         delete from merchant_ledger_entries where id in ('${A}_ml', '${B}_ml');
         delete from merchant_billing_configs where id in ('${A}_mc', '${B}_mc');
         delete from order_attributions where id in ('${A}_pa', '${B}_pa');
         delete from membego_order_lines where id in ('${A}_pl', '${B}_pl');
         delete from membego_orders where id in ('${A}_po', '${B}_po');
         delete from inventory_movements where id in ('${A}_im', '${B}_im'); commit;`)
  } catch {
    /* si no llegó a sembrarse, no hay nada que limpiar */
  }
  try {
    comoOmnisciente(`
      delete from supply_pedidos     where id = '${A}_sped';
      delete from supply_redenciones where id = '${A}_sr';
      delete from supply_vouchers    where id = '${A}_sv';
      delete from supply_derechos    where id = '${A}_sd';
      delete from supply_lotes       where id = '${A}_sl';
      delete from supply_acuerdos    where id = '${A}_sa';
      delete from inventory_reservations where id in ('${A}_ir', '${B}_ir');
      delete from inventory_levels   where id in ('${A}_il', '${B}_il');
      delete from sucursales         where id in ('${A}_su', '${B}_su');
      delete from catalog_items      where id in ('${A}_ci', '${B}_ci');
      delete from catalog_categories where id in ('${A}_cc', '${B}_cc');
      delete from home_bloques    where "revisionId" in ('${A}_h', '${B}_h');
      delete from home_revisiones where id in ('${A}_h', '${B}_h');
      delete from visits      where "clienteId" in ('${A}_k', '${B}_k');
      delete from memberships where "clienteId" in ('${A}_k', '${B}_k');
      delete from clientes    where id in ('${A}_k', '${B}_k');
      delete from plans       where "companyId" in ('${A}', '${B}');
      delete from companies   where id in ('${A}', '${B}');
    `)
  } catch {
    /* si no llegó a sembrarse, no hay nada que limpiar */
  }
}

console.log('\nAislamiento entre empresas (RLS · Capa 2)')
console.log('─'.repeat(64))

try {
  // ── Requisitos previos ────────────────────────────────────────────────────
  const rol = sql(
    `select coalesce((select case when rolbypassrls then 'BYPASS' else 'ok' end
        from pg_roles where rolname='membego_app'), 'NO_EXISTE')`
  )
  if (rol === 'NO_EXISTE') {
    console.error(
      `${C.mal}✗${C.off} El rol membego_app no existe.\n` +
      `  Aplica prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql primero.`
    )
    process.exit(1)
  }
  if (rol === 'BYPASS') {
    console.error(
      `${C.mal}✗${C.off} membego_app tiene BYPASSRLS: las políticas no le aplican.\n` +
      `  Corrígelo con: alter role membego_app nobypassrls;`
    )
    process.exit(1)
  }

  const conPolitica = Number(
    sql(`select count(*) from pg_policies where schemaname='public' and policyname like 'membego_%'`)
  )
  const tablas = Number(
    sql(`select count(*) from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`)
  )
  console.log(`${C.dim}Políticas membego_* activas: ${conPolitica} · tablas en public: ${tablas}${C.off}\n`)

  // ── Siembra ───────────────────────────────────────────────────────────────
  //
  // Dos empresas completas: plan → cliente → membresía → visita. La cadena
  // entera hace falta porque `visits` exige membresía, y es justo lo que
  // interesa: `visits` no tiene `companyId` y debe heredar el inquilino a
  // través de esa cadena.
  limpiar()
  comoOmnisciente(`
    insert into companies (id, name, slug, type, "updatedAt") values
      ('${A}', 'Prueba A', '${A}', 'CARWASH', now()),
      ('${B}', 'Prueba B', '${B}', 'CARWASH', now());
    insert into plans (id, "companyId", nombre, precio, "updatedAt") values
      ('${A}_p', '${A}', 'Plan A', 100, now()),
      ('${B}_p', '${B}', 'Plan B', 100, now());
    insert into clientes (id, "companyId", "supabaseId", nombre, email, "codigoReferido", "updatedAt") values
      ('${A}_k', '${A}', '${A}_u', 'Cliente de A', 'a@prueba.invalid', '${A}_r', now()),
      ('${B}_k', '${B}', '${B}_u', 'Cliente de B', 'b@prueba.invalid', '${B}_r', now());
    insert into memberships (id, "clienteId", "companyId", "planId", "updatedAt") values
      ('${A}_m', '${A}_k', '${A}', '${A}_p', now()),
      ('${B}_m', '${B}_k', '${B}', '${B}_p', now());
    insert into visits (id, "clienteId", "membershipId", servicio, "fechaVisita") values
      ('${A}_v', '${A}_k', '${A}_m', 'Lavado', now()),
      ('${B}_v', '${B}_k', '${B}_m', 'Lavado', now());
    insert into home_revisiones (id, "companyId", territorio, estado, "updatedAt") values
      ('${A}_h', '${A}', 'Territorio A', 'PUBLICADA', now()),
      ('${B}_h', '${B}', 'Territorio B', 'PUBLICADA', now());
    insert into home_bloques (id, "revisionId", tipo, orden, "updatedAt") values
      ('${A}_hb', '${A}_h', 'CABECERA', 0, now()),
      ('${B}_hb', '${B}_h', 'CABECERA', 0, now());

    -- COMMERCE CORE · catálogo. Cada ítem se siembra CON su variante en la misma
    -- transacción: un ítem sin variante no se puede confirmar.
    insert into catalog_items (id, "companyId", name, slug, type, "updatedAt") values
      ('${A}_ci', '${A}', 'Ítem de A', 'item-a', 'SERVICE', now()),
      ('${B}_ci', '${B}', 'Ítem de B', 'item-b', 'SERVICE', now());
    insert into catalog_variants (id, "companyId", "catalogItemId", name, sku, price, "isDefault", "updatedAt") values
      ('${A}_cv', '${A}', '${A}_ci', 'Default', 'RLS-A', 100, true, now()),
      ('${B}_cv', '${B}', '${B}_ci', 'Default', 'RLS-B', 100, true, now());
    insert into catalog_categories (id, "companyId", name, slug, "updatedAt") values
      ('${A}_cc', '${A}', 'Categoría de A', 'cat-a', now()),
      ('${B}_cc', '${B}', 'Categoría de B', 'cat-b', now());

    -- COMMERCE CORE · inventario: una sucursal, un saldo, una reserva y un
    -- movimiento por empresa.
    insert into sucursales (id, "companyId", nombre) values
      ('${A}_su', '${A}', 'Sucursal de A'),
      ('${B}_su', '${B}', 'Sucursal de B');
    insert into inventory_levels (id, "companyId", "catalogVariantId", "locationId", "onHand", "updatedAt") values
      ('${A}_il', '${A}', '${A}_cv', '${A}_su', 5, now()),
      ('${B}_il', '${B}', '${B}_cv', '${B}_su', 5, now());
    insert into inventory_reservations (id, "companyId", "inventoryLevelId", quantity, "expiresAt") values
      ('${A}_ir', '${A}', '${A}_il', 1, now() + interval '1 hour'),
      ('${B}_ir', '${B}', '${B}_il', 1, now() + interval '1 hour');
    insert into inventory_movements (id, "companyId", "inventoryLevelId", type, "destinationBucket", quantity, "previousOnHand", "newOnHand") values
      ('${A}_im', '${A}', '${A}_il', 'PURCHASE', 'AVAILABLE', 5, 0, 5),
      ('${B}_im', '${B}', '${B}_il', 'PURCHASE', 'AVAILABLE', 5, 0, 5);

    -- COMMERCE CORE · pedidos Membego: un pedido con su línea y su atribución por
    -- empresa (el disparador diferido exige que las líneas sumen el subtotal).
    insert into membego_orders (id, "companyId", code, "locationId", "customerId", status, origin, subtotal, "commissionableBase", total, "updatedAt") values
      ('${A}_po', '${A}', 'MBG-PED-2030-900001', '${A}_su', '${A}_k', 'CREATED', 'MARKETPLACE', 100, 100, 100, now()),
      ('${B}_po', '${B}', 'MBG-PED-2030-900001', '${B}_su', '${B}_k', 'CREATED', 'MARKETPLACE', 100, 100, 100, now());
    insert into membego_order_lines (id, "companyId", "orderId", "catalogVariantId", description, sku, quantity, "unitPrice", "lineTotal") values
      ('${A}_pl', '${A}', '${A}_po', '${A}_cv', 'Producto de A', 'PED-A', 1, 100, 100),
      ('${B}_pl', '${B}', '${B}_po', '${B}_cv', 'Producto de B', 'PED-B', 1, 100, 100);
    insert into order_attributions (id, "companyId", "orderId", channel) values
      ('${A}_pa', '${A}', '${A}_po', 'DIRECT'),
      ('${B}_pa', '${B}', '${B}_po', 'DIRECT');

    -- COMMERCE CORE · Merchant Billing: la cuenta, un asiento (el primero de la cuenta: posición 1 y
    -- saldo = monto) y un corte por empresa.
    insert into merchant_billing_configs (id, "companyId", "updatedAt") values
      ('${A}_mc', '${A}', now()),
      ('${B}_mc', '${B}', now());
    insert into merchant_ledger_entries (id, "companyId", seq, type, amount, balance, "referenceType", "referenceId", reason, "idempotencyKey") values
      ('${A}_ml', '${A}', 1, 'ADJUSTMENT', 10, 10, 'MANUAL', 'rls', 'prueba', '${A}_ml_k'),
      ('${B}_ml', '${B}', 1, 'ADJUSTMENT', 10, 10, 'MANUAL', 'rls', 'prueba', '${B}_ml_k');
    insert into merchant_statements (id, "companyId", period, "periodStart", "periodEnd", "billingCycle", "openingBalance", "totalOrders", "totalGmv", "totalCommissions", reversals, adjustments, credits, payments, "closingBalance", "amountDue", "entryCount") values
      ('${A}_ms', '${A}', '2030-01-01/2030-02-01', '2030-01-01', '2030-02-01', 'MONTHLY', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      ('${B}_ms', '${B}', '2030-01-01/2030-02-01', '2030-01-01', '2030-02-01', 'MONTHLY', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    -- COMMERCE CORE · ofertas con presupuesto: una oferta con UN reclamo por empresa. En un solo bloque
    -- (los contadores de la oferta tienen que cuadrar con sus reclamos al confirmar): la oferta nace en
    -- borrador y sin contadores; el pedido del reclamo lleva la atribución de ESA oferta.
    begin;
    insert into deals (id, "companyId", "catalogVariantId", title, "discountType", "discountValue", "startsAt", "maxClaims", "feePerRedemption", "budgetTotal", "updatedAt") values
      ('${A}_dl', '${A}', '${A}_cv', 'Oferta de A', 'PERCENT', 10, now(), 5, 100, 1000, now()),
      ('${B}_dl', '${B}', '${B}_cv', 'Oferta de B', 'PERCENT', 10, now(), 5, 100, 1000, now());
    insert into membego_orders (id, "companyId", code, "locationId", "customerId", status, origin, subtotal, "commissionableBase", total, "updatedAt") values
      ('${A}_do', '${A}', 'MBG-PED-2030-900002', '${A}_su', '${A}_k', 'CREATED', 'MARKETPLACE', 100, 100, 100, now()),
      ('${B}_do', '${B}', 'MBG-PED-2030-900002', '${B}_su', '${B}_k', 'CREATED', 'MARKETPLACE', 100, 100, 100, now());
    insert into membego_order_lines (id, "companyId", "orderId", "catalogVariantId", description, sku, quantity, "unitPrice", "lineTotal") values
      ('${A}_dol', '${A}', '${A}_do', '${A}_cv', 'Producto de A', 'DEAL-A', 1, 100, 100),
      ('${B}_dol', '${B}', '${B}_do', '${B}_cv', 'Producto de B', 'DEAL-B', 1, 100, 100);
    insert into order_attributions (id, "companyId", "orderId", channel, "promotionId") values
      ('${A}_doa', '${A}', '${A}_do', 'PROMOTION_CLAIM', '${A}_dl'),
      ('${B}_doa', '${B}', '${B}_do', 'PROMOTION_CLAIM', '${B}_dl');
    update membego_orders set status = 'AWAITING_MERCHANT' where id in ('${A}_do', '${B}_do');
    insert into deal_claims (id, "companyId", "dealId", "customerId", "orderId", fee, savings, "expiresAt", "updatedAt") values
      ('${A}_dc', '${A}', '${A}_dl', '${A}_k', '${A}_do', 100, 10, now() + interval '7 days', now()),
      ('${B}_dc', '${B}', '${B}_dl', '${B}_k', '${B}_do', 100, 10, now() + interval '7 days', now());
    update deals set status = 'ACTIVE', "publishedAt" = now(), "claimsActive" = 1, "budgetReserved" = 100 where id in ('${A}_dl', '${B}_dl');
    commit;

    -- MEMBEGO SUPPLY · el caso cruzado, que es el que importa.
    --
    -- El proveedor es A. El cliente que recibe el beneficio es el de B: una
    -- persona registrada en otra empresa que recibe una pizza de A. Eso NO es
    -- un caso raro, es el normal — el marketplace de Membego cruza empresas a
    -- propósito— y es exactamente el que se colaba.
    insert into supply_acuerdos (id, codigo, "proveedorId", tipo, "itemNombre",
                                 cantidad, "costoUnitario", "inicioAt", "finAt", "updatedAt")
      values ('${A}_sa', 'MBG-A-001', '${A}', 'ON_DEMAND', 'Pizza Grande',
              1000, 300, now(), now() + interval '90 days', now());
    insert into supply_lotes (id, codigo, "acuerdoId", "proveedorId", "snapshotItemNombre",
                              "snapshotCostoUnitario", "snapshotModelo", "snapshotTipo",
                              "inicioAt", "venceAt", "updatedAt")
      values ('${A}_sl', 'MBG-A-001-L1', '${A}_sa', '${A}', 'Pizza Grande',
              300, 'COMPRA_UNIDAD_COMPLETA', 'ON_DEMAND',
              now(), now() + interval '90 days', now());
    insert into supply_derechos (id, "loteId", "clienteId", "proveedorId", origen,
                                 "costoUnitario", "vencAt", "updatedAt")
      values ('${A}_sd', '${A}_sl', '${B}_k', '${A}', 'REGALO',
              300, now() + interval '30 days', now());
    insert into supply_pedidos (id, numero, estado, "clienteId", "derechoId",
                                monto, "expiraAt", "updatedAt")
      values ('${A}_sped', 'MBG-P-RLS', 'INICIADO', '${B}_k', '${A}_sd',
              399, now() + interval '1 hour', now());
    insert into supply_vouchers (id, "derechoId", codigo, "proveedorId", "vigenteHasta", "updatedAt")
      values ('${A}_sv', '${A}_sd', 'MBG-PRUEBA-1', '${A}', now() + interval '30 days', now());
    insert into supply_redenciones (id, "voucherId", "derechoId", "clienteId", "proveedorId",
                                    "loteId", "acuerdoId", "costoUnitario")
      values ('${A}_sr', '${A}_sv', '${A}_sd', '${B}_k', '${A}', '${A}_sl', '${A}_sa', 300);
  `)

  // ── 1. El `where` olvidado ────────────────────────────────────────────────
  const vistos = comoInquilino(A, `select id from clientes where id in ('${A}_k','${B}_k');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Lectura directa: con el contexto en A, no aparece ningún cliente de B',
    vistos.length === 1 && vistos[0] === `${A}_k`,
    `devolvió: ${JSON.stringify(vistos)}`
  )

  // ── 2. El camino deducido por clave foránea ───────────────────────────────
  const visitas = comoInquilino(A, `select id from visits where id in ('${A}_v','${B}_v');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Lectura por tabla hija: `visits` hereda el inquilino de `clientes`',
    visitas.length === 1 && visitas[0] === `${A}_v`,
    `devolvió: ${JSON.stringify(visitas)}`
  )

  // ── 3. Escritura marcada como de otro ─────────────────────────────────────
  comprobar(
    'Escritura cruzada: A no puede insertar una fila con el companyId de B',
    fallaComoInquilino(
      A,
      `insert into clientes (id,"companyId","supabaseId",nombre,email,"codigoReferido","updatedAt")
       values ('${A}_intruso','${B}','x','Intruso','x@prueba.invalid','${A}_ri',now());`
    )
  )

  // ── 4. Modificación de lo ajeno ───────────────────────────────────────────
  const tocadas = comoInquilino(
    A,
    `with u as (update clientes set nombre='PISOTEADO' returning 1) select count(*) from u;`
  )
  comprobar(
    'Modificación cruzada: un `update` sin `where` solo alcanza las filas de A',
    tocadas === '1',
    `filas afectadas: ${tocadas} (debería ser 1, la de A)`
  )

  // ── 5. La válvula de escape ───────────────────────────────────────────────
  const omni = comoInquilino(
    null,
    `select count(*) from clientes where id in ('${A}_k','${B}_k');`,
    { omnisciente: true }
  )
  comprobar(
    'Modo omnisciente: superadmin, marketplace público y cron siguen viendo todo',
    omni === '2',
    `vio ${omni} de 2`
  )

  // ── 6. Fallo cerrado ──────────────────────────────────────────────────────
  const sinContexto = comoInquilino(
    null,
    `select count(*) from clientes where id in ('${A}_k','${B}_k');`
  )
  comprobar(
    'Sin contexto de empresa no se ve nada (fallo cerrado, no abierto)',
    sinContexto === '0',
    `vio ${sinContexto} filas sin declarar empresa`
  )

  // ── 7. La composición del Inicio, que es lo que ve el cliente ─────────────
  //
  // `home_revisiones` entra por Nivel 0 y `home_bloques` por Nivel N a través
  // de `revisionId`. Se comprueban aquí, y no con un script aparte, por la
  // razón que explica la cabecera de este archivo: las políticas se DEDUCEN,
  // así que nadie las ha leído una por una y el único aval es sembrar dos
  // empresas y mirar qué devuelve la base.
  //
  // Que estas dos tablas caigan por el mecanismo genérico es justamente lo que
  // se está comprobando: si mañana una tabla nueva se queda sin camino, este
  // caso —no un documento— es lo que lo dice.
  const revisiones = comoInquilino(A, `select id from home_revisiones where id in ('${A}_h','${B}_h');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Inicio: la composición de A no incluye la de B',
    revisiones.length === 1 && revisiones[0] === `${A}_h`,
    `devolvió: ${JSON.stringify(revisiones)}`
  )

  const bloques = comoInquilino(A, `select id from home_bloques where id in ('${A}_hb','${B}_hb');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Inicio: los bloques heredan el inquilino de su revisión (Nivel N)',
    bloques.length === 1 && bloques[0] === `${A}_hb`,
    `devolvió: ${JSON.stringify(bloques)}`
  )

  comprobar(
    'Inicio: A no puede colgar un bloque de la composición de B',
    fallaComoInquilino(
      A,
      `insert into home_bloques (id,"revisionId",tipo,orden,"updatedAt")
       values ('${A}_intruso','${B}_h','HERO',1,now());`
    )
  )

  // ── 8. Membego Supply: el inquilino de un derecho es QUIEN LO CUMPLE ──────
  //
  // Estas cuatro comprobaciones nacieron de un fallo medido el 25-09-2026, y
  // las cuatro fallaban antes de arreglarlo.
  //
  // Las políticas se deducen recorriendo claves foráneas en orden ALFABÉTICO de
  // columna. `supply_derechos` tiene tres NOT NULL —`clienteId`, `loteId`,
  // `proveedorId`— y ganaba `clienteId`, así que el derecho quedaba atado a la
  // empresa donde la PERSONA tiene su ficha. No es la misma que lo cumple.
  //
  // Resultado: el proveedor no veía ni uno de sus propios derechos (su portal y
  // su escáner se apagaban), y la empresa de la ficha del cliente SÍ los veía
  // —con `costoUnitario` dentro, que es lo que Membego negoció con un TERCERO—.
  //
  // Por eso se siembra al cliente en B y el proveedor en A: con las dos cosas
  // en la misma empresa, una política mal puesta pasa la prueba.
  const derechosA = comoInquilino(A, `select id from supply_derechos where id = '${A}_sd';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply: el PROVEEDOR ve sus propios derechos, aunque el cliente sea de otra empresa',
    derechosA.length === 1,
    `el proveedor no ve su derecho: devolvió ${JSON.stringify(derechosA)}`
  )

  const derechosB = comoInquilino(B, `select id from supply_derechos where id = '${A}_sd';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: la empresa de la ficha del cliente NO ve el derecho (lleva el costo de Membego)',
    derechosB.length === 0,
    `${B} llegó a leer el derecho de ${A}: ${JSON.stringify(derechosB)}`
  )

  const redenA = comoInquilino(A, `select id from supply_redenciones where id = '${A}_sr';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply: el proveedor ve sus propias entregas',
    redenA.length === 1,
    `devolvió: ${JSON.stringify(redenA)}`
  )

  const redenB = comoInquilino(B, `select id from supply_redenciones where id = '${A}_sr';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: otra empresa no ve las entregas del proveedor',
    redenB.length === 0,
    `${B} llegó a leer la entrega de ${A}: ${JSON.stringify(redenB)}`
  )

  // ── 9. El cobro de la PLATAFORMA no es de ningún inquilino ────────────────
  //
  // `supply_pedidos` lleva `monto`: lo que el cliente le paga a MEMBEGO por una
  // unidad que Membego ya le compró al comercio. Ese número es el margen de la
  // plataforma y no es de nadie más.
  //
  // La trampa es que la derivación automática NO lo deja fuera: `clienteId` es
  // NOT NULL, así que le pone una política por la empresa de la ficha del
  // cliente — el mismo fallo del 25-09, otra vez, en una tabla nueva. Por eso la
  // Capa 2 la declara a mano y DEJA CAER esa política derivada.
  //
  // Las dos comprobaciones de aquí fallan si alguien quita esa declaración: la
  // primera porque B vería el pedido, y la segunda porque A —el proveedor, que
  // cumple la unidad— tampoco debe ver a cuánto la revende Membego.
  const pedidoB = comoInquilino(B, `select id from supply_pedidos where id = '${A}_sped';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: la empresa de la ficha del cliente NO ve el pedido (lleva el margen de Membego)',
    pedidoB.length === 0,
    `${B} llegó a leer el pedido: ${JSON.stringify(pedidoB)}`
  )

  const pedidoA = comoInquilino(A, `select id from supply_pedidos where id = '${A}_sped';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: el propio proveedor NO ve a cuánto revende Membego su unidad',
    pedidoA.length === 0,
    `${A} llegó a leer el pedido: ${JSON.stringify(pedidoA)}`
  )

  comprobar(
    'Supply: B no puede colgar un derecho del lote de A',
    fallaComoInquilino(
      B,
      `insert into supply_derechos (id,"loteId","clienteId","proveedorId",origen,
                                   "costoUnitario","vencAt","updatedAt")
       values ('${B}_intruso','${A}_sl','${B}_k','${B}','REGALO',300,now(),now());`
    )
  )

  // ── 10. Commerce Core · catálogo unificado ────────────────────────────────
  //
  // Las cinco tablas llevan `companyId` propio (también las hijas), así que
  // entran por Nivel 0 y nadie escribió una política a mano para ellas. Que el
  // generador las cubra es justo lo que se comprueba aquí.
  const items = comoInquilino(A, `select id from catalog_items where id in ('${A}_ci','${B}_ci');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Catálogo: con el contexto en A no aparece ningún ítem de B',
    items.length === 1 && items[0] === `${A}_ci`,
    `devolvió: ${JSON.stringify(items)}`
  )

  const variantes = comoInquilino(A, `select id from catalog_variants where id in ('${A}_cv','${B}_cv');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Catálogo: las variantes de B tampoco se ven (la hija lleva su propio companyId)',
    variantes.length === 1 && variantes[0] === `${A}_cv`,
    `devolvió: ${JSON.stringify(variantes)}`
  )

  const categorias = comoInquilino(A, `select id from catalog_categories where id in ('${A}_cc','${B}_cc');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Catálogo: las categorías de B tampoco',
    categorias.length === 1 && categorias[0] === `${A}_cc`,
    `devolvió: ${JSON.stringify(categorias)}`
  )

  comprobar(
    'Catálogo: A no puede insertar un ítem marcado como de B',
    fallaComoInquilino(
      A,
      `insert into catalog_items (id,"companyId",name,slug,type,"updatedAt")
       values ('${A}_intruso_i','${B}','Intruso','intruso','SERVICE',now());`
    )
  )

  comprobar(
    'Catálogo: A no puede colgar una variante (con su propio companyId) de un ítem de B — la FK compuesta lo impide',
    fallaComoInquilino(
      A,
      `insert into catalog_variants (id,"companyId","catalogItemId",name,sku,price,"updatedAt")
       values ('${A}_intruso_v','${A}','${B}_ci','Intrusa','RLS-X',1,now());`
    )
  )

  const tocadasCatalogo = comoInquilino(
    A,
    `with u as (update catalog_items set name='PISOTEADO' returning 1) select count(*) from u;`
  )
  comprobar(
    'Catálogo: un `update` sin `where` solo alcanza los ítems de A',
    tocadasCatalogo === '1',
    `filas afectadas: ${tocadasCatalogo} (debería ser 1)`
  )

  // ── 11. Commerce Core · inventario ────────────────────────────────────────
  //
  // Igual que el catálogo: las tres tablas llevan `companyId` propio y entran
  // por Nivel 0 sin una política escrita a mano. Aquí además se comprueba lo
  // que el ledger promete: ni siquiera la empresa dueña lo edita.
  const veo = (tabla, a, b) =>
    comoInquilino(A, `select id from ${tabla} where id in ('${a}','${b}');`).split('\n').filter(Boolean)
  const niveles = veo('inventory_levels', `${A}_il`, `${B}_il`)
  comprobar('Inventario: con el contexto en A no aparece ningún saldo de B', niveles.length === 1 && niveles[0] === `${A}_il`, `devolvió: ${JSON.stringify(niveles)}`)
  const movs = veo('inventory_movements', `${A}_im`, `${B}_im`)
  comprobar('Inventario: los movimientos de B tampoco se ven', movs.length === 1 && movs[0] === `${A}_im`, `devolvió: ${JSON.stringify(movs)}`)
  const reservas = veo('inventory_reservations', `${A}_ir`, `${B}_ir`)
  comprobar('Inventario: las reservas de B tampoco', reservas.length === 1 && reservas[0] === `${A}_ir`, `devolvió: ${JSON.stringify(reservas)}`)

  comprobar(
    'Inventario: A no puede insertar un saldo marcado como de B',
    fallaComoInquilino(
      A,
      `insert into inventory_levels (id,"companyId","catalogVariantId","locationId","updatedAt")
       values ('${A}_intruso_il','${B}','${B}_cv','${B}_su',now());`
    )
  )
  comprobar(
    'Inventario: A no puede juntar su variante con la sucursal de B — la FK compuesta lo impide',
    fallaComoInquilino(
      A,
      `insert into inventory_levels (id,"companyId","catalogVariantId","locationId","updatedAt")
       values ('${A}_mezcla_il','${A}','${A}_cv','${B}_su',now());`
    )
  )
  const tocadasInventario = comoInquilino(A, `with u as (update inventory_levels set "lowStockThreshold"=9 returning 1) select count(*) from u;`)
  comprobar('Inventario: un `update` sin `where` solo alcanza los saldos de A', tocadasInventario === '1', `filas afectadas: ${tocadasInventario} (debería ser 1)`)
  if (hayDisparador('inventory_movements_sin_cambios')) {
    comprobar(
      'Inventario: ni A, dueña de su ledger, puede editar un movimiento',
      fallaComoInquilino(A, `update inventory_movements set quantity = 99 where id = '${A}_im';`)
    )
  } else {
    omitir('Inventario: ni A, dueña de su ledger, puede editar un movimiento', 'la base no trae los disparadores de las migraciones (db push)')
  }

  // ── 12. Commerce Core · pedidos Membego ───────────────────────────────────
  //
  // Las cinco tablas llevan `companyId` propio y entran por Nivel 0 sin una
  // política escrita a mano. Además se comprueba que las FK compuestas rechazan
  // mezclar empresas y que las líneas de un pedido no se editan ni con el
  // contexto correcto.
  const pedidos = veo('membego_orders', `${A}_po`, `${B}_po`)
  comprobar('Pedidos: con el contexto en A no aparece ningún pedido de B', pedidos.length === 1 && pedidos[0] === `${A}_po`, `devolvió: ${JSON.stringify(pedidos)}`)
  const lineasPed = veo('membego_order_lines', `${A}_pl`, `${B}_pl`)
  comprobar('Pedidos: las líneas de B tampoco se ven', lineasPed.length === 1 && lineasPed[0] === `${A}_pl`, `devolvió: ${JSON.stringify(lineasPed)}`)
  const atribs = veo('order_attributions', `${A}_pa`, `${B}_pa`)
  comprobar('Pedidos: la atribución de B tampoco', atribs.length === 1 && atribs[0] === `${A}_pa`, `devolvió: ${JSON.stringify(atribs)}`)

  comprobar(
    'Pedidos: A no puede insertar un pedido marcado como de B',
    fallaComoInquilino(
      A,
      `insert into membego_orders (id,"companyId",code,"locationId","customerId",status,origin,subtotal,"commissionableBase",total,"updatedAt")
       values ('${A}_intruso_po','${B}','MBG-PED-2030-900002','${B}_su','${B}_k','CREATED','MARKETPLACE',1,1,1,now());`
    )
  )
  comprobar(
    'Pedidos: A no puede juntar su cliente con la sucursal de B — la FK compuesta lo impide',
    fallaComoInquilino(
      A,
      `insert into membego_orders (id,"companyId",code,"locationId","customerId",status,origin,subtotal,"commissionableBase",total,"updatedAt")
       values ('${A}_mezcla_po','${A}','MBG-PED-2030-900003','${B}_su','${A}_k','CREATED','MARKETPLACE',1,1,1,now());`
    )
  )
  const tocadosPedidos = comoInquilino(A, `with u as (update membego_orders set notes='x' returning 1) select count(*) from u;`)
  // A tiene DOS pedidos sembrados (el normal y el de su oferta); B también tiene dos y no se toca.
  comprobar('Pedidos: un `update` sin `where` solo alcanza los pedidos de A', tocadosPedidos === '2', `filas afectadas: ${tocadosPedidos} (debería ser 2: los de A)`)
  if (hayDisparador('membego_order_lines_sin_cambios')) {
    comprobar(
      'Pedidos: ni A, dueña del pedido, puede editar una línea',
      fallaComoInquilino(A, `update membego_order_lines set quantity = 99 where id = '${A}_pl';`)
    )
  } else {
    omitir('Pedidos: ni A, dueña del pedido, puede editar una línea', 'la base no trae los disparadores de las migraciones (db push)')
  }

  // ── 13. Commerce Core · Merchant Billing ──────────────────────────────────
  //
  // Las cuatro tablas llevan `companyId` propio y entran por Nivel 0 sin una
  // política escrita a mano. Lo que importa aquí: lo que una empresa le debe a
  // Membego no lo ve ni lo toca otra empresa, y el libro no se edita ni con el
  // contexto correcto.
  const cuentas = veo('merchant_billing_configs', `${A}_mc`, `${B}_mc`)
  comprobar('Billing: con el contexto en A no aparece la cuenta de B', cuentas.length === 1 && cuentas[0] === `${A}_mc`, `devolvió: ${JSON.stringify(cuentas)}`)
  const libroB = veo('merchant_ledger_entries', `${A}_ml`, `${B}_ml`)
  comprobar('Billing: el libro de B tampoco se ve', libroB.length === 1 && libroB[0] === `${A}_ml`, `devolvió: ${JSON.stringify(libroB)}`)
  const cortes = veo('merchant_statements', `${A}_ms`, `${B}_ms`)
  comprobar('Billing: los cortes de B tampoco', cortes.length === 1 && cortes[0] === `${A}_ms`, `devolvió: ${JSON.stringify(cortes)}`)
  comprobar(
    'Billing: A no puede asentar un movimiento en la cuenta de B',
    fallaComoInquilino(
      A,
      `insert into merchant_ledger_entries (id,"companyId",seq,type,amount,balance,"referenceType","referenceId",reason,"idempotencyKey")
       values ('${A}_intruso_ml','${B}',2,'ADJUSTMENT',1,11,'MANUAL','x','intruso','${A}_intruso_k');`
    )
  )
  const tocadasCuentas = comoInquilino(A, `with u as (update merchant_billing_configs set "statusReason"='x' returning 1) select count(*) from u;`)
  comprobar('Billing: un `update` sin `where` solo alcanza la cuenta de A', tocadasCuentas === '1', `filas afectadas: ${tocadasCuentas} (debería ser 1)`)
  if (hayDisparador('merchant_ledger_entries_sin_cambios')) {
    comprobar(
      'Billing: ni A, dueña de la cuenta, puede editar un asiento del libro',
      fallaComoInquilino(A, `update merchant_ledger_entries set amount = 1 where id = '${A}_ml';`)
    )
    comprobar(
      'Billing: ni A puede borrar un asiento del libro',
      fallaComoInquilino(A, `delete from merchant_ledger_entries where id = '${A}_ml';`)
    )
  } else {
    omitir('Billing: ni A puede editar ni borrar un asiento del libro', 'la base no trae los disparadores de las migraciones (db push)')
  }

  // ── 14. Commerce Core · Ofertas con presupuesto ───────────────────────────
  //
  // `deals` y `deal_claims` llevan `companyId` propio y entran por Nivel 0 sin una
  // política escrita a mano. Lo que importa: la oferta de una empresa y quién la
  // reclamó no los ve ni los toca otra, y un reclamo no se borra ni con el contexto
  // correcto (su pedido y su cuota ya cuentan).
  const ofertasVistas = veo('deals', `${A}_dl`, `${B}_dl`)
  comprobar('Ofertas: con el contexto en A no aparece la oferta de B', ofertasVistas.length === 1 && ofertasVistas[0] === `${A}_dl`, `devolvió: ${JSON.stringify(ofertasVistas)}`)
  const reclamosVistos = veo('deal_claims', `${A}_dc`, `${B}_dc`)
  comprobar('Ofertas: los reclamos de B tampoco se ven', reclamosVistos.length === 1 && reclamosVistos[0] === `${A}_dc`, `devolvió: ${JSON.stringify(reclamosVistos)}`)
  comprobar(
    'Ofertas: A no puede insertar una oferta marcada como de B',
    fallaComoInquilino(
      A,
      `insert into deals (id,"companyId","catalogVariantId",title,"discountType","discountValue","startsAt","maxClaims","feePerRedemption","budgetTotal","updatedAt")
       values ('${A}_intruso_dl','${B}','${B}_cv','intruso','PERCENT',10,now(),5,100,1000,now());`
    )
  )
  comprobar(
    'Ofertas: A no puede ofrecer una variante del catálogo de B — la FK compuesta lo impide',
    fallaComoInquilino(
      A,
      `insert into deals (id,"companyId","catalogVariantId",title,"discountType","discountValue","startsAt","maxClaims","feePerRedemption","budgetTotal","updatedAt")
       values ('${A}_cruce_dl','${A}','${B}_cv','cruce','PERCENT',10,now(),5,100,1000,now());`
    )
  )
  const tocadasOfertas = comoInquilino(A, `with u as (update deals set "statusReason"='x' returning 1) select count(*) from u;`)
  comprobar('Ofertas: un `update` sin `where` solo alcanza las ofertas de A', tocadasOfertas === '1', `filas afectadas: ${tocadasOfertas} (debería ser 1)`)
  if (hayDisparador('deal_claims_reglas')) {
    comprobar('Ofertas: ni A, dueña del reclamo, puede borrarlo', fallaComoInquilino(A, `delete from deal_claims where id = '${A}_dc';`))
    comprobar('Ofertas: ni A puede cambiar la cuota de un reclamo', fallaComoInquilino(A, `update deal_claims set fee = 1 where id = '${A}_dc';`))
  } else {
    omitir('Ofertas: ni A puede borrar ni cambiar la cuota de un reclamo', 'la base no trae los disparadores de las migraciones (db push)')
  }
} catch (e) {
  fallos++
  console.log(`${C.mal}  ✗ La prueba no pudo completarse${C.off}`)
  console.log(`${C.dim}     ${String(e.stderr ?? e.message).split('\n').slice(0, 4).join('\n     ')}${C.off}`)
} finally {
  limpiar()
}

console.log('─'.repeat(64))
if (fallos === 0) {
  console.log(`${C.ok}✓${C.off} ${pasadas} comprobaciones, 0 fallos. El aislamiento se sostiene.\n`)
  process.exit(0)
}
console.log(`${C.mal}✗${C.off} ${pasadas} pasaron, ${fallos} fallaron.`)
console.log(`${C.avi}Una empresa puede ver o tocar datos de otra. No despliegues esto.${C.off}\n`)
process.exit(1)
