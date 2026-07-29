# Recuperación ante desastres

Cierra el hallazgo **A-08** de `docs/AUDITORIA-PRODUCCION.md` (*Sin backups
verificados, sin plan de recuperación, sin runbook*) — Fase 5 del plan.

> **Lo primero, porque cambia cómo se lee todo lo demás:** este documento no
> dice que MembeGo esté a salvo. Dice qué hay que restaurar, en qué orden, con
> qué se cuenta y **qué sigue sin estar cubierto**. La parte que falta está
> señalada como tal en cada sección, no escondida al final.

---

## 1. Lo que no se puede afirmar desde aquí

El entorno donde se escribió esto no tiene acceso a la cuenta de Supabase. Por
tanto **no está verificado** y hay que comprobarlo en el panel:

| Pregunta | Por qué decide todo | Dónde se mira |
|---|---|---|
| ¿Qué plan de Supabase está contratado? | Free no tiene PITR y guarda respaldos diarios pocos días; Pro sí lo tiene. Es la diferencia entre perder un día y perder dos minutos | Supabase → Settings → Billing |
| ¿Está PITR activado? | Sin él, el respaldo más reciente puede tener 23 horas | Settings → Database → Backups |
| ¿Cuánto retienen los respaldos? | Un borrado que se descubre a los diez días no se puede deshacer si solo hay siete | Settings → Database → Backups |
| ¿Se ha restaurado alguno? | Hasta la primera restauración, "tenemos respaldos" es una creencia | Bitácora, § 7 |

Hasta que se rellenen esas cuatro casillas, **el RPO real de MembeGo es
desconocido**. No "24 horas": desconocido, que es peor, porque no se puede
planificar.

---

## 2. Qué hay que restaurar (son cuatro cosas, no una)

El error que hace fracasar las recuperaciones no es no tener respaldo: es
tener respaldo **de una sola de estas cuatro piezas** y descubrir el resto a
mitad del incidente.

| # | Sistema | Qué contiene | ¿Lo cubre un volcado de `public`? |
|---|---|---|---|
| 1 | **Postgres · esquema `public`** | Todo lo de la aplicación: empresas, clientes, membresías, visitas, transacciones, caja | ✅ Sí |
| 2 | **Postgres · esquema `auth`** | Las credenciales de Supabase Auth | ❌ **No** |
| 3 | **Supabase Storage** | Los archivos: comprobantes de pago, fotos antes/después, logos, avatares | ❌ **No** |
| 4 | **Configuración y secretos** | Variables de entorno, claves de CardNET, ajustes de Auth, secretos de CI | ❌ **No** |

### 2.1 · Por qué el esquema `auth` es el que más duele

`User.supabaseId` (`prisma/schema/identidad.prisma`) apunta a `auth.users`, un
esquema que **Prisma no gestiona**: no aparece en `prisma/schema/`, no lo tocan
las migraciones y no entra en un volcado que solo pida `public`.

El resultado de restaurar sin él es particularmente cruel: la aplicación se ve
perfecta. Están las 100.000 fichas de cliente, el historial de lavados, los
saldos, las membresías. Y **nadie puede iniciar sesión**, porque no hay una
sola contraseña. No es una recuperación a medias: es un inventario.

Por eso `scripts/verificar-respaldo.mjs` comprueba `auth.users` explícitamente
y falla si no está.

### 2.2 · Storage: la base guarda el índice, no los archivos

Los cuatro buckets (`avatars`, `logos`, `comprobantes`, `evidencias`) tienen su
**metadatos** en `storage.objects` — eso sí viaja en el volcado — pero los
bytes viven en el almacenamiento de objetos de Supabase. Restaurar la base
devuelve una lista de archivos que ya no existen: cada comprobante de pago del
historial pasa a ser un enlace roto.

Duele distinto según el bucket: `avatars` y `logos` son cosméticos y se pueden
volver a subir. `comprobantes` es el rastro de los pagos por transferencia — el
respaldo de una disputa con un cliente. `evidencias` son las fotos antes/después,
que existen precisamente para cuando alguien reclama un daño en su vehículo.
Perderlos no rompe la aplicación; deja al negocio sin pruebas.

