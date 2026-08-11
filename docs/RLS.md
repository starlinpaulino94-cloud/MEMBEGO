# Aislamiento entre empresas (RLS)

Cubre el punto **12** del plan de `docs/AUDITORIA-PRODUCCION.md` — hallazgo
**A-01**, *"Aislamiento multi-empresa 100 % aplicativo: sin RLS en PostgreSQL"*.

---

## 1. Lo que se encontró al medirlo, y no estaba en la auditoría

La auditoría describía A-01 como un riesgo de segundo orden: el aislamiento
depende de que cada consulta lleve su `where companyId`, así que un olvido
filtraría datos entre empresas. Cierto, y sigue siéndolo.

Al montar el banco de pruebas apareció algo bastante peor.

Supabase, en **cada** proyecto, concede por defecto todos los privilegios sobre
el esquema `public` a los roles `anon` y `authenticated`, y expone PostgREST en
`https://<proyecto>.supabase.co/rest/v1/`. La clave que usa un visitante sin
sesión es `NEXT_PUBLIC_SUPABASE_ANON_KEY`, y esa clave **viaja dentro del
bundle del navegador**: es pública por diseño.

Sin RLS, eso significa que cualquiera que abra membego.com, mire el código
fuente y copie la clave puede hacer:

```bash
curl 'https://<proyecto>.supabase.co/rest/v1/clientes?select=*' \
     -H "apikey: <la clave que está en el HTML>"
```

y descargarse la tabla de clientes entera. Y `memberships`, y `transactions`, y
`comprobantes`. De **todas** las empresas. Sin explotar nada: usando la API tal
como está documentada.

No es una hipótesis. Se reprodujo en un PostgreSQL 16 con los roles y los grants
por defecto de Supabase y dos empresas sembradas:

```
=== LO QUE VE LA CLAVE ANÓNIMA (sin RLS) ===
 id | companyId |    nombre     |     email
----+-----------+---------------+---------------
 k1 | c1        | Ana de ACME   | ana@acme.do
 k2 | c2        | Beto de RIVAL | beto@rival.do
(2 rows)
```

Dos empresas distintas, una sola consulta, sin sesión.

**Esto reclasifica A-01 de ALTO a CRÍTICO**, y es lo que arregla la Capa 1.

---

## 2. Dos capas, dos problemas distintos

| | Capa 1 · barrera pública | Capa 2 · aislamiento real |
|---|---|---|
| **De qué defiende** | De la clave anónima que va en el navegador | Del `where companyId` que a alguien se le olvida |
| **Dónde vive** | `prisma/migrations/20260771_rls_barrera_publica/` | `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` |
| **Se aplica** | Sola, en el despliegue | A mano, cuando decidas |
| **Estado** | **Lista para producción** | **Montada y probada, apagada** |
| **Riesgo de aplicarla** | Ninguno medible (ver § 3) | Alto sin migrar el código antes |

Por qué la Capa 1 no basta por sí sola: Prisma se conecta como `postgres`, que
en Supabase tiene el atributo `BYPASSRLS`. Se salta RLS entero. Una consulta sin
`where companyId` seguiría devolviendo los clientes de todas las empresas
aunque la Capa 1 esté puesta.

---

## 3. Capa 1 — cerrar la puerta de PostgREST

Hace tres cosas, todas sobre `public`:

1. `ENABLE ROW LEVEL SECURITY` en las 115 tablas. Sin políticas, RLS deniega:
   la ausencia **es** la política, igual que en el bucket de comprobantes.
2. Retira los privilegios de `anon` y `authenticated`. Esto es lo decisivo:
   PostgREST responde *"permission denied for table"* antes de evaluar nada.
3. Corrige los privilegios **por defecto**, para que la próxima tabla que cree
   una migración no nazca abierta otra vez.

`service_role` no se toca: se salta RLS por atributo, su clave es solo de
servidor y es la que firma las subidas de Storage.

