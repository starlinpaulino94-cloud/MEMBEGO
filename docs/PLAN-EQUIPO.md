# Plan de trabajo del equipo (3 personas · ciclo de 8 semanas)

> **Versión 2 — reescrita al cerrar el plan de plataforma.**
> El backlog original de este documento (etapas E0–E6 de
> `docs/ESTRATEGIA-PLATAFORMA.md`) está **entregado, desplegado y probado en
> producción**. Lo que sigue NO es continuar aquel plan: es lo que el proyecto
> necesita ahora que la plataforma modular existe.

---

## 1. Punto de partida (leer antes de asignar nada)

**Ya está hecho — no lo vuelvan a construir:**

| Pieza | Dónde vive |
|---|---|
| Sistema de capacidades por empresa | `src/modules/capacidades/` · `docs/CAPACIDADES.md` |
| Launchpad + shell genérico de apps | `/admin/aplicaciones` · `/admin/app/[app]` |
| Catálogo de aplicaciones por categoría | `src/modules/apps/catalogo.ts` |
| Tablero operativo del día | `src/modules/apps/dashboard.ts` |
| Módulo Vehículos | `/admin/app/carwash/vehiculos` |
| Cola de vehículos, Inventario, Fotos antes/después | `/admin/app/carwash/{cola,inventario,evidencias}` |
| Panel de capacidades (superadmin + solo-lectura del admin) | `/superadmin/capacidades` · `/admin/aplicaciones/capacidades` |
| Bitácora de actividad con fecha y hora | `/admin/actividad` · `/superadmin/auditoria` · `docs/ACTIVIDAD.md` |
| Segunda categoría (barbería) montada solo con catálogo | `src/modules/apps/catalogo.ts` |

**Decisiones ya tomadas — no reabrir sin hablar con Estarlin:**

- **Las rutas NO se mudan** (`/admin/citas` se queda donde está). Mudarlas
  rompería el control de permisos por rol, que se deriva del segundo segmento
  de la URL. Está explicado en `docs/ESTRATEGIA-PLATAFORMA.md · E3`.
- **Restaurante y gimnasio no se construyen todavía.** Sus categorías existen
  como valores reservados; sus apps exigen módulos grandes (mesas, cocina,
  rutinas) y no hay cliente que los pida.

---

## 2. Roles

| Persona | Rol | De qué responde |
|---|---|---|
| **Estarlin** | Líder técnico y Core Platform | Arquitectura y decisiones; migraciones de BD y deploys; revisión de TODOS los PRs; el núcleo (clientes, membresías, pagos, motores); adopción del cambio con el equipo de CARTOWN |
| **Programador 1** | Frontend, Experiencia y Calidad de UI | Reportes operativos de la app; pruebas de interfaz de los flujos críticos; pulido de los módulos nuevos con feedback real de pista |
| **Programador 2** | Backend, Pruebas y Confiabilidad | Red de pruebas automatizadas del dinero y los canjes; endurecimiento de flujos; herramientas de diagnóstico |

---

## 3. Frentes de trabajo

Cada tarea trae **pasos concretos** y **"terminado cuando"**. Si un paso no se
entiende, se pregunta ANTES de empezar, no a mitad de camino.

---

### F1 · Adopción de la navegación de dos niveles — **Estarlin** · Semana 1

Todo está construido pero apagado. Este frente es encenderlo sin romper los
hábitos del equipo de pista.

**Pasos:**
1. Avisar al equipo de CARTOWN con 2 días de anticipación: qué van a ver
   distinto (Escáner, Citas, Seguimiento y Sucursales pasan a vivir dentro de
   "Aplicaciones → Car Wash") y qué NO cambia (las direcciones guardadas
   siguen funcionando).
2. Encender `NAVEGACION_V2` para CARTOWN en `/superadmin/capacidades`, un día
   de poco movimiento y por la mañana.
3. Acompañar la primera jornada: estar disponible para el equipo de pista.
4. Anotar cada fricción real (no suposiciones) en una lista.
5. Si la fricción es alta: apagar la capacidad (vuelve todo al instante, sin
   desplegar) y corregir antes de reintentar.

**Terminado cuando:** el equipo de pista completa un día entero de operación
con la navegación nueva sin pedir ayuda, y la lista de fricciones está
resuelta o priorizada.

---

### F2 · Red de pruebas del dinero y los canjes — **Programador 2** · Semanas 1–4 — ENTREGADA
> `npm test` pasó de 2 a 5 archivos y de 24 a 71 pruebas: arqueo de caja,
> stock de inventario, resolutor de capacidades, bordes del canje y máquina de
> estados de la cola. Se verificó que detectan roturas reales (rompiendo la
> lógica a propósito). **Encontró un bug de producción**: un campo de cantidad
> vacío con tipo AJUSTE ponía el stock del producto en cero — corregido.

