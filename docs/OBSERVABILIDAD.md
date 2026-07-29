# Observabilidad

Cierra el hallazgo **A-09** de `docs/AUDITORIA-PRODUCCION.md` (*Observabilidad
incompleta*) — Fase 6 del plan.

> El hallazgo decía, textualmente: *"una degradación del pool de conexiones se
> detecta cuando los usuarios se quejan"*. Esta fase trata de que el sistema lo
> diga antes. Lo que **no** hace es alertar solo: las alertas hay que crearlas a
> mano en el monitor, y están escritas una por una en la § 5.

---

## 1. Las tres piezas, y por qué hacen falta las tres

| Pieza | Responde a | Dónde vive |
|---|---|---|
| **Eventos estructurados** | ¿Cuántos canjes fallaron hoy? ¿Cuánto tardan? | Logs de Vercel · `src/modules/observabilidad/eventos.ts` |
| **Métricas** | ¿Cómo está el negocio y el sistema *ahora*? | `/api/metricas` y `/superadmin/observabilidad` |
| **Errores** | ¿Qué se rompió exactamente y con qué traza? | Sentry |

Ninguna sirve sola. Sentry te dice que hubo una excepción, no que las visitas
cayeron a la mitad. Las métricas te dicen que las visitas cayeron, no por qué.
Los eventos te dicen que los canjes tardan 4 segundos desde las 10:15, que es
lo que conecta las otras dos.

---

## 2. Eventos estructurados

Una línea de JSON con forma fija, escrita a la salida estándar. Vercel ya la
recoge; cualquier recolector externo sabe filtrarla.

```json
{"evt":1,"t":"2026-07-29T14:03:11.221Z","dom":"escaneo","acc":"canje","ok":false,"ms":312,"emp":"cmp_123","motivo":"qr_ya_usado"}
```

| Campo | Qué es |
|---|---|
| `evt` | Marca fija. Filtrar por `evt` aísla estas líneas de todo el ruido |
| `dom` | `escaneo`, `pago`, `registro`, `cola`, `auth`, `datos`, `sistema` |
| `acc` | La acción, en etiqueta |
| `ok` | Si la operación se completó. **Es el campo que calcula los SLO** |
| `ms` | Duración |
| `emp` | Empresa. Sin esto no se diagnostica nada multi-inquilino |
| `motivo` | Por qué no salió bien |

### Qué NO puede aparecer aquí, nunca

`extra` **no acepta cadenas libres**: solo números, booleanos y *etiquetas*
(minúsculas empezando por letra, sin espacios ni arroba, máximo 48 caracteres,
sin secuencias de 7+ dígitos). Un correo no cabe en esa forma. Un teléfono
tampoco. Tampoco se registran identificadores de persona: `companyId` sí,
`userId` no.

No es una lista de cosas prohibidas —esas siempre se quedan cortas— sino una
forma que solo admite lo que queremos. Está protegido por pruebas
(`tests/observabilidad.test.ts`), y esas pruebas están ahí porque la barrera se
relaja sola: alguien añade el correo "para depurar", y seis meses después los
correos de todos los clientes llevan un año en un proveedor externo.

> **Límite conocido:** un número puesto a mano (`{ telefono: 8095551234 }`) sí
> pasa, porque es un número finito y el filtro es de forma, no de intención.
> Ahí la barrera es la revisión de código. Está documentado en la prueba
> correspondiente para que nadie lo descubra por sorpresa.

### Qué está instrumentado hoy

| Dónde | Evento | Para qué |
|---|---|---|
| `canjeActions.ts` | `escaneo/canje` | SLO de canje y de latencia del escaneo |
| `/api/jobs` | `cola/trabajo` | SLO de trabajos; firmas rechazadas |
| `loginActions.ts` | `auth/login` | Fuerza bruta en curso vs. gente que olvidó la clave |
| `src/lib/prisma.ts` | `datos/consulta_lenta`, `datos/pool_agotado` | Consultas >500 ms y `P2024` |

Lo que **no** está instrumentado y se nota: el flujo de pago completo
(`pago/*`), el registro de clientes y las automatizaciones. Se puede añadir con
`registrarEvento` o `medir` sin tocar nada más.

### Consultas útiles en los logs de Vercel

```
evt AND "dom":"escaneo" AND "ok":false     → canjes que no salieron
evt AND "acc":"pool_agotado"                → el P2024 antes de que se note
evt AND "acc":"consulta_lenta"              → qué modelo va lento y desde cuándo
evt AND "dom":"auth" AND "limite_alcanzado" → fuerza bruta
```

---

## 3. Métricas

`GET /api/metricas` con la cabecera `x-metricas-secret`. Devuelve JSON, o
formato Prometheus con `?formato=prometheus`.

```bash
curl -s -H "x-metricas-secret: $METRICAS_SECRET" https://<dominio>/api/metricas | jq
```

**No es público, a diferencia de `/api/health`.** Health devuelve una palabra
—`ok` o `degraded`— justamente para no dar información. Esto devuelve cuántos
clientes se registraron hoy y cuántas empresas hay activas: es inteligencia de
negocio, y un competidor que lo consultara cada día tendría la curva de
crecimiento de MembeGo sin pedir permiso. Sin `METRICAS_SECRET` responde 503.

