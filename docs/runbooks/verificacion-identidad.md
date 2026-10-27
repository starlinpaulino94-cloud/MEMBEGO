# Runbook · Verificación de identidad (manual de operación)

**Para quién:** quien atiende la verificación de identidad en Membego (hoy, solo `SUPERADMIN`). **Cuándo se abre:** a diario (rutina),
cuando una persona escribe a soporte porque no puede verificarse, cuando el panel marca algo en ámbar, o cuando el proveedor (Didit) falla.

**Dos ideas que lo ordenan todo:**

1. **La verificación es opcional y nunca bloquea una compra.** Comprar, reservar, renovar o entrar con el QR no pasan por aquí. La única
   operación que puede pedir identidad es **confirmar un pago a un proveedor de Supply**, y solo si el equipo encendió esa regla (apagada
   de serie). Apagar la verificación **nunca** frena un pago ni una compra.
2. **Membego no guarda documentos ni fotos.** El proveedor los procesa y se borran al concluir; Membego guarda solo el resultado
   (nivel, fechas, un código de motivo propio, una referencia cifrada a la sesión y un código que detecta el mismo documento en dos cuentas).
   **Nadie del equipo puede ver una imagen desde Membego**: la evidencia de un caso se mira en la consola de Didit, y la persona es la única
   que puede verificarse (el equipo no puede aprobar a nadie).

Todo se hace desde **`/superadmin/identidad`**, con las pestañas **Resumen · Casos en revisión · Incidencias · Buscar a una persona · Reglas ·
Auditoría**. Cada vez que abres el caso de una persona te pide un motivo y queda registrado con tu nombre; cada acción también.

---

## 1 · Rutina (diaria la primera semana, luego semanal)

Abre **Resumen**. Esto es lo que mira cada contador y qué hacer:

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| **Estado de la verificación: Apagada** | Nadie puede empezar una verificación (lo que está en curso se sigue resolviendo) | Si no es a propósito, ver §2.1 |
| **Falta configurar: …** | Falta una variable de entorno; no se puede encender | Ver `LISTA-DE-DESPLIEGUE.md` §D |
| **Casos en revisión** (con «el más viejo») | Personas esperando a que alguien mire su caso | §2.2. No dejes pasar más de 2 días hábiles |
| **Incidencias abiertas** (con «la más vieja») | Personas que contaron un problema | §2.3 |
| **Borrados pendientes en el proveedor** | Intentos ya cerrados cuya sesión (con documentos) **sigue en Didit**: el borrado automático no pudo | §3.3. Debería ser 0 |
| **Avisos del proveedor sin procesar** | Avisos de Didit que no se pudieron procesar | §3.2. Debería ser 0 |
| **Borrados pedidos por las personas sin completar** | Solicitudes de borrado de datos aún abiertas. **El plazo legal es de 10 días hábiles**; a los 7 días se marca | §2.5. Nunca más de 7 días |
| **Sin dato** en un contador | Esa consulta falló; **no es un cero** | Recarga; si persiste, mira el log (`identidad:resumen`) |

El **cron diario** (`/api/cron/identidad`, 08:00 UTC) hace el mantenimiento solo: marca como vencidas las verificaciones que pasaron su fecha,
da por abandonados los intentos sin avance en 24 h (libera a la persona para volver a empezar), avisa 30 días antes de que toque revalidar,
reintenta los avisos pendientes y **reconcilia con el proveedor** los intentos que llevan rato sin novedad.

---

## 2 · Procedimientos

### 2.1 Encender o apagar la verificación

*Resumen → «Encender / Apagar la verificación»*, con un **motivo** obligatorio (queda en la bitácora).

- **Encender** exige el entorno completo. **No se enciende con documentos reales** hasta tener el dictamen legal y el contrato con el
  proveedor (ver `docs/identidad/LISTA-DE-DESPLIEGUE.md`).
- **Apagar** es la salida de emergencia: inmediata, no pierde datos, no frena compras ni pagos. Las reglas que estén encendidas pasan a
  «en pausa» (no frenan nada) hasta que se vuelva a encender.