**Hoy no hay respaldo de Storage.** No está resuelto en esta fase y es la
carencia mayor que queda abierta (§ 8).

### 2.3 · Los secretos no están en ningún respaldo, por diseño

Restaurar la base no devuelve `CARDNET_AUTH_KEY`, ni las claves de firma de
QStash, ni `SUPABASE_SERVICE_ROLE_KEY`. Si se pierde el acceso al panel de
Vercel al mismo tiempo que la base, la aplicación restaurada no arranca.

La lista completa de variables está en `.env.example` (nombres, nunca valores).
Los valores tienen que existir **fuera de Vercel**, en un gestor de contraseñas
con acceso de más de una persona. Eso es una tarea del dueño, no del código.

---

## 3. RPO y RTO

- **RPO** (*Recovery Point Objective*): cuántos datos se acepta perder.
- **RTO** (*Recovery Time Objective*): cuánto se acepta estar caído.

Elegirlos es una decisión **de negocio**, no técnica: cuestan dinero. Lo que
sigue es una **propuesta** basada en cómo opera MembeGo y CARTOWN; hay que
confirmarla o cambiarla, y la fecha en que se confirme va en § 7.

| Escenario | RPO propuesto | RTO propuesto | Qué hace falta para cumplirlo | ¿Se cumple hoy? |
|---|---|---|---|---|
| Borrado accidental de filas (un `delete` sin `where`) | 5 min | 1 h | PITR | **No** — sin PITR se pierde hasta el último respaldo diario |
| Migración que corrompe datos | 5 min | 2 h | PITR + runbook | **No** |
| Caída del proyecto Supabase (región, incidente del proveedor) | 1 h | 4 h | Copia fuera de Supabase | **No** |
| Pérdida total de la cuenta (baja, suspensión, factura impagada) | 24 h | 24 h | Copia fuera de Supabase + secretos fuera de Vercel | **No** |
| Fuga de credenciales | 0 | 1 h | Runbook de rotación | Parcial — el runbook existe (`docs/runbooks/credencial-filtrada.md`), la rotación no se ha ensayado |

**Por qué esos números y no otros.** El caso peor de MembeGo no es una hora de
caída: es un sábado por la mañana con la pista llena. Un RTO de 4 horas un
sábado son unos 40-60 lavados que se cobran a mano en papel y se cargan
después — molesto, recuperable. Un RPO de 24 horas ese mismo sábado significa
que esos 60 lavados, sus pagos y sus canjes **nunca existieron**, y no hay
papel del que copiarlos. Por eso el RPO es el que se aprieta primero: la
diferencia de coste entre el plan Free y PITR es órdenes de magnitud menor que
un día de operación perdido.

### 3.1 · Activar PITR

En Supabase → Settings → Database → Backups → *Point in Time Recovery*.
Requiere plan Pro o superior y se cobra aparte según retención (7 / 14 / 28
días). Es la única línea de este documento que convierte varios "No" de la
tabla en "Sí", y la que hay que hacer primero.

Con PITR, restaurar es elegir un instante — literalmente "las 14:03:20 de
ayer" — en vez de aceptar la foto de las 2 de la mañana.

---

## 4. Cómo se restaura (el orden importa)

Este es el procedimiento marco. Cada escenario concreto tiene su runbook en
`docs/runbooks/`.

### Paso 0 · Cerrar la aplicación

```
MODO_MANTENIMIENTO=true   en Vercel → Settings → Environment Variables
```

Y redesplegar (o esperar a que la variable se propague). Ver
`docs/runbooks/modo-mantenimiento.md`.

**Esto no es opcional y no es cortesía con el usuario.** Restaurar mientras la
aplicación acepta escrituras produce una mezcla: encima del estado de las 14:00
se van escribiendo visitas y pagos de las 14:05, y después nadie puede separar
qué fila vino de dónde. Un cliente canjea dos veces el mismo beneficio; una
transacción existe sin su sesión de caja. Eso no se arregla con otra
restauración.

