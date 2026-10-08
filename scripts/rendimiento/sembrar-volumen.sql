-- SIEMBRA DE VOLUMEN PARA EL ENSAYO DE RENDIMIENTO (sprint de cierre, Bloque E).
--
-- SOLO para una base DESECHABLE (copia de la local, p. ej. `createdb -T membego_pg membego_perf`).
-- Nunca contra una base real: apaga disparadores y FK de la sesión para sembrar filas coherentes
-- a mano, y escribe en el libro de Merchant Billing.
--
-- QUÉ DEJA: 120 empresas x ~3 300 pedidos en 12 meses (396 000), con atribución, constancias de pago
-- (reportadas y verificadas), comisiones y su asiento del libro. Necesita que la base ya tenga
-- empresas con sucursal y clientes (las de la siembra de demostración / de las pruebas PG).
--
--   psql "$URL_BASE_DESECHABLE" -v ON_ERROR_STOP=1 -f scripts/rendimiento/sembrar-volumen.sql
--
-- Luego se miden las consultas reales con EXPLAIN (ANALYZE, BUFFERS): ver docs/RENDIMIENTO.md.
SET session_replication_role = replica;  -- sin disparadores ni FK: los datos se construyen coherentes a mano

CREATE TEMP TABLE emp AS
SELECT s."companyId" AS co, min(s.id) AS loc, row_number() OVER (ORDER BY s."companyId") AS n
  FROM sucursales s JOIN clientes c ON c."companyId" = s."companyId"
 GROUP BY s."companyId" ORDER BY s."companyId" LIMIT 120;

CREATE TEMP TABLE cli AS
SELECT c."companyId" AS co, c.id AS cid, row_number() OVER (PARTITION BY c."companyId" ORDER BY c.id) AS k,
       count(*) OVER (PARTITION BY c."companyId") AS n
  FROM clientes c WHERE c."companyId" IN (SELECT co FROM emp);

CREATE TEMP TABLE gen AS
SELECT e.co, e.loc, g AS i,
       (SELECT cid FROM cli WHERE cli.co = e.co AND cli.k = 1 + (g * 7919) % cli.n) AS cid,
       timestamp '2030-04-01' + (random() * 365 * interval '1 day') AS fecha,
       (ARRAY['MARKETPLACE','MARKETPLACE','MARKETPLACE','POS','POS','SUPPLY'])[1 + floor(random() * 6)::int]::"MembegoOrderOrigin" AS origen,
       round((200 + random() * 4800)::numeric, 2) AS total,
       random() AS r1, random() AS r2
  FROM emp e, generate_series(1, 3300) g;

INSERT INTO membego_orders (id, "companyId", code, "locationId", "customerId", status, origin, "verificationLevel",
                            subtotal, "commissionableBase", total, "completedAt", "cancelledAt", "cancelReason",
                            "refundedAt", "refundReason", "qrToken", "qrExpiresAt", "createdAt", "updatedAt")
SELECT 'p' || md5(co || i), co, 'MBG-PED-2030-' || lpad(i::text, 6, '0'), loc, cid,
       CASE WHEN r1 < 0.80 THEN 'COMPLETED' WHEN r1 < 0.88 THEN 'CANCELLED' WHEN r1 < 0.92 THEN 'REFUNDED'
            WHEN r1 < 0.96 THEN 'READY' ELSE 'AWAITING_MERCHANT' END::"MembegoOrderStatus",
       origen,
       CASE WHEN r2 < 0.5 THEN 'CUSTOMER_VERIFIED' WHEN r2 < 0.7 THEN 'EXTERNAL_PAYMENT_REPORTED'
            WHEN r2 < 0.9 THEN 'PAYMENT_VERIFIED' ELSE 'REDEEMED' END::"MembegoVerificationLevel",
       total, total, total,
       CASE WHEN r1 < 0.80 OR (r1 >= 0.88 AND r1 < 0.92) THEN fecha + interval '2 hours' END,
       CASE WHEN r1 >= 0.80 AND r1 < 0.88 THEN fecha + interval '1 hour' END,
       CASE WHEN r1 >= 0.80 AND r1 < 0.88 THEN 'cliente' END,
       CASE WHEN r1 >= 0.88 AND r1 < 0.92 THEN fecha + interval '1 day' END,
       CASE WHEN r1 >= 0.88 AND r1 < 0.92 THEN 'devolucion' END,
       CASE WHEN r1 >= 0.92 AND r1 < 0.96 THEN md5(co || i || 'qr') END,
       CASE WHEN r1 >= 0.92 AND r1 < 0.96 THEN fecha + interval '1 day' END,
       fecha, fecha
  FROM gen;

