-- CONCILIACIÓN · los cobros de agosto sin producto se pueden CERRAR.
--
-- `pago_intentos_target_xor_check` (20261036, 7-oct-2026) exige que cada cobro apunte a una membresía O a una compra.
-- Se añadió `NOT VALID`, así que no revisó lo que ya había: en producción siguen cobros de agosto cuya membresía se
-- borró con la cuenta del cliente (`onDelete: SetNull`), con las dos columnas en nulo. Pero `NOT VALID` solo perdona a
-- las filas que nadie toca: PostgreSQL revisa la regla en cada UPDATE. Por eso «Marcar entregada» y «Cerrar sin
-- entregar» (20261088) fallaban justo en esos cobros —8 de los 9 avisos de oct-2026— con «No se pudo cerrar el cobro»,
-- y `tests/postgres/conciliacion-cierre.db.test.ts` lo reproduce.
--
-- La regla sigue igual para todo cobro ABIERTO: un cobro nuevo, o uno que aún espera su entrega, tiene que decir qué
-- se paga. Solo deja de exigirse cuando el cobro ya está CERRADO (`COMPLETADA` o `DESCARTADA`): ahí no queda nada que
-- entregar y el producto puede haber desaparecido legítimamente. De paso, borrar una membresía cuyo cobro ya se
-- entregó (borrar la cuenta del cliente) deja de chocar con la regla al poner su `membershipId` en nulo.
--
-- `fulfillmentEstado` es NOT NULL (20260912), así que el `IN` nunca da NULL y no abre una puerta por ahí.
-- `NOT VALID` otra vez: no hace falta recorrer la tabla, y la regla nueva solo es más permisiva que la anterior.

ALTER TABLE "pago_intentos" DROP CONSTRAINT IF EXISTS "pago_intentos_target_xor_check";

ALTER TABLE "pago_intentos"
  ADD CONSTRAINT "pago_intentos_target_xor_check"
  CHECK ((("membershipId" IS NULL) <> ("compraId" IS NULL)) OR "fulfillmentEstado" IN ('COMPLETADA', 'DESCARTADA'))
  NOT VALID;
