# ADR-0005 · La última unidad se decide con `FOR UPDATE`, no con un `if`

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Queda una unidad y dos personas pulsan «Obtener» a la vez.

## Decisión

Toda mutación de cubetas abre una transacción, hace `SELECT … FOR UPDATE` sobre
la fila del lote, valida contra el saldo recién bloqueado y escribe. Tres
barreras, ninguna en el navegador:

1. el bloqueo de fila (la segunda transacción **espera** y lee el saldo ya movido);
2. `validarMovimiento` contra ese saldo;
3. los `CHECK` de la migración (cuadre y no-negatividad), por si un día alguien
   abre un camino nuevo y se salta los dos primeros.

## Por qué no las alternativas

- **`if (restantes > 0)` en el cliente**: dos peticiones leen «queda 1» a la vez.
- **`findUnique` sin bloqueo**: el mismo problema un piso más abajo.
- **Solo bloqueo optimista**: obliga a reintentar en un camino que ya tiene que
  ser transaccional por el ledger. `version` se incrementa igual, pero como
  señal para la conciliación, no como defensa.
- **`FOR UPDATE NOWAIT`**: fallaría al segundo cliente aunque quedaran cien
  unidades. El bloqueo dura microsegundos; esperar es lo correcto.

## Consecuencias

Idempotencia por clave única en derechos, redenciones y pagos: un reintento
devuelve lo mismo en vez de duplicar. El QR es de un solo uso por `nonce`.
