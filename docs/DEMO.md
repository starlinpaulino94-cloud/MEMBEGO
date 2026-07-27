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
| 3 | **Vitrina pública** | Un cliente real no puede tropezarse con la empresa de práctica y creer que le va a lavar el carro. | `src/modules/marketplace/queries.ts` |
| 4 | **Métricas de plataforma** | Si los 40 clientes inventados de un entrenamiento suman a "clientes totales", el número deja de servir — y nadie se entera de que dejó de servir. | `src/app/(superadmin)/superadmin/dashboard/page.tsx` |

### Lo que NO se corta, a propósito

- **Transferencia bancaria** sigue disponible. Es manual: alguien tendría que ir
  al banco a propósito. Y practicar el flujo de subir y validar un comprobante
  es justo lo que se entrena.
- **Notificaciones internas (campanita)**: son parte de lo que el personal tiene
  que aprender a ver, y no salen de la aplicación.

## El aviso

`src/components/system/BannerDemo.tsx` se muestra **siempre**, pegado bajo el
encabezado, en el panel (`(admin)/layout.tsx`) y en el portal del cliente
(`(cliente)/layout.tsx`). No se puede cerrar: el riesgo de una empresa de
práctica no es que alguien la use mal, es que alguien **no sepa** que está en
ella, y un aviso que se cierra deja de avisar justo cuando importa.

## Cómo se usa

1. **Crear**: `/superadmin/demo` → "Nueva empresa de práctica". Es el mismo
   formulario que una empresa real (crear el alta también es parte de lo que se
   entrena); lo único distinto es la marca, que va en un campo oculto porque
   se entra por esa pantalla o no se entra.
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

## Migración

`prisma/migrations/20260767_empresa_demo/migration.sql` — aditiva: una columna
booleana con `DEFAULT false`, un índice parcial y dos valores nuevos del enum
`AuditAccion`. Ninguna empresa existente cambia de comportamiento. Se corre a
mano en el SQL Editor de Supabase; el aviso de migraciones pendientes del
superadmin la vigila (`src/modules/superadmin/migraciones.ts`).
