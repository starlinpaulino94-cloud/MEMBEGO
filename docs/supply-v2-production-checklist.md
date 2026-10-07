# Supply 2.0 · lista de comprobación de producción

> **Qué es esto.** Lo que hay que haber comprobado para que Supply 2.0 opere en
> producción, y lo que hay que comprobar **después** de cada despliegue que lo
> toque. No repite lo que ya existe: el despliegue y las migraciones están en
> [`DEVOPS.md`](DEVOPS.md), la recuperación en
> [`RECUPERACION.md`](RECUPERACION.md), los incidentes en
> [`runbooks/`](runbooks/README.md). Esto es la capa de Supply 2.0 encima de
> eso.

> **Qué NO es.** No es una declaración de que el sistema esté listo. Es una
> lista de preguntas con respuesta comprobable. Una casilla sin marcar es
> información; una casilla marcada sin haberla comprobado es peor que no tener
> la lista.

---

## 0 · Las tres cosas que decide todo lo demás

Antes de la lista larga, tres preguntas. Si alguna se responde «no sé», la
respuesta es parar y averiguarlo:

| Pregunta | Cómo se contesta en un minuto |
|---|---|
| ¿Qué dice el propio sistema que le falta? | `/superadmin/supply-v2/operaciones` — la tarjeta **Configuración** lista variable por variable |
| ¿Está listo para operar? | `GET /api/health/ready` — `200` listo o degradado, `503` **no** listo, con el detalle por componente |
| ¿Están las puertas cerradas? | `npm run smoke -- https://<dominio>` — doce comprobaciones de solo lectura |

El panel es la fuente, no esta lista: el validador de configuración corre
contra el entorno real y esta lista se escribió un día concreto.

---

## 1 · Configuración

Lo que el validador comprueba por su cuenta (`/superadmin/supply-v2/operaciones`
→ Configuración). Cada fila dice qué pasa **si falta**, porque eso es lo que
decide si bloquea el despliegue:

| Variable | Si falta | ¿Bloquea? |
|---|---|---|
| `SUPPLY_V2_WEBHOOK_ACTOR_ID` | El webhook responde 500 y los eventos quedan esperando con el pago cobrado fuera | **Sí**, si los pagos externos están encendidos |
| `SUPPLY_V2_TEST_GATEWAY_SECRET` (y el secreto de cada pasarela real) | El webhook rechaza todo con 401. Falla cerrado: nadie entra | **Sí**, si los pagos externos están encendidos |
| `QSTASH_TOKEN` | Los efectos se entregan **en línea**, dentro de la petición: más lento, no se pierde ninguno | No: degradación honesta |
| `CRON_SECRET` | El cron no corre → no se barre el inbox, no se despacha el outbox, no se concilia, no se avisa | **Sí** |
| `SENTRY_DSN` | El detalle de un error se busca en los logs del hosting | No |
| `BOOTSTRAP_SECRET` | `/api/health` da el estado agregado y no el detalle | No |
| `METRICAS_SECRET` | `/api/metricas` responde 503 y no consulta nada (fail-closed) | No, pero no hay monitor externo |

Umbrales de alerta: traen valores por defecto razonables y solo se tocan si el
panel avisa de más o de menos —`SUPPLY_V2_OUTBOX_PENDING_WARN_MINUTES`,
`SUPPLY_V2_OUTBOX_PENDING_CRITICAL_MINUTES`, `SUPPLY_V2_DEAD_LETTER_THRESHOLD`,
`SUPPLY_V2_OPEN_INCIDENTS_HIGH_THRESHOLD`, `SUPPLY_V2_MISMATCH_THRESHOLD`,
`SUPPLY_V2_INBOX_DEAD_THRESHOLD`—.

- [ ] La tarjeta **Configuración** no tiene nada en `MISSING` ni en `INVALID`.
- [ ] Ningún secreto está en una variable `NEXT_PUBLIC_*`. Lo que lleva ese
      prefijo **se sirve al navegador**: ponerlo ahí no es un descuido de
      estilo, es publicarlo.
- [ ] El `SUPPLY_V2_WEBHOOK_ACTOR_ID` apunta a una cuenta de servicio, no a la
      cuenta de una persona. Quien procesa no puede ser quien investiga lo que
      él mismo procesó.
- [ ] Los secretos de pasarela admiten rotación: la variable acepta varios
      separados por coma, y durante la rotación valen los dos.

## 2 · Base de datos

- [ ] `npm run migraciones:pendientes` no reporta nada por aplicar.
- [ ] El esquema no tiene deriva: la tarjeta **Base** del panel dice
      «Responde y el esquema coincide con el código». Una columna que falta
      rompe pantallas que no la usan —está explicado en
      [`DEVOPS.md`](DEVOPS.md)—.
- [ ] `node scripts/rls-capa2-preflight.mjs` pasa: ninguna tabla quedaría
      denegada sin que alguien lo haya decidido.
- [ ] Las migraciones **ya aplicadas no se han editado**. Si hace falta
      corregir una, se escribe otra encima.

