-- Desactivar una membresía deja de llamarse «cancelar».
--
-- `desactivarMembresia` pone el estado en VENCIDA y escribía
-- `MEMBRESIA_CANCELADA`. Son dos operaciones distintas —una la da por
-- terminada, la otra la caduca antes de tiempo— y la bitácora las llamaba
-- igual. El payload llevaba `nuevaAccion: 'VENCIDA'`, pero la etiqueta que se
-- lee en la lista y la que se filtra en Auditoría decían «cancelada».
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'MEMBRESIA_DESACTIVADA';
