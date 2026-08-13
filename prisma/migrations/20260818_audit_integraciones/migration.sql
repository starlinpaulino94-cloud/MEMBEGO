-- Las tres acciones del panel de integraciones dejan rastro.
--
-- «Probar el webhook» manda peticiones al dominio de un tercero; «reenviar
-- ahora» y «devolver los agotados a la cola» mueven la cola de eventos de TODAS
-- las empresas que usan ese satélite. Ninguna de las tres escribía nada: si un
-- martes se reencolaron mil eventos y el satélite se quejó de duplicados, no
-- había forma de saber quién los reencoló ni a qué hora.
--
-- La sonda además se guarda para poder LEERLA después: su resultado vivía solo
-- en el estado de un componente y desaparecía al cambiar de página, así que la
-- respuesta que había que reenviarle al equipo del satélite se perdía en cuanto
-- alguien hacía clic en otro sitio.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_SONDEADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_REINTENTADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_REENCOLADA';
