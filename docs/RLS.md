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

1. `ENABLE ROW LEVEL SECURITY` en las 112 tablas. Sin políticas, RLS deniega:
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
Cubiertas por política de inquilino: 112 de 112
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
su empresa. En MembeGo eso son **765 puntos de consulta**. Encenderlo de golpe
significaría cambiar `DATABASE_URL` y descubrir en producción cuáles se
quedaron fuera — y este contenedor no tiene acceso a tu base para probarlo antes.

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

1. Migrar a `conEmpresa` los módulos de `/admin` (los 28 archivos que ya usan
   `resolveCompanyId`, que es el punto donde se resuelve la empresa).
2. Marcar con `sinEmpresa` lo que cruza inquilinos: marketplace, superadmin,
   cron, trabajos de la cola.
3. En una base de **prueba**: aplicar la Capa 2, cambiar `DATABASE_URL` a
   `membego_app`, ejercitar la aplicación entera.
4. `npm run rls:probar` contra esa base.
5. Recién entonces, producción — y con `docs/runbooks/` a mano, porque la marcha
   atrás es devolver `DATABASE_URL` al rol `postgres`, que se salta RLS.

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
