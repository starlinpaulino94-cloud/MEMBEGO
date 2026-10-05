-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · ACCIONES DE BITÁCORA
--
-- Aparte, por lo mismo que en los bloques 1 y 3: PostgreSQL no permite usar un
-- valor de enum nuevo en la transacción que lo crea.
--
-- Tres acciones, y solo tres: lo que CAMBIA algo. La lectura del panel no se
-- audita —registrar cada mirada llena la bitácora de ruido y esconde las
-- decisiones—. Reintentar un difunto de la cola ya tiene su acción propia
-- (`COLA_REENCOLADA`) y se reutiliza.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OPERATIONS_SWITCH_CHANGED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OPERATIONS_RECONCILE_RUN';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OPERATIONS_ALERT_ACKNOWLEDGED';
