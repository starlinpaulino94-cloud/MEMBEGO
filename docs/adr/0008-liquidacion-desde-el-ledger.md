# ADR-0008 · El saldo del proveedor se suma, no se guarda

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Hace falta saber cuánto se le debe a cada proveedor.

## Decisión

No existe `supplierBalance`. El saldo es la suma de `supply_asientos_financieros`,
calculada en cada lectura. `monto` positivo = a favor del proveedor; negativo =
a favor de Membego.

## Por qué

Es el ADR-0002 aplicado al dinero: un saldo guardado es un número que alguien
puede editar y que nadie puede explicar, pero con consecuencias contables.

Una sola columna con signo, y no `debe`/`haber`, porque así el saldo es una
suma y no hay forma de que dos lecturas del mismo dato den cifras distintas.

## `COMPROMISO_COMPRA` no es deuda

Firmar un contrato de RD$300.000 no significa deber RD$300.000 hoy: en
`PAGO_POR_REDENCION` no se debe nada hasta que alguien consuma. Por eso es un
asiento **memorando** que queda fuera del saldo por pagar, aunque sí entra en el
reporte de «contratado vs pagado».

## Liquidar

`proponerLiquidacion` calcula, **no paga**: quien decide es una persona y este
número es lo que tiene delante. Las redenciones reversadas quedan fuera —una
entrega que se deshizo no se paga— y lo ya depositado se consume antes de
transferir de nuevo, para no pagar dos veces la misma pizza.

## Consecuencias

Un pago nace `PENDIENTE` y solo mueve el saldo al confirmarse: alguien prepara
la liquidación el viernes y tesorería la confirma el lunes sin que el saldo
mienta durante el fin de semana.