INSERT INTO order_attributions (id, "companyId", "orderId", channel, "campaignId", "promotionId", "referralCode", "createdAt")
SELECT 'a' || id, "companyId", id, canal,
       CASE WHEN canal = 'CAMPAIGN' THEN 'camp-' || "companyId" END,
       CASE WHEN canal = 'PROMOTION_CLAIM' THEN 'promo-' || "companyId" END,
       CASE WHEN canal = 'REFERRAL' THEN 'REF' || substr(id, 2, 6) END,
       "createdAt"
  FROM (SELECT o.*, (ARRAY['MARKETPLACE_BROWSE','MARKETPLACE_SEARCH','PROMOTION_CLAIM','CAMPAIGN','REFERRAL','QR_SCAN','DIRECT'])[1 + floor(random() * 7)::int]::"MembegoAttributionChannel" AS canal
          FROM membego_orders o) x;

INSERT INTO payment_evidences (id, "companyId", "orderId", method, amount, reference, "recordedAt", source, "verifiedAt", "verificationRef")
SELECT 'e' || o.id, o."companyId", o.id, 'TRANSFER', o.total, 'REF-' || o.code, o."createdAt",
       CASE WHEN o."verificationLevel" = 'PAYMENT_VERIFIED' THEN 'BANK_RECONCILED' ELSE 'MERCHANT_REPORTED' END::"MembegoPaymentEvidenceSource",
       CASE WHEN o."verificationLevel" = 'PAYMENT_VERIFIED' THEN o."createdAt" END,
       CASE WHEN o."verificationLevel" = 'PAYMENT_VERIFIED' THEN 'BANK-' || o.code END
  FROM membego_orders o
 WHERE o.status IN ('COMPLETED', 'REFUNDED') AND o."verificationLevel" IN ('EXTERNAL_PAYMENT_REPORTED', 'PAYMENT_VERIFIED');

-- Comisiones (y su asiento) para los COMPLETED de marketplace
CREATE TEMP TABLE com AS
SELECT o.id AS oid, o."companyId" AS co, o."completedAt" AS ts, o.total, o."verificationLevel" AS nivel,
       row_number() OVER (PARTITION BY o."companyId" ORDER BY o."completedAt", o.id) AS seq,
       (o."verificationLevel" = 'PAYMENT_VERIFIED') AS verif
  FROM membego_orders o
 WHERE o.status = 'COMPLETED' AND o.origin = 'MARKETPLACE';

CREATE TEMP TABLE com2 AS
SELECT *, CASE WHEN verif THEN round(total * 8 / 100, 2) ELSE 100 END AS monto FROM com;

INSERT INTO merchant_ledger_entries (id, "companyId", seq, type, amount, balance, "referenceType", "referenceId", "idempotencyKey", "createdAt")
SELECT 'l' || oid, co, seq::int, 'ORDER_FEE', monto,
       sum(monto) OVER (PARTITION BY co ORDER BY seq), 'COMMISSION', oid, 'commission:' || oid, ts
  FROM com2;

INSERT INTO merchant_commissions (id, "companyId", "orderId", type, status, "feeModel", "verificationLevel", "baseAmount", rate, amount, "ledgerEntryId", "createdAt", "updatedAt")
SELECT 'c' || oid, co, oid,
       CASE WHEN verif THEN 'PERCENTAGE' ELSE 'CPA_FIXED' END::"MerchantCommissionType",
       'CONFIRMED', 'HYBRID', nivel, total, CASE WHEN verif THEN 8 END, monto, 'l' || oid, ts, ts
  FROM com2;

ANALYZE;
SELECT 'pedidos', count(*) FROM membego_orders UNION ALL
SELECT 'atribuciones', count(*) FROM order_attributions UNION ALL
SELECT 'constancias', count(*) FROM payment_evidences UNION ALL
SELECT 'comisiones', count(*) FROM merchant_commissions UNION ALL
SELECT 'asientos', count(*) FROM merchant_ledger_entries;
