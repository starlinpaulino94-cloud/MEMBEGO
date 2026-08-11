# Un vertical nuevo, sin tocar el Core

Fase 7 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/validacion.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §15, §17.

---

## La pregunta que decide si esto es una plataforma

La Fase 6 contestó «¿sirve este contrato para operar?». Queda la otra, la que
separa una plataforma de un monolito con una API delante:

**¿Se integra un sistema nuevo sin modificar MembeGo?**

Mientras dar de alta un vertical exija editar un `as const`, añadir un caso a un
`switch` o desplegar el Core, la respuesta es no. Y con doscientos verticales
esa deuda no es un inconveniente: es el techo del negocio.

---

## El manifiesto

Un vertical se declara en **datos**:

```json
{
  "slug": "hotel-pms",
  "nombre": "Hotel PMS",
  "urlBase": "https://pms.midominio.com",
  "webhookUrl": "https://pms.midominio.com/webhooks/membego",
  "businessTypes": ["HOTEL"],
  "capabilities": ["CUSTOMER_LOOKUP", "CUSTOMER_REGISTRATION", "BENEFIT_EVALUATION"]
}
```

```bash
tsx scripts/registrar-sistema.ts hotel.json --empresa hotel-sol --vertical HOTEL
```

Eso escribe cinco filas —el tipo de negocio, el sistema, la relación N:M, la
credencial y la habilitación— e imprime las tres variables del `.env` del
satélite. **Ni un `switch`, ni un despliegue.**

Hay uno completo y versionado en
[`examples/manifiestos/restaurant.json`](../../examples/manifiestos/restaurant.json),
que es además el que valida `tests/platform-satelite.test.ts`: si se toca, la
prueba lo dice.

### Se piden capabilities, no scopes

`"capabilities": ["BENEFIT_REDEMPTION"]` concede `benefits:read` y
`benefits:redeem`. Escribir un scope directamente no concede nada: falla la
validación.

La diferencia importa el día que alguien edite el archivo de un satélite y añada
una línea. Si el manifiesto llevara scopes, esa línea **sería** el permiso.
Llevando capabilities, la lista de lo concedible vive en el Core y un valor que
no esté en ella no concede: falla, en vez de conceder algo que nadie revisó.

### Nace en DRAFT

Registrar no es lanzar. Comprobado contra base real: un sistema en `DRAFT`
**no recibe ni token** —la puerta se cierra antes de la primera petición— hasta
que alguien lo revisa y lo activa desde el panel.

Volver a correr el script para actualizar una URL **no** reactiva un sistema
suspendido: el `update` no toca `estado` ni `autoHabilitar`, porque esas son
decisiones que alguien tomó mirando un incidente.

---

## El techo escondido que esta fase destapó

La Fase 1b convirtió los tipos de negocio en tabla para que registrar un
vertical fuera escribir filas. Pero el vertical de una **empresa** seguía
saliendo de aquí:

```ts
switch ((type ?? '').toLowerCase()) {
  case 'restaurante': return 'RESTAURANTE'
  ...
  default:            return 'CAR_WASH'
}
```

Cuatro valores. Con eso se podía dar de alta el sistema de un hotel y **ninguna
empresa podía ser compatible con él jamás**. El registro era datos; la
compatibilidad seguía siendo código, y el techo seguía puesto — escondido.

Lo encontró la prueba contra base real, no el análisis estático: una empresa
creada con `type: "restaurant"` caía en el `default` y quedaba clasificada como
lavadero.

**Arreglo:** `companies.tipoNegocioCodigo`, un código de `tipos_negocio`.
Aditiva, nullable y rellenada reproduciendo exactamente la resolución de hoy, así
que ninguna empresa cambia de vertical el día del despliegue. Cuando la columna
está, manda; cuando no, se resuelve como siempre.

> El camino de respaldo —para una base sin migrar— **no** pide la columna. Si la
> pidiera, fallaría también, y el resultado no sería «se resuelve como antes»
> sino «esta empresa no tiene ningún sistema».

---

## La escritura que faltaba

La Fase 6 terminó diciendo que el contrato no aguantaba escribir, y que la
conversación había que tenerla con un restaurante delante. Es esta.

```ts
const { customer, created } = await membego.createCustomer(
  { companyId, name: 'Juan', phone: '+18095551234' },
  `mesa-4-${turnoId}`      // la referencia de TU operación
)
```

El vertical **no se vuelve dueño de la identidad** por poder pedir un alta. Quien
decide cómo queda la fila —que no pueda iniciar sesión, que quede marcada como
local, de qué canal vino, si en realidad ya existía— es el Core, igual para
todos. El satélite manda un nombre; no manda un registro.

### `created` importa

Si el identificador ya estaba, se devuelve el cliente que existe con
`created: false` en vez de abrir una segunda ficha. Dos fichas de la misma
persona parten su historial en dos y nadie vuelve a saber cuántas veces vino.

