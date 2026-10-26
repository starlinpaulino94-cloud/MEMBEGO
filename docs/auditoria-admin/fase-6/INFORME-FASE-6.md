# Informe de la fase 6 · consolidación de la navegación (21-10-2026)

> **Estado: construida, verificada en QA con cinco roles y commiteada en la rama local `claude/auditoria-fase6` (`1f0c3d9d`, `ec09699d`), sin push; falta tu aprobación de la fase.** Base: `claude/auditoria-fase5`, apilada sobre `fase4`, `fase3` y `fase2`, sobre `main` (`5571363e`). Ninguna de las cinco ramas está en GitHub.
>
> **Qué cambia para quien usa el panel:** el menú lateral de la empresa pasa de **44 destinos** a **23 entradas** (administrador, sin ser proveedora de Membego), y las pantallas que se fusionan en una entrada aparecen como **pestañas** encima de su contenido. **No cambia ninguna ruta, ninguna sección de permisos, ninguna capacidad ni ninguna pantalla**: cada pestaña es la misma ruta de siempre, con la misma guardia. Plataforma, mostrador, cliente y vendedor no cambian.

## 1. Qué se hizo (tareas 6.1 a 6.4 de `12`)

| Tarea | Qué | Dónde |
|---|---|---|
| **6.1 Pestañas por módulo** | Una entrada declara sus `pestanas` (ruta, etiqueta, capacidad y, si la pantalla lo exige, función). Una barra (`PestanasModulo`, con `NavSeccion` de la fase 4) se pinta sola encima de **todas** las rutas de un módulo. | `nav-config.ts`, `PestanasModulo.tsx`, `AppShell.tsx` |
| **6.2 `nav-config` con prefijos** | Los destinos de antes siguen en el catálogo (`ENLACES_ADMIN`); el hub los compone en módulos con `modulo()`, que falla si una pestaña no existe. La entrada se muestra si le queda **al menos una pestaña visible** y aterriza en la **primera visible** (03 · C.3). | `nav-config.ts` |
| **6.3 Pruebas** | 34 nuevas y 14 actualizadas, más 3 invariantes ampliados a las pestañas (ver §3). Las dos que pedía 03 · D.3: «toda pestaña declara su sección» y «ninguna ruta de antes queda sin módulo». | `tests/navegacion-*.test.ts` |
| **6.4 Rutas heredadas** | `/admin/whatsapp`, `/admin/campanas`, `/admin/excursiones/reportes` y `/admin/referidos` **siguen igual** y registran cada acceso (`navegacion · ruta_legada`): el dato de uso que faltaba para decidir si se retiran. | `modules/navegacion/legado.ts` |

Además: el buscador y la paleta tratan cada pestaña como un destino propio («Pagos › Conciliación»), y lo que se escribía para llegar a una pantalla —también con su nombre de antes— sigue llegando.

### El menú resultante (administrador, todo encendido)

| Grupo | Entradas (pestañas) |
|---|---|
| Principal | Resumen |
| App del cliente | **Editor de inicio** (Inicio · Sinónimos de búsqueda) |
| Comercio | **Catálogo** (Productos y servicios · Inventario) · **Pedidos Membego** (Pedidos · Mi cuenta · Resultados) · **Beneficios y regalos** (la vista de la fase 5; sin barra) · **Planes** (Planes · Plantillas) · Parques y Tours |
| Operaciones | Canjes y QR · **Citas** (Agenda · Configuración) · **Pagos** (Por validar · Movimientos · Comprobantes · Conciliación) · Caja |
| Clientes | **Clientes** (Directorio · Membresías · En riesgo · Segmentos) · Prospectos · **Soporte** (Tickets · Comunicación) |
| Marketing | **Comunicaciones** (Notificaciones · Automatizaciones · Campañas segmentadas · Campañas) · Publicaciones · **Fidelización** (Invita y Gana · Ruleta · Regalos · Recompensas · Seguimiento) |
| Analítica | **Reportes** (Resumen · Finanzas · Membresías · Operación · Retención · Audiencia · Origen) · Actividad |
| Ajustes | **Empresa** (Perfil público · Cobros) · Sucursales · **Equipo** (Personas · Accesos) · Integraciones · Entregas Membego |

## 2. Lo que adapté del diseño aprobado, y por qué

