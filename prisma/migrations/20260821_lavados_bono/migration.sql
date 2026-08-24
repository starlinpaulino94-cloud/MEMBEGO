-- ─────────────────────────────────────────────────────────────────────────────
-- LAVADOS DE REGALO EN SU PROPIO CONTADOR
--
-- El problema: las recompensas de tipo LAVADOS_GRATIS (referidos, bienvenida,
-- reglas de crecimiento) sumaban al MISMO campo que los lavados del plan
-- (`lavadosRestantes`). Una vez otorgado, un regalo era indistinguible de un
-- lavado del plan.
--
-- Renovar hace una asignación ABSOLUTA de ese campo al número del plan. Con los
-- dos mezclados, eso producía dos errores opuestos y ninguno visible:
--
--   · El regalo YA USADO reaparecía cada mes, porque el contador se reponía
--     entero. El negocio regalaba un lavado por período sin haberlo decidido.
--   · El regalo SIN USAR se borraba al renovar, porque la asignación absoluta
--     lo pisaba. El cliente perdía algo que se le había prometido.
--
-- Con un contador aparte, renovar repone solo lo del plan y el regalo sobrevive
-- hasta que se use. Aditiva y con DEFAULT 0: las membresías existentes quedan
-- exactamente como están, sin regalos pendientes inventados.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "lavadosBonoRestantes" INTEGER NOT NULL DEFAULT 0;
