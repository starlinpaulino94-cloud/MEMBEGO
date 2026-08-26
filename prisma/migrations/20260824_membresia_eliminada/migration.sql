-- ─────────────────────────────────────────────────────────────────────────────
-- MEMBRESIA_ELIMINADA · nuevo valor de la bitácora
--
-- Hace falta para poder BORRAR de verdad una membresía que nunca llegó a
-- usarse (sin visitas, sin comprobantes, sin pagos confirmados) — la basura
-- que dejan las pruebas. Cancelar no sirve para eso: deja el registro puesto.
--
-- El asiento de auditoría es lo ÚNICO que queda cuando la fila desaparece, así
-- que la acción tiene su propio valor y no se mezcla con MEMBRESIA_CANCELADA:
-- «se dio de baja» y «dejó de existir» son preguntas distintas y quien audite
-- tiene que poder distinguirlas.
--
-- Aditivo y con IF NOT EXISTS: se puede ejecutar dos veces sin daño.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'MEMBRESIA_ELIMINADA';
