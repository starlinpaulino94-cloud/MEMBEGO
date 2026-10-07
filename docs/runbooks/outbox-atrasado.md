# Runbook · El outbox se atrasa o acumula efectos sin salida

> **Síntoma que ves:** el Centro de Operaciones marca **Outbox** en `DEGRADADO`
> o `NO DISPONIBLE`. O los clientes pagan y no reciben su aviso.

**Impacto:** el dinero está bien. Un efecto del outbox es una CONSECUENCIA ya
apuntada —avisar al cliente, mandar un correo—, no el pago en sí: la compra
está pagada y el derecho emitido aunque el aviso no haya salido. Lo que se
pierde es que la persona se entere.

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

El efecto se APUNTA dentro de la misma transacción que mueve el dinero, y se
ENTREGA después, fuera de ella. Por eso un proveedor de correo caído no deshace
un pago.

```
PENDING → PROCESSING (arrendado) → DELIVERED
                   ↘ FAILED (reprogramado, 8 intentos) → DEAD_LETTER
```

Tres cosas que explican casi todos los incidentes:

- **El arriendo caduca a los 5 minutos.** Si un worker muere con la fila
  reclamada, el rescate del cron la devuelve a disponible. No hace falta tocar
  nada a mano.
- **La escalera son 8 intentos**, de 30 s a 24 h con dispersión. `DEAD_LETTER`
  significa que se agotaron, no que se perdió: la fila está entera y se puede
  reintentar desde el panel.
- **`DELIVERED` quiere decir «se lo dimos al destino»**, no «la persona lo
  recibió». Para un correo significa que el proveedor lo aceptó. Puede rebotar
  después, y eso no se ve aquí.

---

## 2 · Confirmar

### a) ¿Qué dice el panel?

```
/superadmin/supply-v2/operaciones
```

| Estado de **Outbox** | Qué significa | Dónde seguir |
|---|---|---|
| `APAGADO` | La entrega está apagada con el kill switch | § 3a |
| `DEGRADADO` · «efectos sin salida» | Hay `DEAD_LETTER` | § 3c |
| `DEGRADADO` · «el más viejo lleva N min» | Se entrega, pero lento | § 3b |
| `NO DISPONIBLE` | Un efecto lleva más del umbral crítico esperando: **la entrega no está corriendo** | § 3b |

### b) ¿Está corriendo el cron?

El despacho vive en el cron, no en un proceso aparte:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<dominio>/api/cron/supply-v2 | head -c 400
```

Mira `outbox.activo`, `outbox.encolados` y `outbox.rescatados`. Si responde
`401`, el secreto no cuadra; si no responde, el problema es la aplicación.

### c) ¿Dónde se atasca?

```
/superadmin/supply-v2/operaciones/outbox
```

La vista es de **solo lectura** a propósito: un efecto no se edita a mano.
Mira la columna de estado y la edad.

---

## 3 · Arreglar

### a) La entrega está apagada

Alguien la apagó con el kill switch y el panel dice quién y por qué. **No se ha
perdido nada**: los efectos se siguieron apuntando y están en `PENDING`.
Encender y la siguiente pasada del cron los saca.

### b) No se entrega o va lento

En orden:

1. **¿Corre el cron?** Si el plan lo ejecuta una vez al día, un atraso de horas
   es lo esperado, no una avería. El umbral se configura
   (`SUPPLY_V2_OUTBOX_WARN_MINUTES`, `..._CRITICAL_MINUTES`) y los valores por
   defecto están en el informe del bloque 4.
2. **¿Está la cola configurada?** Sin QStash el trabajo se ejecuta EN LÍNEA:
   más lento, pero no se pierde. Lo dice la configuración crítica del panel, y
   es degradación honesta, no avería → [`cola-atascada.md`](cola-atascada.md).
3. **¿Hay filas atrapadas en `PROCESSING`?** El rescate del cron las devuelve
   a los 5 minutos. Si no lo hace, el cron no está corriendo: vuelve al punto 1.

### c) Hay efectos sin salida

```
/superadmin/supply-v2/operaciones/difuntos
```

Cada fila trae su último error, los intentos y la compra relacionada. **Lee el
error antes de reintentar**: reintentar ocho veces algo que nunca va a
funcionar solo gasta la escalera.

- Error transitorio (red, `5xx` del destino) → *Reintentar*. Devuelve la fila a
  `PENDING` con la escalera completa y queda auditado.
- `ORDEN_INEXISTENTE` o parecido → el efecto apunta a algo que no está. No se
  arregla reintentando; escala con el identificador del efecto.
- `AVISO_SIN_DESTINO` → el efecto se apuntó mal. Lo mismo.

---

## 4 · Qué NO hacer

- **No editar filas del outbox a mano.** La vista es de solo lectura por eso.
  Un `UPDATE` directo se salta el candado, la escalera y la bitácora.
- **No borrar los difuntos** para que el panel se vea bien. Cada uno es un
  aviso que alguien no recibió.
- **No reintentar en masa sin leer los errores.** Si fallan todos por la misma
  causa, reintentar los 200 no arregla ninguno y sí tapa el motivo.

---

## 5 · Criterio de recuperación

- **Outbox** en `SANO`, o en `DEGRADADO` con una causa conocida y acotada.
- Cero `DEAD_LETTER` nuevos en 30 minutos.
- El efecto más viejo pendiente, por debajo del umbral de aviso.

## 6 · Escalamiento

Si hay más de 50 difuntos con errores distintos, no los reintentes uno a uno:
es un síntoma de algo mayor —la base, la cola o un despliegue a medias— y toca
mirar ahí primero.