### Por qué no rompe nada

Porque **MembeGo no usa PostgREST**. Todo va por Prisma. Comprobado con
`grep`: no hay una sola llamada `.from('<tabla>')` ni `.rpc(` en `src/`. Las
únicas `.from(...)` que existen son `supabase.storage.from('avatars' | 'logos' |
'comprobantes')`, que van al esquema `storage`, no a `public`.

Auth (`auth.users`) y Storage (`storage.objects`) viven en otros esquemas y esta
migración no los toca. Iniciar sesión, registrarse y subir archivos siguen
igual.

### La guarda que puede abortar la migración

Activar RLS sin políticas deniega a todo rol que no la bypasee. Si la aplicación
se conectara con un rol normal, esto la dejaría sin acceso a su propia base.

La migración lo comprueba y **para** si no se cumple:

```
RLS abortado: el rol "x" no tiene BYPASSRLS ni es superusuario.
```

En Supabase el rol `postgres` —el de `DATABASE_URL` y `DIRECT_URL` de MembeGo—
sí lo tiene, así que pasa. Lo que la guarda **no** puede ver es el caso en que
el rol que migra sea distinto del rol de la aplicación; en MembeGo son el mismo.

### Verificación

```sql
-- Debe dar 0. Es la consulta que importa.
select count(*) from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated');
```

`npm run db:doctor` la incluye a partir de ahora, junto con "tablas sin RLS",
porque el riesgo real es la tabla que se añada **después**: no rompe nada, solo
deja la puerta entornada, y así nadie se entera.

---

## 4. Capa 2 — aislamiento real, y por qué se entrega apagada

### Qué hace

Un rol `membego_app` **sin** `BYPASSRLS`, y políticas que filtran por
`current_setting('app.company_id')`. La aplicación declara en qué empresa
trabaja al abrir cada transacción.

Las políticas no son una lista escrita a mano. Se deducen del esquema:

```
Nivel 0 — tablas con companyId propio: 80
companies cubierta por su propia clave primaria.
Ronda 1 — cubiertas por clave foránea: 28
Ronda 2 — cubiertas por clave foránea: 0
Catálogos globales: lectura abierta, escritura solo omnisciente.
transaction_counters: ámbito global TX:* + TICKET del propio inquilino.
────────────────────────────────────────────────
Cubiertas por política de inquilino: 115 de 115
SIN ruta al inquilino (solo omnisciente): ninguna
```

`visits`, por ejemplo, no tiene `companyId`: llega al inquilino a través de
`clientes`. Eso lo encuentra el propio recorrido de claves foráneas, no yo
escribiendo 112 políticas a mano.

Las tres que se quedaron sin camino se miraron una por una y llevan regla
propia. `business_categories` y `campanas_globales` son catálogos que administra
MembeGo y lee todo el mundo: lectura abierta, escritura solo para el superadmin.
`transaction_counters` es `(id, seq)` y su `id` es un ámbito —`TX:<fecha>` es
global, `TICKET:<empresa>` no—, así que la regla lo distingue en vez de abrirla
entera.

### Y encenderlo, que es un paso aparte — y faltaba

**Una política no se aplica sola.** Si la tabla no tiene `ENABLE ROW LEVEL
SECURITY`, PostgreSQL ni la mira: las políticas existen, `pg_policies` las
enseña, y el aislamiento es cero.

Eso es exactamente lo que pasaba. El archivo creaba las 137 políticas y no
encendía RLS en ninguna tabla. Medido: `relrowsecurity` en **0 de 137**, y
`npm run rls:probar` daba **1 de 6** — y la que pasaba era «el modo omnisciente
lo ve todo», que es justo lo que ocurre cuando RLS está apagado. Verde por el
motivo equivocado.

Lo peligroso no era el fallo, sino su forma: el recuento de políticas decía 137
de 137, así que cualquier comprobación por encima daba por hecho que estaba
puesto. Se habría cambiado `DATABASE_URL` a `membego_app` creyendo tener
aislamiento y sin tener ninguno.

