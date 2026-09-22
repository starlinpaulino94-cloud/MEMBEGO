# Conectar Park & Tours

El segundo satélite real, y la comprobación de que dar de alta un vertical es
**datos**. Continúa `docs/platform/satelite.md` y `docs/platform/registro.md`.

---

## Lo que faltaba, y lo que no

Park & Tours ya hablaba con MembeGo: tiene su `/sso/membego`, su
`/api/membego/webhook` y su cliente de la API de plataforma. MembeGo ya sabía
recibirlo: `/api/integraciones/abrir/[slug]` firma el token, `/sso/entrar` acepta
el de vuelta, y la regla de acceso vive en un solo sitio desde la Fase 1b.

Lo único que faltaba era **la fila**. Sin ella el sistema no existe para el
registro, y sin registro no hay acceso: ni tarjeta, ni icono, ni botón. No había
nada que programar — había algo que dar de alta.

> Car Wash está conectado exactamente igual. Su fila se registró a mano en
> producción; el rastro está en
> `prisma/migrations_manual/2026-09-limpiar-carwash-duplicado.sql`, que limpia el
> duplicado que dejó aquel alta improvisada. Esta vez el alta está escrita.

---

## Dónde aparece el acceso

Dos superficies, las dos alimentadas por el mismo registro. Ninguna de las dos
nombra a ningún vertical:

| Dónde | Qué lo pinta | Para quién |
|---|---|---|
| **/admin/integraciones → «Tus aplicaciones»** | `aplicacionesDeEmpresa` | El primer día: tiene nombre, dominio y motivo si no abre |
| **App Launcher de la barra superior** | `sistemasParaLanzador` | Para quien entra veinte veces al día |

Las dos llevan a `/api/integraciones/abrir/park-and-tours`, que firma un token
de 90 segundos y redirige a `{urlBase}/sso/membego?token=…`.

La diferencia entre ambas es deliberada: el lanzador enseña **solo lo que abre**
—un botón que no hace nada es peor que ningún botón— y la pantalla de
Integraciones enseña **también lo que no abre, con el motivo**, pero solo a
quien administra. Es donde alguien viene cuando algo debería estar y no está.

---

## El alta, en tres pasos

### 1 · El vertical de la empresa

Panel de superadmin → **Empresas** → editar → **Vertical** → «Excursiones y
Tours».

El selector lee `tipos_negocio`, así que `EXCURSIONES` ya está ahí desde
`20260817_excursiones_fundacion`. No hace falta tocar nada más.

> **Una empresa tiene UN vertical.** `companies.tipoNegocioCodigo` decide qué
> módulos ve en el menú, qué capacidades tiene y a qué sistemas entra. Si el
> mismo dueño opera un car wash **y** un negocio de excursiones, en MembeGo son
> dos empresas, no una con dos sombreros. Cambiarle el vertical a la empresa del
> car wash para que abra Park & Tours le quitaría el Car Wash — y el menú.

### 2 · El alta del sistema

```
prisma/migrations_manual/2026-09-conectar-park-and-tours.sql
```

Entero, de una vez, en el editor SQL de Supabase. Antes, edita tres líneas
marcadas `EDITA`: la `urlBase` real del satélite, su `urlWebhook`, y el `slug`
de la empresa (sale del segundo `SELECT` del bloque 1).

Es idempotente. Escribe cuatro filas en tres tablas:

```
tipos_negocio            EXCURSIONES, si esta base no lo tuviera
sistemas_conectados      el sistema: slug, URLs, secreto, ACTIVE
sistemas_tipos_negocio   la compatibilidad N:M con EXCURSIONES
empresas_sistemas        la concesión a UNA empresa, ENABLED
```

### 3 · El secreto, al `.env` del satélite

El bloque 4 lo imprime una vez:

```
MEMBEGO_SECRETO=whs_…
```

Con él, Park & Tours verifica la firma del token SSO y la de los webhooks. Sin
él, su `/sso/membego` rechaza todo con `motivo=sesion`.

---

## Lo que el SQL no hace, y por qué

| No hace | Porque |
|---|---|
| Cambiar el vertical de una empresa | Reconfigura su panel entero. Se elige en el formulario, y si no cuadra el alta **para** en vez de dejar una habilitación que el acceso rechazará |
| Emitir la credencial OAuth2 | `clientSecretHash` es un scrypt, y eso no se calcula en SQL. Ver abajo |
| Rotar el secreto de un sistema ya dado de alta | Rotar tiene su ventana de solape y vive en el panel de plataforma |
| Reactivar un sistema `SUSPENDED` o `RETIRED` | Esos estados los puso alguien a conciencia |

### La credencial OAuth2 es aparte, y es opcional

