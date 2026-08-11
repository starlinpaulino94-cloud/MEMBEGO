# El restaurante como sistema aparte

Fase 7b del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/satelite.md`.

---

## La otra mitad del encargo

La Fase 7 contestó «¿se integra un sistema nuevo sin modificar MembeGo?» — sí,
por manifiesto, sin un `switch` ni un despliegue.

Queda la que da nombre al estándar:

**¿Funciona el contrato cuando hay red en medio?**

Todo lo construido hasta aquí se validó **con la red desconectada**. Car Wash
pide por el puerto `ClientePlataforma`, pero con `clienteLocal()`, que llama en
proceso y contra la misma base. Eso demuestra que el contrato *expresa* la
operación. No demuestra nada sobre latencia, reintentos, orden de llegada ni
copias desactualizadas — porque ninguna de esas cosas existe cuando no hay red.

Fue deliberado y está escrito en la Fase 6:

> «Descubrir un hueco con Car Wash cuesta una tarde. Con el primer satélite
> integrado cuesta una versión del contrato y un despliegue coordinado con otro
> equipo.»

Esta es la tarde.

---

## Qué es `apps/restaurant`

Un sistema con **su propia base de datos**, que habla con MembeGo **solo por
HTTP**. Cuatro tablas:

| Tabla | De quién es |
|---|---|
| `mesas`, `comandas` | Del restaurante. MembeGo no sabe que existen |
| `clientes_proyectados` | **Copia** de lectura de un dato del Core |
| `eventos_recibidos` | El inbox: qué webhooks ya se procesaron |

Ni `clientes`, ni `memberships`, ni `promociones`. Verificado contra la base
real: las cuatro tablas y ninguna más.

---

## La regla que sostiene todo

> **La copia local MUESTRA. No DECIDE.**

El camarero teclea un teléfono y ve «Ana, socia Premium» al instante, leyendo la
copia. Sigue funcionando si MembeGo tarda o no responde — el restaurante no
puede dejar de servir comida por algo que no es suyo.

Pero el momento en que ese beneficio **se consume**, la decisión la toma el Core
por HTTP. Sin excepción.

Decidido con la copia, basta un webhook lento para regalar un beneficio que ya
se gastó en otro local hace cinco minutos. Y no se nota: el camarero ve «le
queda uno», lo aplica, el cliente se va contento. Aparece al cuadrar caja, días
después, sin forma de saber a quién se le regaló qué.

Por eso `ClienteProyectado` **no tiene saldos ni usos restantes**. No es un
olvido: tenerlos invitaría a usarlos. Hay una prueba que falla si alguien añade
un campo gastable a esa tabla.

---

## Lo que el cliente en-proceso hacía invisible

### Los eventos no llegan en orden

MembeGo reintenta lo que no responde. El segundo intento de un evento de las
10:00 puede aterrizar **después** del primer intento de uno de las 10:05. No es
un fallo: es cómo funciona cualquier reparto con reintentos.

Aplicado sin mirar, el cliente «vuelve» a su nombre anterior. Y no falla nada:
no hay error, ni log, ni fila mal formada. Solo un dato viejo pisando a uno
nuevo.

Se ordena por `occurredAt`, que el sobre define como *cuándo ocurrió* y no
cuándo se envió — los reintentos no lo mueven. Es el único campo del sobre con
el que se puede ordenar.

La comparación es **estrictamente mayor**. Con `>=`, dos eventos del mismo
instante se aplican los dos y gana el último en llegar: justo el
no-determinismo que la comparación existe para quitar.

### El duplicado es el funcionamiento normal

El mismo `eventId` llega más de una vez **por diseño**. El inbox lo reconoce y
responde 200 sin volver a aplicar.

Está **en base, no en memoria**. El inbox en memoria del SDK sirve para probar;
aquí se vacía al reiniciar el proceso — y reiniciar es exactamente cuando
MembeGo está reintentando lo que quedó sin responder.

### Tres defensas que no se sustituyen

| Defensa | De qué protege |
|---|---|
| **Firma** sobre el cuerpo crudo | La URL es pública: cualquiera puede inventar un `customer.created` |
| **Inbox** por `eventId` | El reintento, que es normal |
| **Orden** por `occurredAt` | Un evento viejo llegando después de uno nuevo |

Quitar cualquiera deja un hueco que las otras dos no tapan.

> **El cuerpo se lee CRUDO.** La firma se calcula sobre los bytes exactos que
> llegaron. Parsear el JSON y volver a serializarlo cambia el orden de las
> claves y los espacios: los datos son los mismos y la firma ya no cuadra.
> Falla en todos los eventos y el mensaje —«firma inválida»— apunta al sitio
> equivocado. Es el error más repetido al integrar webhooks firmados.

---

## Decisiones de la operación

### Primero el canje, después el cierre

Cerrando primero, un fallo del canje deja la comanda cobrada **como si** se
hubiera aplicado el beneficio. Al revés queda un canje consumido y una comanda
abierta: visible, y arreglable por quien esté en el mostrador.

De los dos desastres, ese avisa.

### La clave de idempotencia es la comanda

No la llamada, no un uuid nuevo, no la hora. Si el cobro se reintenta —la
respuesta se perdió, el camarero volvió a pulsar— tiene que llegar la **misma**
clave, o se consume el beneficio dos veces por una comida.

### La venta se registra sin bloquear

Después de cerrar y sin `await`. Es información para el Core, no una condición
para cobrar: si falla, el cliente ya pagó y lo que se pierde es una fila de
analítica. Bloquear el cobro por esto sería dejar de facturar porque un sistema
de informes no responde.

### El puesto lo asigna este sistema

`membegoRole` es qué es en MembeGo. `systemRole` es qué es **aquí**, y MembeGo
lo transporta sin interpretarlo.

La tentación es decidir los permisos con `membegoRole`, porque siempre viene y
`systemRole` puede ser `null`. Hacerlo mete a un ADMIN_EMPRESA —que administra
campañas— en la caja del restaurante sin que nadie se lo haya dado.

Sin puesto no se puede nada. Un `systemRole` que este sistema no reconoce
(«Mesero jefe») se trata como sin puesto: denegar por no reconocerlo es
correcto; caerse, no.

---

## Verificación

**760 pruebas** en `tests/`, de las que 15 son de esta fase.

Y **15 comprobaciones contra PostgreSQL 16 y HTTP reales**
(`scripts/verificar-satelite-restaurante.mts`), que es lo que separa esto de un
ejercicio:

```
FIRMA — la calcula el Core, la verifica el satélite
  ✓ un evento firmado por el Core se acepta
  ✓ una firma manipulada se rechaza con 400
  ✓ una firma de OTRO evento no sirve para este
  ✓ el intruso no entró en la proyección
