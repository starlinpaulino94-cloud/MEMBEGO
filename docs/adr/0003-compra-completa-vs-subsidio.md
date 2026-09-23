# ADR-0003 · Compra de unidad completa y subsidio son operaciones distintas

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Dos formas de que Membego ponga dinero sobre una pizza de RD$700:

- **compra completa** — Membego paga RD$300 al comercio y adquiere la unidad;
- **subsidio** — Membego aporta RD$300 y el cliente le paga RD$400 al comercio.

Se parecen en la cifra y no se parecen en nada más.

## Decisión

Son valores distintos de `modeloComercial`, con ramas distintas del cálculo, y
`desglosarSubsidio()` **lanza** si se le pasa una compra completa.

## Por qué

En compra completa el proveedor ya cobró por contrato: cobrarle al cliente la
unidad base otra vez sería cobrarla dos veces. El escáner lo **rechaza**
(`COBRO_INDEBIDO`) y se lo dice al empleado antes de que discuta con el cliente
en el mostrador. En subsidio ocurre lo contrario: el cliente sí paga la
diferencia y el comercio tiene derecho a cobrarla.

Y el dinero de la reventa cambia de manos: si Membego compró la unidad entera y
la revende a RD$399, **ese dinero lo cobra Membego**. Dejar que lo cobre el
comercio crearía un modelo confuso de propiedad y liquidación — exactamente el
problema de trazabilidad que este dominio existe para eliminar.

## Consecuencias

Los extras (bebida, adicionales) van en su propio campo, separados del aporte
del cliente, y nunca se suman en el mismo total.
