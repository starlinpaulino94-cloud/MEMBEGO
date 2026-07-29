# Migraciones y esquema de base de datos

Este proyecto usa **Prisma** sobre **Supabase PostgreSQL**. Históricamente el
esquema base se creó con `prisma db push` y una serie de scripts SQL sueltos, y
las migraciones formales (`prisma/migrations/`) solo contienen cambios
incrementales posteriores. Por eso, hasta ahora **no existía una forma de
reconstruir la base de datos desde cero** con `prisma migrate deploy`.

Este documento aclara los caminos soportados.

## Estructura

```
prisma/
├── schema/                  # Fuente de verdad del modelo de datos (un archivo por dominio)
├── baseline/
│   └── full_schema.sql      # Esquema COMPLETO actual, generado desde prisma/schema/
├── migrations/              # Migraciones incrementales que corre `migrate deploy`
│   ├── 20260705_add_multi_membership_support/
│   ├── 20260706_add_marketplace_fase2/
│   ├── 20260706_add_performance_indexes/
│   └── 20260707_sync_app_roles/
└── legacy_sql/              # Scripts SQL históricos ya aplicados (solo referencia)
```

- **`baseline/full_schema.sql`**: crea TODO el esquema actual (enums, tablas,
  índices, claves foráneas). Se regenera con:
  ```bash
  npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema --script > prisma/baseline/full_schema.sql
  ```
- **`legacy_sql/`**: scripts que se ejecutaron manualmente en su momento para
  construir el esquema. **Ya no se usan**; se conservan solo como historia. No
  los ejecutes en una base nueva: su contenido ya está en `baseline/full_schema.sql`.

## Caminos soportados

### A. Base de datos NUEVA (desde cero)

Opción rápida (desarrollo):
```bash
bun run db:push        # aplica prisma/schema/ directamente
bun run db:seed        # datos de prueba
```

Opción con SQL explícito (p. ej. un entorno donde solo tienes `psql`):
```bash
psql "$DIRECT_URL" -f prisma/baseline/full_schema.sql
```
Esto deja la BD con el esquema completo actual (incluye ya todos los cambios de
las migraciones incrementales y los roles nuevos).

### B. Base de datos EXISTENTE (producción) — aplicar cambios nuevos

Vercel **no** corre migraciones automáticamente. Antes de cada release con
cambios de esquema, ejecuta desde tu máquina apuntando `.env` a producción:
```bash
bun run db:migrate:deploy   # aplica las migraciones pendientes en prisma/migrations
```
Migraciones pendientes relevantes:
- `20260707_sync_app_roles`: agrega los roles `ADMINISTRADOR`, `GERENTE`,
  `CAJERO`, `RECEPCION` al enum `AppRole`.
- `20260725_add_rule_engine_core`: crea la infraestructura del Motor Universal
  de Reglas (`rule_groups`, `rules`, `rule_conditions`, `rule_actions`,
  `rule_execution_logs`). Solo AÑADE tablas/enums nuevos; no altera nada previo.
- `20260726_add_rule_condition_groups`: Fase 2 del Rule Engine. Añade el enum
  `RuleLogicalOperator`, la tabla `rule_condition_groups` (árbol booleano
  auto-anidable) y las columnas `groupId`/`conditionType`/`dataType` (con DEFAULT)
  en `rule_conditions`. Additivo y seguro sobre filas existentes.
- `20260727_add_action_engine_config`: Fase 3 (Action Engine). Añade a
  `rule_actions` las columnas `obligatoria`, `maxReintentos`, `activa`, `version`
  (con DEFAULT) para configurar cada acción por datos. Additivo y seguro.
- `20260728_add_promotion_framework`: Fase 4 (Framework Universal de
  Promociones). Añade el enum `PromotionStatus` y las tablas `promotions`,
  `promotion_rules`, `promotion_actions`, `promotion_restrictions`,
  `promotion_versions`, `promotion_audits`. Solo AÑADE; el modelo `Promocion`
  (marketplace) queda intacto.
- `20260729_add_data_dictionary`: Fase 6 (Business Data Dictionary). Añade el
  enum `DictionaryVariableStatus` y las tablas `data_dictionary_variables` y
  `data_dictionary_variable_versions` (variables custom/por-empresa; el catálogo
  estándar vive en código). Solo AÑADE.
- `20260730_add_membership_engine`: Fase A (Membership Engine universal). Añade
  los enums `MembershipPlanType`/`MembershipPeriodicity`/`MembershipInstanceStatus`
  y las tablas `membership_plans`, `membership_instances`, `membership_usage`.
  Solo AÑADE; el modelo `Membership` (Car Wash) queda intacto.

> Si prefieres `db:push`, también sincroniza el enum, pero `migrate:deploy` deja
> registro en `_prisma_migrations` y es lo recomendado para producción.

## Nota sobre consolidación total del historial

Convertir `baseline/full_schema.sql` en una migración `0_init` y marcar el
historial existente como baseline (`prisma migrate resolve --applied`) es
posible, pero requiere ejecutarse con cuidado sobre una BD de staging para no
romper el estado de `_prisma_migrations` en producción. Se dejó como paso
futuro deliberado; el baseline de arriba ya cubre la reconstrucción desde cero.
