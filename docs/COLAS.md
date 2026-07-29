# Trabajos en segundo plano

Fase 2 de `docs/AUDITORIA-PRODUCCION.md` (C-06 y C-07).

## El problema que resuelve

Dos cosas se hacían **dentro del request** y ninguna cabía:

- **Fan-out de notificaciones.** `notificarClientesEmpresa` leía a todos los
  clientes y hacía un único `createMany`. Con 50.000 clientes, un INSERT de
  50.000 filas en una función serverless con límite de tiempo — bloqueando la
  respuesta al administrador que pulsó el botón, y dejando el envío a medias si
  se agotaba.
- **Cron de automatizaciones.** Un bucle `for` con `await` por empresa dentro de
  los 60 segundos del cron. Con mil empresas a ~200 ms son 200 segundos: se
  cortaba a la mitad y **las restantes no se procesaban nunca**, devolviendo 200
  como si todo hubiera ido bien.

## Cómo funciona ahora

```
server action / cron
        │
        ├─ encolar({ tipo, ... })  →  QStash  →  POST /api/jobs
        │                                              │
        └─ (sin QStash: ejecuta en línea)              └─ ejecutarTrabajo()
                                                            │
                                             lote de 1.000 → se encadena solo
```

| Pieza | Archivo |
|---|---|
| Cliente REST de QStash + verificación de firma | `src/lib/jobs/qstash.ts` |
| Catálogo de trabajos y tamaño de lote | `src/modules/jobs/tipos.ts` |
| Encolado con degradación a ejecución en línea | `src/modules/jobs/cola.ts` |
| Ejecución de cada trabajo | `src/modules/jobs/ejecutor.ts` |
| Endpoint que recibe de QStash | `src/app/api/jobs/route.ts` |

### Decisiones que conviene no deshacer

**Lotes encadenados, no cien mensajes de golpe.** El trabajo procesa 1.000
destinatarios y, si quedan más, se encola a sí mismo. Encolar los cien lotes de
una vez llenaría la cola antes de saber si el primero funcionó.

**`orderBy: { id: 'asc' }` en la paginación de destinatarios.** No es estético.
Sin orden explícito PostgreSQL puede devolver las filas en distinto orden entre
consultas, y entonces `skip`/`take` se solapan o se saltan gente: unos reciben
la notificación dos veces y otros ninguna.

**Verificación de firma, no un secreto compartido.** `/api/jobs` es público por
necesidad y hace escrituras masivas. La firma de QStash es un JWT calculado
sobre el **cuerpo** del mensaje: cambiar el `companyId` de la petición la
invalida. Un secreto en cabecera se filtra en un log y ya no hay vuelta atrás.
Está probado en `tests/cola.test.ts` (12 casos).

**El cuerpo se lee crudo y se verifica antes de parsear.** Parsear y
re-serializar para comprobar el hash rompería mensajes legítimos por cualquier
diferencia de formato.

**400 para un cuerpo ilegible, 500 para un fallo de ejecución.** QStash solo
reintenta ante 5xx. Un cuerpo roto no mejora con reintentos; un fallo transitorio
de base sí.

## Configuración

Variables de entorno (Upstash → QStash):

```
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
QSTASH_TARGET_URL=https://tu-dominio        # opcional; si no, NEXT_PUBLIC_APP_URL
```

**Sin `QSTASH_TOKEN` los trabajos se ejecutan dentro del request.** No se
pierden, pero vuelve el riesgo original. En producción se escribe un `warn`
ruidoso en el log precisamente para que se note.

**Sin `QSTASH_CURRENT_SIGNING_KEY` el endpoint responde 503** y no ejecuta nada:
mejor que la cola no funcione a que funcione sin firmar.

## Cómo comprobar que funciona

1. Mandar una notificación a todos los clientes desde el panel. La acción debe
   responder de inmediato; en el panel de QStash aparece el mensaje.
2. Con más de 1.000 clientes, deben aparecer mensajes **encadenados**: uno por
   lote, cada uno con `desde` mayor que el anterior.
3. Disparar el cron a mano: la respuesta debe traer
   `reparto: { empresas, encoladas, enLinea }` con `enLinea: 0`. Si `enLinea` no
   es cero, QStash no está configurado.
4. Probar el rechazo: `curl -X POST https://tu-dominio/api/jobs -d '{}'` debe
   devolver **401**.

## Lo que queda fuera de esta fase

El correo saliente (`src/lib/email.ts`) sigue enviándose dentro del request. Hoy
son envíos de uno en uno, no fan-out, así que no es el mismo problema — pero es
el siguiente candidato natural a pasar por la cola.
