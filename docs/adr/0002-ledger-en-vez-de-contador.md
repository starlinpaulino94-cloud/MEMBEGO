# ADR-0002 · El supply restante es un ledger, no un contador

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Hace falta saber cuántas unidades quedan de un lote. Lo barato es una columna
`restantes` que se decrementa.

## Decisión

La fuente de verdad es `supply_movimientos`: un asiento por cada traslado entre
cubetas. Los contadores del lote existen por rendimiento y son **caché**.

## Por qué

- Un número editable no se puede auditar. Ante «¿por qué quedan 742?» la única
  respuesta posible sería «lo que diga la pantalla».
- Con asientos, cada unidad que se movió tiene fecha, actor y motivo, y el
  recálculo va siempre **del ledger al contador**, nunca al revés.
- Permite detectar deriva: la conciliación compara los dos caminos y un
  descuadre es un hallazgo con el id de la fila que hay que mirar.

## Forma concreta

Asientos de **partida doble**: `origen` → `destino` con `cantidad` siempre
positiva (`null` = fuera del lote). El signo lo da el par, no el número. Así el
invariante

```
comprado = DISPONIBLE + ASIGNADO + RETENIDO + EMITIDO + REDIMIDO + CERRADO
```

se cumple **por construcción** y no por disciplina de quien escribe. Está además
como `CHECK` en la base.

## Consecuencias

Nada se borra jamás: un error se corrige con `REVERSA`, `AJUSTE` o
`CANCELACION`, con motivo obligatorio. Escribir cubetas fuera de
`movimientos.ts` está prohibido y hay una prueba que lo impide.
