-- DIAGNÓSTICO DE PAGOS CON TARJETA · SOLO LECTURA.
--
-- Qué responde: de los cobros con tarjeta aprobados por la pasarela, ¿cuántos dejan a un cliente esperando de verdad, cuántos
-- solo tienen el registro sin cerrar y cuántos entregados no tienen su comprobante? Es la misma clasificación que usa la pantalla
-- /admin/conciliacion (`modules/observabilidad/conciliacion-entrega.ts`), escrita en SQL para mirar PRODUCCIÓN antes de tocar nada.
--
-- Cómo usarla: pégala en el editor SQL de Supabase (o `psql`) y corre cada consulta por separado. Ninguna escribe: solo SELECT.
-- No imprime ni lee números de tarjeta (la tabla no los guarda). No cambies nada a partir de esto sin pasar por la conciliación,
-- que deja bitácora de quién hizo qué.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · RESUMEN: cobros aprobados cuya entrega NO está cerrada, por situación.
--     CLIENTE_ESPERANDO     → el producto no está activo: hay que reintentar la entrega.
--     REGISTRO_SIN_CERRAR   → el producto YA está activo desde el cobro: solo falta cerrar el registro («Marcar entregada»).
--     EN_CURSO              → de hace menos de 2 minutos: es el cobro ocurriendo, no un problema.
-- ─────────────────────────────────────────────────────────────────────────────
WITH sin_cerrar AS (
  SELECT
    p."id",
    p."companyId",
    p."monto",
    p."activadoAt",
    p."fulfillmentEstado",
    p."fulfillmentIntentos",
    p."canal",
    CASE
      WHEN p."fulfillmentEstado" IN ('PENDIENTE', 'PROCESANDO') AND p."updatedAt" > now() - interval '2 minutes'
        THEN 'EN_CURSO'
      WHEN p."activadoAt" IS NOT NULL AND (
             (m."id" IS NOT NULL AND m."pagoConfirmado" AND m."fechaPago" >= p."activadoAt" - interval '1 minute')
          OR (k."id" IS NOT NULL AND k."pagoConfirmado" AND k."fechaActivacion" >= p."activadoAt" - interval '1 minute')
           )
        THEN 'REGISTRO_SIN_CERRAR'
      ELSE 'CLIENTE_ESPERANDO'
    END AS situacion
  FROM "pago_intentos" p
  LEFT JOIN "memberships" m ON m."id" = p."membershipId"
  LEFT JOIN "producto_compras" k ON k."id" = p."compraId"
  WHERE p."estado" = 'APROBADO'
    AND p."fulfillmentEstado" IN ('PENDIENTE', 'PROCESANDO', 'FALLIDA')
)
SELECT situacion, "fulfillmentEstado", count(*) AS cobros, sum("monto") AS monto
FROM sin_cerrar
GROUP BY situacion, "fulfillmentEstado"
ORDER BY situacion, "fulfillmentEstado";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · DETALLE de los que dejan a un cliente esperando (los más viejos primero). Sin datos personales: empresa, monto y fechas.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  c."name"                AS empresa,
  p."id"                  AS cobro,
  p."monto",
  p."activadoAt"          AS cobrado_el,
  p."fulfillmentEstado"   AS entrega,
  p."fulfillmentIntentos" AS reintentos,
  left(coalesce(p."fulfillmentError", ''), 80) AS ultimo_error
FROM "pago_intentos" p
JOIN "companies" c ON c."id" = p."companyId"
LEFT JOIN "memberships" m ON m."id" = p."membershipId"
LEFT JOIN "producto_compras" k ON k."id" = p."compraId"
WHERE p."estado" = 'APROBADO'
  AND p."fulfillmentEstado" IN ('PENDIENTE', 'PROCESANDO', 'FALLIDA')
  AND NOT (p."fulfillmentEstado" IN ('PENDIENTE', 'PROCESANDO') AND p."updatedAt" > now() - interval '2 minutes')
  AND NOT (
       p."activadoAt" IS NOT NULL AND (
            (m."id" IS NOT NULL AND m."pagoConfirmado" AND m."fechaPago" >= p."activadoAt" - interval '1 minute')
         OR (k."id" IS NOT NULL AND k."pagoConfirmado" AND k."fechaActivacion" >= p."activadoAt" - interval '1 minute')
       )
  )
ORDER BY p."activadoAt" ASC NULLS FIRST
LIMIT 100;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · COMPROBANTES: cobros ya entregados que no tienen su venta en el libro. `con_canal` son los recientes (el cron de entregas
--     los repara solo); `sin_canal` son anteriores al comprobante y se generan desde la conciliación con «Generar los N
--     comprobantes», que es una decisión del negocio (mueve los reportes de esos meses).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE p."canal" IS NOT NULL)                         AS con_canal,
  coalesce(sum(p."monto") FILTER (WHERE p."canal" IS NOT NULL), 0)      AS monto_con_canal,
  count(*) FILTER (WHERE p."canal" IS NULL)                             AS sin_canal_antiguos,
  coalesce(sum(p."monto") FILTER (WHERE p."canal" IS NULL), 0)          AS monto_sin_canal,
  min(p."activadoAt") FILTER (WHERE p."canal" IS NULL)                  AS el_mas_antiguo
FROM "pago_intentos" p
WHERE p."estado" = 'APROBADO'
  AND p."fulfillmentEstado" = 'COMPLETADA'
  AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."pagoIntentoId" = p."id");
