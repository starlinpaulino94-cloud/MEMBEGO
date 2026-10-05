# Runbook · Hay un incidente de pago sin resolver

> **Síntoma que ves:** el Centro de Operaciones marca **Conciliación** en
> `DEGRADADO` con incidentes de severidad alta. O llega el aviso
> «Incidente de pago de severidad alta».

**Impacto:** hay dinero que no cuadra. Puede ser a nuestro favor o en contra, y
mientras no se resuelva la compra **no está pagada**: el cliente pagó algo y no
tiene lo que compró. Es el incidente más caro en confianza de todo el Slice 9.

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

Cuando llega un aviso de pago, se compara lo que la pasarela dice con lo que
Membego tiene apuntado. Si no cuadra, **no se toca el dinero**: se abre un
incidente y se espera a una persona.

Esto es deliberado y conviene entenderlo antes de tocar nada:

- **Ninguna automatización resuelve un incidente.** Ni el cron, ni el webhook,
  ni un reintento. Mover dinero pide una decisión humana.
- **Quien procesó el aviso no puede resolverlo.** La cuenta de la integración
  tiene prohibido cerrar la investigación sobre lo que ella misma procesó; el
  servicio lo rechaza con `ACTOR_DE_INTEGRACION`.
- **Un error de seguridad NO es un incidente financiero.** Una firma inválida o
  un reenvío se rechazan en la puerta y no abren incidente: no hay dinero
  descuadrado, hay alguien llamando mal.

---

## 2 · Confirmar

```
/superadmin/supply-v2/operaciones/incidentes?severity=HIGH
```

Abre el incidente. La ficha trae lo que hace falta para decidir **sin abrir
PostgreSQL**: severidad, motivo, proveedor, compra, transacción de la pasarela,
hilo de correlación, **lo esperado frente a lo reportado**, el estado y la
línea de tiempo.

Los motivos que vas a ver y lo que significan de verdad:

| Motivo | Qué pasó | Qué suele ser |
|---|---|---|
| `AMOUNT_MISMATCH` | La pasarela dice un importe y la compra tiene otro | Un cupón o beneficio aplicado después, o un cobro parcial |
| `ORDER_NOT_FOUND` | El aviso apunta a una compra que no existe | Referencia mal armada del lado del proveedor |
| `DUPLICATE_TRANSACTION` | Esa transacción ya se asoció a otra compra | Reintento del proveedor con referencia cambiada |
| `CURRENCY_MISMATCH` | Moneda distinta | Configuración del proveedor |

Antes de decidir, usa la **línea de tiempo**: dice en qué orden pasó todo y
distingue lo que está guardado de lo que solo existe en los registros.

---

## 3 · Resolver

Desde la ficha, con tu propia cuenta —no con la de la integración—. Las cuatro
resoluciones, y cuándo usar cada una:

| Resolución | Cuándo | Qué hace |
|---|---|---|
| `ACCEPT_INTERNAL` | Lo nuestro es correcto y lo del proveedor no | Cierra sin tocar dinero |
| `ACCEPT_EXTERNAL` | La evidencia externa es correcta | **Confirma el pago por el servicio oficial**: emite derechos, reconoce la economía y avisa al cliente |
| `MANUAL_ADJUSTMENT` | Hace falta un ajuste fuera de este camino | Cierra y deja constancia; el ajuste se hace donde corresponda |
| `IGNORE` | Ruido demostrable | Cierra sin efecto |

**La nota es obligatoria en las cuatro.** Escribe qué COMPROBASTE, no qué
decidiste: dentro de tres semanas, en una auditoría, «importe correcto según el
panel del proveedor, captura adjunta» vale y «se acepta» no.

`ACCEPT_EXTERNAL` pide además **el importe que autorizas**, y pasa por el mismo
servicio que cualquier pago: no hay un camino corto que escriba
`paymentStatus` a mano.

---

## 4 · Qué NO hacer

- **No tocar `paymentStatus` en la base.** Jamás. Saltarse el servicio deja la
  economía descuadrada, sin derechos emitidos y sin bitácora. Es el error que
  este runbook existe para evitar.
- **No resolver con la cuenta de la integración.** El sistema lo rechaza, y si
  algún día no lo hiciera seguiría estando mal.
- **No cerrar con `IGNORE` lo que no entiendes.** `IGNORE` es para ruido
  demostrable. Si no sabes qué pasó, escala: un incidente abierto es incómodo,
  uno cerrado en falso es invisible.
- **No esperar a que se arregle solo.** Nada lo va a resolver salvo una persona.

---

## 5 · Criterio de recuperación

- El incidente en `RESOLVED`, con resolución, nota y actor guardados.
- Si fue `ACCEPT_EXTERNAL`: la compra en `PAID`, su derecho emitido y el aviso
  al cliente apuntado en el outbox.
- **Conciliación** vuelve a `SANO` cuando no quedan incidentes de severidad
  alta sin resolver.

## 6 · Escalamiento

Si el desacuerdo pasa de lo que tu criterio cubre —un importe grande, un
patrón que se repite, o la sospecha de que el proveedor está cobrando de más—,
**no lo resuelvas**: déjalo en `INVESTIGATING` con la nota de lo que
comprobaste y escala. Un incidente en investigación con contexto es trabajo
hecho; uno cerrado deprisa hay que deshacerlo.