Ahora el archivo lo enciende en las 137 —también en las que no tienen política,
porque sin política RLS deniega y eso es lo correcto para una tabla nueva que
nadie ha decidido cómo aislar— y **falla con excepción** si alguna quedara
apagada. No `FORCE ROW LEVEL SECURITY`: eso aplicaría RLS también al dueño de
las tablas, que es quien migra, y en Supabase ese dueño es superusuario, así que
ni le alcanzaría.

Comprobado de punta a punta contra PostgreSQL 16: `db push`, el archivo, y
`npm run rls:probar` → **6 de 6**. Y una segunda pasada activa 0 tablas nuevas y
sigue en 6 de 6.

### La válvula de escape, y su límite honesto

Muchísimo de MembeGo cruza empresas por diseño: el marketplace público, el panel
del superadmin, el cron. Para eso está `app.omnisciente = 'on'`, que en el
código es `sinEmpresa(motivo, fn)`.

Esa válvula **la puede abrir la propia aplicación**. Es decir: esto no defiende
de un servidor comprometido, y no pretende hacerlo. Defiende de un `where`
olvidado — que es el fallo que de verdad ocurre. Un `where` olvidado nunca
escribe `app.omnisciente`.

La versión fuerte sería un segundo rol con su propia cadena de conexión, de modo
que el código de inquilino no pueda alcanzar la válvula ni queriendo. Cuesta dos
clientes de Prisma; está anotado como trabajo futuro.

### Por qué apagada

Para que RLS proteja de un `where` olvidado, **cada consulta** tiene que declarar
su empresa. En MembeGo eso son **~100 archivos, ~500+ puntos de consulta**. La
migración a `conEmpresa`/`sinEmpresa` está completada (Fase 5); el gate de
cobertura estática en CI (`node scripts/rls-cobertura.mjs`) bloquea que un
archivo nuevo con consultas entre sin declarar su contexto.

Peor: una Capa 2 a medias (políticas puestas, aplicación todavía conectando como
`postgres`) **no protege de nada** y hace creer que sí. Esa ilusión es lo
verdaderamente peligroso.

Así que se entrega montada, probada y con el camino de encendido escrito.

### El detalle que hace posible encenderla poco a poco

`conEmpresa()` **se puede usar hoy, con RLS apagado, y no cambia nada**. Hoy la
aplicación se conecta como `postgres`, que se salta RLS: poner la variable de
sesión no tiene ningún efecto.

El día que `DATABASE_URL` pase a `membego_app`, el código que ya use
`conEmpresa` queda protegido sin tocarlo, y el que no lo use dejará de ver datos
—ruidosamente, en la primera prueba— en vez de fallar en silencio.

```ts
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

// Panel de empresa: dentro solo existen las filas de esa empresa.
const clientes = await conEmpresa(companyId, (tx) =>
  tx.cliente.findMany({ where: { companyId } })   // el where NO se quita
)

// Marketplace público: cruza empresas a propósito.
const empresas = await sinEmpresa('marketplace público', (tx) =>
  tx.company.findMany({ where: { isPublished: true } })
)
```

El `where: { companyId }` se queda. RLS es la **segunda** barrera, no la
primera: si un día se despliega sin las políticas, el filtro de la aplicación
sigue ahí. Dos cierres independientes.

### `SET LOCAL`, y por qué no hay versión sin transacción

`SET LOCAL` muere con la transacción. `SET` a secas se queda pegado a la
**conexión**, y con un pooler delante —MembeGo usa el de Supabase— la conexión
se reutiliza: la siguiente petición heredaría la empresa de la anterior y un
cliente vería los datos de otro.

Es el fallo clásico de RLS con pooling. Por eso `conEmpresa` abre siempre una
transacción y no existe una variante "suelta".

### Orden recomendado para encenderla

