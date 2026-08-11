# Validación del contrato con un vertical real

Fase 6 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/sso.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §14, §17.

---

## La pregunta que ninguna documentación contesta

**¿Sirve este contrato para operar de verdad?**

Cinco fases construyeron una API, un SDK y unos contratos. Todo probado, todo
verde — y ninguna prueba podía contestar eso, porque no había nadie usándolo.

Esta fase lo contesta metiendo a **Car Wash** por el contrato. No un satélite
imaginario: el vertical que MembeGo opera todos los días, con sus pistas, sus
matrículas y sus clientes de mostrador. Si el contrato no le sirve a él, no le
va a servir a Restaurant.

> El orden importa. Descubrir un hueco con Car Wash cuesta una tarde. Con el
> primer satélite integrado cuesta una versión del contrato y un despliegue
> coordinado con otro equipo.

---

## El puerto

```
ClientePlataforma          la interfaz            @membego/contracts
├── MembegoClient          habla HTTP             @membego/platform-sdk
└── clienteLocal()         llama en proceso       Core
```

Las dos declaran `implements ClientePlataforma`, así que **el compilador**
comprueba que sirven lo mismo. No es teoría: al añadir los vehículos, `tsc` paró
las dos hasta que las dos los implementaron.

Car Wash pide por el contrato **ahora**, con la implementación que no cruza la
red. El día de la extracción cambia una línea:

```ts
const membego = clienteLocal(companyId)      // hoy
const membego = new MembegoClient({ ... })   // el día que salga
```

Sin esto, extraer el vertical significaría reescribir cada una de esas lecturas
**el mismo día que se mueve el código** — el día con menos margen de todos.

### Las consultas están escritas una vez

`modules/plataforma/consultas.ts` lo usan los dos caminos. Escritas por
separado, el satélite y el vertical embebido darían respuestas distintas sobre
el mismo cliente, y averiguar cuál es la buena exigiría leer las dos.

Comprobado contra base real: HTTP y en-proceso devuelven **exactamente el mismo
JSON** para resolver por placa, buscar, listar vehículos y listar sucursales.

---

## Lo que el ejercicio destapó

Tres huecos. Ninguno lo dijo una revisión de diseño; los tres los dijo intentar
que Car Wash usara el contrato.

| Hueco | Por qué existía | Qué se hizo |
|---|---|---|
| **Resolver por matrícula** | El contrato sabía de correos y teléfonos. En un lavadero el cliente se identifica por el coche | `resolve?plate=` |
| **Buscar por texto** | `resolve` exige identificador exacto, a propósito. Pero un mostrador teclea «mar» y espera ver a María | `GET /customers/search`, con mínimo y tope |
| **Vehículos** | Entidad compartida: MembeGo es su dueño (§13) y el lavadero no opera sin ella | `VehicleDTO`, dos endpoints, y entrada en el contrato de proyección |

### Y un fallo que estaba en producción

La resolución por teléfono comparaba en **una sola dirección**:
`guardado.endsWith(consultado)`. Con el cliente guardado como `809-555-1234` y
un satélite preguntando por `+18095551234` —E.164, el formato que manda
cualquier integración seria— la respuesta era **«no existe»**.

Es el peor fallo posible aquí: el empleado concluye que el cliente no tiene
membresía y le cobra el precio completo.

Lo encontró la prueba contra base real, no el análisis estático. La comparación
es ahora simétrica y acotada a **tres dígitos** de prefijo — suficiente para un
código de país o de zona, y no más:

```
809-555-1234  ==  +1 809 555 1234     ✓
    555-1234  ==     809-555-1234     ✓  (ficha vieja sin código de zona)
    555-1234  ==  +1 809 555 1234     ✗  (cuatro de más ya es otro número)
```

El margen es una **decisión con un riesgo asumido**: dos personas distintas con
`555-1234` y `809-555-1234` se confundirían. Se acepta porque el fallo contrario
es peor y ocurre todos los días.

---

## El acoplamiento, medido

```
node scripts/acoplamiento-vertical.mjs --detalle
```

Cuántas veces el vertical lee o escribe **directamente** una tabla del Core.
Cada una es una línea que habrá que reescribir el día de la extracción.

**25 al empezar · 22 ahora.** El techo está en la prueba y solo puede bajar.

### La primera medida era falsa

Contaba 22 donde había 25. El patrón obvio —`tx.cliente.`— no encuentra esto,
que es como está escrito medio código:

```ts
tx.vehiculo
  .findFirst({ ... })
```

Un número que se cree y es falso es peor que no medir: se toman decisiones con
él. El script normaliza los espacios antes de contar, y hay una prueba que
comprueba que sigue haciéndolo.