### Por qué las métricas salen de la base y no de contadores

Un contador en memoria en Vercel no vale para nada: cada petición cae en una
instancia distinta y las instancias mueren solas. Un contador que dice "3
canjes" es cierto para esa instancia mientras otras veinte vieron los otros 400.
La base de datos es el único sitio que lo ve todo.

Lo que la base **no** puede responder es la latencia —no guarda cuánto tardó
cada petición—. Eso son los eventos. Las dos mitades juntas son la
observabilidad.

### Lo que se mide

**Negocio** (24 h, sin empresas de práctica): visitas y su variación frente a
ayer, transacciones, clientes nuevos, pagos aprobados/rechazados, **pagos sin
resolver**, empresas activas, notificaciones.

**Sistema**: latencia de la base, conexiones abiertas frente al máximo, índices
inválidos.

De todos, el que más veces va a salvar una tarde es **pagos sin resolver**:
cobros iniciados hace más de una hora que nunca se cerraron. Cada fila es un
cliente que pagó y no recibió lo suyo. Hoy solo se descubren cuando ese cliente
escribe.

El panel para mirarlo con los ojos está en `/superadmin/observabilidad`.

---

## 4. SLO y presupuesto de error

Definidos en `src/modules/observabilidad/slo.ts` y probados.

| Objetivo | Meta | Presupuesto | SLI |
|---|---|---|---|
| La aplicación responde | 99,5% / 30 días | 3 h 36 min al mes | `/api/health` = `ok` |
| El escaneo es rápido | 95% | — | Canjes servidos en menos de 1,5 s |
| Un canje válido no falla | 99,5% | — | Canjes que terminan en visita registrada |
| Los trabajos se ejecutan | 99% | — | Trabajos encolados sin fallo definitivo |

### Por qué 99,5% y no 99,99%

```
99,0%  →  7 h 12 min de caída al mes
99,5%  →  3 h 36 min          ← el elegido
99,9%  →      43 min
99,99% →       4 min
```

99,99% mensual significa que un incidente de cinco minutos ya rompe el objetivo
del mes. Con una persona, sin guardia y con toda la infraestructura en un solo
proveedor (`docs/RECUPERACION.md` § 6), eso sería un número decorativo. Y un
SLO que se incumple todos los meses se ignora igual que una alerta que salta
siempre.

### La cuenta que la gente hace mal

Con un objetivo del 99,5%, **un 0,25% de errores no es "casi nada": es medio
mes de presupuesto gastado**. Lo que se consume no es la tasa de fallo, sino la
tasa de fallo dividida entre la que el SLO permite.

### Cómo calcular el consumo real

Contando eventos del log en la ventana:

```
bueno = eventos con "ok":true
total = todos los eventos del dominio
```

Para el SLO de **canje**, `total` son los canjes intentados y los errores son
**solo** los de `motivo: error_interno`. Un QR ya usado o una promoción sin usos
salen con `ok:false` y no cuentan: son el sistema funcionando bien.

Por debajo de 20 eventos no se saca conclusión (`hayDatos`): con tres canjes, un
fallo mueve el porcentaje del 0% al 33%.

### Estado del SLO

**Son una propuesta.** Nadie los ha aceptado y no hay un mes completo de datos.
Hasta entonces son la hipótesis de trabajo, no una promesa a nadie.

---

## 5. Alertas: cuáles crear, con qué umbral

**Ninguna de estas existe todavía.** Hay que crearlas a mano; esta sección es
para copiar y pegar.

### 5.1 · Monitor de uptime (UptimeRobot o Better Stack; el plan gratuito basta)

| Qué | Valor |
|---|---|
| URL | `https://<dominio>/api/health` |
| Intervalo | 5 minutos |
| Alerta si | El cuerpo **no** contiene `"status":"ok"`, o no responde |
| Fallos antes de avisar | 2 seguidos (uno solo puede ser un despliegue) |
| Canal | WhatsApp o llamada |

Este es el único que puede despertar a alguien de madrugada, y es el que hay que
montar **primero**: es gratis y es la diferencia entre enterarse en 10 minutos o
en dos horas. `/api/health` está exento del modo mantenimiento, así que un
mantenimiento planificado no lo dispara.

### 5.2 · Alertas de Sentry

| Alerta | Condición | Severidad |
|---|---|---|
| Pico de errores | Más de 25 eventos en 5 min | Llamada |
| Error nuevo en producción | Cualquier `issue` nuevo con más de 5 apariciones en 1 h | Revisar |
| Canje roto | Errores de `confirmarCanjePromocion` > 3 en 10 min | Llamada |
| Pago roto | Cualquier error en `/api/pagos/*` | Llamada |

Los dos últimos son distintos del resto: no importa el volumen, importa que
tocan dinero.

### 5.3 · Sobre las métricas (requiere un recolector que lea `/api/metricas`)