> #### ✅ Migración terminada el 2026-08-11
>
> La lista `PENDIENTES` del gate está **vacía**. Las cuatro tandas —admin (57),
> superadmin (12), cliente (10) y mostrador (6)— quedaron migradas, y con ellas
> desaparece el único motivo por el que la Capa 2 no podía encenderse.
>
> Lo que sigue abajo es el registro de cómo se descubrió, que conviene conservar:
> el problema no fueron los 85 archivos sino el **✓ verde** que decía que no
> existían.
>
> #### ⚠️ Estado que se encontró el 2026-08-11
>
> Los pasos 1 y 2 estaban marcados como completados **sobre una medida falsa**.
> El gate `scripts/rls-cobertura.mjs` recorría solo archivos `.ts`, y en App
> Router una parte enorme de las consultas vive en componentes de servidor
> (`.tsx`): las páginas del panel llaman a Prisma directamente. Contaba 9
> archivos de los 95 que tocan la base, y por eso decía «✓ todo cubierto».
>
> Medida con el gate corregido:
>
> | | |
> |---|---|
> | Archivos que tocan la base | **95** |
> | Sitios de consulta | **~188** |
> | **Sin envoltorio de tenant** | **85** |
> | Reparto | 44 admin · 11 superadmin · 6 cliente · 1 empleado · 2 componentes |
>
> El inventario nominal está en la constante `PENDIENTES` del script, y se
> imprime en cada ejecución. **Mientras no esté vacía, el paso 5 no se puede
> dar**: con `membego_app`, una consulta sin contexto no falla — devuelve cero
> filas, así que el panel se queda en blanco y los registros no dicen por qué.

1. Migrar a `conEmpresa` los módulos de `src/modules/**`, `src/lib/**` y los
   route handlers de `src/app/**/route.ts` → **Completado** (Fase 5.0–5.4).
2. Marcar con `sinEmpresa` lo que cruza inquilinos → **Completado** en esa
   misma capa.
3. ~~Migrar las páginas y componentes de servidor (`.tsx`)~~ → **Completado**
   (85 archivos, cuatro tandas). El gate lo verifica en cada ejecución: la lista
   `PENDIENTES` está vacía y cualquier archivo nuevo sin contexto falla en el
   acto.
4. En una base de **prueba**: aplicar la Capa 2, cambiar `DATABASE_URL` a
   `membego_app`, ejercitar la aplicación entera.
5. `npm run rls:probar` contra esa base.
6. Recién entonces, producción — y con `docs/runbooks/` a mano, porque la marcha
   atrás es devolver `DATABASE_URL` al rol `postgres`, que se salta RLS.

### Tres cosas que apareció la migración, y que no eran RLS

Migrar 85 archivos obliga a leerlos, y leerlos encontró defectos que llevaban
tiempo ahí:

- **Ocho transacciones anidadas.** Varias pantallas mezclaban consultas de
  Prisma con llamadas a módulos que abren su propia transacción. Envolver el
  conjunto las metía dentro de una transacción ya abierta, lo que pide una
  segunda conexión desde dentro de la primera: con el pooler de Supabase por
  delante, así es como se agota el pool. No habría dado un error claro — habría
  dado timeouts intermitentes bajo carga.
- **Dos agujeros de autorización.** `promociones/[id]/editar` e
  `invitaciones/[id]/editar` leían la fila por su identificador sin mirar de qué
  empresa era: quien acertara el id abría la promoción o la campaña de otro
  negocio.
- **Un respaldo ciego.** El panel de plataforma cuenta clientes excluyendo las
  empresas de práctica y, si esa columna falta, cae a un conteo sin filtro. Ese
  camino de repuesto tampoco tenía contexto: habría devuelto cero justo el día
  que hiciera falta.

### Dónde cruzar empresas es la respuesta correcta

