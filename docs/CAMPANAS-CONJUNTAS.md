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

---

# Campañas EN CADENA (marketing cruzado entre negocios)

Además de replicar la misma oferta, una campaña puede ser una **cadena**: cada
empresa aporta un beneficio **distinto**, y **canjear uno desbloquea el
siguiente**.

**Ejemplo real:** carwash + restaurante.
1. **Paso 1 — Carwash:** lavado gratis. El cliente lo toma él mismo.
2. **Paso 2 — Restaurante:** 20% en desayuno. Aparece **solo** cuando canjea el lavado.

## Por qué esto funciona para los dos negocios

El carwash paga un lavado y a cambio lleva su cliente al restaurante. El
restaurante recibe un cliente **que ya demostró que se mueve**, no un volante.
Y el cliente encadena dos beneficios sin registrarse dos veces.

## Cómo entra el cliente (sin pantallas nuevas)

El beneficio del paso 1 se publica como una **promoción normal** del carwash.
El cliente la adquiere como cualquier otra; al hacerlo queda inscrito en la
cadena automáticamente (`vincularCompraSiEsPaso`). Los pasos siguientes se
crean como promociones **privadas** — no se pueden tomar por su cuenta, solo
llegan por la cadena.

## El puente entre empresas

`Cliente` es una fila **por empresa** (`@@unique([supabaseId, companyId])`), así
que el cliente del carwash no existe en el restaurante. Al desbloquear el paso 2
se busca —o se crea— su ficha en la empresa destino usando su `supabaseId`, con
`canalOrigen = 'CAMPANA_CONJUNTA'`. Eso es exactamente lo que la campaña le
promete al aliado: **clientes nuevos, trazables**.

## Dónde se engancha

`avanzarCadenaTrasCanje()` se llama en `confirmarCanjePromocion` **después** de
que la transacción del canje ya está confirmada, y con fail-open: si la cadena
falla, se registra en el log pero **el canje no se revierte**. Un canje ya
cobrado nunca se deshace por un problema de marketing.

El empleado que escanea ve un aviso: *"Se desbloqueó «20% en desayuno» en El
Fogón"*, para que se lo diga al cliente en el mostrador.

## Imágenes

- **Portada de la campaña** (`campanas_globales.imagenUrl`).
- **Imagen por beneficio** (`campana_pasos.imagenUrl`); si se deja vacía, se
  hereda la portada.

## Migración

`prisma/migrations/20260761_campanas_cadena/migration.sql` — añade
`campana_pasos`, `campana_inscripciones`, las columnas `modo`/`imagenUrl` de la
campaña y `producto_compras.campanaPasoId`. Todo aditivo y nullable; con
verificación de 4 filas al final.

## Límites conocidos

- La cadena es **lineal** (1 → 2 → 3). No hay ramas ni "elige uno de estos dos".
- El desbloqueo ocurre cuando la compra queda **CONSUMIDA** (último uso). Un
  beneficio de varios usos desbloquea el siguiente al agotarse, no al primer uso.
- No hay vencimiento propio del eslabón: se usa el de la promoción generada.
