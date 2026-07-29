-- Invita y Gana · contenido editable del módulo del cliente.
-- Añade la columna `contenido` (jsonb) a campanas_invitacion para guardar los
-- textos que el superadmin/admin personaliza (subtítulo, etiquetas, mensaje de
-- compartir, títulos, nombres de estadísticas, historial, estado vacío, botones).
--
-- Idempotente: se puede ejecutar varias veces sin error. NO toca datos
-- existentes; las campañas sin textos personalizados usan los valores por
-- defecto de la aplicación (src/lib/invitaContenido.ts).

ALTER TABLE "campanas_invitacion"
  ADD COLUMN IF NOT EXISTS "contenido" jsonb;
