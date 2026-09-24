# ADR-0007 · La capacidad se modela por contrato, no por industria

**Estado:** aceptado · **Fecha:** 2026-09-23

## Contexto

No se compran 1.000 pizzas para que aparezcan 700 personas el mismo sábado. El
contrato dice 1.000 en total, 50 por día, 10 por hora.

## Decisión

Tres límites genéricos —diario, horario, días bloqueados— declarados en el
acuerdo y copiados al lote. Nada específico de comida en el código.

## Por qué

Los mismos tres números describen un car wash (bahías por hora), una barbería
(sillas), una excursión (asientos del autobús) y un café. Si el modelo solo
funcionara para pizzas, estaría mal diseñado.

Un límite **ausente** significa «el contrato no lo limita», no «cero»: tratarlo
como cero dejaría sin reservar todos los acuerdos que solo pactaron cupo diario.

## El día es el del comercio

`dia` se guarda como `yyyy-mm-dd` en la zona del proveedor, no como rango UTC.
Con `DateTime`, una recogida a las 22:30 en Santo Domingo cae en el día
siguiente en UTC y consumiría el cupo del martes estando el lunes. El cupo
diario de una cocina se cuenta por la jornada de esa cocina.

## Consecuencias

`STOCK_RESERVADO` no consume cupo: 500 termos apartados no se preparan, se
entregan. `CAPACIDAD_AGENDADA` exige reserva antes de poder enseñar el QR.
