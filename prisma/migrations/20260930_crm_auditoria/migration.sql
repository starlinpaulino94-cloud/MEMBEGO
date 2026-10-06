--- CRM · valores de auditoría para prospectos y respuestas automáticas.
--- Aditiva y sin riesgo: solo añade valores a un enum. Rollback: ninguno hace
--- falta —un valor de enum sin usar no molesta a nadie—, y quitarlo exigiría
--- recrear el tipo entero.
---
--- POR QUÉ ESTA MIGRACIÓN VA ANTES QUE SU CÓDIGO
---
--- Las actions del CRM escriben estos valores. Si el código llega a producción
--- antes que la migración, PostgreSQL rechaza el valor desconocido. Por eso la
--- escritura de la bitácora es «best-effort» y va fuera de la transacción del
--- prospecto: mientras falte esta migración no habrá rastro —un coste real—,
--- pero el CRM sigue funcionando en vez de quedarse de solo lectura con un
--- «Ocurrió un error» por toda explicación. Mismo razonamiento que
--- `auditarPlan` en `modules/admin/planActions.ts`.
---
--- `ADD VALUE` es legal dentro de una transacción desde PostgreSQL 12 siempre
--- que el valor no se USE en esa misma transacción. Aquí solo se declara, así
--- que corre tal cual en el editor SQL de Supabase.

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROSPECTO_CREADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROSPECTO_ACTUALIZADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROSPECTO_DESCARTADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROSPECTO_ETAPA_CAMBIADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROSPECTO_ASIGNADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'AUTO_RESPUESTA_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'AUTO_RESPUESTA_ACTUALIZADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'AUTO_RESPUESTA_ELIMINADA';