Y hay que mirarlo: un cliente que ya existía puede tener membresía, y darle la
bienvenida como si fuera nuevo es, para quien está delante, un sistema que no lo
reconoce.

### Solo el nombre es obligatorio

Es la regla que ya seguía el mostrador de Car Wash y se sostiene igual en un
restaurante: exigir correo o documento en la puerta es la forma más rápida de que
el encargado deje de usar el sistema y vuelva al cuaderno.

### Sin identificador no se deduplica

Dos «Juan» en el mismo restaurante son dos personas. Fusionarlos por el nombre
mezclaría el historial de dos clientes reales, y ese daño no tiene vuelta atrás.

Por eso la clave de idempotencia es **obligatoria**: el caso normal de una mesa
—alguien que llega solo con su nombre— no tiene con qué deduplicarse, así que un
reintento por una respuesta perdida crearía la segunda ficha.

### Tres sitios escribían la misma fila

`mostrador-actions`, `cola-actions` y ahora la API. Tres copias, cada una con su
idea de qué poner en `email` y de si marcar `esLocal`. La tercera era el momento
de parar: con filas ya escritas, unificarlas deja de ser un refactor y pasa a ser
una migración de datos.

Ahora hay un solo `altaCliente`, y el acoplamiento de Car Wash bajó de **22 a
20**.

> **Cambio de comportamiento, deliberado:** el alta desde la pista ahora
> deduplica por teléfono. Antes creaba siempre. Si ese número ya está, el carro
> entra en la ficha del cliente que ya vino otras veces. El riesgo asumido es
> que dos personas que comparten teléfono se unifiquen; se acepta porque el
> fallo contrario —partir el historial de un cliente habitual— es el que ocurre
> todos los días. El mostrador lo dice en pantalla cuando pasa.

---

## Lo que sigue fuera del puerto

| | Decisión |
|---|---|
| **Crear vehículos** | Sigue fuera: **ningún satélite real lo ha pedido**. Restaurant no tiene coches. Añadirlo «ya que estamos» sería diseñar contra un caso imaginado, que es cómo se llenan las APIs de métodos que nadie usa y nadie puede quitar |
| **Fusionar mostrador ↔ cuenta** | En el Core para siempre. Es irreversible y toca membresías, compras e historial |
| **Listar el personal** | No es un hueco, es un límite. Un satélite conoce a sus usuarios porque entran por SSO |

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **La capa de plataforma no ramifica por ningún vertical** | Un despliegue de MembeGo por cada sistema nuevo |
| La guardia detecta una ramificación cuando la hay | Creerse un cero que solo significa que no sabe buscar |
| **Un manifiesto no puede concederse un scope** | Que editar el archivo de un satélite sea darse permisos |
| El manifiesto exige https | El token SSO viajando sin cifrar |
| Devuelve todos los errores, no el primero | Cinco intentos para arreglar cinco problemas |
| Dar de alta un sistema escribe filas, no código | Que «registrar» vuelva a ser editar un `switch` |
| Un sistema nace en DRAFT | Que correr un script sea lanzar |
| Reregistrar no reactiva un suspendido | Deshacer una decisión operativa por cambiar una URL |
| **El vertical se resuelve por la tabla, no por una lista fija** | El techo de cuatro verticales, escondido |
| Sin la columna se resuelve como antes | Dejar sin sistemas a las empresas de hoy |
| El respaldo no pide la columna que falta | Una caída completa por una migración sin aplicar |
| El alta exige clave de idempotencia en los dos caminos | La segunda ficha de quien solo dijo su nombre |
| **Nadie crea clientes fuera del servicio del Core** | Tres formas distintas del mismo cliente |
| Escribir clientes exige también leerlos | Un permiso que miente sobre lo que concede |
| Lo que ningún satélite ha pedido sigue fuera | Un puerto lleno de métodos que nadie puede quitar |

Verificado además contra PostgreSQL 16 real, **27 comprobaciones**. Entre ellas,
la que da nombre a la fase: **un vertical que no existía en ninguna lista
—`HOTEL`— registrado desde un manifiesto, activado, y dando de alta un huésped
contra el Core**, con cero cambios de código. Y que el sistema del restaurante
no entra en la empresa del hotel.

---

## Lo que falta

**El panel del superadmin todavía ofrece los cuatro tipos de siempre** en un
`<Select>` con las opciones escritas a mano. La columna ya acepta cualquier
código, y `--vertical` la fija desde el script; pero asignar un vertical nuevo
**desde la interfaz** sigue sin poder hacerse. Es la única pieza de la Fase 7
que queda, y es de pantalla, no de arquitectura.

---

## Siguiente

**Fase 7b — Restaurant como aplicación aparte**: hecha. Su propia base de datos,
su proyección local, su webhook firmado y su SSO, hablando con MembeGo solo por
HTTP. Verificado contra PostgreSQL 16 y HTTP reales, con la firma generada por
la función del propio Core.

→ `docs/platform/restaurante.md`