### 2.2 Un caso en revisión

*Casos en revisión.* Hay dos orígenes (la columna **Por qué espera**): el proveedor lo dejó en revisión («In Review»), o **el mismo documento
apareció en dos cuentas**.

1. Pulsa el caso y elige el motivo de la consulta («Revisar un caso»).
2. **La evidencia no está en Membego.** Copia la **Referencia del intento** (columna de la lista) y búscala en la consola de Didit por
   `vendor_data`. Ahí ves el documento y la selfie.
3. Decide:
   - **Es válido:** **apruébalo en la consola de Didit**. El resultado vuelve solo (aviso firmado, o la reconciliación del cron) y la persona queda
     verificada. En Membego **no hay botón de aprobar**, a propósito.
   - **No es válido o es fraude:** **Rechazar** (con motivo). Es definitivo; la persona recibe un mensaje neutro («No pudimos verificar tu
     identidad. Contacta a soporte»), nunca el motivo real.
   - **Hay que repetirlo** (mala luz, una foto torcida): **Pedir que repita**. No cuenta como rechazo y se le avisa.
4. Al resolver, Membego **borra la sesión en el proveedor** (los documentos) y deja el asiento.

> **Un documento repetido no se le dice a la persona.** Si dos cuentas presentan la misma cédula, la segunda queda «en revisión» y solo ve
> «estamos revisando tu verificación». Nunca se confirma que ese documento ya tiene cuenta.

### 2.3 Una incidencia

*Incidencias.* La persona cuenta un problema desde su pantalla de verificación (tipo + mensaje).

1. **Tomar** (pasa a «en proceso» y queda tu nombre) o abrir su ficha.
2. **Resolver** con una **respuesta** (obligatoria, hasta 500 caracteres): la persona la recibe en su campana y por push. La respuesta la escribes
   tú: no incluyas datos que no quieras que lea, ni el motivo de un rechazo por fraude.
3. Si la causa es que está bloqueada, sigue en §2.4.

### 2.4 Una persona bloqueada («contacta a soporte»)

El sistema deja de dejarla volver a intentarlo sola en dos casos: **rechazo definitivo** (fraude, documento alterado, menor de edad, documento
repetido) y **tres rechazos reintentables en una semana**. Tras un rechazo reintentable normal solo hay una espera de 5 minutos.

1. **Buscar a una persona** (mínimo 3 letras del nombre o correo) → abre su caso (motivo «Soporte a la persona»).
2. Mira el historial de intentos y las incidencias. **Antes de reabrir, asegúrate** (por el canal que uses con la persona) de que es quien dice ser y de
   que lo que falló tiene arreglo.
3. **Reabrir la verificación** (con motivo, queda con tu nombre). Esto **no la verifica**: le abre un intento nuevo y le llega un aviso. Tiene que
   hacerlo ella, pasando de nuevo por el proveedor.
4. Si no te deja: ya está verificada (no hace falta), ya tiene un intento abierto (lo retoma desde su pantalla), **no ha dado sus permisos** (los da
   ella en su pantalla; el equipo no puede darlos por ella) o la verificación está apagada.

### 2.5 Una solicitud de borrado (derecho de supresión)

La persona puede pedirlo desde su pantalla («Borrar mis datos de verificación»), al eliminar su cuenta, o escribiendo a soporte. **Plazo legal: 10 días
hábiles** desde la solicitud (Ley 172-13, art. 8).

1. Si lo pidió por soporte: abre su caso → **Borrar sus datos de verificación** (con el motivo, p. ej. el número del ticket y marcar «entiendo que
   es definitivo»).
2. **El orden es siempre el mismo:** primero se borra en el proveedor (cada sesión, con borrado de plantillas biométricas), y **solo si Didit lo confirma**
   se borra en Membego (resultado, referencias, códigos de motivo). Se conservan únicamente el registro de lo que la persona aceptó (es la prueba de su
   consentimiento) y los intentos sin ningún dato (estado y fechas).