## 3 · Operación

- [ ] `/superadmin/supply-v2/operaciones` carga y responde en tiempo razonable.
- [ ] Los cinco interruptores aparecen **encendidos** —o apagados con su motivo
      escrito, que es distinto de apagados sin más—:
      `SUPPLY_V2_EXTERNAL_PAYMENTS`, `SUPPLY_V2_OUTBOX_DELIVERY`,
      `SUPPLY_V2_RECONCILIATION_SWEEP`, `SUPPLY_V2_OPERATIONS_CENTER`,
      `SUPPLY_V2_AUTOMATIONS`.
- [ ] El cron está programado y **corre**: la última respuesta de
      `/api/cron/supply-v2` trae `inbox`, `outbox`, `conciliacion`, `alertas`,
      `metricas` y `automatizaciones`, ninguno con `"activo": false` inesperado.
- [ ] No hay alertas activas sin reconocer.
- [ ] Hay **al menos una persona** con el permiso de operaciones. Las
      automatizaciones avisan a quien tiene el permiso, no a una lista de
      correos en una variable: sin nadie con el permiso, los avisos
      operativos no tienen destinatario.
- [ ] Los filtros **Sin salida** del inbox y del outbox están vacíos, o lo que
      queda está explicado en una nota de incidente.

## 4 · Pagos

- [ ] `npm run smoke` da verde, y en particular **«el webhook rechaza lo que no
      lleva firma»**. Un 200 ahí es una brecha, no un fallo de disponibilidad.
- [ ] Una firma vieja se rechaza: la ventana anti-replay está activa
      (`REPLAY_REJECTED` → 400).
- [ ] El mismo evento entregado dos veces deja **una** fila, un pago y un juego
      de derechos. Lo demuestra la suite contra PostgreSQL, no hace falta
      probarlo en producción.
- [ ] CardNET sigue **separado**: no está integrado con Supply 2.0 y su runbook
      es [`runbooks/pagos-cardnet.md`](runbooks/pagos-cardnet.md). Mezclar los
      dos caminos es el error que esta casilla existe para prevenir.
- [ ] Ninguna credencial real de pasarela aparece en el repositorio, en una
      prueba ni en un `.env` versionado.

## 5 · Despliegue y vuelta atrás

El pipeline real está en [`DEVOPS.md`](DEVOPS.md) y en
`.github/workflows/deploy-migraciones.yml`. Lo propio de Supply 2.0:

- [ ] Las puertas de CI pasaron: `tsc`, `eslint`, `npm test`,
      `rls:cobertura`, `transacciones-anidadas`, `permisos-catalogo`,
      `rls-capa2-preflight`, `build`, `presupuesto`, `npm audit`.
- [ ] La suite contra PostgreSQL (`npm run test:db`) pasó. **No cuenta una
      ejecución**: las carreras y los barridos globales solo se ven repitiendo.
- [ ] El E2E pasó contra una base desechable (`npm run e2e:limpio`).
- [ ] Sabe **cómo volver atrás** antes de desplegar:
      [`runbooks/revertir-despliegue.md`](runbooks/revertir-despliegue.md).
- [ ] Si el despliegue trae migración, sabe que **el código vuelve atrás y el
      esquema no**: una migración que quita una columna no se revierte
      revirtiendo el despliegue.
- [ ] Justo después de desplegar: `npm run smoke -- https://<dominio>` y una
      mirada al panel. En ese orden, porque el smoke tarda veinte segundos.

## 6 · Respaldo y recuperación

Esto **no se puede afirmar desde el repositorio** y
[`RECUPERACION.md`](RECUPERACION.md) lo dice en su primera sección: el plan de
Supabase, si PITR está activo y cuánto se retiene se miran en el panel de
Supabase. Lo que sí se puede comprobar:

- [ ] Las cuatro casillas de `RECUPERACION.md` § 1 están rellenas. Mientras no
      lo estén, **el RPO real es desconocido** —que es peor que «24 horas»,
      porque no se puede planificar—.
- [ ] El simulacro automático corre: `.github/workflows/respaldo-verificacion.yml`
      y `npm run respaldo:verificar`.
- [ ] Hay **al menos una restauración real** en la bitácora de simulacros
      (`RECUPERACION.md` § 7). Hasta la primera, «tenemos respaldos» es una
      creencia.
- [ ] Se sabe que un volcado del esquema `public` **no** incluye el esquema
      `auth`, ni Storage, ni los secretos. Son cuatro cosas, no una.

---

## Cómo se usa esto

Antes de un despliegue que toque Supply 2.0: las secciones 1, 2 y 5.
Después: el § 0 completo, que son tres comprobaciones.
Una vez al mes, sin despliegue de por medio: la lista entera, que es la única
forma de que las casillas de la 6 no envejezcan calladas.

Una casilla que no se puede comprobar se deja sin marcar **y se escribe por
qué**. Marcarla «porque debería estar bien» convierte la lista en un trámite, y
un trámite no ha evitado nunca un incidente.
