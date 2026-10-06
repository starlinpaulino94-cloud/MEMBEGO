# ADR-0006 · FEFO por defecto, pero configurable

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Con tres lotes del mismo producto que vencen en octubre, noviembre y diciembre,
¿de cuál sale la próxima unidad?

## Decisión

**First Expire, First Out** por defecto, con desempate por fecha de compra. La
estrategia es un parámetro (`FEFO` · `FIFO` · `MAYOR_COSTO` · `MENOR_COSTO`) y
vive en un módulo puro que se prueba sin base.

## Por qué

Lo que vence sin usarse ya está pagado. Cualquier otro orden por defecto tira
dinero.

Configurable porque hay razones comerciales legítimas para saltárselo: una
campaña atada a un proveedor concreto, un lote reservado para un acuerdo con un
influencer, o un proveedor con incidencias al que no conviene mandarle más
clientes hasta resolverlas.

## Consecuencias

La decisión de qué lote se consume **no vive en una consulta SQL**, donde no se
podría probar: `fefo.ts` recibe lotes ya leídos y devuelve el orden.
