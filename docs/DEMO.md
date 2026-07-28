# Empresas de demostración

Empresas que existen para **entrenar al personal**, no para operar. Dentro se
hace el procedimiento completo —registrar un cliente por el enlace, venderle,
cobrarle, canjearle, atenderlo en la pista— y nada de eso es real.

## La regla que lo ordena todo

> Una empresa demo se comporta igual que una real **hacia adentro** y no existe
> **hacia afuera**.

**Hacia adentro** todo funciona: promociones, membresías, QR, pista, caja,
reportes, comisiones, incidencias. Si algo se comportara distinto, el
entrenamiento enseñaría un sistema que no es el que van a usar.

**Hacia afuera** se corta en cuatro puntos, y cada uno responde a un daño
concreto:

| # | Qué se corta | Por qué | Dónde está |
|---|---|---|---|
| 1 | **Pasarela de pago real (CardNET)** | Es el único punto donde el dinero de alguien se mueve de verdad. Una tarjeta cobrada en un entrenamiento es un cobro que hay que devolver. | `src/modules/pagos/metodosDisponibles.ts` |
| 2 | **Correos salientes** | Un "tu membresía venció" llegando a una persona real desde una empresa inventada es confuso en el mejor caso y dañino en el peor. | `src/lib/email.ts` (guard por `companyId`) |
| 3 | **Todo lo que ofrece empresas** | Un cliente real no puede tropezarse con la empresa de práctica y creer que le va a lavar el carro. | ver "Quién la ve" abajo |
| 4 | **Métricas de plataforma** | Si los 40 clientes inventados de un entrenamiento suman a "clientes totales", el número deja de servir — y nadie se entera de que dejó de servir. | `src/app/(superadmin)/superadmin/dashboard/page.tsx` |

### Lo que NO se corta, a propósito

- **Transferencia bancaria** sigue disponible. Es manual: alguien tendría que ir
  al banco a propósito. Y practicar el flujo de subir y validar un comprobante
  es justo lo que se entrena.
- **Notificaciones internas (campanita)**: son parte de lo que el personal tiene
  que aprender a ver, y no salen de la aplicación.

## Quién la ve: la línea entre ofrecer y tener

La regla, en una frase: **a una empresa de práctica solo se llega por su enlace
de registro.** Nadie más la ve, en ninguna pantalla.

La línea que separa los dos lados no es "público vs. privado", es **ofrecer vs.
tener**:

- **OFRECER** — la vitrina pública, el explorar, las promociones destacadas,
  las nuevas, las que vencen pronto, las empresas recomendadas, el modo marca
  única. En todas ellas quien mira no pidió ver esa empresa: se la estamos
  poniendo delante nosotros. Ahí va `SIN_DEMO` (`src/modules/demo/index.ts`),
  y una empresa de práctica no aparece jamás.
- **TENER** — sus empresas, sus membresías, sus promociones, su QR, su menú.
  Quien entró por el enlace es cliente de esa empresa y adentro tiene que verlo
  todo. Esas consultas se acotan por `companyId` (que ya es la prueba de que la
  empresa es suya) y **no** llevan el filtro.

Puntos concretos donde se aplica:

| Superficie | Archivo | Qué pasa |
|---|---|---|
| Vitrina pública, perfil `/empresas/<slug>`, destacadas, recientes, estadísticas | `modules/marketplace/queries.ts` | No aparece. El perfil devuelve 404 aunque se tenga la URL. |
| Feed del cliente: destacadas, nuevas, expiran, recomendadas | `modules/social/queries.ts` (`promoVigente`, `baseWhere`) | No aparece. |
| Empresas que sigo | `modules/social/queries.ts` (`getMisEmpresas`) | No aparece. |
| Botón "Seguir" | `modules/social/actions.ts` | Rechazado: seguirla la metería en el feed de alguien que nunca pidió verla. |
| Modo marca única | `modules/marketplace/marcaUnica.ts` | No cuenta: crear una empresa de práctica no puede cambiarle la portada al negocio real. |
| **Sus propias promociones** | `modules/social/queries.ts` (`promoDeMisEmpresas`), `marketplace/queries.ts` (`getClientePromociones`) | **Sí las ve.** Sección "De tus empresas". |
| **Su menú de Promociones** | `modules/cliente/navDisponible.ts` | **Sí aparece.** |

Dos correcciones de paso, que afectan también a empresas reales: la sección del
feed antes se llamaba "De empresas que sigues" y solo miraba a quién sigues;
ahora es "De tus empresas" e incluye aquellas donde eres cliente, las sigas o
no. Y el menú de Promociones del cliente ya no exige que el negocio esté
publicado en la vitrina — una empresa que aún no se publicó también tiene
clientes, y les escondía el módulo.

## El aviso

`src/components/system/BannerDemo.tsx` se muestra **siempre**, pegado bajo el
encabezado, en el panel (`(admin)/layout.tsx`) y en el portal del cliente
(`(cliente)/layout.tsx`). No se puede cerrar: el riesgo de una empresa de
práctica no es que alguien la use mal, es que alguien **no sepa** que está en
ella, y un aviso que se cierra deja de avisar justo cuando importa.

## Quién entra a la empresa de práctica

Hay dos formas, y la primera es la normal:

**Cuenta existente (recomendada).** Se le da acceso al administrador que **ya
usa la plataforma**. No se crea ninguna cuenta, no hay otra contraseña que
recordar y —lo importante— **no se le cambia su empresa activa**: sigue en su
negocio, y la empresa de práctica le aparece en el selector de empresas de
arriba del panel. Entra al modo de prueba con dos clics y vuelve igual. Es lo
que hace que "entrenar" no sea "cerrar sesión y volver a entrar con otro
correo".

