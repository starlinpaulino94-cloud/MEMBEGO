# SSO endurecido y acceso por usuario

Fase 5 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/sdk.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §13, §50.

---

## Lo que el SSO no tenía

| Hoy | Ahora |
|---|---|
| El token vale **las veces que quieras** durante sus 90 s | Un solo uso: `jti` + registro del canje |
| Sin `returnUrl` | `returnUrl` validada contra la `urlBase` y **dentro de la firma** |
| Solo el rol de MembeGo | `systemRole`: el puesto **dentro del vertical** |
| Entra todo el equipo | `UsuarioSistema`, opcional por sistema |
| La cabecera ofrece **un** sistema | Ofrece **todos** los accesibles |

Todo lo nuevo es opcional en el payload. **Un satélite que no lo mire funciona
exactamente igual que antes** — que es lo que permite desplegar esto sin
coordinar una fecha con nadie.

---

## Uso único

Un token SSO viaja en una URL. Esa URL acaba en el historial del navegador, en
un `Referer` y en el log de cualquier proxy por el que pase. Mientras el token
valga más de una vez, quien la capture entra.

### Por qué hacía falta un endpoint

Un satélite puede verificar el token por su cuenta con el secreto compartido —el
camino de siempre, y sigue funcionando—. Pero así **MembeGo no se entera de esa
verificación**, y por tanto no puede impedir la segunda.

```
POST /api/platform/v1/sso/redeem     { "token": "..." }
```

El `jti` se registra en MembeGo: el primero gana, el segundo recibe
`409 SSO_TOKEN_ALREADY_USED`.

El camino antiguo no se rompe ni se avisa con un plazo. Lo que cambia es que
**el que migra gana algo**, en vez de tener que cambiar para seguir igual.

### El registro es un INSERT

El `jti` es la **clave primaria**. El segundo canje choca contra ella.

No hay lectura previa, y por tanto no hay ventana entre comprobar y marcar — que
es justo donde dos peticiones simultáneas conseguirían abrir sesión las dos.
Está comprobado contra una base real: dos canjes en paralelo, uno gana.

### Se verifica con el secreto de quien llama

El token se comprueba con el secreto del sistema **autenticado**, no con el del
sistema que aparezca en el token. Un sistema no puede canjear un token emitido
para otro: no verificaría, porque no es su firma.

Y la empresa se vuelve a contrastar con las habilitaciones. El token la lleva
firmada por nosotros, así que no pudo manipularse — pero la habilitación pudo
revocarse en los 90 segundos que lleva vivo.

### Los dos sentidos

`/sso/entrar` (satélite → MembeGo) también registra el `jti` cuando viene. Si un
satélite aún no lo manda, **entra igual y queda el aviso en el log**: rechazarlo
rompería a quien ya funciona por no haber desplegado algo que acabamos de
publicar.

---

## `returnUrl`

```
GET /api/integraciones/abrir/restaurant?returnUrl=https://r.test/mesas/4
```

Sin validar, `?returnUrl=https://sitio-malo/` haría que el usuario pulse un
enlace de MembeGo, MembeGo lo autentique, y lo mande a donde diga el atacante —
con nuestra credibilidad detrás y un token válido en la URL.

Se compara **origen**, no prefijo de cadena:

```
base:   https://carwash.membego.com
malo:   https://carwash.membego.com.evil.io/     ← empieza igual, no es lo mismo
```

Validar redirecciones con `startsWith` es el fallo clásico, y hay una prueba
para cada variante. También se rechaza bajar de `https` a `http`: es una
degradación silenciosa, con el token en una URL sin cifrar.

**Va dentro de la firma**, no en la query del satélite. Suelta, cualquiera podría
cambiarla después de que MembeGo la validara.

Una `returnUrl` manipulada **se descarta en silencio** y la apertura continúa: lo
que el usuario quería era entrar, y negarle la entrada castiga a la víctima en
vez de al que manipuló el parámetro.

---

## El puesto dentro del vertical

```
UsuarioSistema
  userId · companyId · sistemaId
  systemRole   ← MESERO, COCINA, LAVADOR
  estado · permisos
```

La Fase 1b contestó «¿tiene esta **empresa** este sistema?». Faltaba «¿y esta
**persona**, con qué puesto?».

> **`systemRole` es una cadena libre, y el Core no la interpreta jamás.**

Un enum obligaría a desplegar MembeGo cada vez que un vertical inventara un
puesto — la dependencia que esta arquitectura existe para eliminar (§50). Hay una
prueba que recorre el código del SSO y falla si aparece `MESERO`, `COCINA` o
`LAVADOR` fuera de un comentario.

En el token viajan **los dos roles, por separado**:

```jsonc
{ "rol": "EMPLEADO",        // MembeGo
  "systemRole": "MESERO" }  // tu vertical
```

