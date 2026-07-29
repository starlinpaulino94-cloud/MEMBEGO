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

### El `schema.prisma` de 4.003 líneas

Este sí duele de verdad: 112 modelos en un archivo es incómodo de navegar todos
los días. Prisma 6 admite dividirlo en `prisma/schema/` por dominios, y el
esquema ya trae las secciones marcadas por su autor (`// FASE 2: MARKETPLACE`,
`// Caja (POS)`, etc.), así que la división saldría de la organización que ya
existe y no de una inventada.

**Tampoco se hizo aquí, y por una razón concreta:** ese archivo es del que
depende cada despliegue y cada migración. Mezclar su reorganización con una PWA,
una cola sin conexión, pruebas E2E y presupuestos de bundle produce un diff que
nadie puede revisar — y "nadie puede revisarlo" es exactamente cómo se cuela un
cambio sutil de esquema.

Va en su propio cambio, y es demostrable que no altera nada. La lista de
comprobación que lo haría seguro:

```bash
npx prisma validate                      # el esquema sigue siendo válido
npx prisma generate                      # el cliente se genera igual

# LA PRUEBA QUE IMPORTA: no debe haber ninguna diferencia entre las
# migraciones existentes y el esquema dividido. Si sale algo, la división
# cambió el modelo de datos.
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema \
  --shadow-database-url "$DATABASE_URL" --exit-code

npx tsc --noEmit && npm run build && npm test && npm run e2e
```

Y hay que acordarse de dos sitios que apuntan a la ruta vieja:
`.github/workflows/ci.yml` (el trabajo `esquema`) y `scripts/db-doctor.mjs`
(`SCHEMA_PATH`).

**Recomendación:** hacerlo, pero solo. Es de las pocas mejoras de esta fase que
se paga sola en tiempo de desarrollo.

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
