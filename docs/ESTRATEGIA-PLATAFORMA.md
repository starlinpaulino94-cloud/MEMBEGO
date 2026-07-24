# Estrategia de implementación · MembeGo Platform + Business Apps

> Análisis de la propuesta "núcleo común + motores por categoría + capacidades
> + navegación en dos niveles (launchpad)" y **plan de implementación por
> etapas sobre la app REAL que ya está en producción**, diseñado para que
> nada se rompa en el camino. Documento de estrategia: aquí no hay código.

---

## 1. Veredicto del análisis

La dirección propuesta es **correcta** y coincide con hacia dónde ya apunta el
código. Pero hay tres correcciones importantes que cambian el plan:

1. **MembeGo ya ES una plataforma con núcleo común.** No partimos de cero:
   clientes, membresías, promociones, pagos, caja, facturación, QR, citas,
   notificaciones, automatizaciones, reportes, auditoría y permisos por
   sección ya existen y funcionan. La propuesta describe en gran parte lo que
   ya está construido. Lo que falta NO es el núcleo: es la **separación
   visual/organizativa** (dos niveles) y el **sistema de capacidades**.

2. **El mayor riesgo no es técnico, es de ejecución.** La app está en
   producción con clientes reales (CARTOWN), un cron diario, QRs activos,
   pagos y campañas corriendo. Un "reordenamiento grande" mal llevado rompe
   enlaces, notificaciones con `href`, flujos de canje y hábitos del equipo.
   Por eso la estrategia es **evolutiva, nunca big-bang**: cada etapa se
   entrega completa, verificada y con vuelta atrás.

3. **No hay que mover código para lograr la experiencia de "dos sistemas".**
   La navegación de MembeGo ya es **data-driven** (un archivo define grupos y
   enlaces, y los permisos filtran por sección). Cambiar "qué se ve y dónde"
   es barato; mover archivos y rutas es caro y riesgoso. La estrategia
   explota eso: primero se reorganiza la NAVEGACIÓN, y solo después (si hace
   falta) las rutas.

---

## 2. Qué existe hoy (inventario honesto)

### Ya construido y en producción

| Pieza de la propuesta | Estado real en MembeGo |
|---|---|
| Núcleo: clientes, membresías, promociones, pagos, facturación, caja, QR, reportes, notificaciones, auditoría | ✅ Existe y funciona (33+ secciones admin) |
| Multi-tenant por empresa | ✅ Todo el dato cuelga de `companyId` |
| Categoría del negocio | ⚠️ Existe `Company.type` ("carwash"/"restaurante") y `categoria`, pero casi no se usan para condicionar la UI |
| Permisos por sección (fail-closed) | ✅ `ADMIN_SECTIONS` + roles acotados (Marketing/Supervisor) — es la semilla del sistema de capacidades |
| Navegación data-driven | ✅ Un solo archivo define grupos/enlaces y ya se filtra por rol y por módulos ocultos |
| Configuración por empresa vía JSON | ✅ Patrón probado 3 veces (`engagementConfig`, `regalosConfig`, `seguimientoConfig`) — la futura columna de capacidades es el mismo patrón |
| Motores reutilizables (reglas, beneficios, automatizaciones, referidos, estrategias) | ✅ Ya son "Shared Services": no saben de car wash |
| Módulos específicos de car wash | ✅ Vehículos, escáner de pista, caja POS, citas, seguimiento de lavados |
| Marca única | ✅ Modo activo (una sola empresa publicada) — simplifica el pilotaje |

### Lo que NO existe (el trabajo real de esta iniciativa)

- La **columna de capacidades** por empresa y su resolutor (categoría →
  módulos base; capacidades → encender/apagar extras).
- El **launchpad "Aplicaciones"** y el **shell del negocio** (layout propio,
  branding propio, menú propio) como segundo nivel.
