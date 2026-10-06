# Runbook · Las conciliaciones no cuadran

> **Síntoma que ves:** el Centro de Operaciones marca **Conciliación** en
> `DEGRADADO` con comprobaciones en desacuerdo, o el panel de conciliaciones
> acumula filas en `MISMATCH`.

**Impacto:** por sí solo, ninguno inmediato: una conciliación en desacuerdo es
una ALERTA, no un movimiento. Lo que importa es lo que haya detrás, y para eso
está el incidente que abre.

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

Cada comprobación compara lo que la pasarela dijo con lo que Membego tiene, y
termina en uno de cuatro resultados:

| Resultado | Qué significa |
|---|---|
| `MATCHED` | Cuadra. Se deja la fila como registro de la asociación aceptada |
| `MISMATCH` | No cuadra. Abre un incidente financiero |
| `WAITING` | Falta información para decidir todavía |
| `IGNORED` | No aplica (un evento que no manejamos) |

Dos cosas que ahorran tiempo:

- **Las `MATCHED` se guardan a propósito.** No son ruido: son lo que permite
  detectar una transacción duplicada, comparando contra asociaciones ya
  aceptadas.
- **Se concilia contra lo que la pasarela NOS DIJO**, no contra lo que cobró.
  Un cobro del que nunca nos avisaron no se detecta aquí. Es una limitación
  conocida y está escrita en el informe del bloque 3.

---

## 2 · Confirmar

```
/superadmin/supply-v2/operaciones/conciliaciones?resultado=MISMATCH
```

Cada fila trae proveedor, transacción, compra, estado interno y externo,
importe esperado y reportado, **la diferencia**, severidad y el incidente que
abrió.

Mira primero si las discrepancias comparten patrón:

- **Todas del mismo día y del mismo importe** → suele ser un cambio del lado del
  proveedor (comisión nueva, redondeo, moneda).
- **Todas de la misma oferta o campaña** → suele ser nuestro: un beneficio o
  cupón que se aplica después de que el importe se mandó a cobrar.
- **Sueltas y sin patrón** → trátalas una a una por su incidente.

---

## 3 · Arreglar

Una conciliación **no se resuelve**: se resuelve su INCIDENTE, y eso tiene su
propio runbook → [`incidente-financiero.md`](incidente-financiero.md).

Lo que sí se hace desde aquí:

### a) Volver a conciliar una operación concreta

```
/superadmin/supply-v2/operaciones  →  «Conciliar ahora»
```

Pide la compra o la transacción. **Exige un criterio**: no se lanzan barridos
sin criterio desde la interfaz, y queda auditado quién lo pidió.

Úsalo cuando sospeches que el desacuerdo era temporal —un aviso que llegó
desordenado— y quieras volver a comparar con los datos de ahora.

### b) Dejar que el barrido recoja lo reciente

El cron vuelve a conciliar lo reciente en cada pasada y detecta lo que el
webhook no vio: un aviso perdido, una compra cancelada después de pagarse. Si
la capacidad **Barrido de conciliación** está apagada, eso no ocurre y el panel
lo dice.

---

## 4 · Qué NO hacer

- **No borrar filas de conciliación** para limpiar el panel. Son el registro de
  qué se comparó y cuándo; sin ellas no se puede detectar un duplicado.
- **No ajustar el importe de la compra** para que cuadre. Eso no concilia nada:
  esconde la diferencia y rompe la economía de la venta.
- **No apagar el barrido** porque «genera mucho ruido». Si genera ruido es que
  hay desacuerdos; apagarlo los deja igual de reales y además invisibles.

---

## 5 · Criterio de recuperación

- Cero `MISMATCH` sin incidente asociado.
- Los incidentes de severidad alta, resueltos (ver su runbook).
- **Conciliación** en `SANO` en el Centro de Operaciones.

## 6 · Escalamiento

Si en una sola pasada aparecen más de 10 discrepancias nuevas, no las trates
una a una: es un cambio sistemático del lado del proveedor o nuestro. Apaga el
barrido solo si el ruido impide trabajar, **anota el motivo** y escala con tres
ejemplos de filas distintas.