### Paso 1 · Escribir qué pasó, antes de tocar nada

Hora, síntoma, qué se hizo justo antes. Treinta segundos. Durante el incidente
parece tiempo perdido y a las tres horas es lo único que explica por qué el
sistema estaba como estaba.

### Paso 2 · Restaurar

Según el escenario, el runbook correspondiente. Si es PITR, elegir el instante
**anterior** al problema, no el instante del problema.

### Paso 3 · Poner el esquema al día

La copia restaurada puede tener menos migraciones que el código desplegado.

```bash
DATABASE_URL="<DIRECT_URL>" npx prisma migrate deploy
npm run db:doctor
```

Sin esto la aplicación arranca y falla en silencio: por la tolerancia
*fail-open* del código, los módulos cuya columna falta aparecen **vacíos** en
vez de dar error. Ya pasó con `companies.capacidades`.

### Paso 4 · Verificar antes de abrir

Con la aplicación todavía cerrada, entrar con el pase de mantenimiento
(`/?pase=…`) y comprobar a mano:

- [ ] Iniciar sesión con una cuenta real — si esto falla, el esquema `auth` no
      se restauró (§ 2.1) y **no hay que abrir**.
- [ ] El panel de una empresa carga con sus clientes.
- [ ] Escanear un QR de prueba y canjear.
- [ ] Abrir y cerrar una sesión de caja.
- [ ] Un comprobante del historial se ve (si no, es el Storage, § 2.2).
- [ ] `/api/health` con el header `x-health-secret` no reporta `schema DRIFT`.

### Paso 5 · Reconciliar lo que se perdió

Mientras el mantenimiento estuvo encendido:

- **QStash reintentó** los trabajos rechazados con espera creciente; las
  notificaciones salen solas al reabrir.
- **CardNET no reintenta.** Los avisos de pago recibidos durante la ventana se
  perdieron. Hay que conciliar contra la tabla `pago_intentos`, que existe
  justo para esto. Ver `docs/runbooks/pagos-cardnet.md`.
- **Los lavados cobrados a mano** hay que cargarlos en caja.

### Paso 6 · Abrir

`MODO_MANTENIMIENTO=false`. Y anotar el resultado en la bitácora (§ 7) — sobre
todo si algo salió mal, que es cuando menos ganas dan de escribirlo.

---

## 5. El simulacro automático

`.github/workflows/respaldo-verificacion.yml` corre cada lunes a las 08:00 de
Santo Domingo y ejecuta `scripts/verificar-respaldo.mjs`: vuelca producción,
la restaura en un PostgreSQL desechable y comprueba lo que quedó dentro.

También se puede lanzar a mano desde Actions → *Simulacro de restauración* →
*Run workflow*, o en local:

```bash
RESPALDO_ORIGEN="<DIRECT_URL de producción>" \
RESPALDO_DESTINO="<base vacía y desechable>" \
npm run respaldo:verificar
```

### Qué prueba

- Que el volcado se crea y se restaura.
- Que las tablas críticas existen y tienen filas.
- Que **`auth.users` viajó** y no hay usuarios huérfanos (§ 2.1).
- Que las migraciones de la copia coinciden con las del repositorio.
- El **RPO medido**: cuántos minutos hay entre el dato más reciente de la copia
  y ahora. Ese número, y no el que promete el plan contratado, es el que vale.

### Qué NO prueba

- **Storage.** No mira los archivos (§ 2.2).
- **Que la aplicación funcione** sobre la copia. Verifica datos, no arranque.
  Eso sigue siendo el paso 4, a mano.
- **El RTO completo.** Mide lo que tarda la restauración de la base. No incluye
  el despliegue, la verificación manual ni el tiempo de darse cuenta —que en la
  práctica suele ser el más largo de los tres.
- **El respaldo de Supabase.** Vuelca la base **en vivo**; no restaura el
  respaldo que hace Supabase. Prueba que los datos son restaurables y que la
  copia está completa, no que el mecanismo de respaldo del proveedor funcione.
  Para eso hace falta restaurar un respaldo real de Supabase a mano, al menos
  una vez (§ 8).

