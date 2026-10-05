# Runbook · Los avisos de la pasarela entran y no se procesan

> **Síntoma que ves:** el Centro de Operaciones muestra eventos externos en
> `FAILED` o `DEAD_LETTER`, o la alerta **«Eventos externos sin salida»**
> (`INBOX_DEAD`). O el proveedor jura que mandó el aviso, la pantalla del inbox
> lo confirma, y la compra sigue sin pagar.

**Impacto:** es el caso grave. A diferencia del outbox —donde el dinero ya está
decidido y lo que falta es el aviso— aquí **el pago está cobrado en la pasarela
y los derechos NO están emitidos en Membego**. El cliente pagó y no tiene su
membresía. Cada hora cuenta.

Distíngalo desde el principio de su vecino de al lado:

| | El aviso **no llegó** | El aviso **llegó y no se procesó** |
|---|---|---|
| ¿Hay fila en el inbox? | No | Sí |
| Runbook | [`pagos-externos-caidos.md`](pagos-externos-caidos.md) | **este** |

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

Un aviso de pago hace dos cosas distintas, y pueden fallar por separado:

```
POST /api/webhooks/supply-v2/<PASARELA>
   │
   ├─ 1. REGISTRAR  → fila en supply_v2_external_events (status RECEIVED)
   │                   identidad (provider, externalEventId, eventType), única
   │
   └─ 2. PROCESAR   → confirma el pago + emite derechos + apunta el aviso
                       en la MISMA transacción
```

El registro casi nunca falla; el procesamiento sí. Y la fila queda como prueba
de que llegó, que es lo que se mira aquí.

```
RECEIVED → PROCESSING → PROCESSED        (movió el dinero · final)
                      ↘ IGNORED          (recibido y descartado a propósito · final)
                      ↘ FAILED (8 intentos) → DEAD_LETTER
```

Cuatro cosas que explican casi todos los incidentes:

- **`IGNORED` no es un error nuestro.** Significa «lo recibimos y a propósito no
  hace nada»: un tipo de evento que no manejamos, un monto que no cuadra con la
  compra, una orden que no existe. El `lastError` de la fila dice cuál de esas.
  Cuando es un descuadre, además queda un incidente financiero abierto —ese es
  [`incidente-financiero.md`](incidente-financiero.md)—.
- **`FAILED` sí es nuestro, y es transitorio.** La base saturada, una
  transacción que chocó, la cuenta de la integración sin configurar. Se
  reprograma por la escalera compartida: 8 intentos, de 30 s a 24 h.
- **Reintentar no puede cobrar dos veces.** La identidad
  `(provider, externalEventId, eventType)` es única y el procesador rechaza lo
  que ya está resuelto. Pulsar «Reintentar» dos veces no emite derechos dos
  veces.
- **`DEAD_LETTER` no se barre solo, a propósito.** Agotó sus ocho intentos:
  necesita que una persona lo mire y decida. Lo que sí se barre solo son los
  `RECEIVED` y los `FAILED` con su hora vencida, en el paso 0 del cron.

---

## 2 · Confirmar

### a) ¿Cuántos hay y en qué estado?

```
/superadmin/supply-v2/operaciones/inbox
```

Los filtros de arriba son los estados. El orden en que se miran:

1. **Sin salida** (`DEAD_LETTER`) — lo más urgente: nadie los va a tocar solo.
2. **Fallidos** (`FAILED`) — mire la columna «Int.»: si va subiendo pasada a
   pasada, el barrido corre y el problema persiste; si está clavada en 1, el
   barrido no corre (→ § 2c).
3. **Recibidos** (`RECEIVED`) — si hay muchos y viejos, el barrido no corre.

La columna **Último error** es el diagnóstico, ya saneado (nunca lleva firmas ni
datos de tarjeta). `SIN_ACTOR_CONFIGURADO` apunta directo al § 3a.

### b) ¿Qué le pasó a UNO en concreto?

El enlace **Historia** de cada fila lleva a la búsqueda por su `correlationId`,
que es el hilo completo: el evento, lo que hizo con la compra, el efecto del
outbox que apuntó y el aviso que salió.

```
/superadmin/supply-v2/operaciones/buscar?q=<correlationId>
```

### c) ¿Está corriendo el barrido?

