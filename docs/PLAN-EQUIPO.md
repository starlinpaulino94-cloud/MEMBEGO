# Plan de trabajo del equipo (3 personas · ciclo de 14 semanas)

> Distribución de tareas sobre `docs/ESTRATEGIA-PLATAFORMA.md` (etapas E0–E6).
> Los planes individuales completos están en los PDF entregados; este es el
> resumen operativo de referencia.

## Roles

| Persona | Rol | Módulos a cargo |
|---|---|---|
| **Estarlin** | Líder técnico y Core Platform | Arquitectura y decisiones (E0); núcleo (clientes, membresías, promociones, pagos, motores); sistema de capacidades (E1); BD/migraciones; deploys; revisión de TODOS los PRs; integración E6 |
| **Programador 1** | Frontend y Experiencia | Launchpad "Aplicaciones" + shell de la app Car Wash (E2); rutas propias con redirecciones y dashboard operativo (E3); módulo Vehículos; pantallas de los módulos de P2 |
| **Programador 2** | Backend y Módulos de negocio | Panel de capacidades (E4); cola de vehículos; inventario básico; fotos antes/después + control de daños; reportes operativos |

## Calendario general

- **Sem 1–2** · E0 (Estarlin) + onboarding de P1 y P2 (entorno, docs, tareas pequeñas supervisadas).
- **Sem 2–3** · E1 fundaciones invisibles (Estarlin).
- **Sem 3–5** · E2 launchpad/shell (P1) y E4 panel de capacidades (P2).
- **Sem 6–8** · E3 rutas + dashboard operativo + Vehículos (P1); cola de vehículos (P2).
- **Sem 9–11** · Inventario básico (P2) con pantallas de P1; pulido UX.
- **Sem 12–13** · Fotos antes/después + control de daños (P2).
- **Sem 12–14** · E6 segunda categoría (Estarlin con apoyo de ambos).

## Reglas de trabajo (aplican a todos)

1. Una rama por tarea y Pull Request SIEMPRE; nada se mezcla sin revisión y
   aprobación de Estarlin.
2. Migraciones de BD: solo Estarlin (aditivas, idempotentes, se corren ANTES
   del deploy).
3. Definición de terminado: `tsc` + lint + build en verde, prueba manual del
   flujo afectado y docs actualizadas.
4. Los motores del núcleo (reglas, beneficios, caja, facturación, growth) no
   se tocan sin aprobación previa.
5. Las URLs existentes nunca se rompen: toda pantalla movida deja redirección.
6. Daily corto + revisión de entregables los viernes.
