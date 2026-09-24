# ADR-0004 · Emitido no es redimido, asignado no es consumido

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

Una campaña aparta 200 unidades, reparte 173 vouchers y 128 personas van al
local. ¿Cuánto costó esa campaña?

## Decisión

Tres cifras, siempre separadas:

| | unidades | costo |
| --- | ---: | ---: |
| comprometido (apartado sin emitir) | 27 | RD$8.100 |
| expuesto (emitido sin canjear) | 45 | RD$13.500 |
| **consumido (redimido)** | **128** | **RD$38.400** |

Solo lo **redimido** es gasto.

## Por qué

- Una unidad apartada sigue siendo un activo: liberarla cuesta un clic.
- Un voucher emitido es una promesa; si nadie lo canjea, el proveedor no
  entregó nada y a Membego no le costó nada.
- Contar vouchers como gasto infla el costo de toda campaña y hace que regalar
  parezca más caro de lo que es — justo la decisión que estos números tienen
  que informar.

## Consecuencias

El CAC se publica **dos veces**: por cliente alcanzado y por cliente activado.
El primero siempre parece mejor; el segundo es el que se paga. Enseñar solo uno
es como se justifican campañas que no funcionaron.
