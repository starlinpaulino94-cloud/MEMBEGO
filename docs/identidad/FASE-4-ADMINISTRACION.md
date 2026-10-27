# Verificación de identidad · Fase 4 — Administración

Estado: **construida y probada (código fuente, render y base de datos); sin verla en un navegador con sesión real de
SUPERADMIN.** Sigue apagada: la verificación no se ofrece a nadie hasta que se encienda el interruptor (entorno completo +
interruptor en base de datos; la capacidad por empresa solo gobierna la insignia de la ficha), y no se usa con documentos reales hasta el dictamen legal y el contrato con el
proveedor. Base: [AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md),
[FASE-1-BACKEND.md](./FASE-1-BACKEND.md), [FASE-2-PROVEEDOR.md](./FASE-2-PROVEEDOR.md) y [FASE-3-CLIENTE.md](./FASE-3-CLIENTE.md).

## Qué puede hacer el equipo

Una sección **Identidad** en el panel de superadmin (`/superadmin/identidad`, menú «Negocio», después de Usuarios), con
cuatro pestañas, y una ficha por persona (`/superadmin/identidad/[userId]`).

| Pieza pedida | Dónde |
|---|---|
| Consultar el estado de identidad | **Resumen**: compuerta (entorno / interruptor), intentos de 24 h por estado, verificadas vigentes y las que vencen en 30 días. **Personas**: búsqueda por correo o nombre (mínimo 3 letras; no hay listado completo a propósito). **Ficha**: estado, vigencia, permisos dados, intentos, incidencias y línea de tiempo |
| Revisar intentos e incidentes | Intentos con su estado y código de razón en la ficha; **Incidencias** (abiertas / resueltas) con «tomar» y «resolver» |
| Gestionar casos en revisión humana | **Revisión**: cola de casos (los más antiguos primero; se marca el que espera por documento repetido). En la ficha: **rechazar** o **pedir que repita** |
| Consultar registros de auditoría | **Actividad**: bitácora filtrada a la identidad (`IDENTIDAD_*` + entidad `IdentidadVerificacion`), con las etiquetas en español |
| Restringir a personal autorizado | Solo `SUPERADMIN`, en todas las capas (ver abajo) |
| Las empresas no descargan documentos de otros | Ninguna empresa llama a nada de la identidad; lo único que ve de una persona es la insignia «Identidad verificada» de su ficha |

Acciones del equipo (todas con texto de motivo o confirmación explícita, todas con asiento de auditoría):
`resolverRevisionAction` (rechazar o pedir repetición), `atenderIncidenciaAction` (tomar / resolver con respuesta a la
persona), `pedirRevalidacionAction`, `revocarVerificacionAction`, `suprimirIdentidadAction` (derecho de supresión, con
casilla «entiendo que es definitivo») y `cambiarInterruptorAction` (el interruptor general, con motivo).

## Reglas que el código hace cumplir

- **Solo SUPERADMIN, en tres capas** (cada una vuelve a comprobar): la página (`requireRole('SUPERADMIN')`), la acción
  (`requireSuperadmin()` al empezar, cada una) y el servicio (`exigirGestionDeIdentidad(actor)` al empezar cada función de
  `staff.ts`). Un formulario enviado a mano por otro rol no pasa.
- **El equipo no puede acreditar a nadie.** No existe acción de «aprobar». Un caso en revisión solo se puede **rechazar** o
  **pedir que repita**; aprobarlo ocurre en la consola del proveedor, donde está la evidencia, y el resultado vuelve por
  aviso firmado o por reconciliación. `aplicarDecision` sigue siendo la única que escribe «verificada», y solo la llama
  `sincronizacion.ts`.
- **Resolver un caso solo toca lo que sigue en revisión** (condición repetida dentro del UPDATE: si el proveedor lo movió
  mientras tanto, no se pisa) y una decisión que no sea de las dos permitidas se rechaza (`decision_invalida`; antes se
  habría tratado como «pedir repetición»).
- **Abrir un caso deja asiento ANTES de leer nada**: quién, a quién, con qué motivo (lista cerrada: revisar un caso,
  atender una incidencia, soporte, auditoría) y desde qué IP. Sin motivo válido, no se abre (`motivo_requerido`).
- **Nunca sale de esta capa** una imagen, la referencia de la sesión del proveedor, el hash del documento ni el número de
  documento (Membego no los tiene: el proveedor los borra al concluir). La referencia sellada solo aparece como filtro
  («¿queda algo por borrar?»), nunca elegida. Para ver la evidencia, el equipo la busca en la consola del proveedor por
  `vendor_data` = id del intento. El panel no tiene rutas de datos ni enlaces de descarga.