PROYECCIÓN — persistida de verdad
  ✓ el cliente quedó en la base del satélite
  ✓ guardó `vigenteDesde` del evento, no la hora de guardado
INBOX — el reintento es normal, no un fallo
  ✓ el mismo eventId reintentado responde 200
  ✓ y se reconoce como duplicado
  ✓ no dejó una segunda fila en el inbox
ORDEN — lo que el cliente en-proceso hacía invisible
  ✓ un reintento tardío de un evento viejo NO pisa al nuevo
AISLAMIENTO — la base del satélite es suya
  ✓ solo existen las tablas del satélite
  ✓ no existe la tabla `clientes` de MembeGo
  ✓ no existe la tabla `memberships` de MembeGo
  ✓ no existe la tabla `promociones` de MembeGo
  ✓ no existe la tabla `companies` de MembeGo
```

La firma la genera **la función del Core** (`firmarEd25519`), no una reimplementación.
Si las dos mitades del contrato se hubieran separado, aquí se vería.

### Lo que encontró el compilador

Al escribir el cobro se dieron por supuestas dos formas de DTO —
`r.redemption.id` y `montoCentavos`. `tsc` paró las dos: son `redemptionId` y
`amount`.

Es exactamente para lo que existe `packages/contracts`. Escritas a mano en el
satélite, esas dos suposiciones habrían compilado, se habrían desplegado, y
habrían fallado contra el Core de verdad.

---

## Lo que falta

| Pieza | Estado |
|---|---|
| Base propia, proyección, inbox, firma, SSO | ✅ |
| Verificado contra Postgres y HTTP reales | ✅ |
| **Interfaz del restaurante** | 🔴 No hay pantallas: el dominio y la integración están, la operación se maneja por HTTP |
| **Reconciliación periódica** | 🔴 Si un webhook se pierde del todo, la copia queda vieja para siempre. Hace falta un barrido que compare contra el Core |
| **Despliegue separado** | 🔴 Vive en el monorepo. Sacarlo a su repositorio es el siguiente paso natural |

> La reconciliación es la más importante de las tres. El desfase hoy se puede
> **medir** (`desfase()`), que es lo que permite enseñarlo en pantalla; lo que
> todavía no hay es nada que lo **corrija**.