El volcado contiene datos personales de clientes reales y **no se guarda**: ni
como artefacto de Actions ni en disco. El razonamiento completo está en la
cabecera del flujo.

---

## 6. Guardia: qué es cierto aquí

Un plan de guardia con rotación, escalado en tres niveles y turnos de fin de
semana sería, en MembeGo hoy, un documento bonito y falso. **Hay una persona.**
Escribirlo de otra forma no crea la segunda.

Lo que sí se puede sostener con una persona, y es lo que hay que montar:

1. **Que el sistema avise antes que el cliente.** Un monitor de uptime externo
   (UptimeRobot, Better Stack; ambos con plan gratuito suficiente) apuntando a
   `https://<dominio>/api/health` cada 5 minutos, con aviso por WhatsApp o
   llamada. Ese endpoint devuelve `degraded` si la base no responde, y está
   exento del modo mantenimiento precisamente para que un mantenimiento
   planificado no dispare las mismas alertas que una caída real.
2. **Que exista un segundo par de manos con acceso.** No para responder
   incidentes: para el escenario en que la única persona con acceso está
   ilocalizable. Como mínimo, las credenciales del gestor de contraseñas en
   poder de alguien de confianza y por escrito qué hacer con ellas.
3. **Que los runbooks estén escritos.** Están en `docs/runbooks/`. Sirven tanto
   para otra persona como para uno mismo a las 3 de la mañana, que a efectos
   prácticos es otra persona.

Lo que **no** se cumple hoy y hay que saberlo: si el incidente ocurre mientras
el dueño duerme o viaja, el RTO real es "cuando despierte o aterrice". Ninguna
tecnología arregla eso; solo una segunda persona.

---

## 7. Bitácora de simulacros

Una fila por cada restauración real o de prueba. Si esta tabla se queda vacía,
este documento es literatura.

| Fecha | Tipo | Quién | Duración | Resultado | Qué se aprendió |
|---|---|---|---|---|---|
| — | — | — | — | **Nunca se ha restaurado un respaldo de producción** | — |

**Primer simulacro pendiente.** Consiste en restaurar a mano un respaldo real
de Supabase (no el volcado en vivo que hace el flujo semanal) sobre un proyecto
nuevo, y recorrer el paso 4 completo. Es la única forma de convertir la última
fila de esta tabla en un dato.

Casillas del § 1 pendientes de rellenar tras revisar el panel:

- [ ] Plan de Supabase contratado: ______
- [ ] PITR activado: sí / no
- [ ] Retención de respaldos: ____ días
- [ ] RPO/RTO de la § 3 aceptados o corregidos, con fecha: ______

---

## 8. Lo que sigue sin estar cubierto

Sin adornos:

1. **Respaldo de Supabase Storage.** No existe. Los comprobantes de pago y las
   fotos de evidencia no se pueden recuperar si se pierde el bucket. Es la
   carencia mayor de esta fase. La solución razonable es un trabajo periódico
   que liste los objetos y los copie a otro proveedor; no se hizo aquí porque
   requiere decidir dónde se guardan y quién paga por ello, y porque copiar
   datos personales a un segundo sitio es una decisión del dueño, no del
   código.
2. **Copia fuera de Supabase.** Todo depende hoy de un solo proveedor. Si la
   cuenta desaparece —suspensión, error de facturación, incidente grave— no hay
   de dónde partir. El flujo semanal genera un volcado válido, pero lo borra a
   propósito (no se pueden dejar datos personales en artefactos de CI).
3. **Restaurar un respaldo real de Supabase.** El simulacro prueba que los
   datos son restaurables; no prueba el mecanismo del proveedor. Falta hacerlo
   una vez a mano.
4. **PITR.** Depende del plan contratado (§ 3.1).
5. **Segunda persona con acceso** (§ 6).

Los cinco están fuera del alcance del código: son decisiones de gasto y de
confianza. Este documento existe para que sean decisiones **conscientes** en
vez de descubrimientos.