- **Los contadores no inventan ceros**: si una consulta falla, ese bloque dice «sin dato» y el resto sigue.
- **Las empresas están aisladas**: nada de `src/app/(admin)`, `src/modules/admin`, `src/components/admin` ni
  `src/app/(vendedor)` importa el módulo de identidad ni lee sus tablas. Única excepción, de la Fase 2: borrar a un
  empleado se frena mientras haya un borrado de identidad sin completar; esa función solo devuelve un texto de aviso.
  La insignia se pinta solo si la persona permitió la divulgación **y** la empresa tiene la capacidad
  `VERIFICACION_IDENTIDAD`, y no dice nada más que «verificada» (ni fecha de rechazo, ni nivel, ni documento).
- **Avisos a la persona** al repetirse la verificación (`IDENTIDAD_REPETIR`) o al responderle una incidencia, una sola vez por
  caso (clave de deduplicación), sin datos personales y sin el motivo interno.

## Qué cambió en la base de datos

| Migración | Qué hace |
|---|---|
| `20261084_identidad_admin_enums` | (sola, por `ADD VALUE`) asientos `IDENTIDAD_REVISION_RESUELTA` e `IDENTIDAD_INCIDENCIA_ATENDIDA`; aviso `IDENTIDAD_REPETIR` |
| `20261085_identidad_incidencias_respuesta` | `respuesta` y `atendidaPorId` en las incidencias; CHECK: respuesta de 1 a 500 caracteres y «resuelta» exige respuesta y fecha |

Ambas son idempotentes y están selladas (251 migraciones). No hay tablas nuevas, así que no hace falta RLS nueva.

## Archivos

| Pieza | Dónde |
|---|---|
| Servicio del equipo (resumen, colas, búsqueda, caso, resolver) | `src/modules/identidad/staff.ts` |
| Reglas de dominio nuevas | `identidad.ts` (`resolverRevisionDeIdentidad`, `atenderIncidenciaDeIdentidad`), `identidadCore.ts` (`REVISION_NEGADA`), `avisos*.ts` |
| Acciones | `src/modules/superadmin/identidadActions.ts` |
| Páginas | `src/app/(superadmin)/superadmin/identidad/page.tsx` y `[userId]/page.tsx` |
| Componente | `src/components/superadmin/identidad/AccionConTexto.tsx` |
| Insignia del negocio | `src/components/admin/IdentidadVerificadaBadge.tsx` + ficha del cliente |
| Bitácora | `src/modules/auditoria/queries.ts` (filtros por prefijo de acción, tipo y id de entidad) |
| Menú | `src/components/layout/nav-config.ts` |

## Pruebas

- `tests/postgres/identidad-equipo.db.test.ts` — 15 pruebas contra PostgreSQL: solo el equipo (un admin de empresa, un
  cliente, nadie o un rol inventado no leen ni tocan nada); abrir un caso deja asiento con motivo e IP y no devuelve
  referencia ni hash; rechazar y pedir repetición (código neutro, sesión borrada, aviso sin el motivo real, la persona
  puede empezar al instante); el equipo no puede acreditar; dos personas del equipo resolviendo a la vez; incidencias
  (tomar, resolver con respuesta única, la base exige lo mismo que el servicio); colas; búsqueda con mínimo de 3
  caracteres; resumen sin ceros inventados; borrados sin completar y purgas pendientes.
- `tests/identidad-guardas.test.ts` — +4 guardas de código: solo SUPERADMIN en todas las capas, sin acción de aprobar,
  nada sensible en `staff.ts`, empresas aisladas.
- `tests/identidad-equipo-render.test.ts` — la insignia y la acción con texto se pintan como deben.
- **Mutaciones** (rompí cada protección y comprobé que alguna prueba falla; restauré después): resolver sin exigir
  «en revisión», consultar sin motivo, acción sin rol, servicio sin rol, página sin `requireRole`, insignia sin capacidad,
  decisión inventada. Las 7 fueron atrapadas.

## Lo que sigue pendiente (no es de esta fase)

- Verlo en un navegador con sesión real de SUPERADMIN (hasta ahora, render de servidor y pruebas de código).
- Dictamen legal (Ley 4-23, arts. 58–60), contrato / acuerdo de encargo con el proveedor y su configuración (flujo, claves,
  aviso firmado, edad mínima 18); correr `npm run identidad:probar-didit` y «Try Webhook» contra su sandbox.
- No existe un rol de «soporte de plataforma»: hoy solo SUPERADMIN. Si se quiere dar acceso a más personas, es una decisión
  de roles aparte (y de contrato: quién puede ver datos de identidad).
- Fase 5 (reglas por funcionalidad) y siguientes: solo con tu autorización.
