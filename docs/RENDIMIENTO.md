# Presupuestos de rendimiento y tamaño del código

Cubre los puntos **27** y **29** del plan de `docs/AUDITORIA-PRODUCCION.md`
— Fase 7.

---

## 1. Presupuestos de bundle (punto 29)

### El problema

El JavaScript de una aplicación web solo crece. Nunca hay un día en que alguien
decida "hoy engordamos el bundle": hay cien días en que se añade una librería de
gráficos, un selector de fechas, un lector de QR, y cada uno suma cincuenta
kilobytes que nadie mira. Un año después la aplicación tarda seis segundos en
abrir en un teléfono de gama media con datos móviles, y ya no se puede señalar
al culpable porque no hay uno.

Un presupuesto no prohíbe crecer. Prohíbe crecer **sin darse cuenta**.

### Los tres números

`npm run presupuesto` (tras `npm run build`), y en CI dentro del trabajo
*Build de producción*.

| Qué | Medido hoy | Techo | Qué pregunta responde |
|---|---|---|---|
| JavaScript de cliente (todo) | 5.177 KB | 6.500 KB | ¿Se está haciendo pesado el proyecto en general? |
| **Entrada compartida** | **820 KB** | **1.000 KB** | **Lo que descarga SIEMPRE cualquier visitante. El que de verdad se siente** |
| Trozo individual más grande | 493 KB | 600 KB | ¿Hay una librería que debería cargarse a demanda? |

Se miden **sin comprimir**. Los bytes que viajan van con gzip o brotli y son
bastante menos, pero el tamaño sin comprimir es el que el navegador tiene que
parsear y compilar, y en un teléfono de gama media eso pesa más que la descarga.
Además es estable: no depende de cómo tenga configurada la compresión el CDN.

### Por qué no se usa "First Load JS"

Es el número que todo el mundo cita, y con Next 16 esta configuración ya no lo
imprime. Parsear una tabla que a veces sale y a veces no no es base para nada:
se miden los bytes en disco de `.next/static/chunks`, que es lo que de verdad se
descarga.

### Cuando el CI falle aquí

En orden:

1. Mirar **qué entró** en el último cambio y cargarlo con `next/dynamic` — como
   ya se hace con el lector de QR (`ScannerClient.tsx`), que es 280 KB que solo
   pagan quienes escanean.
2. Buscar una alternativa más ligera.
3. **Subir el techo a propósito** y anotar por qué en `scripts/presupuesto-bundle.mjs`.

La tercera es legítima. Lo que no vale es subirlo sin mirar.

---

## 2. Archivos grandes (punto 27) — lo que se midió y qué se hizo

El punto pedía *"dividir archivos de 900+ líneas y el schema por dominios"*.
Antes de dividir nada, la medición:

| Archivo | Líneas | Qué es |
|---|---|---|
| `src/modules/referidos/actions.ts` | 972 | Server actions |
| `src/modules/regalos/actions.ts` | 964 | Server actions |
| `src/lib/automation/playbooks/campaign.ts` | 950 | **Biblioteca de contenido** |
| `src/lib/automation/playbooks/membership.ts` | 932 | **Biblioteca de contenido** |
| `src/lib/automation/playbooks/gamification.ts` | 921 | **Biblioteca de contenido** |
| `src/modules/admin/actions.ts` | 917 | Server actions |
| `src/lib/automation/playbooks/referral.ts` | 916 | **Biblioteca de contenido** |

**Cinco de los siete son bibliotecas de contenido**, no lógica: catálogos de
playbooks declarativos, uno detrás de otro. Un archivo de 950 líneas de datos no
es complejidad; es una lista. Partirlo en tres de 300 no lo hace más fácil de
entender — hace falta abrir tres archivos para leer lo mismo.

**Los tres de server actions sí son lógica**, y ahí la división tendría sentido.
Pero dividir por número de líneas no es la razón correcta: la razón correcta es
que un archivo tenga más de una responsabilidad. Eso hay que mirarlo con el
código delante, en un cambio dedicado, y no como efecto colateral de una fase
que ya toca cuarenta archivos.

**Decisión: no se dividieron.** Cambiar la forma de código que funciona, sin una
pregunta concreta que responder, es riesgo sin beneficio medible.

### El esquema: de 4.003 líneas en un archivo a 14 por dominio — **hecho**

Este sí dolía de verdad: 112 modelos y 53 enums en un solo archivo es incómodo
de navegar todos los días. Ahora está en `prisma/schema/`, un archivo por
dominio, con el índice al principio de `base.prisma`.