**El problema real:** hoy hay 2 archivos de prueba (`tests/`) para un sistema
con caja, facturación, canje de QR y capacidades. La verificación es
`tsc + lint + build`, que confirma que el código *compila*, no que *hace lo
correcto*. Con dos personas nuevas tocando el código, eso ya no alcanza.

**Pasos:**
1. Leer `tests/referidos-e6.test.ts` para entender el estilo que ya se usa
   (Node test runner con `tsx`, sin frameworks nuevos — **no** instalar Jest
   ni Vitest sin aprobación).
2. Escribir pruebas del **canje de promoción**: QR válido se canja una vez;
   el segundo intento con el mismo token se rechaza; un QR de otra empresa se
   rechaza. Archivo: `tests/canje.test.ts`.
3. Pruebas de **caja**: no se puede cobrar con la caja cerrada; el arqueo
   cuadra; una orden ya cobrada no se cobra dos veces.
   Archivo: `tests/caja.test.ts`.
4. Pruebas del **resolutor de capacidades** (`src/modules/capacidades/`): sin
   configuración devuelve el paquete base; un override enciende y apaga; ante
   error de base de datos devuelve todo permitido (fail-open).
   Archivo: `tests/capacidades.test.ts`.
5. Pruebas de **inventario**: una salida mayor al stock se rechaza; el
   `stockResultante` del movimiento coincide con el stock del producto.
   Archivo: `tests/inventario.test.ts`.
6. Agregar `npm test` a la rutina: ninguna rama se aprueba con pruebas en rojo.

**Terminado cuando:** `npm test` corre en verde, cubre los cuatro flujos, y
al menos una prueba falla a propósito si se rompe la lógica (compruébalo
rompiéndola a mano y viendo que la prueba lo detecta).

---

### F3 · Reportes operativos de la app — **Programador 1** · Semanas 2–5 — ENTREGADA
> `/admin/app/carwash/reportes` con rango de fechas, vehículos por día, tiempo
> promedio de servicio, servicios más pedidos, consumo de insumos y export CSV.

Es lo único del plan original que nunca se construyó. El tablero del día
muestra el "ahora"; falta el "cómo nos fue".

**Pasos:**
1. Leer `src/modules/apps/dashboard.ts` (el tablero del día) y
   `src/app/(admin)/admin/reportes/` (los reportes de plataforma, para NO
   duplicarlos: aquellos son de negocio, estos son de operación).
2. Crear `src/modules/apps/reportes.ts` con consultas por rango de fechas:
   vehículos atendidos por día, tiempo promedio entre entrada y entrega
   (usar `inicioAt`/`entregadoAt` de `cola_vehiculos`), servicios más
   vendidos, consumo de inventario del período.
3. Crear la pantalla `/admin/app/carwash/reportes` siguiendo el patrón de
   `/admin/app/carwash/inventario` (filtros con `next/form`, tabla, estado
   vacío).
4. Agregarla al catálogo en `src/modules/apps/catalogo.ts` como módulo de la
   app Car Wash (sin capacidad nueva: es parte del paquete base).
5. Export CSV, copiando el patrón de `/admin/actividad/export/route.ts`.

**Terminado cuando:** un encargado puede responder "¿cuántos carros hicimos
esta semana y cuánto tardamos en promedio?" sin salir de la app, y bajarlo a
Excel.

---

### F4 · Pulido con feedback real de pista — **Programador 1** · Semanas 5–8 — PARCIAL

> **Hecho (defectos verificables en código, sin observación):**
> - Los botones de acción de la cola medían **32 px** de alto (`size="sm"`);
>   ahora **44 px**, el mínimo táctil. Es la acción más frecuente del módulo y
>   se usa de pie, con un celular y las manos mojadas.
> - **"Cancelar" estaba pegado a "Iniciar" y no pedía confirmación**: un toque
>   errado sacaba el vehículo de la pista sin vuelta atrás. Ahora confirma y
>   está separado visualmente del botón de avance.
> - El campo de placa abría el teclado en minúsculas y con corrector: ahora
>   `autoCapitalize="characters"` + corrector apagado.
> - El icono de cámara de cada tarjeta era un blanco de 11 px; ahora 44 px.
> - Toda transición confirma con un aviso ("Listo ✓"): antes solo se veía un
>   spinner y no quedaba claro si había pasado algo.
>
> **PENDIENTE — solo se resuelve en pista.** Lo anterior quita los defectos
> obvios; lo que sigue depende de ver a la gente trabajar y NO debe adivinarse:

**Pasos:**
1. Acompañar media jornada al equipo de pista, en persona, observando cómo
   usan la cola en el celular. Anotar; no proponer nada todavía.
2. Preguntas a responder con lo observado (no con suposiciones):
   - ¿Cuántos toques toma registrar un vehículo en la práctica? ¿Llenan la
     descripción y el servicio, o solo la placa?
   - Con la cola llena, ¿cuánto hay que desplazarse para llegar a "Listo"?
     (en el celular las tres columnas quedan una debajo de otra).
   - ¿Se lee la pantalla al sol? ¿Suben el brillo, se acercan a la sombra?
   - ¿Registran el vehículo al momento o lo apuntan y lo cargan después?
     Si es lo segundo, el módulo está estorbando y hay que entender por qué.
   - ¿Usan las fotos antes/después, o se saltan ese paso cuando hay prisa?