3. **Si Didit no confirma**, no se borra nada local y la solicitud queda abierta: repite la acción más tarde (es segura de repetir). El Resumen la
   marca a los 7 días. Eliminar la **cuenta** completa se bloquea con un mensaje claro mientras el proveedor no confirme.

### 2.6 Retirar una verificación o pedir que se repita

En el caso de una persona verificada: **Retirar la verificación** (con motivo; deja de valer y deja de verse en las fichas de los negocios) o **Pedir que
se verifique de nuevo** (eligiendo por qué: fraude, cambio de nombre, documento vencido, solicitud de la persona…). En ambos casos puede volver a verificarse.
Una verificación vale **36 meses**; pasado ese plazo vence sola (y 30 días antes se le avisa).

### 2.7 La regla de pago a proveedores

*Reglas.* **Apagada de serie. No se enciende antes de la respuesta del abogado** (ver la lista de despliegue).

- Encendida, **al confirmar un pago a un proveedor de Supply** se exige que la persona que aceptó el contrato del proveedor esté verificada con
  documento: solo antes del **primer pago**, o en **todos** (si la verificación vence o se retira, los pagos se detienen).
- El panel cuenta cuántos proveedores activos tienen el representante verificado, sin verificar o sin nadie que haya aceptado el contrato: **avisa a esos
  proveedores antes de encender** (la persona se verifica desde Configuración del portal del proveedor → «aquí»).
- **Un pago frenado** muestra a quién pedírselo (nombre y correo). El pago queda **pendiente**: no sale dinero. En cuanto la persona se verifica, se puede
  confirmar. **Si hay que pagar ya:** apaga la regla (Reglas → Apagar, con motivo) y confirma el pago; vuelve a encenderla después.

---

## 3 · Cuando algo falla

### 3.1 El proveedor (Didit) está caído

**Qué ve la persona:** «Inténtalo en un momento» (y cuándo reintentar); su intento queda para retomarlo. **Qué hace el sistema:** tras 5 fallos seguidos
deja de llamarle durante 30 segundos (responde al instante) y vuelve a probar con una petición; nada más se ve afectado.
**Qué hacer:** normalmente nada: pasa solo. Si dura horas, avisa a quien lo pida y, si quieres evitar mensajes de error, **apaga la verificación** (§2.1).
Cuando vuelva, el cron reconcilia lo pendiente. **Nunca** se bloquea una compra por esto.

### 3.2 Los avisos del proveedor no llegan o se atrasan

Síntoma: personas que ya hicieron su verificación y siguen en «en proceso»; el contador «Avisos del proveedor sin procesar» sube.

1. La pantalla de la persona **pregunta sola al proveedor** cada vez que la abre (máximo una vez cada 15 s), y el cron lo hace a diario: casi nunca
   hace falta intervenir.
2. En la consola de Didit, comprueba el **destino del webhook** (`https://<dominio>/api/webhooks/identidad/didit`, evento `status.updated`) y usa
   **Try Webhook**: un 200 confirma firma, frescura y bandeja. Un 401 es un secreto equivocado (§3.5); un 404 es que `DIDIT_WEBHOOK_SECRET` no está
   configurado.
3. Los avisos fallidos se reintentan con el cron; si el contador no baja, mira el log (`identidad:procesar-evento`).

### 3.3 «Borrados pendientes en el proveedor» no baja de cero

Son sesiones de intentos ya cerrados cuyos documentos **siguen en Didit** porque el borrado falló. El cron reintenta cada día. Si persiste: ¿está caído
Didit (§3.1)?, ¿la `DIDIT_API_KEY` es válida?, ¿se perdió `IDENTIDAD_CLAVES_MAESTRAS` (sin ella Membego no puede abrir la referencia de la sesión y no sabe qué
borrar)? Mientras no se borren, **rige la retención del propio proveedor**: avísalo en el análisis de riesgos.

