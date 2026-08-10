# Los tres conceptos de la plataforma

Fase 1 del *Membego Platform Integration Standard v1*.

Antes de construir registro, entitlements o API, hay que separar tres cosas que
hoy comparten una sola lista. Sin esta separación todo lo demás se construye
torcido, y arreglarlo después obliga a migrar datos ya escritos.

---

## El problema

`modules/capacidades/catalogo.ts` tiene **19 valores** bajo un solo nombre,
`CAPACIDADES`, y son dos cosas distintas:

| Valor | Qué es en realidad |
|---|---|
| `POS_CAJA`, `RULETA`, `PAGO_CARDNET`, `CITAS`… | Funciones de **MembeGo** que una empresa enciende |
| `COLA_VEHICULOS`, `COMISIONES`, `TURNOS`… | Módulos del **vertical Car Wash** |

Y el estándar necesita un tercer concepto que no existía: **qué necesita un
sistema del Core**.

Con un vertical la mezcla se aguanta. Con diez son doscientos valores en un enum
del Core que nadie puede leer entero — y la regla «no hardcodear categorías por
todo el Core» se incumple **por acumulación, no por decisión**.

---

## Los tres conceptos

### 1 · Función de empresa — `FuncionEmpresa`

Qué puede hacer una **empresa** dentro de MembeGo.

```
NAVEGACION_V2  CITAS  SEGUIMIENTO  RULETA  GIFT_CARDS
CITA_ANTES_DEL_QR  POS_CAJA  PAGO_TRANSFERENCIA  PAGO_CARDNET
```

Vive en el Core para siempre. Se enciende por empresa, con paquete base por
categoría y overrides.

### 2 · Módulo de vertical — `ModuloVertical`

Qué módulos tiene un **vertical**. Hoy están en el Core porque Car Wash está
embebido; **se van con él** cuando salga.

```
INVENTARIO  COLA_VEHICULOS  EVIDENCIA_FOTOS  CUENTAS_CORPORATIVAS
COMISIONES  INCIDENCIAS  COMPRAS  ACTIVOS  TURNOS      → todos CAR_WASH
```

Cada uno declara a qué vertical pertenece. Eso no es decorativo: es lo que
permite comprobar **por prueba** que el Core no los referencia.

Cuando Restaurant traiga `MESAS` y `COCINA`, entran aquí — no en la lista de
funciones de empresa.

### 3 · Capability — `Capability`

Qué necesita un **sistema** del Core. Es el contrato de integración: lo que un
vertical declara en su manifest y lo que sus credenciales autorizan.

```
CUSTOMER_LOOKUP  MEMBERSHIP_LOOKUP  BENEFIT_EVALUATION  BENEFIT_REDEMPTION
PROMOTION_LOOKUP  QR_VALIDATION  BRANCH_LOOKUP
VISIT_SYNC  TRANSACTION_SYNC  LOYALTY_EVENT
```

> **En inglés, y es la única parte del dominio que lo está.** Estos valores
> viajan por el cable: van en el manifest JSON, en los scopes de la credencial y
> en la documentación que lee quien construye un satélite. Un identificador de
> protocolo no se traduce.

Cada capability concede **solo** sus scopes:

| Capability | Scopes |
|---|---|
| `CUSTOMER_LOOKUP` | `customers:read` |
| `BENEFIT_EVALUATION` | `benefits:read` |
| `BENEFIT_REDEMPTION` | `benefits:read`, `benefits:redeem` |
| `TRANSACTION_SYNC` | `transactions:write` |

Declarar que solo se consultan clientes **no** da permiso de escribir
transacciones. Y canjear exige poder evaluar primero: un sistema que consume sin
evaluar consume a ciegas.

---

## Qué se hizo y qué no

**Se clasifica. No se renombra ni se migra.**

`companies.capacidades` guarda hoy en producción `{ overrides: {
COLA_VEHICULOS: true } }`. Renombrar el tipo obligaría a migrar esos datos antes
de saber si el diseño aguanta.

La separación **física** —sacar los módulos del vertical fuera del Core— llega
cuando Car Wash salga. Para entonces la frontera ya estará escrita y probada.

---

## Shared Data Contracts, no Shared Database

Cada vertical tiene **su propia base**. Ninguno se conecta a la de MembeGo.

Pero un restaurante no puede pedir por HTTP el nombre del cliente cada vez que
pinta una fila de la comanda. La salida son **proyecciones locales**: copias de
los datos compartidos, alimentadas por eventos.

### La regla que no se puede romper

> Una proyección es una **caché**, nunca una **autoridad**.
>
> Se lee para pintar, listar, buscar y filtrar.
> **No** se lee para decidir.

| Pregunta | Dónde se responde |
|---|---|
| ¿Cómo se llama este cliente? | Proyección local |
| ¿En qué sucursal está? | Proyección local |
| ¿Puede canjear este beneficio? | **MembeGo, siempre** |

No es purismo. Una proyección puede estar desfasada por un webhook en cola. Un
nombre desfasado se ve raro; **un canje decidido sobre una membresía desfasada
regala un beneficio ya consumido**, cuesta dinero y no deja rastro de por qué.

### Qué puede proyectar un vertical

| Entidad | Refresco | Campos | Para qué |
|---|---|---|---|
| `Company` | evento | id, nombre, slug, logoUrl, moneda, zonaHoraria, idioma | Cabeceras, comprobantes, formato |
| `Branch` | evento | id, companyId, nombre, direccion, activa | Selector, impresión, informes |
| `Customer` | evento | id, nombre, email, telefono | Buscar y pintar. **No** decidir |
| `MembershipSummary` | evento | id, customerId, companyId, planNombre, estado, vigenteHasta | Mostrar estado. **Nunca** autorizar |
| `BenefitEligibility` | **consulta** | — | **No se copia.** Decide dinero |

`Customer` no lleva dirección, ni documento, ni preferencias: el vertical no las
necesita para operar, y pedirlas «por si acaso» es lo contrario de la
minimización de datos.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| Toda capacidad clasificada | Que la lista vuelva a crecer mezclada |
| Ningún valor en los dos conceptos | Ambigüedad silenciosa |
| **El núcleo no razona sobre módulos de un vertical** | Que MembeGo vuelva a ser «una app de car wash con extras» |
| Cada capability declara sus scopes | Permisos implícitos |
| Concesión mínima | Que pedir lectura dé escritura |
| **La elegibilidad no se proyecta** | Autorizar canjes con datos viejos |
| Cliente sin datos de más | Fuga de PII a los verticales |
| Entidad desconocida → sin permisos | Fallo abierto |

La tercera y la sexta son las que de verdad importan. Las demás protegen la
higiene; esas dos protegen el modelo de negocio.

---

## Siguiente

Fase 1b —tipos de negocio a tabla, registro N:M y habilitaciones por empresa—
está en `docs/platform/registro.md`.
