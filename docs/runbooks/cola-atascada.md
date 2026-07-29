# Runbook · Los trabajos en segundo plano no se ejecutan

**Síntoma:** las notificaciones masivas no llegan a los clientes. Las
automatizaciones (cumpleaños, membresías por vencer, clientes inactivos) no se
disparan. El panel dice que la campaña se envió y nadie la recibió.

---

## 1 · Cómo funciona (30 segundos que ahorran una hora)

Lo pesado no se hace dentro de la petición: se encola en **QStash** (Upstash),
que llama de vuelta a `POST /api/jobs`. Ese endpoint es público por necesidad
—QStash llama desde fuera— y lo primero que hace es **verificar la firma**.

Dos consecuencias que explican casi todos los incidentes de aquí:

- **Sin `QSTASH_CURRENT_SIGNING_KEY`, el endpoint responde 503 y no ejecuta
  nada.** Es deliberado: prefiero una cola parada a una cola que ejecuta
  escrituras masivas sin firmar.
- Los lotes son de 1.000 y **se encadenan solos**: cada trabajo procesa su lote
  y encola el siguiente. Si la cadena se corta a la mitad, la mitad de los
  clientes recibió la notificación.

---

## 2 · Confirmar

### a) ¿Están las variables?

Vercel → Environment Variables. Tienen que estar las cuatro:

```
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
QSTASH_TARGET_URL      (opcional; sin ella se usa NEXT_PUBLIC_APP_URL)
```

**Esta es la causa número uno.** Si faltan, la cola nunca ha funcionado y no
hay nada roto: hay algo sin configurar.

### b) ¿El endpoint responde?

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<dominio>/api/jobs -d '{}'
```

| Código | Significado |
|---|---|
| `401` | **Correcto.** El endpoint vive y rechaza lo no firmado |
| `503` | Falta `QSTASH_CURRENT_SIGNING_KEY` → § 3a |
| `404` | El despliegue no incluye la ruta. ¿Se desplegó la versión correcta? |
| Nada / 5xx | Es un problema de la aplicación, no de la cola → [`base-de-datos-caida.md`](base-de-datos-caida.md) |

### c) ¿Qué dice QStash?

Consola de Upstash → QStash → **Events**. Ahí se ve cada mensaje, su destino y
la respuesta que recibió.

| Lo que ves en Events | Diagnóstico |
|---|---|
| No hay mensajes | La aplicación no está encolando → § 3b |
| Mensajes con `401` | La clave de firma de Vercel no coincide con la de Upstash → § 3c |
| Mensajes con `503` | Falta la clave en Vercel → § 3a |
| Mensajes con `500` reintentándose | El trabajo falla al ejecutarse → § 3d |
| Mensajes `200` pero nadie recibe nada | La cola funciona; el problema es el envío de correo → § 4 |

---

## 3 · Arreglar

### a) Falta la clave de firma

Upstash → QStash → **Signing keys**. Copia *Current* y *Next* a Vercel como
`QSTASH_CURRENT_SIGNING_KEY` y `QSTASH_NEXT_SIGNING_KEY`. Redespliega.

Las dos, no solo la primera: Upstash **rota** las claves, y durante la rotación
conviven mensajes firmados con una y con otra. Con solo la actual, media
rotación se pierde en trabajos rechazados.

### b) No se encola nada

Sin `QSTASH_TOKEN`, el código **no falla**: ejecuta el trabajo **dentro de la
petición**. No se pierde nada, pero vuelve el riesgo original — un envío masivo
puede agotar el tiempo de la función a mitad de camino, y entonces sí se pierde
la parte que faltaba.

Comprueba `QSTASH_TOKEN` y, si está, mira los logs de Vercel buscando fallos al
publicar.

### c) `401` en los eventos de QStash

La clave que tiene Vercel no es la que usa Upstash para firmar. Vuelve a
copiarlas —enteras, sin espacios de más al pegar— y redespliega.

También ocurre si `QSTASH_TARGET_URL` apunta a un despliegue de *preview* con
otras variables. Debe apuntar al dominio de producción.

### d) `500` con reintentos

El trabajo se ejecuta y revienta. Vercel → Logs, busca `[jobs] fallo ejecutando`.

**Deja que reintente.** El `500` es a propósito: los trabajos son idempotentes,
repetir es seguro y perder el trabajo no lo es. Si la causa es transitoria (la
base saturada), se resuelve solo. Si es un error de código, arréglalo y el
reintento lo recogerá.

Causas frecuentes: base saturada ([`pool-agotado.md`](pool-agotado.md)) o una
columna que falta ([`migracion-fallida.md`](migracion-fallida.md)).

---

## 4 · La cola va bien y aun así nadie recibe nada

Entonces el problema es el correo, no la cola.

- `RESEND_API_KEY` en Vercel. Sin ella, el envío queda deshabilitado en
  silencio.
- El dominio `membego.com` verificado en Resend (DNS).
- Panel de Resend → Logs: ¿salieron? ¿rebotaron?

**Nota:** el correo se envía **dentro de la petición**, no por la cola
(`src/lib/email.ts`). Está anotado como pendiente en la auditoría. La
consecuencia práctica es que un pico de registros puede bloquear peticiones
esperando al servidor de correo.

---

## 5 · Después de un mantenimiento

`/api/jobs` devuelve `503` con el modo mantenimiento encendido y **QStash
reintenta** con espera creciente: los trabajos salen solos al reabrir. No hay
que hacer nada.

Lo que **no** se recupera solo son los avisos de CardNET →
[`pagos-cardnet.md`](pagos-cardnet.md).

---

## 6 · No hagas esto

- **No quites la verificación de firma** para "salir del paso". Es lo único que
  separa este endpoint de que cualquiera en internet dispare cien mil
  inserciones. Hay 12 pruebas en `tests/cola.test.ts` cuidando exactamente eso.
- **No purgues la cola de QStash** sin mirar qué hay dentro: se pierden los
  trabajos pendientes de verdad.
- **No reenvíes una campaña** porque "no llegó" sin comprobar antes en Events.
  Si sí llegó, los clientes reciben la notificación dos veces.