El barrido del inbox es el **paso 0** del cron de Supply 2.0:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<dominio>/api/cron/supply-v2 | head -c 400
```

En la respuesta:

```json
{"inbox":{"activo":true,"procesados":3,"fallidos":0,"saltados":0}}
```

| Lo que ve | Qué significa |
|---|---|
| `"activo": false` | **Los pagos externos están apagados** con el kill switch (→ § 3b) |
| `"motivo": "SIN_ACTOR_CONFIGURADO"` | Falta `SUPPLY_V2_WEBHOOK_ACTOR_ID` (→ § 3a) |
| `"saltados"` > 0 | Hay más de 100 esperando; cada pasada se lleva 100 (→ § 3d) |
| `procesados` > 0 y la cola no baja | Entran más de los que salen (→ § 3d) |

---

## 3 · Arreglar

### a) Falta la cuenta de la integración

El síntoma es inequívoco: `SIN_ACTOR_CONFIGURADO` en el último error, o ese
mismo `motivo` en la respuesta del cron. Y el Centro de Operaciones marca
**config** en `NO DISPONIBLE`.

Confirmar un pago escribe un responsable en el asiento (`paymentConfirmedById`),
y sin cuenta designada no hay responsable: el sistema **falla cerrado** y deja el
evento esperando antes que mover dinero sin dueño.

1. Averigüe el id de la cuenta de servicio de la organización.
2. Póngalo en `SUPPLY_V2_WEBHOOK_ACTOR_ID` y **redespliegue** (es variable de
   entorno, no se recarga en caliente).
3. Compruebe que **config** vuelve a `HEALTHY` en
   `/superadmin/supply-v2/operaciones`.
4. Lance el cron a mano con el `curl` del § 2c. Los eventos esperando se
   procesan en esa pasada.

No hace falta tocar las filas: siguen en `FAILED`/`RECEIVED` con su hora, y el
barrido las coge.

### b) Los pagos externos están apagados

`"activo": false` en el `inbox` de la respuesta del cron, y el panel muestra
**Pagos externos** en `APAGADO`.

Es una decisión de alguien, con motivo y nombre en la bitácora. Antes de
encender, **lea ese motivo** en `/superadmin/supply-v2/operaciones`: si se apagó
porque la pasarela mandaba avisos duplicados, encenderlo sin arreglar eso repite
el problema con más cola acumulada.

Para encender: botón **Encender** de «Pagos externos (webhook de pasarela)».

### c) Hay eventos sin salida (`DEAD_LETTER`)

Uno por uno, no en bloque: agotaron ocho intentos, así que algo pasó con cada
uno y conviene saber qué.

1. Filtre por **Sin salida** en `/superadmin/supply-v2/operaciones/inbox`.
2. Lea **Último error**. Si dice `SIN_ACTOR_CONFIGURADO`, arregle el § 3a
   primero: reintentar antes de eso solo gasta el intento.
3. Abra **Historia** y compruebe el estado real de la compra. **Si la compra ya
   está pagada, no reintente**: alguien la confirmó a mano y el evento es
   información vieja. Reintentarlo sale por «ya estaba resuelto» y no hace daño,
   pero el que importa ya está hecho.
4. Pulse **Reintentar**. Se procesa en el acto y el aviso dice qué pasó de
   verdad: «Procesado», «ya estaba resuelto», «descartado a propósito»,
   «rechazado: no cuadra» o «volvió a fallar».

Si el aviso dice **«rechazado: no cuadra con la compra»**, esto ya no es un
problema de proceso: hay un desacuerdo de dinero y queda un incidente abierto.
Siga por [`incidente-financiero.md`](incidente-financiero.md).

### d) Entran más de los que salen

El barrido se lleva 100 por pasada. Con el cron diario del plan Hobby, 100 al
día no basta si la pasarela manda miles.

Lo que se hace mientras:

```bash
# Varias pasadas seguidas. Es idempotente: lo ya procesado sale por
# «repetido» sin tocar un peso.
for i in 1 2 3 4 5; do
  curl -s -H "Authorization: Bearer $CRON_SECRET" \
    https://<dominio>/api/cron/supply-v2 | head -c 200
  echo
done
```

Lo que se hace después: un cron más frecuente. El camino normal **no es el
barrido** —es que la propia petición del webhook procese su evento en segundos—,
así que una cola grande en el inbox significa que el camino normal está fallando
de forma sistemática. Busque la causa en el § 2a (la columna «Último error» será
la misma en casi todas las filas) antes de subir la frecuencia del cron.

---

## 4 · Qué NO hacer

- **No edite las filas de `supply_v2_external_events` con SQL.** Pasar un
  `FAILED` a `PROCESSED` a mano hace que el sistema crea que emitió derechos que
  nunca emitió, y la conciliación dejará de poder detectarlo. El cliente seguirá
  sin su membresía y ya nada lo dirá.
- **No borre los eventos atascados.** Son la prueba de que la pasarela avisó. Si
  mañana hay una reclamación, esa fila es lo que la sostiene.
- **No confirme el pago a mano «para salir del paso» sin dejar nota.** Si lo
  hace —y a veces es lo correcto, cuando el cliente está esperando— confirme por
  el camino de finanzas, que queda auditado, y escriba en la nota el
  `correlationId` del evento. Así quien vea después el evento en `DEAD_LETTER`
  entiende por qué no hay que reintentarlo.
- **No suba el tope del barrido ni la frecuencia del cron como primera
  medida.** Una cola que crece es un síntoma; el tope solo cambia la velocidad a
  la que se acumula.
- **No apague los pagos externos para «parar el ruido».** Apagarlos no procesa
  lo acumulado: deja de recibir lo nuevo y la cola se queda igual, con la
  diferencia de que ahora también se pierden los avisos que el proveedor deje de
  reentregar.

---

## 5 · Criterio de recuperación

Está resuelto cuando, en `/superadmin/supply-v2/operaciones`:

- **Eventos externos sin salida** no aparece como alerta activa.
- El filtro **Sin salida** del inbox está vacío, o lo que queda está explicado
  en una nota de incidente.
- El filtro **Fallidos** está vacío o baja pasada a pasada.
- Dos pasadas seguidas del cron devuelven `"procesados": 0` con la cola a cero
  —y no `"procesados": 0` con cola, que es el síntoma del § 3a—.

Y, para cada cliente afectado: su compra está pagada y su derecho emitido. El
inbox limpio con un cliente sin membresía no es recuperación.

---

## 6 · Escalamiento

- **Más de 24 h con eventos sin procesar** → es incidente financiero: abra
  [`incidente-financiero.md`](incidente-financiero.md) en paralelo, sin esperar
  a vaciar el inbox.
- **El mismo `lastError` en todas las filas y no es de configuración** → avise a
  quien mantiene Supply 2.0 con el `correlationId` de tres filas distintas. Tres
  historias completas valen más que cien filas.
- **La pasarela manda avisos que no reconocemos** (`TIPO_NO_MANEJADO` repetido)
  → no es una avería: es una integración incompleta. Va a la cola de desarrollo,
  no a la de guardia.