### 3.4 Una persona dice «no me deja verificarme»

En su caso, mira el motivo (la pantalla de la persona lo dice con sus palabras):

| Motivo | Qué pasa | Qué hacer |
|---|---|---|
| Espera tras un rechazo | Debe esperar 5 minutos | Nada: se le dice a qué hora puede |
| Demasiados rechazos | 3 en una semana | §2.4 (reabrir) |
| Rechazo definitivo | Fraude, documento alterado, menor de edad, documento repetido | §2.4, con mucho cuidado |
| Falta un permiso | No marcó biometría y/o transferencia a la UE | Que los marque ella en su pantalla |
| Intento abierto | Ya empezó una verificación | Que la retome desde su pantalla (se abre sola al volver) |
| Ya verificada | Está vigente | Nada |
| «No está disponible» | La verificación está apagada | §2.1 |

### 3.5 Rotar secretos

- **Secreto del webhook** (`DIDIT_WEBHOOK_SECRET`): pasa el actual a `DIDIT_WEBHOOK_SECRET_ANTERIOR`, pon el nuevo en `DIDIT_WEBHOOK_SECRET`, cambia el secreto en la
  consola de Didit, y cuando ya no lleguen avisos firmados con el viejo, vacía `_ANTERIOR`. Mientras conviven, valen los dos.
- **Claves maestras** (`IDENTIDAD_CLAVES_MAESTRAS`, formato `1:<base64>,2:<base64>`): para rotar, **añade** una versión nueva (`2:…`) sin quitar la anterior: se
  sella con la más alta y se sigue leyendo con las demás. **No quites una versión vieja mientras existan referencias selladas con ella**: hoy no hay
  herramienta para volver a sellar, así que perderla deja esas sesiones sin poder borrarse. Guarda una copia de las claves **fuera del sistema**.
- **Pepper** (`IDENTIDAD_PEPPER_DEDUPE`): **no se rota** salvo emergencia. Cambiarlo invalida la detección del mismo documento en dos cuentas para
  todas las verificaciones ya hechas.
- **API key de Didit** (`DIDIT_API_KEY`): se cambia en la consola y en la variable; no hay que migrar nada.

### 3.6 Una clave o secreto se expuso

Sigue `docs/runbooks/credencial-filtrada.md` y, además: **apaga la verificación** (§2.1); rota la clave expuesta (§3.5; si fue la API key o el secreto del
webhook, hazlo en la consola de Didit); revisa en Didit si hay sesiones o llamadas que no reconozcas; y, si fueron las claves maestras o el pepper, avisa
al dueño del producto: puede ser un incidente de datos personales (notificación a los afectados y a la autoridad) y requiere al abogado.

---

## 4 · Lo que no se hace

- **No** pedir ni aceptar una cédula, una selfie ni un documento por WhatsApp, correo o ticket «para adelantar»: el único canal es el proveedor.
- **No** decirle a una persona por qué se rechazó si fue una señal de fraude, ni que su documento ya tiene otra cuenta.
- **No** escribir en la base de datos a mano para «verificar» a alguien. El único camino a «verificada» es el proveedor, vía el aviso firmado o la
  reconciliación; hay una prueba que impide cualquier otro.
- **No** reabrir una verificación sin haber revisado el caso, ni dar acceso al panel a alguien que no sea `SUPERADMIN`.
- **No** compartir las claves de identidad con otros sistemas (las de los conectores son otras, a propósito).

## 5 · Dónde mirar

- Bitácora de identidad: `/superadmin/identidad?vista=auditoria` (cada consulta, cambio de regla, interruptor, resolución, borrado y reapertura).
- Log del servidor: líneas con contexto `identidad:*` (`crear-sesion`, `procesar-evento`, `purgar-sesion`, `reconciliar`, `suprimir-en-proveedor`, `aviso-*`…).
- Diseño y límites: `docs/identidad/` (la auditoría y las notas de cada fase), y la validación final en `FASE-7-VALIDACION-FINAL.md`.