- **Dashboards por categoría** (hoy hay un dashboard genérico).
- Módulos de car wash que la propuesta menciona y hoy no existen: inventario
  de químicos, cola de vehículos en vivo, fotos antes/después, control de
  daños. (Son features nuevas, no reorganización — van al final.)
- Cualquier motor de otra industria (restaurante, gym…). **No se construyen
  todavía**: se valida primero la arquitectura con el car wash.

---

## 3. Decisiones de arquitectura (tomarlas ANTES de tocar nada)

**D1 · Un solo repositorio, una sola base de datos, un solo deploy.** Las
"aplicaciones" son espacios de rutas y navegación dentro del mismo Next.js.
Nada de microservicios ni repos separados: duplicaría costo sin beneficio al
tamaño actual.

**D2 · Tres capas lógicas, no tres proyectos.**
- **Platform (núcleo)**: lo que toda empresa usa — clientes, membresías,
  promociones, marketing, pagos, reportes, configuración.
- **Business Apps**: la experiencia especializada por categoría (Car Wash
  primero), con su propio menú, dashboard e identidad visual.
- **Shared Services**: los motores existentes (reglas, beneficios, caja,
  facturación, notificaciones, auditoría). No se mueven ni se reescriben;
  las apps los consumen.

**D3 · Categoría + capacidades, en ese orden.** La categoría define el
paquete inicial de módulos (elige por ti); las capacidades permiten
encender/apagar módulos concretos por empresa (ajusta fino). Se guarda como
JSON en la empresa (patrón ya probado) — **sin tablas nuevas**.

**D4 · Fail-open para lo existente, fail-closed para lo nuevo.** Regla de
oro anti-roturas: una empresa SIN configuración de capacidades ve **todo lo
que ve hoy** (nada desaparece por accidente). Solo cuando el superadmin
configure capacidades explícitamente se empieza a ocultar. Los módulos
nuevos sí nacen apagados por defecto.

**D5 · Las URLs viejas nunca mueren.** Todo enlace guardado, notificación
con `href`, QR o hábito del equipo debe seguir funcionando: si una pantalla
"se muda" a la app del negocio, la URL vieja redirige a la nueva. Los
`href` de notificaciones ya enviadas no se pueden editar — la redirección es
obligatoria, no opcional.

**D6 · Nada de renombrar/mover tablas ni columnas.** La base de datos no se
entera de esta iniciativa salvo por UNA columna nueva (capacidades), con
migración idempotente que se corre a mano ANTES del deploy, como siempre.

**D7 · Interruptor general con vuelta atrás.** La navegación nueva
(launchpad + shell) se activa con un interruptor por empresa. Si algo sale
mal, se apaga y la app vuelve al menú actual **sin redeploy y sin tocar
datos**. Este interruptor es la póliza de seguro de toda la iniciativa.

---

## 4. Clasificación de los módulos actuales

Base para el launchpad: qué se queda en MembeGo (plataforma) y qué se muda a
la app Car Wash. Criterio: *"¿esto habla del CLIENTE y su relación con el
negocio, o habla de la OPERACIÓN física del negocio?"*

**MembeGo Platform (se quedan):** Resumen, Clientes, Membresías, Regalos
P2P, Pagos, Facturas, Registros, Métodos de pago, Ofertas/Promociones,
Publicaciones, Invita y Gana, Ruleta, Notificaciones, Automatizaciones,
Campañas, Reportes, Audiencia, Origen de clientes, Crecimiento, Perfil
público, Personalización, Planes, Empleados, Comunicación, Tickets.

**Car Wash App (se mudan o nacen ahí):** Dashboard operativo del día,
Escanear QR (pista), Caja/POS del empleado, Citas/Agenda, Seguimiento de
lavados gratis, Sucursales, Vehículos (hoy viven dentro de la ficha del
cliente → ganan módulo propio), y los futuros: cola de vehículos,
inventario, fotos antes/después, control de daños.