1. **24 entradas y no 21.** El «21» de `03` · C.2 y de los prototipos era el menú de entonces. Desde la foto de la auditoría nacieron el catálogo, el inventario, los pedidos, las ofertas con presupuesto, «Mi cuenta Membego», «Resultados» y las entregas del proveedor. **Catálogo** (con Inventario) y **Pedidos Membego** (con Mi cuenta y Resultados) entran como dos módulos nuevos; **Entregas Membego** sigue siendo una entrada que solo ven las empresas proveedoras. Una empresa con todo encendido ve 24; una que no es proveedora, 23; el supervisor ve 8 y marketing 6, **como dice `03` · C.3**.
2. **La barra vive en la carcasa, no en ocho layouts.** Las pestañas de un módulo están en carpetas distintas (`/admin/pagos`, `/admin/registros`, `/admin/conciliacion`…): ningún layout las envolvería a todas. Quien añade una pestaña la declara en el módulo y aparece en todas sus pantallas.
3. **«Finanzas» exige su función.** La pantalla ya pide `reportes › ver_financieros`; una pestaña que solo lleva a «no autorizado» no es un permiso, es un tropiezo. No se ofrece a quien no la tiene.
4. **Sin barra donde la pantalla ya trae sus pestañas:** Prospectos (CRM), Parques y Tours y Beneficios (selector de tipo de la fase 5). Se probó que no queden dos barras apiladas.
5. **Campañas (el agrupador) queda como una pestaña de Comunicaciones, no se retira.** La auditoría lo propone «previa verificación de uso»; hoy no hay dato, así que se cuenta (6.4) en vez de decidir a ciegas.
6. **Se retira `NavAudiencia`** (la mini-navegación de tres enlaces de Audiencia): sus tres pantallas son ahora pestañas de tres módulos (Reportes, Clientes, Comunicaciones) y habría dos barras compitiendo.
7. **Caja entra al menú del administrador** (D-09, adoptada en la fase 3): solo para quien puede abrirla (administrador, gerente, cajero) y con la capacidad POS_CAJA; a Marketing y Supervisión, que rebotarían, no se les enseña. **Se abre en la pantalla de mostrador**, no en la del panel.
8. **Nombres del prototipo aprobado:** «Experiencia cliente» → «App del cliente», «Escanear QR» → «Canjes y QR», «Empleados» → «Equipo» (los nombres de antes siguen siendo palabras de búsqueda).

## 3. Medición

### 3.1 Pruebas y compuertas (sobre el árbol final)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| `npm test` | **4 930 pruebas; 4 923 pasan, 0 fallan, 7 omitidas.** La fase 5 tenía 4 896: **+34** |
| eslint sobre lo tocado | 0 problemas |
| Permisos y capacidades | **sin cambios**: `git diff` de `src/lib/auth`, `src/modules/capacidades`, `src/proxy.ts` y `prisma` frente a la fase 4 está vacío |
| Las dos pruebas de `03` · D.3 | «toda pestaña declara su sección» ✔ y «toda ruta de antes —y cualquier subruta suya— sigue resolviendo a un módulo» ✔ (los 45 destinos del catálogo × 3 subrutas cada uno) |

### 3.2 Antes y después, por rol (destinos del menú → entradas; empresa con las capacidades de comercio encendidas)

| Rol | Antes | Ahora | Pantallas alcanzables | Entradas con barra |
|---|---:|---:|---:|---:|
| Administrador | 44 | **23** | 54 | 13 |
| Gerente | 26 | **16** | 33 | 8 |
| Supervisor | 13 | **8** | 17 | 4 |
| Marketing | 11 | **6** | 14 | 3 |
| Cajero | 11 | **8** | 13 | 3 |

«Antes» cuenta los destinos del catálogo que cada rol veía; el cajero baja menos porque gana Caja. **Nadie perdió una pantalla**: las «pantallas alcanzables» incluyen todo lo de antes.

### 3.3 En el navegador, contra el entorno de QA

Cinco roles (administrador, gerente, supervisor, marketing, cajero) recorrieron **cada entrada de su menú y cada pestaña que enseñaba su barra**:

| Rol | Entradas | Pantallas abiertas | Con barra | **Rebotes** | Errores de consola |
|---|---:|---:|---:|---:|---:|
| Administrador | 21 | 53 | 46 | **0** | 0 |
| Gerente | 15 | 30 | 22 | **0** | 0 |
| Supervisor | 8 | 17 | 13 | **0** | 0 |
| Marketing | 5 | 11 | 9 | **0** | 0 |
| Cajero | 8 | 13 | 8 | **0** | 0 |

