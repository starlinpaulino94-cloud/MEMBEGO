-- ============================================================================
-- MEMBRESÍA · EVENTO «AJUSTADA»  ·  reportes de todo lo que pasa (Fase 2)
-- ============================================================================
--
-- Extender la vigencia de una membresía («extender la fecha de lavado») o
-- corregir sus lavados restantes solo dejaba una nota de auditoría genérica
-- (`NOTA_INTERNA` + payload.tipo): el reporte de ciclo de vida —que lee
-- `membresia_eventos`— no lo veía, y para quien pregunta «¿cuándo le
-- extendieron la membresía a este cliente?» el hecho no existía.
--
-- `AJUSTADA` es el tipo de evento que le da nombre propio. Los ajustes pasan a
-- escribir su fila en la historia de la membresía (además de la nota, que se
-- conserva para la bitácora), y el reporte de ciclo de vida los enseña.
--
-- Idempotente y no destructivo: solo AÑADE un valor al enum.
-- ============================================================================

ALTER TYPE "MembresiaEventoTipo" ADD VALUE IF NOT EXISTS 'AJUSTADA';