**Ambiguos — DECIDIDO (E0 firmada):** Citas → **Car Wash** (operación de
pista), Seguimiento → **Car Wash**, Sucursales → **Car Wash**, Reportes →
**Platform** (la app tendrá reportes operativos propios). Nombre de la app
en el launchpad: **"Car Wash"**. Catálogo v1 de categorías y capacidades:
ver `docs/CAPACIDADES.md` (fuente de verdad en
`src/modules/capacidades/catalogo.ts`).

> Nota: "mudarse" en las primeras etapas significa **aparecer en el menú de
> la app** — la ruta física puede quedarse donde está todo el tiempo que haga
> falta (D5).

---

## 5. Plan por etapas

Cada etapa termina con: verificación técnica completa (tipos, lint, build),
prueba manual del flujo crítico (registro → regalo → cita → QR → canje →
caja), y entrega desplegada. Ninguna etapa deja la app "a medias".

### E0 · Cimientos de decisión (sin tocar código de la app) ✅ *firmada*
- Cerrar la clasificación de la sección 4 (la lista de ambiguos).
- Definir el catálogo v1: categorías (`CAR_WASH` primero; las demás solo
  como valores reservados) y capacidades v1 (`POS_CAJA`, `CITAS`,
  `SEGUIMIENTO`, `GIFT_CARDS`, `RULETA`, `CITA_ANTES_DEL_QR`… — varias ya
  existen como flags dispersos y se unifican aquí).
- Nombrar la app: "Car Wash" a secas dentro del launchpad (el branding por
  empresa ya existe con `colorPrimario`/logo).
- **Entregable:** este documento actualizado con las decisiones firmadas.
- **Riesgo: cero.** No se despliega nada.

### E1 · Fundaciones invisibles (el usuario no ve ningún cambio) ✅ *entregada — ver docs/CAPACIDADES.md*
- Columna de capacidades en la empresa (migración idempotente, manual).
- Catálogo de categorías/capacidades en código + resolutor único:
  *empresa → categoría → módulos base → capacidades → secciones visibles*.
- Conectarlo al sistema de permisos existente como una capa MÁS (rol Y
  capacidad deben permitir; regla D4: sin configuración = todo lo actual).
- **Prueba de éxito:** la app se ve y funciona EXACTAMENTE igual que antes.
- **Rollback:** trivial (la capa nueva devuelve "todo permitido").

### E2 · El launchpad y el shell (el cambio visible, con interruptor)
- Entrada "Aplicaciones" en el menú de MembeGo → pantalla launchpad que
  muestra solo las apps de la empresa (hoy: Car Wash).
- Shell de la app Car Wash: layout propio (identidad visual diferenciada,
  botón claro "← Volver a MembeGo"), menú propio con los módulos
  clasificados en la sección 4. **Los enlaces apuntan a las pantallas
  actuales** — cero páginas movidas.
- El menú de MembeGo deja de listar los módulos operativos (solo si el
  interruptor D7 está encendido para la empresa).
- **Prueba de éxito:** con el interruptor apagado, nada cambió; encendido,
  la experiencia de dos niveles funciona y TODAS las URLs viejas siguen vivas.
- **Rollback:** apagar el interruptor.

### E3 · Identidad real de la app (rutas propias + dashboard operativo)
- Espacio de rutas propio para la app Car Wash con redirecciones desde cada
  URL vieja (D5). Se muda una pantalla a la vez, empezando por las de menos
  tráfico; el escáner y la caja de última.
- Dashboard operativo del Car Wash (lavados de hoy, cola/citas del día,
  recompensas por vencer, caja del día) — separado del dashboard ejecutivo
  de MembeGo, reutilizando consultas existentes.
- Vehículos como módulo propio dentro de la app.
- **Prueba de éxito:** enlaces de notificaciones viejas redirigen bien;
  el equipo de pista no nota fricción en escáner/caja.

### E4 · Capacidades administrables
- Panel (superadmin, y versión de solo-lectura para el admin de la empresa)
  para encender/apagar capacidades por empresa.