### Qué queda, y por qué

| Dónde | Cuántos | Qué es |
|---|---|---|
| `mostrador-actions.ts` | 13 | **Escrituras** del Core: crear clientes de mostrador, añadir vehículos, fusionar con la cuenta real |
| `mostrador.ts` | 4 | Lecturas que necesitan campos que el DTO no lleva (`esLocal`) o del propio vertical |
| `cola-actions.ts` | 2 | Crear cliente y vehículo desde la pista |
| `fase2` · `fase3` · `turnos` | 3 | `tx.user` — la plantilla de la empresa |

**No es deuda pendiente de migrar: son las tres decisiones del puerto.**

---

## Lo que el puerto NO da, y por qué

Está declarado en el código (`FUERA_DEL_PUERTO`), no solo aquí, para que quien
busque un método y no lo encuentre lea la razón en vez de suponer que se olvidó.

| | Decisión |
|---|---|
| **Crear clientes y vehículos** | Core-owned. Un vertical que los cree empieza a ser dueño de la identidad del cliente, que es justo lo que MembeGo no puede ceder (§14). Llegan cuando un satélite real las necesite, con su idempotencia |
| **Fusionar mostrador ↔ cuenta** | Se queda en el Core **para siempre**. Es irreversible y toca membresías, compras e historial; un satélite no puede tener ese poder por muy legítimo que sea su caso |
| **Listar el personal** | No es un hueco, es un límite. Un satélite conoce a sus usuarios porque entran por SSO. Darle la plantilla entera sería exponer a gente que nunca usó su sistema |
| **Evaluar y cobrar en proceso** | `clienteLocal` los rechaza. Un vertical embebido que evalúe por su cuenta está a un paso de decidir el canje — la segunda implementación de la ruta del dinero que la Fase 3b existió para evitar |

### Un caso donde forzarlo habría sido peor

`duenoDeLaPlaca` —la consulta que hace la pista cuando entra un coche— se migró
y **se revirtió**. Pasarla por el contrato convertía 1 consulta en 3, en la
operación más frecuente del día, porque el DTO no lleva `esLocal` ni la
categoría tarifaria.

Peor código a cambio de mover un número no es una mejora. Queda como hueco
documentado, y el número refleja la realidad en vez de maquillarla.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **El acoplamiento no crece** | Añadir dependencia nueva cuando el proyecto va en la otra dirección |
| La medida ve las consultas partidas en varias líneas | Volver a creerse un número falso |
| **Las dos implementaciones declaran el mismo puerto** | Que una se quede atrás sin que nadie lo note |
| La API y el cliente en proceso comparten las consultas | Dos respuestas distintas sobre el mismo cliente |
| El cliente en proceso rechaza otra empresa | Razonar sobre una empresa que no es la suya |
| El vertical embebido no evalúa ni cobra | La segunda implementación de la ruta del dinero |
| Resolver exige exactamente un identificador | Elegir en silencio por un criterio que nadie pidió |
| Buscar tiene mínimo y tope | Que «buscar» sea «descargarse la base a base de probar» |
| El vehículo entra con su límite de campos | Sacar color, año y categoría tarifaria del Core |
| **El mismo número escrito de otra forma se reconoce** | Cobrarle el precio completo a quien sí tiene membresía |
| Un sufijo suelto no es el mismo número | Enseñar los datos de otra persona |
| El puerto no ofrece crear ni fusionar | Que un vertical se vuelva dueño de la identidad |

Verificado además contra PostgreSQL real, 17 comprobaciones — entre ellas que
**HTTP y en-proceso devuelven el mismo JSON** en las cuatro consultas, que la
misma matrícula en otra empresa no se cuela, y que una sola letra no vale como
búsqueda.

---

## Conclusión de la validación

**El contrato sirve, con tres correcciones.** Ninguna era estructural: faltaban
una forma de identificar (matrícula), una forma de buscar y una entidad
compartida (vehículo). El modelo —capabilities, scopes, habilitaciones,
proyecciones, canje único— aguantó el primer contacto con un vertical real.

Lo que no aguanta todavía es **escribir**: un mostrador crea clientes y
vehículos, y el puerto no lo ofrece. Es la conversación de la Fase 7, y hay que
tenerla con Restaurant delante — porque un restaurante también registra clientes
que llegan sin cuenta, y el diseño tiene que servir a los dos.

---

## Siguiente

Fase 7 —un vertical nuevo sin tocar el Core, y la escritura que aquí faltaba—
está en `docs/platform/satelite.md`.