3. Priorizar con Estarlin las TRES fricciones más caras. No más de tres.
4. Corregir de una en una, con un Pull Request separado por fricción.
5. Volver a observar y confirmar que la fricción desapareció de verdad.

**Terminado cuando:** el equipo de pista usa la cola por decisión propia
durante una semana completa, sin que nadie se lo recuerde. Ese es el único
indicador que vale: si hay que recordárselo, el módulo todavía estorba.

---

### F5 · Endurecimiento y diagnóstico — **Programador 2** · Semanas 5–8 — ENTREGADA
> Hallazgo: `db-doctor` YA cubría todas las migraciones (las deriva del
> `schema.prisma`); lo que faltaba era que avisara solo. Ahora el panel del
> superadmin muestra un banner cuando hay migraciones sin correr, con qué deja
> de funcionar y qué SQL correr.

**Pasos:**
1. Revisar `scripts/db-doctor.mjs` y extenderlo para que verifique que TODAS
   las migraciones manuales están aplicadas (columnas y tablas esperadas), no
   solo unas pocas.
   *Contexto: ya nos pasó — una migración sin correr dejó las capacidades
   apagadas en silencio durante días, porque el código es fail-open a
   propósito. La herramienta debe delatar eso.*
2. Agregar al panel de superadmin un aviso visible cuando falte una migración
   esperada.
3. Revisar los `catch` silenciosos del código nuevo (`.catch(() => {})`) y
   asegurar que al menos registren en consola con contexto.
   *Cerrado: los 46 del servidor usan `anotarFallo('modulo:operacion')`
   (`src/lib/prisma-errors.ts`), que registra con clasificación y remedio
   (`SCHEMA_DRIFT` → «corre db-doctor») sin romper el flujo. Una regla de
   ESLint (`no-restricted-syntax`) impide que vuelvan a colarse en
   `src/modules`, `src/lib` y `src/app`. En la UI se dejaron intactos: ahí
   `navigator.share().catch(() => {})` significa «el usuario canceló», y no
   hay nada que registrar.*

**Terminado cuando:** `npm run db:doctor` reporta el estado real de todas las
migraciones manuales y un superadmin ve el aviso sin tener que entrar a la
base de datos.

---

## 4. Calendario

| Semana | Estarlin | Programador 1 | Programador 2 |
|---|---|---|---|
| 1 | F1 · Encender navegación | Onboarding + leer `docs/` | Onboarding + F2 pasos 1–2 |
| 2 | Revisión + acompañamiento | F3 · consultas | F2 · canje y caja |
| 3–4 | Revisión de PRs | F3 · pantalla | F2 · capacidades e inventario |
| 5 | Revisión de PRs | F3 cierre + F4 observación | F5 · db-doctor |
| 6–7 | Revisión de PRs | F4 · correcciones | F5 · avisos y catches |
| 8 | Cierre y retrospectiva | F4 cierre | F5 cierre |

**Onboarding (ambos, semana 1):** leer en este orden `README.md`,
`docs/ESTRATEGIA-PLATAFORMA.md`, `docs/CAPACIDADES.md`, `docs/ACTIVIDAD.md`.
Levantar el proyecto, correr `npm test` y `npm run build` en verde **antes**
de escribir una línea.

---

## 5. Reglas de trabajo

1. Una rama por tarea y Pull Request SIEMPRE; nada se mezcla sin revisión y
   aprobación de Estarlin.
2. **Migraciones de BD: solo Estarlin.** Aditivas, idempotentes, corridas a
   mano ANTES del deploy — y **verificadas** después (la migración que no se
   corre no avisa: el código es fail-open a propósito).
3. **Definición de terminado:** `npm test` + `tsc` + lint + build en verde,
   prueba manual del flujo afectado y documentación actualizada en `docs/`.
4. Los motores del núcleo (reglas, beneficios, caja, facturación, growth) no
   se tocan sin aprobación previa.
5. Las URLs existentes nunca se rompen.
6. **Toda función nueva nace apagada** detrás de su capacidad, y se enciende
   por empresa cuando esté probada.
7. Daily corto + revisión de entregables los viernes.

---

## 6. Qué haría falta para crecer (fuera de este ciclo)

Para cuando exista la demanda, no antes:

- **Segunda categoría como producto real:** si aparece una barbería cliente,
  el trabajo NO es de arquitectura (ya está resuelto) sino de producto:
  plantillas de planes y promociones para el oficio, vocabulario y onboarding.
- **Apps de restaurante o gimnasio:** sí exigen módulos grandes. Decisión de
  negocio, no técnica.
- **Migración de rutas (E3):** solo si aparece una razón de producto concreta,
  y sabiendo que arrastra rediseñar los permisos por sección.
