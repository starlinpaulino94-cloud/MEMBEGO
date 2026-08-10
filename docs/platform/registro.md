# Registro de sistemas, verticales y habilitaciones

Fase 1b del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/conceptos.md`. Ver también `docs/PLATFORM_ARCHITECTURE_REPORT.md` §5–§7.

---

## El problema

Que una empresa pudiera entrar a un sistema satélite se decidía comparando dos
cadenas:

```
sistema.activo && sistema.categoria === categoriaDeLaEmpresa
```

Con un vertical eso funciona. Con dos, falla en tres sitios a la vez:

| | Qué pasa |
|---|---|
| **Un sistema, una categoría** | Un POS que sirve a restaurante **y** a barbería no se puede representar |
| **Registrar = conceder** | Dar de alta el sistema de Restaurante se lo entrega de golpe a **todos** los restaurantes de la plataforma |
| **`activo` no distingue** | «Aún no lanzado», «suspendido por incidente» y «retirado» eran el mismo `false` |

Y la comparación estaba copiada en cuatro archivos. En uno de ellos —el SSO de
entrada— **se leía y no se usaba**.

---

## Lo que sustituye

Tres conceptos, tres tablas.

```
TipoNegocio            el vertical            CAR_WASH · RESTAURANTE · …
SistemaTipoNegocio     compatibilidad (N:M)   qué verticales atiende un sistema
EmpresaSistema         concesión              qué empresa lo tiene habilitado
```

**Compatibilidad y concesión son preguntas distintas.** «Este sistema sirve a
restaurantes» y «este restaurante concreto lo tiene contratado» daban la misma
respuesta mientras hubo un solo vertical, y por eso bastaba una columna. Dejan
de darla en cuanto hay dos.

### La regla

`src/modules/plataforma/acceso.ts` — pura, sin base de datos, un solo sitio.

```
1 · sistema.estado = ACTIVE                    → si no: SISTEMA_NO_ACTIVO
2 · tipoNegocio ∈ sistema.tiposNegocio         → si no: VERTICAL_INCOMPATIBLE
3 · habilitación ∈ {DISABLED, SUSPENDED}       → HABILITACION_REVOCADA
4 · habilitación = ENABLED                     → permitido
5 · sin fila, o AVAILABLE                      → decide sistema.autoHabilitar
```

**El orden no es arbitrario.** El paso 3 va antes del 5: una revocación
explícita gana a la política general. Al revés, apagarle el sistema a una
empresa concreta no haría nada mientras el vertical siguiera siendo automático —
el panel diría «deshabilitado» y la puerta seguiría abierta.

Los cuatro motivos existen separados, y no como un `false`, porque cada uno lo
arregla una persona distinta: el estado lo cambia el superadmin, la
compatibilidad la declara quien registra el sistema, la habilitación la concede
quien vende.

### `autoHabilitar`

Nace en `false`: **un vertical nuevo es opt-in**. Eso es exactamente lo que los
entitlements existen para conseguir.

Los sistemas que ya funcionaban por categoría quedan en `true` con la migración,
porque así funcionaban ayer y nadie puede perder acceso el día del cambio.

---

## Ciclo de vida

| Estado | Significa | Puerta |
|---|---|---|
| `DRAFT` | Registrado, aún no lanzado | cerrada |
| `ACTIVE` | En servicio | **abierta** |
| `SUSPENDED` | Parado por incidente | cerrada |
| `RETIRED` | Fuera de servicio para siempre | cerrada |

`activo` sigue existiendo como espejo de `estado = 'ACTIVE'`, y la migración
instala un **CHECK** que impide que los dos valores se separen. Dos columnas que
dicen lo mismo se separan siempre; con el CHECK, el `UPDATE` que las separaría
falla en vez de dejar la fila diciendo dos cosas.

---

## Migración expansiva

`prisma/migrations/20260803_plataforma_registro`

Se añade y se rellena; **no se borra nada**. `categoria` y `activo` siguen ahí y
siguen siendo correctos. Retirarlas es una fase posterior.

Al terminar:

- cada sistema tiene sus verticales en la tabla N:M, traspasados desde `categoria`;
- cada sistema existente queda `autoHabilitar = true`;
- cada empresa que **hoy** accede por categoría tiene una fila `ENABLED` explícita.

> Esas filas son redundantes con `autoHabilitar`… hoy. Dejan de serlo en cuanto
> alguien apague esa política para hacer el vertical opt-in: sin filas
> explícitas, ese cambio revocaría en silencio el acceso de todas las empresas
> existentes.

Verificada contra PostgreSQL 16 con datos sembrados, incluidos los casos raros:
override de categoría en `capacidades`, `type` desconocido (cae a `CAR_WASH`,
el mismo fail-open de producción) y un sistema con una `categoria` que no está
en el catálogo — para el que se crea el tipo en vez de dejarlo sin ningún
vertical compatible, que es exactamente cómo se pierde acceso sin enterarse.

### El camino de respaldo

El código se despliega antes que la migración: es el orden normal y el único que
permite volver atrás sin tocar la base. Mientras tanto, `estado` no existe.

`modules/plataforma/registro.ts` lo detecta y repite la lectura con las columnas
viejas, mapeando `activo → ACTIVE|SUSPENDED`, `categoria → [código]`,
`autoHabilitar → true`. Eso reproduce **exactamente** la regla anterior: durante
la ventana, quien entraba sigue entrando y quien no, sigue sin entrar.

No es un fail-open — el respaldo no concede nada que la versión anterior no
concediera. Desaparece con la columna `categoria`.

---

## El hueco que se cerró

`/sso/entrar` leía `categoria` del sistema y **no la usaba nunca**. Con la firma
válida, el satélite del car wash podía abrir la sesión de un usuario de un
restaurante.

Una firma demuestra **quién** pide, no **sobre quién** puede pedir. La
comprobación va ahora después de verificar el token —el `companyId` viene dentro,
así que no se puede saber antes— y aplica la misma regla que todo lo demás.

El cron de reintentos también resuelve el destino de nuevo en cada pasada, en vez
de fiarse de que el evento estuviera en la cola: un evento encolado el lunes
puede salir el miércoles, y entre medias la empresa pudo perder la habilitación.
Con eso, revocar deja de ser una promesa a futuro y vacía también la cola.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| Solo `ACTIVE` abre | Que un sistema en borrador reciba tráfico |
| El estado se mira antes que la habilitación | Que suspender un sistema no cierre nada |
| Sin vertical declarado → nadie entra | Que una lista vacía funcione como comodín |
| **Una revocación explícita gana a `autoHabilitar`** | Apagar en el panel y que siga abierto |
| Cada estado de habilitación decidido | Un quinto estado cayendo en el `else` |
| Nadie decide con `categoria` ni `activo` | Volver a conceder ignorando habilitaciones |
| La semilla cubre el catálogo | Una categoría nueva sin ningún sistema posible |
| El CHECK está en la migración | Que `activo` y `estado` se separen |

La cuarta es la que de verdad importa: es el único fallo de esta lista que se lee
como un acierto en pantalla.

---

## Lo que NO se hizo, y por qué

**`slug` no se renombra a `systemKey`.** El informe lo proponía. Es parte del
contrato público con el satélite —viaja en `/sso/entrar?sistema=<slug>`— y
renombrarlo obliga a coordinar un despliegue con cada satélite a cambio de nada
más que estética.

**La categoría de la empresa sigue en `companies.capacidades`.** Moverla a una
clave foránea contra `tipos_negocio` es una migración de datos de negocio, no de
catálogo, y merece su propia fase.

**No hay panel para conceder habilitaciones todavía.** Se conceden por SQL. La
pantalla llega con el App Launcher, cuando haya más de un sistema que ofrecer.

---

## Siguiente

Fase 2 —la API entrante que usa estas habilitaciones para decidir sobre qué
empresa puede actuar un sistema— está en `docs/platform/api-v1.md`.
