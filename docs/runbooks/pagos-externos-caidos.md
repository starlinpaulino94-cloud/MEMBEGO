# Runbook · Los pagos externos no entran

> **Síntoma que ves:** el proveedor dice que mandó avisos de pago y las compras
> siguen sin pagar. O el Centro de Operaciones marca **Pagos externos** en
> `NO DISPONIBLE` / `APAGADO`.

**Impacto:** nadie pierde dinero —una compra sin confirmar sigue sin confirmar,
y el cliente no recibe lo que no pagó—, pero cada minuto que pasa es un cliente
que pagó de verdad y no tiene su beneficio. El daño es de confianza y crece
solo.

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

```
pasarela → POST /api/webhooks/supply-v2/TEST_GATEWAY
         → interruptor → firma → inbox → conciliación → pago → outbox → aviso
```

Tres cosas que explican casi todos los incidentes:

- **Falla CERRADO en cada paso.** Sin secreto de pasarela responde `401`; sin
  cuenta de integración responde `500` y guarda el evento para después; con la
  capacidad apagada responde `503`. Nunca acepta un pago que no pudo verificar.
- **Un `503` o un `500` NO pierden el aviso.** El proveedor reintenta, y lo que
  ya entró queda en el inbox esperando. Lo que de verdad se pierde es un `200`
  dado por error.
- **El procesamiento y la lectura son cosas distintas.** Apagar los pagos no
  apaga el Centro de Operaciones: se puede seguir investigando y resolviendo a
  mano mientras la integración está parada.

---

## 2 · Confirmar

### a) ¿Qué dice el propio sistema?

```
/superadmin/supply-v2/operaciones
```

Mira la fila **Pagos externos** y la sección **Configuración crítica**. El panel
ya distingue los cuatro casos; no hace falta adivinar:

| Estado | Qué significa | Dónde seguir |
|---|---|---|
| `APAGADO` | Alguien usó el kill switch **a propósito** | § 3a |
| `NO DISPONIBLE` | Encendido pero sin configurar | § 3b |
| `DEGRADADO` | Entra, pero hay eventos fallidos o sin salida | § 3c |
| `SANO` | El problema no está aquí | § 4 |

### b) ¿Responde la frontera?

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<dominio>/api/webhooks/supply-v2/TEST_GATEWAY -d '{}'
```

| Código | Significado |
|---|---|
| `401` | **Correcto.** Vive y rechaza lo que no lleva firma válida |
| `503` | La capacidad está apagada → § 3a |
| `404` | Proveedor desconocido en la URL, o el despliegue no trae la ruta |
| `500` | Falta la cuenta de integración → § 3b |

### c) ¿Llegaron los avisos y qué pasó con ellos?

```
/superadmin/supply-v2/operaciones/inbox
```

Si está **vacío**, los avisos no están llegando: el problema está antes que
nosotros (DNS, la URL configurada en el proveedor, su propia cola). Si hay
filas en `FAILED` o `DEAD_LETTER`, sí llegaron y fallamos nosotros → § 3c.

---

## 3 · Arreglar

### a) Está apagado a propósito

Lo apagó una persona y el panel dice **quién, cuándo y por qué** (apagar exige
motivo). Lee el motivo antes de encender: si lo apagaron porque la pasarela
estaba mandando duplicados, encenderlo sin arreglar eso repite el problema.

Para encender: `/superadmin/supply-v2/operaciones` → capacidad
**Pagos externos** → *Encender*. Surte efecto en la siguiente petición.

### b) Encendido pero sin configurar

La sección **Configuración crítica** dice cuál falta. Nunca enseña el valor,
solo el estado:

| Pieza | Qué pasa si falta |
|---|---|
| `SUPPLY_V2_WEBHOOK_ACTOR_ID` | `500`: el evento se guarda y se reprograma, no se pierde |
| `SUPPLY_V2_TEST_GATEWAY_SECRET` | `401`: se rechaza todo |

Se ponen en las variables de entorno del despliegue. **La cuenta de integración
tiene que ser una cuenta aparte**, no la de una persona que resuelve
incidentes: el Slice 9 rechaza que quien procesa el aviso cierre el incidente
que ese aviso abrió, y con la misma cuenta la resolución fallará con
`ACTOR_DE_INTEGRACION`.

Después, los eventos que quedaron esperando salen solos en la siguiente pasada
del cron, o a mano desde el panel.

### c) Entran pero fallan

```
/superadmin/supply-v2/operaciones/inbox?status=FAILED
```

La columna de error ya viene **saneada** (sin firmas ni tokens). Los dos casos
que importan:

- **`MONTO_NO_CUADRA` / discrepancias** → no es una avería de la integración:
  es dinero que no cuadra y tiene su propio runbook
  (`conciliacion-discrepante.md`).
- **`INTERNAL_ERROR` repetido** → mira si la base responde
  (`base-de-datos-caida.md`) antes de tocar nada aquí.

---

## 4 · Está sano y aun así no llegan

Entonces el aviso no sale del proveedor o no llega a nuestra puerta. Comprueba,
en este orden:

1. La URL que el proveedor tiene configurada, carácter por carácter.
2. Que el dominio resuelva y el certificado esté vigente.
3. Los registros del proveedor: casi todos muestran el código que recibieron.
   Un `401` suyo significa que la firma no cuadra —secreto rotado de un lado y
   no del otro—.

---

## 5 · Qué NO hacer

- **No aceptar sin verificar.** Jamás un cambio que responda `200` «mientras se
  arregla la firma»: eso es aceptar pagos de cualquiera que conozca la URL.
- **No confirmar pagos a mano en la base.** Hay un servicio para eso, con su
  candado y su bitácora; un `UPDATE` directo deja la economía descuadrada sin
  que nadie se entere.
- **No borrar los eventos fallidos** para «limpiar el panel». Son la única
  prueba de qué mandó el proveedor.

---

## 6 · Criterio de recuperación

- **Pagos externos** en `SANO` en el Centro de Operaciones.
- Un aviso de prueba del proveedor responde `200` con `EVENT_ACCEPTED`.
- El inbox no acumula `FAILED` nuevos durante 15 minutos.
- Las compras que estaban esperando aparecen pagadas, con su derecho emitido.

## 7 · Escalamiento

Si en 30 minutos no está claro si el problema es nuestro o del proveedor:
apaga la capacidad con el kill switch —el proveedor reintentará— y escala. Es
preferible una integración parada y explicada que una que acepta a medias.