«Rebote» = lo que el menú ofrece y la guardia de la ruta devuelve al Resumen. **Ninguna pestaña ofrecida llevó a un «no autorizado»**, que es lo que esta fase no podía hacer. En cada pantalla con barra había exactamente una pestaña activa. La empresa de QA tiene apagadas algunas capacidades (por eso 21 y no 23; Marketing ve 5 y no 6 sin «Publicaciones»).

* **390 px:** `/admin/pagos` y `/admin/reportes` (la barra de 7 pestañas) **sin desborde horizontal de la página**; la barra se desplaza dentro de sí misma.
* **Migas de la cabecera (defecto heredado, arreglado):** a 1 280 px las migas se dibujaban unas encima de otras ya con tres niveles; con la pestaña habrían sido cuatro. Ahora el contenedor recorta y las migas llegan hasta el módulo (la pestaña la marca la barra): **0 solapes a 1 280, 1 024 y 768 px**.
* Capturas: `verificacion-f5/capturas-f6/` en este worktree (ignorada por Git): menú de administrador, supervisor y marketing; módulos con barra a 1 280 y 390 px.

## 4. Criterios de aceptación de `12` · fase 6

| Criterio | Estado |
|---|---|
| 21 entradas | **24 con todo encendido, 23 sin ser proveedora** (§2.1); supervisor 8 y marketing 6, como `03` · C.3. **No es literalmente 21** y lo digo. |
| Cero rutas rotas | **Cumplido en lo que se probó:** los 45 destinos del catálogo y sus subrutas resuelven a un módulo (prueba); en QA, 0 rebotes en cinco roles. **No hice** el «recorrido automatizado de todas las rutas antiguas con 200/302 esperados» como script aparte: recorrí lo que el menú ofrece a cada rol, y la empresa de QA no tiene encendidas Parques y Tours, Publicaciones ni el portal del proveedor. |
| Ninguna sección de permisos cambiada | **Cumplido** (§3.1: diff vacío). |
| Pruebas de navegación actualizadas y en verde | **Cumplido** (34 nuevas, 14 actualizadas, 4 930 en verde). |

## 5. Lo que NO está hecho o NO se sabe

1. **6.5 (retirar el riel y el modo compacto): no se hizo.** No hay decisión tuya. El panel de empresa ya no usa el riel (una sola columna); sigue sirviendo a quien tiene varios espacios (el cliente).
2. **Plataforma (17 → 13 entradas) no se toca:** es de la fase 8. Parques y Tours sigue con sus 10 pestañas propias (reorganizarlas en 5 no estaba en 6.1).
3. **Las pestañas «no cambian ninguna pantalla» también significa que Comprobantes y Movimientos siguen siendo dos pantallas**: `03` propone absorber el primero como filtro del segundo; eso es un cambio de pantalla (fase 7).
4. **No probé con lector de pantalla, Firefox ni Safari**, ni el cajón móvil por dentro (solo que la página no desborda). La barra es un `<nav>` con `aria-label` y `aria-current`, que es lo que se comprobó.
5. **No hice clic en las pestañas con eventos reales:** las abrí por su ruta y leí lo que pintaron. La navegación cliente de Next entre pestañas sin prefetch no se midió.
6. **Los accesos heredados solo se cuentan desde que esto se despliegue.** Hoy no hay dato; en unas semanas lo habrá, y de él depende retirar o no esas cuatro rutas.

## 6. Decisiones que necesito de ti

1. ¿**24 entradas** (23 sin proveedor) en lugar de 21, y los tres nombres cambiados («App del cliente», «Canjes y QR», «Equipo»)?
2. ¿Quieres que **«Campañas»** (el agrupador) siga como pestaña de Comunicaciones hasta ver el dato de uso? Es lo que hice.
3. ¿**6.5**: retiro el riel y el modo compacto, o los dejo para el cliente?
4. Cuando haya semanas de datos: filtrar el log por `"dom":"navegacion"` y `"acc":"ruta_legada"` dice quién abre cada una de las cuatro rutas. Dime cuándo lo revisamos.
5. Siguen pendientes de ti desde antes: el `push` de las ramas apiladas, D-08, D-11, la regla de ingresos del cajero, el índice de Car Wash, encender `.panel-ds` en todo el panel y las pruebas con tres personas (3.2).

## 7. Cómo verlo

```bash
git switch claude/auditoria-fase6
npm test
```

Para el panel en el navegador hace falta el entorno de QA (`docs/auditoria-admin/linea-base/README.md`): compilar con `con-entorno-qa.mjs`, servir y entrar con `qa-administrador`, `qa-gerente`, `qa-supervisor`, `qa-marketing` o `qa-cajero`. **El servidor de QA está apagado.**