No todo lo que no lleva `conEmpresa` es un descuido. Una misma persona tiene una
**ficha por negocio**, y varias pantallas del cliente —«Mis beneficios», el
detalle de un beneficio, agendar su canje, el detalle de la membresía— ya
llevaban comentarios explicando que filtrar por la ficha activa hacía que una
recompensa reclamada en otro negocio se guardara bien y no apareciera en ningún
sitio. Ponerles `conEmpresa` habría reintroducido ese fallo con la firma de una
mejora de seguridad. Van con `sinEmpresa` y el motivo escrito; lo que las
protege es la comprobación de pertenencia contra `misClienteIds`.

Lo mismo el panel de plataforma (cruzar empresas es su trabajo), los intereses
de la persona, el conmutador de empresas, y las dos pantallas públicas —la
invitación por token y la landing de campaña— que se abren sin sesión y donde la
empresa se descubre AL resolver el enlace.

### Por qué el punto ciego importaba más que los 85 archivos

Un atraso conocido se planifica. Lo grave era el **✓ verde**: cualquiera que
leyera el gate o la Fase 5 concluiría que solo faltaba cambiar una variable de
entorno, y esa conclusión termina en una tarde con el panel en blanco y una
marcha atrás a ciegas. El gate ahora imprime el atraso con su número en cada
ejecución, y falla en el acto si aparece un archivo **nuevo** sin contexto.

---

## 5. La prueba de aislamiento

`npm run rls:probar`. Corre en CI, en el trabajo *Esquema de base de datos*.

No comprueba que las políticas **existan** — eso no diría nada, porque están
deducidas y nadie las ha leído una por una. Siembra dos empresas completas
(plan → cliente → membresía → visita) y mira qué devuelve la base:

```
✓ Lectura directa: con el contexto en A, no aparece ningún cliente de B
✓ Lectura por tabla hija: `visits` hereda el inquilino de `clientes`
✓ Escritura cruzada: A no puede insertar una fila con el companyId de B
✓ Modificación cruzada: un `update` sin `where` solo alcanza las filas de A
✓ Modo omnisciente: superadmin, marketplace público y cron siguen viendo todo
✓ Sin contexto de empresa no se ve nada (fallo cerrado, no abierto)
```

**Y se comprobó que la prueba puede fallar.** Una prueba que siempre pasa no
vale nada, así que se saboteó a propósito la política de `clientes`
(`using (true)`, como haría alguien "arreglando" un error de permisos). Resultado:
5 de 6 en rojo, incluida la de `visits` — lo que confirma que el camino deducido
por clave foránea depende de verdad del padre y no es decorativo.

También se verificó a través de Prisma, no solo en `psql`, porque lo que importa
es que funcione con el cliente que usa la aplicación:

```
conEmpresa("t1") sin where → [ 't1k' ]
conEmpresa("t2") sin where → [ 't2k' ]
sinEmpresa()      sin where → [ 'k1', 'k2', 't1k', 't2k' ]
```

Un `findMany` **sin `where`** devolviendo solo el inquilino: ese es el bug que
esto atrapa.

---

## 6. Lo que sigue sin estar cubierto

1. **La Capa 2 no está encendida en producción.** Hasta que lo esté, el
   aislamiento entre empresas sigue dependiendo solo de la aplicación. La
   Capa 1 sí cierra la puerta pública, que era la grave.
2. **La válvula `app.omnisciente` la puede abrir la propia aplicación.** No
   defiende de un servidor comprometido. La versión con dos roles queda
   pendiente.
3. **`storage.objects` no lleva políticas por empresa.** Hoy `comprobantes` está
   cerrado a cal y canto (solo `service_role`) y `avatars`/`logos` son públicos
   a propósito. Si algún día un bucket necesita separación por empresa, hay que
   escribirla aparte: esta capa solo cubre `public`.
4. **Sin pentest externo.** Lo de aquí está probado contra el modelo de amenaza
   que yo mismo escribí, que es exactamente el sesgo que un tercero rompe.