- El launchpad, los menús y los guards de servidor obedecen la capacidad
  (fail-closed en server actions para lo apagado — no solo esconder el menú).
- Unificar los flags dispersos existentes (gift cards, ruleta, cita-antes-
  del-QR…) bajo este panel, manteniendo compatibilidad con su configuración
  actual.

### E5 · Nuevas features del Car Wash (recién aquí)
Con la casa ordenada, se construye lo que hoy no existe, cada una como
capacidad apagada por defecto: cola de vehículos del día, inventario básico
(productos/movimientos/existencias), fotos antes/después + control de daños
en el canje. Prioridad según lo que CARTOWN pida primero.

### E6 · Segunda categoría (la prueba de fuego de la arquitectura)
- Elegir una categoría cercana (barbería/salón: también es agenda + servicios
  + membresías) y montarla **solo con catálogo + navegación**, sin escribir
  módulos nuevos. Si para lograrlo hay que tocar código del núcleo, la
  arquitectura tiene una fuga y se corrige aquí, barato.
- Recién después de esta validación tiene sentido hablar de motores de
  restaurante/gym (que sí requieren módulos nuevos grandes: mesas, cocina…).

---

## 6. Reglas permanentes de seguridad (todas las etapas)

1. **Producción manda:** ningún cambio entra si el flujo crítico completo
   (registro → bienvenida → cita → QR → canje → caja → reporte) no pasa la
   prueba manual.
2. **BD solo aditiva** e idempotente, corrida a mano antes del deploy; el
   código siempre tolera que la migración aún no exista (patrón ya usado en
   seguimiento/adquisición/citas).
3. **Una etapa = un deploy**, verificado (tipos, lint, build) y con su
   mecanismo de vuelta atrás identificado ANTES de desplegar.
4. **No se reescriben los motores** (reglas, beneficios, caja, facturación,
   growth). Son la parte más valiosa y estable del sistema.
5. **Los roles no cambian de significado:** empleados de pista siguen viendo
   solo escáner/caja; Marketing y Supervisor conservan sus alcances.
6. **Todo documentado en `docs/`** al cierre de cada etapa (qué se movió,
   qué URLs redirigen, qué capacidades existen).

---

## 7. Riesgos principales y su mitigación

| Riesgo | Mitigación |
|---|---|
| Romper enlaces/QRs/notificaciones al mover pantallas | D5: redirecciones permanentes; mover rutas recién en E3 y de una en una |
| "Big-bang" que deja la app a medias | Etapas cerradas; interruptor D7; E1 y E2 no mueven ninguna página |
| Sobre-ingeniería (construir para 10 industrias que no existen) | E6 valida con UNA segunda categoría antes de generalizar; los motores de restaurante/gym NO se construyen aún |
| Confundir al equipo actual (hábitos) | Interruptor por empresa: se enciende cuando el equipo esté avisado; las URLs viejas funcionan igual |
| Duplicar lógica entre Platform y App | Capa Shared Services explícita: las apps consumen los motores, nunca los copian |
| Deriva del alcance (cada etapa crece) | El catálogo v1 de E0 es cerrado; toda feature nueva del Car Wash espera a E5 |

---

## 8. Resumen para decidir

- La propuesta de la conversación es la dirección correcta, pero **el 70% del
  "núcleo" que describe ya existe** — el proyecto real es: capacidades +
  launchpad/shell + dashboards por categoría + redirecciones, y después las
  features operativas nuevas del car wash.
- El camino seguro es **evolutivo con interruptor**: dos etapas (E1, E2) que
  no mueven ni una página ya entregan la experiencia de "dos sistemas", con
  rollback instantáneo.
- La decisión más importante que pide este plan HOY es la **E0**: cerrar la
  clasificación de módulos y el catálogo v1 de categorías/capacidades. Todo
  lo demás se deriva de ahí.