| Archivo | Bloques | Qué contiene |
|---|---|---|
| `base` | 2 | Generador, origen de datos y el índice |
| `identidad` | 9 | Usuarios, empresas, sucursales, auditoría |
| `clientes` | 6 | El cliente final, vehículos, notas |
| `membresias` | 8 | Membresías, planes, QR, visitas |
| `promociones` | 9 | Promociones y compras |
| `marketplace` | 5 | Categorías, reseñas, capa social |
| `referidos` | 23 | Referidos, crecimiento, invitaciones |
| `caja` | 17 | Caja, transacciones, tickets, regalos |
| `motores` | 42 | Reglas, promociones universales, beneficios, automatizaciones |
| `campanas` | 15 | Campañas, ruleta, ofertas privadas |
| `citas` | 3 | Agenda y reservas |
| `soporte` | 7 | Tickets, FAQ, WhatsApp |
| `carwash` | 20 | Operación de pista |
| `pagos` | 1 | Pasarela |

La división salió de las secciones que el propio esquema ya tenía marcadas
(`// FASE 2: MARKETPLACE`, `// Caja (POS)`…), no de una organización inventada.

#### Cómo se demostró que no cambia nada

Un cambio en este archivo lo paga cada despliegue y cada migración, así que no
basta con que compile. Se comprobó en cuatro niveles, de menos a más
concluyente:

```bash
# 1. Ningún bloque perdido, duplicado ni alterado (167 bloques, comparados
#    tras normalizar espacios y comentarios).
# 2. El esquema sigue siendo válido y el cliente se genera igual.
npx prisma validate && npx prisma generate

# 3. Diff del modelo de datos ANTIGUO contra el NUEVO. Salida esperada:
#    "This is an empty migration" — cero diferencias.
npx prisma migrate diff \
  --from-schema-datamodel <schema.prisma original> \
  --to-schema-datamodel prisma/schema --script

# 4. LA PRUEBA QUE ZANJA EL ASUNTO: `db push` de cada versión sobre dos bases
#    vacías distintas y `pg_dump --schema-only` de ambas. Resultado: 2.953
#    líneas de DDL idénticas en las dos, salvo los dos tokens aleatorios que
#    pg_dump genera en cada invocación.
```

Y después, todo lo demás en verde: `tsc`, `eslint`, 187 pruebas, `next build`,
28 E2E y `npm run db:doctor` (112 modelos, 53 enums, sin desfase).

#### Lo que hubo que tocar además

- `package.json` → `prisma.schema: "prisma/schema"`. **Prisma 6.19 no detecta
  la carpeta solo**; sin esta línea dice "schema not found".
- `.github/workflows/ci.yml`, trabajo `esquema` → `--to-schema-datamodel prisma/schema`.
- `scripts/db-doctor.mjs` → concatena los `.prisma` de la carpeta en vez de leer
  un archivo.

#### Un hallazgo que salió por el camino

`prisma migrate diff --from-migrations` **falla en este repositorio**, y fallaba
igual antes de dividir nada:

```
Migration `20260705_add_multi_membership_support` failed to apply cleanly
to the shadow database. The underlying table for model `memberships` does not exist.
```

El historial de migraciones no se puede reproducir desde cero. Es la
consecuencia esperable de aplicarlas a mano en el SQL Editor durante meses —
alguna asume un estado que otra creó fuera del historial— y explica por qué el
trabajo `esquema` del CI lleva `continue-on-error: true`.

No es urgente: la base de producción está bien y `db push` desde el esquema
produce el resultado correcto. Pero significa que **hoy no se puede levantar un
entorno nuevo replicando las migraciones**, solo empujando el esquema. Si algún
día hace falta (un entorno de pruebas de verdad, o el simulacro de restauración
del § 5 de `docs/RECUPERACION.md`), habrá que consolidar el historial en una
migración base. No se hizo aquí porque es otro cambio, y arreglar dos cosas a la
vez en el archivo del que depende cada despliegue es exactamente lo que este
mismo documento decía que no había que hacer.

---

## 3. Lo que sigue sin medirse

1. **Los scripts de carga de k6 nunca se han ejecutado** (`tests/carga/`, Fase 4).
   El techo de "500-1.000 concurrentes" sigue siendo una estimación.
2. **No hay Lighthouse ni Core Web Vitals en CI.** Los presupuestos miden bytes,
   no experiencia: un bundle pequeño puede seguir dando un LCP malo por una
   imagen sin optimizar o una fuente que bloquea. La prueba E2E de "responde en
   menos de 8 s" es una red mínima, no una medición.
3. **No hay presupuesto para el CSS ni para las imágenes.** El CSS de Tailwind
   se poda solo y las imágenes pasan por `next/image`, así que hoy no son el
   problema — pero tampoco están vigilados.