`MEMBEGO_CLIENT_ID` / `MEMBEGO_CLIENT_SECRET` son para que el satélite **llame**
a la API de plataforma —canjear un beneficio desde su punto de venta—. El SSO y
los webhooks no las usan: van con el secreto compartido.

Se emiten con el registrador, sobre la misma base:

```bash
tsx scripts/registrar-sistema.ts examples/manifiestos/park-and-tours.json
```

Reregistrar no toca `estado` ni `autoHabilitar`, así que correrlo después del SQL
no deshace nada. El manifiesto declara **capabilities**, no scopes; los scopes se
derivan en el Core:

```
CUSTOMER_LOOKUP · CUSTOMER_REGISTRATION · MEMBERSHIP_LOOKUP · BENEFIT_EVALUATION
BENEFIT_REDEMPTION · QR_VALIDATION · TRANSACTION_SYNC
  ↓
benefits:read benefits:redeem customers:read customers:write
memberships:read qr:validate transactions:write
```

Un scope escrito a mano en el archivo del satélite no llega hasta aquí. Esa
dirección es la que importa el día que alguien añada una línea a ese JSON: no
puede darse permisos a sí mismo.

---

## Si la tarjeta no aparece

El bloque 5 del SQL devuelve los cuatro pasos de `acceso.ts` en orden, uno por
columna. La primera que diga `false` es la única que hay que arreglar:

| Columna en `false` | Lo que dice la tarjeta | Qué falta |
|---|---|---|
| `1_sistema_activo` | «El sistema está en borrador o suspendido» | `sistemas_conectados.estado` no es `ACTIVE` |
| `2_vertical_compatible` | «El vertical de tu empresa no coincide» | Paso 1: el vertical de la empresa |
| `3_no_revocada` | «La habilitación está suspendida o revocada» | `empresas_sistemas.estado` es `DISABLED`/`SUSPENDED` |
| `4_concedida` | «Registrado, pero tu empresa no lo tiene habilitado» | Falta la fila `ENABLED` del bloque 3 |

Si la consulta no devuelve **ninguna fila**, no hay habilitación para esa
empresa: el bloque 3 no llegó a correr, o paró con su mensaje.

Y si la tarjeta aparece pero el satélite rechaza la entrada, el motivo está en su
redirección: `/login?error=membego&motivo=…`

| `motivo` | Dónde mirar |
|---|---|
| `token` | El `MEMBEGO_SECRETO` del satélite no es el del paso 3, o el token se reutilizó |
| `vinculo` | El correo que entra no administra ninguna organización en el satélite |
| `cuenta` | Rol `CLIENTE`: el SSO trae al equipo, no a los clientes finales |
| `sesion` | Falta `MEMBEGO_SECRETO`, o falló Supabase Auth en el satélite |

---

## La guardia

`tests/plataforma-park-and-tours.test.ts` vigila lo único que aquí no tiene
compilador: dos archivos de datos.

| Prueba | Qué impide |
|---|---|
| El manifiesto es válido para el registrador | Que el alta falle con alguien delante de una consola de producción |
| Las capabilities existen y derivan scopes | Un `"scopes"` escrito a mano que no concede nada |
| **El SQL y el manifiesto dicen lo mismo** | Un `urlBase` desincronizado: el token SSO entregado en otro dominio, sin que nada falle antes |
| El alta no escribe en `companies` | Reconfigurar un negocio desde un archivo titulado «conectar Park & Tours» |
| El alta no inventa credenciales | Una credencial con un hash imposible, que el panel cuenta y nadie puede usar |
| El reregistro solo toca nombre y URLs | Pisar el `secreto` en la segunda pasada y dejar al satélite sordo |
| No hay `UPDATE` de `sistemas_conectados` | Que reregistrar reactive un sistema que se había parado |
| `estado` y `activo` van emparejados | El CHECK de `20260803` abortando el alta a la mitad |
| Ninguna sentencia destructiva | Que un archivo de alta se corra con el miedo de uno que borra |
| Las cuatro escrituras llevan `ON CONFLICT` | Una segunda pasada que revienta a medias y deja el alta hecha a trozos |

La tercera es la que de verdad importa: es el único fallo de la lista que no
produce ningún error hasta que alguien pulsa el botón.

---

## Qué demuestra

La pregunta de la Fase 7 era: **¿se integra un sistema nuevo sin modificar el
Core?**

Car Wash no contaba —es el incumbente, y el Core se escribió alrededor suyo—.
`apps/restaurant` tampoco del todo: se construyó para probar el contrato.

Park & Tours es un sistema de otro dominio, con su propia base, su propio equipo
de conceptos y ninguna relación con lavar coches. Conectarlo costó un JSON y un
SQL. Ni un `switch`, ni un `as const`, ni un despliegue.
