# ADR-0001 · Membego Supply no se modela como inventario del comercio

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Membego compra 1.000 pizzas a una pizzería. La tentación es obvia: sumarlas al
inventario o restarlas del suyo (`stock = 4000` si tenía 5.000).

## Decisión

No. Membego adquiere **derechos de consumo contractuales**, no unidades
físicas, y viven en tablas propias (`supply_*`) separadas de
`productos_inventario` (capa 1, lo que el comercio tiene) y de
`producto_compras` (lo que un cliente le compra a una empresa).

## Por qué

- Para comida preparada y servicios no existe la unidad física: la pizza se
  hace cuando llega el cliente y el lavado no está guardado en ningún sitio.
- Restarlo del stock del comercio es falso: la pizzería sigue vendiendo sus
  pizzas normalmente. Lo comprometido con Membego es una **obligación de
  cumplimiento**, no una reserva de mercancía.
- `Promotion.quantity = 1000` perdería quién lo compró, cuánto costó, bajo qué
  contrato, de qué lote, para qué campaña, quién lo recibió y quién lo consumió.

## Consecuencias

Hay tres capas que nunca se mezclan, y el módulo tiene guardias automáticas que
lo vigilan (`tests/supply-contratos.test.ts`). El precio es un dominio nuevo de
quince tablas en vez de una columna; a cambio, cada unidad es trazable del
contrato a la persona.
