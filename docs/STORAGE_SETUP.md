# Supabase Storage — setup y diagnóstico de subida de imágenes

Corrige el error **"No se pudo subir la imagen"** (avatares, logos, comprobantes,
galería). El código de subida es correcto; el fallo está del lado de Supabase
Storage.

## Cómo aplicarlo

Son **tres archivos y el orden importa**: cada uno corrige las políticas del
anterior. Aplicar solo el primero deja el sistema en el estado inseguro que los
otros dos arreglan.

1. Abre el **SQL Editor** de tu proyecto en Supabase.
2. Ejecuta, en este orden:
   1. `prisma/migrations_manual/2026-07-storage-buckets.sql` — crea los buckets
      `avatars`, `logos` y `comprobantes`.
   2. `prisma/migrations_manual/2026-07-comprobantes-privado.sql` — pasa
      `comprobantes` a privado y le quita toda política: a partir de aquí solo
      se lee y escribe con URL firmada por el servidor.
   3. `prisma/migrations_manual/2026-08-storage-ownership.sql` — añade la
      comprobación de **propiedad** en `avatars` y `logos`. Sin este, cualquier
      usuario autenticado puede sobrescribir o borrar el logo de cualquier
      empresa.
3. Reintenta subir una imagen en la app.

Los tres son idempotentes: correrlos varias veces no hace daño.

> **Si ya tenías el paso 1 aplicado de antes**, ejecuta igualmente el 2 y el 3.
> Son los que cierran los dos huecos que encontró la auditoría (C-01 y C-04).

### Buckets que este setup NO cubre

El código sube además a `promociones` (promociones, campañas de invitación,
adjuntos de solicitudes) y a `evidencias` (carwash). Ningún SQL de este
repositorio los crea ni define sus políticas: si funcionan, es porque alguien
los configuró a mano en el panel. Eso significa que **nadie puede revisar esa
configuración leyendo el código**, y que un proyecto nuevo de Supabase no la
tendrá. Está pendiente decidir su visibilidad y llevarlos a un archivo como los
otros tres.

## Por qué fallaba

Las subidas se hacen **desde el navegador** con la sesión del usuario (rol
`authenticated`, key anónima). Para que `.upload()` funcione hacen falta tres
cosas en Supabase, y basta con que falte una para ver el error genérico:

| Causa | Síntoma en la pestaña Network / Console | Lo arregla el script |
|-------|------------------------------------------|----------------------|
| El bucket no existe | `400 Bucket not found` | Sí (crea los 3 buckets) |
| Falta política de INSERT/UPDATE para `authenticated` | `403 new row violates row-level security policy` | Sí (políticas 2b/2c) |
| El bucket no es público | La subida funciona pero la imagen no carga después | Sí (`public = true` + política 2a) |

Para confirmar cuál fue, abre DevTools → **Network**, reintenta la subida y mira
la petición a `.../storage/v1/object/...`: el código (`400` vs `403`) indica la
causa exacta. Ya no es necesario para arreglarlo — el script cubre las tres —
pero sirve para verificar.

## Nota de seguridad (comprobantes)

El bucket `comprobantes` queda **público** porque el código usa `getPublicUrl()`
para mostrarlos. Esto significa que cualquiera con la URL exacta puede ver un
comprobante de pago. Es aceptable a corto plazo (las URLs no son adivinables),
pero si se quiere endurecer, el paso siguiente es hacer ese bucket privado y
servirlo con URLs firmadas (`createSignedUrl`) — requiere un pequeño cambio de
código en `ComprobanteForm.tsx` y `ReportarProblemaForm.tsx`.
