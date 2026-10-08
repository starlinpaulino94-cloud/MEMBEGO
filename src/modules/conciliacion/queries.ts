import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { MUESTRA_POR_REGLA, REGLAS, type FilaDeHallazgo, type Hallazgo } from './domain'

/**
 * CONCILIACIÓN DEL COMERCIO · lecturas (Fase 9). SOLO LECTURA y sin tablas nuevas: cada regla es una consulta
 * que devuelve los casos que NO cuadran (con el total, aunque solo se devuelva una muestra).
 *
 * DOS ALCANCES: una empresa (`companyId`) o la plataforma (`null`, que deja fuera las empresas de práctica).
 * La plataforma corre en `sinEmpresa` (superadmin); una empresa, en `conEmpresa`.
 *
 * Las consultas son constantes del código: lo único que entra por parámetro es la empresa, ligada como valor.
 * Cada una produce `(companyId, referencia, detalle, total)` con `count(*) OVER()` ANTES del límite, así que una
 * sola pasada da el total y la muestra.
 */

export interface Alcance {
  companyId: string | null
}

/** Filtro de empresa sobre la columna `col` (constante del código). */
function alcance(a: Alcance, col: string): Prisma.Sql {
  const c = Prisma.raw(col)
  return a.companyId
    ? Prisma.sql`AND ${c} = ${a.companyId}`
    : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "companies" cdemo WHERE cdemo."id" = ${c} AND cdemo."esDemo" = true)`
}

/** Los renglones de cada pedido, sumados. */
const lineasPorPedido = (a: Alcance): Prisma.Sql => Prisma.sql`
  (SELECT l."orderId", count(*)::int AS n, coalesce(sum(l."quantity" * l."unitPrice"), 0) AS bruto, coalesce(sum(l."discount"), 0) AS dto
     FROM "membego_order_lines" l WHERE true ${alcance(a, 'l."companyId"')} GROUP BY l."orderId") ls`

type Consulta = (a: Alcance) => Prisma.Sql

const dinero = (col: string) => Prisma.raw(`to_char(${col}, 'FM999,999,999,990.00')`)

const CONSULTAS: Readonly<Record<string, Consulta>> = {
  // ── Pedidos y comisiones ────────────────────────────────────────────────
  C01: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Completado el ' || to_char(o."completedAt", 'YYYY-MM-DD') || ' por ' || ${dinero('o."total"')} AS detalle,
           row_number() OVER (ORDER BY o."completedAt" DESC NULLS LAST, o."id") AS "orden"
      FROM "membego_orders" o
     WHERE o."status" = 'COMPLETED' AND o."origin" = 'MARKETPLACE' ${alcance(a, 'o."companyId"')}
       AND o."commissionableBase" > 0
       AND NOT EXISTS (SELECT 1 FROM "merchant_billing_configs" bc WHERE bc."companyId" = o."companyId"
                          AND ((bc."feeModel" = 'CPA_FIXED' AND bc."cpaAmount" = 0) OR (bc."feeModel" = 'PERCENTAGE' AND bc."percentageRate" = 0)))
       AND NOT EXISTS (SELECT 1 FROM "merchant_commissions" m WHERE m."orderId" = o."id")`,
  C02: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Reembolsado, comisión de ' || ${dinero('m."amount"')} || ' sigue confirmada' AS detalle,
           row_number() OVER (ORDER BY o."refundedAt" DESC NULLS LAST, o."id") AS "orden"
      FROM "membego_orders" o JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."status" = 'REFUNDED' AND m."status" = 'CONFIRMED' ${alcance(a, 'o."companyId"')}`,
  C03: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Pedido ' || o."status" || ' con comisión confirmada de ' || ${dinero('m."amount"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE m."status" = 'CONFIRMED' AND o."status" NOT IN ('COMPLETED', 'REFUNDED') ${alcance(a, 'o."companyId"')}`,
  C04: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Origen ' || o."origin" || ' con comisión de ' || ${dinero('m."amount"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."origin" <> 'MARKETPLACE' ${alcance(a, 'o."companyId"')}`,
  C05: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Base ' || ${dinero('m."baseAmount"')} || ' × ' || m."rate"::text || ' % da ' || ${dinero('round(m."baseAmount" * m."rate" / 100, 2)')} || ' y se cobró ' || ${dinero('m."amount"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, o."id") AS "orden"
      FROM "merchant_commissions" m JOIN "membego_orders" o ON o."id" = m."orderId"
     WHERE m."type" = 'PERCENTAGE' AND m."rate" IS NOT NULL AND m."amount" <> round(m."baseAmount" * m."rate" / 100, 2) ${alcance(a, 'm."companyId"')}`,
  C06: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'La comisión usó la base ' || ${dinero('m."baseAmount"')} || ' y el pedido tiene ' || ${dinero('o."commissionableBase"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, o."id") AS "orden"
      FROM "merchant_commissions" m JOIN "membego_orders" o ON o."id" = m."orderId"
     WHERE m."baseAmount" <> o."commissionableBase" ${alcance(a, 'm."companyId"')}`,

  // ── Pagos y verificación ────────────────────────────────────────────────
  P01: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Nivel ' || o."verificationLevel" || ' sin constancia de pago' AS detalle,
           row_number() OVER (ORDER BY o."updatedAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o
     WHERE o."verificationLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED') ${alcance(a, 'o."companyId"')}
       AND NOT EXISTS (SELECT 1 FROM "payment_evidences" p WHERE p."orderId" = o."id")`,
  P02: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Constancia: ' || p."method" || ' por ' || ${dinero('p."amount"')} || ' (pedido ' || ${dinero('o."total"')} || ')' || CASE WHEN coalesce(btrim(p."reference"), '') = '' THEN ', sin referencia' ELSE '' END AS detalle,
           row_number() OVER (ORDER BY o."updatedAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o JOIN "payment_evidences" p ON p."orderId" = o."id"
     WHERE o."verificationLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED') ${alcance(a, 'o."companyId"')}
       AND (p."amount" <> o."total" OR p."method" IN ('CASH', 'OTHER') OR coalesce(btrim(p."reference"), '') = '')`,
  P03: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Nivel ' || o."verificationLevel" || CASE WHEN c."orderId" IS NULL THEN ' sin confirmación del cliente' ELSE ': confirmó ' || ${dinero('c."confirmedTotal"')} || ' y el pedido es ' || ${dinero('o."total"')} END AS detalle,
           row_number() OVER (ORDER BY o."updatedAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o LEFT JOIN "customer_confirmations" c ON c."orderId" = o."id"
     WHERE o."verificationLevel" IN ('CUSTOMER_VERIFIED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED') ${alcance(a, 'o."companyId"')}
       AND (c."orderId" IS NULL OR c."confirmedTotal" <> o."total")`,
  P04: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Comisión CPA de ' || ${dinero('m."amount"')} || ' por ' || ${dinero('o."total"')} || '; el pago se verificó después de cerrar' AS detalle,
           row_number() OVER (ORDER BY o."completedAt" DESC NULLS LAST, o."id") AS "orden"
      FROM "membego_orders" o JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."verificationLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED') AND m."verificationLevel" NOT IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED')
       AND m."type" = 'CPA_FIXED' AND m."dealId" IS NULL AND m."feeModel" = 'HYBRID' ${alcance(a, 'o."companyId"')}`,

  // ── Montos del pedido ───────────────────────────────────────────────────
  L01: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Pedido ' || o."status" || ' por ' || ${dinero('o."total"')} || ' sin renglones' AS detalle,
           row_number() OVER (ORDER BY o."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o
     WHERE NOT EXISTS (SELECT 1 FROM "membego_order_lines" l WHERE l."orderId" = o."id") ${alcance(a, 'o."companyId"')}`,
  L02: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Subtotal ' || ${dinero('o."subtotal"')} || ' vs renglones ' || ${dinero('ls.bruto')} || '; descuento ' || ${dinero('o."discount"')} || ' vs renglones ' || ${dinero('ls.dto')} AS detalle,
           row_number() OVER (ORDER BY o."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o JOIN ${lineasPorPedido(a)} ON ls."orderId" = o."id"
     WHERE (o."subtotal" <> ls.bruto OR o."discount" <> ls.dto) ${alcance(a, 'o."companyId"')}`,
  L03: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Total ' || ${dinero('o."total"')} || ' vs ' || ${dinero('o."subtotal" - o."discount" + o."adjustment" + o."tax"')} || '; base ' || ${dinero('o."commissionableBase"')} || ' vs ' || ${dinero('o."subtotal" - o."discount" + o."adjustment"')} AS detalle,
           row_number() OVER (ORDER BY o."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o
     WHERE (o."total" <> o."subtotal" - o."discount" + o."adjustment" + o."tax" OR o."commissionableBase" <> o."subtotal" - o."discount" + o."adjustment") ${alcance(a, 'o."companyId"')}`,
  L04: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, l."description" || ': ' || l."quantity"::text || ' × ' || ${dinero('l."unitPrice"')} || ' − ' || ${dinero('l."discount"')} || ' no es ' || ${dinero('l."lineTotal"')} AS detalle,
           row_number() OVER (ORDER BY l."createdAt" DESC, l."id") AS "orden"
      FROM "membego_order_lines" l JOIN "membego_orders" o ON o."id" = l."orderId"
     WHERE l."lineTotal" <> l."quantity" * l."unitPrice" - l."discount" ${alcance(a, 'l."companyId"')}`,

  // ── Libro de la cuenta Membego ──────────────────────────────────────────
  G01: (a) => Prisma.sql`
    SELECT e."companyId", '#' || e."seq"::text AS referencia,
           CASE WHEN e.prev_seq IS NULL AND e."seq" <> 1 THEN 'El primer asiento no es el 1'
                WHEN e.prev_seq IS NOT NULL AND e."seq" <> e.prev_seq + 1 THEN 'Salta del asiento ' || e.prev_seq::text || ' al ' || e."seq"::text
                ELSE 'Saldo ' || ${dinero('e."balance"')} || ' pero el anterior más el monto da ' || ${dinero('coalesce(e.prev_bal, 0) + e."amount"')} END AS detalle,
           row_number() OVER (ORDER BY e."createdAt" DESC, e."id") AS "orden"
      FROM (SELECT x.*, lag(x."seq") OVER w AS prev_seq, lag(x."balance") OVER w AS prev_bal
              FROM "merchant_ledger_entries" x WHERE true ${alcance(a, 'x."companyId"')}
            WINDOW w AS (PARTITION BY x."companyId" ORDER BY x."seq")) e
     WHERE (e.prev_seq IS NULL AND (e."seq" <> 1 OR e."balance" <> e."amount"))
        OR (e.prev_seq IS NOT NULL AND (e."seq" <> e.prev_seq + 1 OR e."balance" <> e.prev_bal + e."amount"))`,
  G02: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Comisión de ' || ${dinero('m."amount"')} || ' y su asiento #' || e."seq"::text || ' es de ' || ${dinero('e."amount"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, m."id") AS "orden"
      FROM "merchant_commissions" m
      JOIN "merchant_ledger_entries" e ON e."id" = m."ledgerEntryId"
      JOIN "membego_orders" o ON o."id" = m."orderId"
     WHERE e."amount" <> m."amount" ${alcance(a, 'm."companyId"')}`,
  G03: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia,
           CASE WHEN m."status" = 'CONFIRMED' THEN 'Confirmada pero con asiento de reverso'
                WHEN m."reversalEntryId" IS NULL THEN 'Revertida sin asiento de reverso'
                ELSE 'Reverso de ' || ${dinero('re."amount"')} || ' para una comisión de ' || ${dinero('m."amount"')} END AS detalle,
           row_number() OVER (ORDER BY m."updatedAt" DESC, m."id") AS "orden"
      FROM "merchant_commissions" m
      JOIN "membego_orders" o ON o."id" = m."orderId"
      LEFT JOIN "merchant_ledger_entries" re ON re."id" = m."reversalEntryId"
     WHERE ((m."status" = 'CONFIRMED' AND m."reversalEntryId" IS NOT NULL)
         OR (m."status" = 'REVERSED' AND (m."reversalEntryId" IS NULL OR re."amount" <> -m."amount"))) ${alcance(a, 'm."companyId"')}`,

  // ── Ofertas con presupuesto ─────────────────────────────────────────────
  O01: (a) => Prisma.sql`
    SELECT d."companyId", d."title" AS referencia, 'Gastado ' || ${dinero('d."budgetSpent"')} || ' pero los cupones canjeados suman ' || ${dinero('coalesce(s.canjeado, 0)')} AS detalle,
           row_number() OVER (ORDER BY d."updatedAt" DESC, d."id") AS "orden"
      FROM "deals" d
      LEFT JOIN (SELECT "dealId", sum("fee") AS canjeado FROM "deal_claims" WHERE "status" = 'REDEEMED' GROUP BY "dealId") s ON s."dealId" = d."id"
     WHERE d."budgetSpent" <> coalesce(s.canjeado, 0) ${alcance(a, 'd."companyId"')}`,
  O02: (a) => Prisma.sql`
    SELECT d."companyId", d."title" AS referencia, 'Apartado ' || ${dinero('d."budgetReserved"')} || ' pero los cupones reclamados suman ' || ${dinero('coalesce(s.apartado, 0)')} AS detalle,
           row_number() OVER (ORDER BY d."updatedAt" DESC, d."id") AS "orden"
      FROM "deals" d
      LEFT JOIN (SELECT "dealId", sum("fee") AS apartado FROM "deal_claims" WHERE "status" = 'CLAIMED' GROUP BY "dealId") s ON s."dealId" = d."id"
     WHERE d."budgetReserved" <> coalesce(s.apartado, 0) ${alcance(a, 'd."companyId"')}`,
  O03: (a) => Prisma.sql`
    SELECT d."companyId", d."title" AS referencia, 'Cupos en uso ' || d."claimsActive"::text || ' pero hay ' || coalesce(s.vivos, 0)::text || ' cupones reclamados o canjeados' AS detalle,
           row_number() OVER (ORDER BY d."updatedAt" DESC, d."id") AS "orden"
      FROM "deals" d
      LEFT JOIN (SELECT "dealId", count(*)::int AS vivos FROM "deal_claims" WHERE "status" IN ('CLAIMED', 'REDEEMED') GROUP BY "dealId") s ON s."dealId" = d."id"
     WHERE d."claimsActive" <> coalesce(s.vivos, 0) ${alcance(a, 'd."companyId"')}`,
  O04: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Cupón ' || dc."status" || ' y pedido ' || o."status" AS detalle,
           row_number() OVER (ORDER BY dc."createdAt" DESC, dc."id") AS "orden"
      FROM "deal_claims" dc JOIN "membego_orders" o ON o."id" = dc."orderId"
     WHERE NOT ((dc."status" = 'REDEEMED' AND o."status" = 'COMPLETED')
             OR (dc."status" = 'CLAIMED' AND o."status" IN ('CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY'))
             OR (dc."status" IN ('CANCELLED', 'EXPIRED') AND o."status" = 'CANCELLED')
             OR (dc."status" = 'REFUNDED' AND o."status" = 'REFUNDED')) ${alcance(a, 'dc."companyId"')}`,
  O05: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, 'Cuota del cupón ' || ${dinero('dc."fee"')} || ' y se cobró ' || ${dinero('m."amount"')} AS detalle,
           row_number() OVER (ORDER BY m."createdAt" DESC, m."id") AS "orden"
      FROM "deal_claims" dc
      JOIN "membego_orders" o ON o."id" = dc."orderId"
      JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE dc."status" = 'REDEEMED' AND m."status" = 'CONFIRMED' AND m."amount" <> dc."fee" ${alcance(a, 'dc."companyId"')}`,

  // ── Inventario ──────────────────────────────────────────────────────────
  I01: (a) => Prisma.sql`
    SELECT il."companyId", v."sku" || ' · ' || s."nombre" AS referencia, 'Apartado ' || il."reserved"::text || ' pero las reservas activas suman ' || coalesce(r.q, 0)::text AS detalle,
           row_number() OVER (ORDER BY il."updatedAt" DESC, il."id") AS "orden"
      FROM "inventory_levels" il
      JOIN "catalog_variants" v ON v."id" = il."catalogVariantId"
      JOIN "sucursales" s ON s."id" = il."locationId"
      LEFT JOIN (SELECT "inventoryLevelId", sum("quantity")::int AS q FROM "inventory_reservations" WHERE "status" = 'ACTIVE' GROUP BY "inventoryLevelId") r ON r."inventoryLevelId" = il."id"
     WHERE il."reserved" <> coalesce(r.q, 0) ${alcance(a, 'il."companyId"')}`,
  I02: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, l."description" || ': ' || r."quantity"::text || ' apartada(s) todavía en un pedido ' || o."status" AS detalle,
           row_number() OVER (ORDER BY o."completedAt" DESC NULLS LAST, o."id") AS "orden"
      FROM "membego_orders" o
      JOIN "membego_order_lines" l ON l."orderId" = o."id"
      JOIN "inventory_reservations" r ON r."id" = l."inventoryReservationId"
     WHERE o."status" IN ('COMPLETED', 'REFUNDED') AND r."status" = 'ACTIVE' ${alcance(a, 'o."companyId"')}`,
  I03: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, l."description" || ': ' || r."quantity"::text || ' apartada(s) en un pedido cancelado' AS detalle,
           row_number() OVER (ORDER BY o."cancelledAt" DESC NULLS LAST, o."id") AS "orden"
      FROM "membego_orders" o
      JOIN "membego_order_lines" l ON l."orderId" = o."id"
      JOIN "inventory_reservations" r ON r."id" = l."inventoryReservationId"
     WHERE o."status" = 'CANCELLED' AND r."status" = 'ACTIVE' ${alcance(a, 'o."companyId"')}`,
  I04: (a) => Prisma.sql`
    SELECT o."companyId", o."code" AS referencia, l."description" || ': la reserva está ' || r."status" || ' y el pedido sigue ' || o."status" AS detalle,
           row_number() OVER (ORDER BY o."createdAt" DESC, o."id") AS "orden"
      FROM "membego_orders" o
      JOIN "membego_order_lines" l ON l."orderId" = o."id"
      JOIN "inventory_reservations" r ON r."id" = l."inventoryReservationId"
     WHERE o."status" IN ('CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY') AND r."status" <> 'ACTIVE' ${alcance(a, 'o."companyId"')}`,
}

interface FilaCruda {
  companyId: string
  referencia: string
  detalle: string
  total: number
}

/**
 * Corre las reglas (todas, o solo las indicadas) y devuelve un hallazgo por regla, con 0 casos si cuadra.
 * Una regla que falla no tumba a las demás: se registra y su hallazgo sale con `error`.
 */
export async function conciliarEnTx(tx: Tx, a: Alcance, opciones: { reglas?: readonly string[]; muestra?: number } = {}): Promise<(Hallazgo & { error?: string })[]> {
  const muestra = Math.max(1, Math.min(50, opciones.muestra ?? MUESTRA_POR_REGLA))
  const elegidas = REGLAS.filter((r) => !opciones.reglas || opciones.reglas.includes(r.codigo))
  const salida: (Hallazgo & { error?: string })[] = []
  const nombres = new Map<string, string>()
  for (const regla of elegidas) {
    const consulta = CONSULTAS[regla.codigo]
    if (!consulta) {
      salida.push({ regla, total: 0, muestra: [], error: 'Sin consulta' })
      continue
    }
    // Cada regla en su punto de guardado: si una consulta falla, Postgres aborta la transacción entera y las
    // demás reglas fallarían también. Con el SAVEPOINT solo se pierde la que falló.
    await tx.$executeRawUnsafe('SAVEPOINT regla_conciliacion')
    try {
      const filas = await tx.$queryRaw<FilaCruda[]>`
        SELECT q."companyId", q."referencia", q."detalle", (count(*) OVER ())::int AS total
          FROM (${consulta(a)}) q
         ORDER BY q."orden"
         LIMIT ${muestra}`
      for (const f of filas) if (!nombres.has(f.companyId)) nombres.set(f.companyId, '')
      salida.push({
        regla,
        total: filas[0]?.total ?? 0,
        muestra: filas.map((f): FilaDeHallazgo => ({ companyId: f.companyId, empresa: f.companyId, referencia: f.referencia, detalle: f.detalle })),
      })
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT regla_conciliacion')
    } catch (e) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT regla_conciliacion')
      console.error(`[conciliacion ${regla.codigo}]`, e instanceof Error ? e.message : e)
      salida.push({ regla, total: 0, muestra: [], error: 'No se pudo evaluar esta regla.' })
    }
  }
  if (nombres.size > 0) {
    const empresas = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT "id", "name" FROM "companies" WHERE "id" IN (${Prisma.join([...nombres.keys()])})`
    const porId = new Map(empresas.map((e) => [e.id, e.name]))
    for (const h of salida) for (const f of h.muestra) f.empresa = porId.get(f.companyId) ?? f.companyId
  }
  return salida
}
