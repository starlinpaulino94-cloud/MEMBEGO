# Campañas conjuntas (superadmin)

Una promoción o una membresía que el superadmin define **una sola vez** y se
crea en **varias empresas** a la vez. Sirve para marketing conjunto entre los
negocios de la plataforma.

Pantalla: `/superadmin/campanas`

## Cómo funciona (y por qué así)

Al aplicar una campaña, cada empresa participante recibe una **copia real** de
la oferta dentro de su propio catálogo. No existe una "promoción global" sin
dueño.

**La razón es de arquitectura, no de comodidad.** Todo el sistema asume que
cada fila tiene UNA empresa dueña (`companyId`): el canje, la caja, la
facturación, los reportes y los permisos por rol. Una promoción sin dueño
obligaría a reescribir las 33 consultas de promociones más el motor de canje —
justo el núcleo que las reglas del proyecto prohíben tocar
(`docs/ESTRATEGIA-PLATAFORMA.md`, regla 4).

Con copias reales:

- El cliente ve "20% en CARTOWN" como una oferta normal de ese negocio.
- Canjea donde la tomó, con el flujo de siempre.
- Cada empresa puede pausar o ajustar la suya sin afectar a las demás.
- El canje, la caja y los reportes funcionan **sin un solo cambio**.

## Flujo de uso

1. **Crear** (queda en BORRADOR). Eliges qué se genera —promoción o membresía—,
   llenas la plantilla y marcas las empresas: todas las activas, o una lista.
   Crear NO reparte nada todavía: es para que puedas revisar.
2. **Aplicar**. Recorre las empresas y crea la oferta en cada una.
   - Es **idempotente**: una empresa que ya recibió su copia no la recibe dos
     veces. Puedes volver a aplicar cuando entre una empresa nueva.
   - Es **tolerante a fallos**: si una empresa falla, se guarda el error en esa
     fila y las demás continúan. El detalle muestra cuál falló y por qué.
   - Con "todas las empresas" marcado, al volver a aplicar se incorporan
     automáticamente las empresas creadas después.
3. **Archivar**. Desactiva la oferta en TODAS las empresas participantes.
   No borra nada: el historial de canjes y compras se conserva.

## Qué se puede repartir

| Tipo | Crea en cada empresa | Campos de la plantilla |
|---|---|---|
| `PROMOCION` | Una fila en `promociones` | Título, descripción, descuento, vigencia, si es comprable y su precio, usos por compra |
| `PLAN` | Una fila en `plans` | Nombre, precio, usos incluidos (o ilimitado), duración en días, descripción |

## Migración

`prisma/migrations/20260760_campanas_globales/migration.sql` — crea
`campanas_globales` y `campana_global_empresas`. **No modifica ninguna tabla
existente.** Idempotente, con verificación de 2 filas al final. Si no se corre,
la pantalla muestra un aviso y nada más se rompe.

## Límite conocido (decisión, no olvido)

El cliente canjea **en la empresa donde tomó la oferta**, no en cualquiera de
las participantes. Un cupón único canjeable en todos los negocios a la vez es
otra cosa: exige que el canje, la caja y los reportes dejen de asumir una sola
empresa dueña, y abre la pregunta de quién cobra y cómo se liquida entre
negocios. Si el negocio lo pide, se diseña aparte — la base de campañas ya
queda lista para colgarlo.