| Alerta | Condición | Por qué |
|---|---|---|
| Pool saturándose | `membego_conexiones_saturacion > 0.75` durante 10 min | Es el `P2024` **antes** de que ocurra |
| Base lenta | `membego_bd_latencia_ms > 300` durante 10 min | Región lejana o pool cargado |
| Pagos colgados | `membego_pagos_sin_resolver > 5` | Clientes que pagaron y no recibieron nada |
| Índice inválido | `membego_indices_invalidos > 0` | Una migración `CONCURRENTLY` que se cortó |
| Caída de actividad | `membego_visitas_24h` < 40% de `membego_visitas_previas_24h` | Algo del flujo del cliente está roto y no da error |

La última es la más valiosa y la que casi nadie monta: detecta los fallos que
**no producen errores**. Un botón que dejó de funcionar tras un despliegue no
genera ninguna excepción; genera silencio.

### 5.4 · Alertas por tasa de quema del presupuesto

Cuando haya un mes de datos. El error clásico es alertar al llegar a cierto
porcentaje del presupuesto: eso avisa cuando ya se gastó, y por un incidente de
hace tres semanas. Se alerta de la **velocidad**, en dos ventanas a la vez —una
larga que confirma que el problema es real y una corta que confirma que sigue
pasando ahora—.

| Factor | Ventana larga | Ventana corta | Con el SLO de 99,5% | Severidad |
|---|---|---|---|---|
| 14,4× | 1 h | 5 min | 7,2% de fallos | Llamada |
| 6× | 6 h | 30 min | 3,0% | Llamada |
| 3× | 1 día | 2 h | 1,5% | Revisar |
| 1× | 3 días | 6 h | 0,5% | Revisar |

Los umbrales salen de `umbralDeAlerta()`, no de copiarlos a mano.

### 5.5 · De qué NO alertar

Tan importante como lo anterior. Una alerta que salta y no exige nada enseña a
ignorar todas las demás:

- **Un error suelto.** Sentry ya lo guarda; mirarlo mañana está bien.
- **Consultas lentas puntuales.** Interesa la tendencia, no el caso.
- **Picos de CPU o memoria** sin efecto sobre latencia ni errores.
- **`limite_alcanzado` del login.** Es el sistema defendiéndose: funcionando.
- **Cualquier cosa que no tenga una acción concreta al otro lado.** Si al
  recibirla no hay nada que hacer, no es una alerta: es un dato.

---

## 6. Trazas distribuidas

Sentry está configurado con `tracesSampleRate: 0.2` y `prismaIntegration`, lo
que da la traza de una petición de cada cinco, con sus consultas dentro.

Eso es lo que hay y es razonable para el tamaño actual. Lo que **falta** para
llamarlo "tracing distribuido completo" —el punto 25 del plan— es propagar el
contexto a los trabajos de QStash: hoy, cuando una notificación masiva falla, la
traza de la petición que la encoló y la del trabajo que la ejecutó son dos
trazas sin relación. No se hizo en esta fase; queda anotado.

### Lo que Sentry ya no recibe (Fase 6)

Los `beforeSend` anteriores borraban `Authorization` y `Cookie`. Faltaban tres
vías por las que los datos personales seguían llegando:

- **La URL.** `/?pase=<MANTENIMIENTO_PASE>`, `/confirmar?token=…`.
- **`event.user`**, que el SDK rellena con el correo.
- **Las migas de navegación**, que son URLs otra vez (antes solo se limpiaban
  las de `fetch`).

La política ahora está en un solo archivo
(`src/modules/observabilidad/sentryLimpieza.ts`) usado por servidor y navegador,
para que no se desincronicen a los seis meses. Se conserva el `id` del usuario
—sin él, "esto le pasa siempre al mismo" deja de poder decirse— y la ruta
entera; se va todo lo que hay después del `?`.

---

## 7. Configuración pendiente

Sin esto, la mitad de esta fase es código que nadie mira:

1. **`METRICAS_SECRET`** en Vercel (mínimo 16 caracteres, `openssl rand -base64 32`).
2. **Monitor de uptime** contra `/api/health` (§ 5.1). Gratis. Empieza por aquí.
3. **Alertas de Sentry** (§ 5.2).
4. **Recolector de métricas** si se quiere el § 5.3 automático. Mientras tanto,
   `/superadmin/observabilidad` sirve para mirarlo a mano.
5. **Derivar los logs de Vercel** a un recolector con retención y búsqueda si se
   quiere calcular los SLO sin trabajo manual.

---

## 8. Lo que sigue sin estar cubierto

1. **Nada de esto alerta solo todavía.** El código emite y expone; los avisos
   dependen de la § 7.
2. **Los SLO no están medidos.** Ni un mes de datos. Los números de la § 4 son
   una propuesta.
3. **El flujo de pago no está instrumentado con eventos.** Es el que más dinero
   mueve y el que menos se ve.
4. **Las trazas no cruzan la cola** (§ 6).
5. **Sin retención de logs propia**, calcular el consumo del presupuesto es un
   ejercicio manual sobre la consola de Vercel.