Mezclarlos haría que el satélite tuviera que adivinar cuál está mirando, y que un
cambio de rol en MembeGo moviera permisos dentro del vertical.

### `accesoPorUsuario`

| | Sin fila | Con fila `ACTIVE` | Con fila `SUSPENDED` |
|---|---|---|---|
| `false` (por defecto) | **entra** | entra con su puesto | **no entra** |
| `true` | no entra | entra con su puesto | no entra |

`false` por defecto por el mismo motivo que `autoHabilitar` en la Fase 1b:
exigir de golpe una fila por persona dejaría a toda la plantilla de Car Wash
fuera el día del despliegue.

**Una suspensión cierra la puerta siempre**, también en modo abierto. Es la misma
regla de la Fase 1b: lo explícito gana a la política. Al revés, suspender a
alguien no haría nada y el panel diría «suspendido» con la puerta abierta.

Suspender aquí no toca la cuenta de MembeGo: un camarero de baja deja de entrar
al sistema del restaurante y sigue pudiendo ver su nómina.

---

## App Launcher

La cabecera ofrece **todos** los sistemas que la empresa tiene habilitados y a
los que este usuario tiene acceso — no el primero.

Devolver uno solo era la limitación que obligaba a elegir por el usuario, y con
dos sistemas habilitados, elegir por él es esconderle uno.

---

## Uso desde el SDK

```ts
// El satélite recibe /sso/membego?token=...
const sesion = await membego.redeemSso(token)

sesion.systemRole   // 'MESERO' — tuyo, MembeGo solo lo transportó
sesion.membegoRole  // 'EMPLEADO' — el de MembeGo
sesion.returnUrl    // ya validada contra tu urlBase
```

Un segundo canje del mismo token devuelve `MembegoError` con
`code: 'SSO_TOKEN_ALREADY_USED'`. Si te llega, o hay un reintento tuyo —que no
hace falta, la primera respuesta era válida— o alguien capturó la URL.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **Un dominio que empieza igual no es el mismo dominio** | El redirector abierto por `startsWith` |
| Bajar de https a http se descarta | El token viajando sin cifrar |
| Los campos nuevos van dentro de la firma | Cambiar el rol o el destino desde la query |
| Manipular el rol invalida el token | Escalar dentro del satélite |
| Un token sin los campos nuevos sigue valiendo | Romper Car Wash |
| **El canje es un INSERT, no leer-y-escribir** | La ventana en la que dos entran |
| El `jti` es clave primaria en la migración | Que el uso único desaparezca sin que nada falle |
| Los dos sentidos registran el canje | Una garantía a medias |
| Un token sin `jti` se avisa, no se rechaza | Romper a quien aún no desplegó |
| El canje verifica con el secreto de quien llama | Que el token elija con qué se comprueba |
| El canje revalida la habilitación | Entrar con una habilitación revocada hace 80 s |
| **El Core no enumera los roles de ningún vertical** | Desplegar MembeGo por un puesto nuevo |
| Los dos roles viajan separados | Que un cambio en MembeGo mueva permisos del vertical |
| El acceso por usuario nace desactivado | Dejar a la plantilla fuera el día del despliegue |
| Una suspensión gana al modo abierto | «Suspendido» en el panel con la puerta abierta |
| El lanzador filtra por acceso, no solo por empresa | Ofrecer lo que no se puede abrir |

Verificado además contra PostgreSQL real, 11 comprobaciones: el canje devuelve el
rol del vertical; **el mismo token una segunda vez da 409**; **dos canjes
simultáneos y solo uno gana**; un token firmado con otro secreto da 401; uno sin
`jti` se canjea; el modo abierto deja entrar sin fila y el estricto no; una fila
`ACTIVE` trae su puesto; **un suspendido no entra aunque el sistema sea abierto**;
y el lanzador esconde el sistema del que está suspendido.

---

## Despliegue

Migración `20260806_sso_acceso_por_usuario`. Aditiva e idempotente; sin
variables de entorno nuevas.

`accesoPorUsuario` nace en `false` en todos los sistemas, así que **ningún
empleado pierde el acceso que tiene hoy**.

Para asignar puestos:

```sql
INSERT INTO usuarios_sistemas ("id","userId","companyId","sistemaId","systemRole","updatedAt")
VALUES (gen_random_uuid()::text, '<userId>', '<companyId>', '<sistemaId>', 'MESERO', now());
```

Y para que un vertical exija acceso explícito:

```sql
UPDATE sistemas_conectados SET "accesoPorUsuario" = true WHERE slug = 'restaurant';
```

---

## Siguiente

Fase 6: Car Wash consumiendo los contratos **sin salir del monolito** — la
validación de que el estándar sirve, hecha con el vertical que ya funciona y
antes de que exista un satélite real. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §17.