**Cuenta nueva.** Se crea un usuario aparte con su correo y contraseña. Tiene
sentido cuando la empresa es de otra persona, o cuando se quiere una cuenta de
entrenamiento compartida y desechable.

Se elige al crear la empresa (`/superadmin/demo/nueva` o
`/superadmin/empresas/nueva`) y se puede cambiar después desde la tarjeta de la
empresa en `/superadmin/demo`, agregando o quitando personas de una en una.

### El encierro que esto podía provocar (y cómo se evita)

El selector de empresas se arma con las filas de `UserCompanyAccess` **más** la
empresa activa. Parece completo, pero tenía un agujero: si la empresa de siempre
de una persona no tenía fila en `UserCompanyAccess` —el caso normal hasta ahora,
porque se llegaba a ella por `User.companyId` y ya—, en cuanto cambiaba a otra
empresa la suya desaparecía de la lista: dejaba de ser la activa, nunca tuvo
fila, y el selector ya no la podía ofrecer. **Quedaba encerrada en la empresa a
la que acababa de entrar.**

Antes no salía a la luz porque casi nadie tenía dos empresas. Vincular un
administrador a una empresa de práctica lo provoca a la primera: entra a
practicar y no puede volver a su negocio.

Por eso, al dar acceso a una empresa nueva se escribe **también** la fila de su
empresa de siempre (`filasDeAcceso` en `src/modules/empresas/accesos.ts`, con
pruebas en `tests/accesos.test.ts`). Es idempotente y no concede nada que la
persona no tuviera ya: solo hace explícito lo que era implícito.

Quitar el acceso tiene el cuidado simétrico: si esa empresa es la que la persona
tiene abierta en ese momento, primero se la devuelve a otra de las suyas, y si
no le queda ninguna se rechaza la operación en vez de dejarla sin panel.

## Cómo se usa

1. **Crear**: `/superadmin/demo` → "Nueva empresa de práctica". Es el mismo
   formulario que una empresa real (crear el alta también es parte de lo que se
   entrena); lo único distinto es la marca, que va en un campo oculto porque
   se entra por esa pantalla o no se entra. Ahí se elige si la administra una
   cuenta existente o una nueva.
2. **Entrenar**: copiar el **enlace de registro** (`/registro/<slug>`) y
   compartirlo. Quien se registre por ahí es cliente de esa empresa y, por
   tanto, cliente de práctica.
3. **Reiniciar**: en `/superadmin/demo`, con confirmación escrita
   (`REINICIAR`). Antes de escribirla se ve el inventario exacto de lo que se
   va a borrar.
   - **Borra**: clientes y su rastro (membresías, compras, visitas, QR,
     vehículos, tickets), cobros, sesiones de caja e intentos de pago, y el
     trabajo de pista (cola, incidencias, comisiones, turnos, cargos a flotas).
   - **Conserva**: la configuración — planes, promociones, servicios, precios,
     tipos de vehículo, bahías, empleados y capacidades. Es lo que costó montar;
     borrarlo obligaría a rearmar la empresa cada vez y, a la tercera, nadie la
     rearma y se entrena sobre la empresa de verdad.
4. **Convertir en real**: solo si está **vacía**. Ascender una empresa con
   clientes inventados dentro metería esa basura en las estadísticas como si
   fuera negocio. Primero se reinicia, después se convierte.

## Notas de implementación

- **`esEmpresaDemo` falla CERRADO** (`src/modules/demo/index.ts`), al revés que
  casi todo el sistema: si no se puede leer la empresa, se asume que **no** es
  demo. Equivocarse hacia "no es demo" deja el sistema como estaba;
  equivocarse hacia "sí es demo" apagaría la pasarela de una empresa real que
  sí necesita cobrar.
- **`nombreSiEsDemo`** resuelve en una sola consulta las dos preguntas del
  layout (¿pongo el aviso? ¿con qué nombre?), porque el layout corre en cada
  clic.
- El dashboard del superadmin lee `esDemo` con **doble camino**: si la columna
  todavía no está migrada, reintenta sin ella. El centro de control no puede
  quedarse en blanco por una columna que aún no existe.
- `purgarClienteRow` vive en `src/modules/superadmin/purgar.ts` y **no** en un
  archivo `'use server'`: allí cada export se convierte en un endpoint llamable
  desde el navegador, y exportar "borra este cliente por id" habría creado sin
  querer un botón de borrado sin autenticación.
- Dar y quitar acceso se hace **de a uno**
  (`src/modules/empresas/accesosActions.ts`), no reemplazando el conjunto
  completo. La pantalla de Usuarios ya permite reasignar todas las empresas de
  una persona de golpe; eso sirve para arreglar a alguien, pero si se abre para
  sumar una empresa y se guarda con una casilla desmarcada por accidente, se le
  quita el acceso a un negocio real.

## Migración

`prisma/migrations/20260767_empresa_demo/migration.sql` — aditiva: una columna
booleana con `DEFAULT false`, un índice parcial y dos valores nuevos del enum
`AuditAccion`. Ninguna empresa existente cambia de comportamiento. Se corre a
mano en el SQL Editor de Supabase; el aviso de migraciones pendientes del
superadmin la vigila (`src/modules/superadmin/migraciones.ts`).
