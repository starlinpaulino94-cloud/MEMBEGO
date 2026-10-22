# Informe de la fase 7 · octavo bloque: un solo `crearEmpresa` (tarea 7.3) (22-10-2026)

> **Estado: construido, verificado contra la base y Supabase Auth del entorno de QA aislado (escribió y limpió) y commiteado en la rama local `claude/auditoria-fase7` (`12f99d82`), sin push; falta tu aprobación de este bloque.** Los bloques 1 a 7 los aprobaste y diste 7.1 por cerrada; este es 7.3, lo que pediste a continuación.
>
> **Lo que tienes que saber:** al probar el alta contra la base real encontré un defecto **que ya existía en los tres caminos**: **el rollback nunca borraba la empresa**. Si algo fallaba después de crear la empresa (la cuenta del administrador, el usuario, el correo de verificación…), el sistema borraba la cuenta de Auth pero **dejaba la empresa huérfana** —y, con cuenta nueva, una fila de usuario sin empresa—, porque la sucursal principal impide borrarla y el error se tragaba en silencio. Está corregido y verificado. Además: **la pantalla nueva («Empresas → Nueva» precargada desde una solicitud) no la pude ver en un navegador** (en QA no hay superadmin).

## 1. Qué se hizo

**Antes:** el superadmin (`crearEmpresa`), la solicitud aprobada (`crearEmpresaDesdeSolicitud`) y el registro público (`registrarEmpresa`) repetían el mismo guion —slug único, empresa con las capacidades de «tenant nuevo», sucursal principal, cuenta en Supabase Auth, usuario en la base, rol en la sesión y deshacer si algo falla—, cada uno con su propio `slugify`, su propia unicidad y su propio rollback. El informe 04 (F-02) pedía «un solo `crearEmpresa` de dominio con solicitud precargada».

| Qué | Dónde |
|---|---|
| **El alta, una vez** (`darDeAltaEmpresa`): el orden, el vertical, las capacidades, la sucursal, las categorías, la cuenta nueva **o** el acceso de una cuenta existente, y el deshacer. Los efectos (base y Auth) entran por «puertos» para poder probar el orden y el rollback sin servicios. | `modules/empresas/alta.ts` |
| **Los tres caminos** quedan delgados y conservan solo lo suyo: permiso y modo de administrador (superadmin); contraseña temporal y credenciales que se muestran una vez (solicitud); límite de intentos, consentimiento y correo de verificación (registro). El **slug** y el **rollback** ya no se escriben tres veces. | `empresas/actions.ts`, `solicitudes/actions.ts`, `registro/empresaActions.ts` |
| **La solicitud que se convierte en empresa**: el final común («Creada» + enlace a la empresa + rastro en la bitácora) vive en un helper que usan los dos caminos de la solicitud. | `modules/solicitudes/creada.ts` |
| **La solicitud precarga la creación** (`/superadmin/empresas/nueva?solicitud=<id>`): llega escrito lo del solicitante (nombre, vertical si equivale a uno, contacto, ciudad, dirección, web, descripción y los datos del administrador); si el correo del dueño ya es una cuenta de la plataforma, arranca en **«Cuenta existente»** con ese administrador elegido; nunca trae contraseña. Una solicitud que ya tiene su empresa, que no existe o que está incompleta **no precarga** y la pantalla lo dice. | `empresas/nueva/page.tsx`, `EmpresaCreateForm.tsx`, `solicitudes/nucleo.ts` |
| **Un enlace «Crear con los datos precargados»** en la solicitud, y el mensaje de «ya existe una cuenta con ese correo» ahora dice a dónde ir (antes: «créala desde Empresas → Nueva y marca esta solicitud en las notas»). | `SolicitudAcciones.tsx`, `solicitudes/actions.ts` |

**Lo que no usa el alta, a propósito:** `duplicarEmpresa` (copia el perfil de una empresa que ya existe, nace inactiva y sin administrador) y la empresa «Supplier Lite» de Supply (otro dominio). Quedan dos creaciones más a mano, no tres.

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **El rollback ahora sí deshace la empresa** (el defecto de arriba; verificado con el código nuevo, deducido para el antiguo). Borra, en una sola transacción, el usuario administrador recién creado, la sucursal principal y la empresa. Antes quedaba una **empresa huérfana con su sucursal** cada vez que algo fallaba tras crearla. **Si en producción hubo altas fallidas, pueden existir empresas huérfanas** (empresas sin ningún usuario, con una sola sucursal «Principal»). No las busqué ni las borré; es una consulta de solo lectura que te puedo preparar si quieres revisarlo.
2. **El registro público ahora también guarda el vertical** (la columna que manda) cuando el tipo elegido es uno válido. Antes lo dejaba vacío y la empresa se resolvía por el texto de `type`. Si el tipo no es un vertical válido, queda igual que antes.
3. **Una solicitud puede dar su empresa por dos caminos** (botón con contraseña temporal, o «Empresas → Nueva» precargada); los dos la dejan «Creada» y enlazada. Si la solicitud ya tiene su empresa, el segundo camino se niega antes de crear nada.
4. **Dentro del alta, «marcar la solicitud» y «mandar el correo de verificación» cuentan:** si fallan, se deshace todo (antes ya era así en la solicitud y en el registro; ahora lo es también al crear desde «Empresas → Nueva» con una solicitud precargada).
5. Los textos de error y de éxito de los tres caminos **no cambian** (salvo el mensaje de «ya existe esa cuenta» de la solicitud).

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **22** (`tests/alta-empresa.test.ts`): el orden con cuenta nueva y existente, el consentimiento y la confirmación de correo, los slugs ocupados, **cada etapa que puede fallar y qué se deshace** (incluido que una cuenta existente nunca se toca y que el error que sale es el original), lo que se escribe en la base, la solicitud → empresa y → precarga, que los tres caminos usan el alta, y el orden del borrado |
| `npm test` completo | **5 167 pruebas, 5 160 pasan, 0 fallan, 7 omitidas** (el bloque anterior cerró en 5 145: **+22**) |
| `rls:cobertura` | ✔ (la primera vez frenó la página nueva por leer la solicitud sin envoltorio; ahora va por `sinEmpresa`, con motivo) |
| eslint sobre lo tocado | 0 problemas |
| Prueba existente que cambié | `capacidades-fase0`: contaba **≥ 4** altas de empresa en el código y ahora hay **3** (el alta única, la copia y el Supplier Lite). Bajé el piso a 3 con la razón escrita; lo que la prueba exige —que **toda** alta lleve las capacidades de tenant nuevo— no cambia |

### 3.2 Contra la base y Auth de QA (el proyecto aislado) — **escribió y limpió**

Un guion llama al alta con los puertos **reales** y crea cinco empresas «QA alta …» con sus cuentas: **18 comprobaciones, todas bien**, y al terminar **0 empresas, 0 usuarios en la base y 0 cuentas de Auth** de esas pruebas.

* **Cuenta nueva (como el superadmin):** empresa con su slug, capacidades de tenant nuevo, tipo y vertical, sucursal principal, un usuario ADMINISTRADOR de esa empresa y, en la sesión de Auth, rol, empresa y usuario correctos.
* **Registro público:** nace sin publicar, con el país, el consentimiento guardado (versión y marketing) y la cuenta con el correo **sin confirmar**.
* **Cuenta existente:** ve las dos empresas, **su empresa activa no cambió** y no se creó otro usuario.
* **Falla al terminar:** la empresa, la cuenta de Auth y el usuario **ya no existen**.
* **Correo repetido en Auth:** falla y **no deja empresa huérfana**.

> **Cómo apareció el defecto:** la primera pasada de este guion falló justo ahí (`sucursales_companyId_fkey`) y dejó cinco empresas de prueba que tuve que limpiar a mano; con el arreglo, la segunda pasada fue completa. Con el código **anterior** (los tres caminos) tenía que pasar lo mismo: la sucursal principal se crea antes de cualquier paso que pueda fallar y el `.catch` del rollback tragaba el error. **Es una deducción del código y del esquema; no ejecuté el código antiguo** para verlo.

## 4. Lo que NO está hecho o NO se sabe

1. **No vi «Empresas → Nueva» precargada en un navegador** (en QA no hay superadmin). Está cubierta por pruebas del marcado (cada campo lleva su valor inicial, el campo oculto de la solicitud, el enlace desde la solicitud), por el compilador y por la prueba del alta contra QA; **no** por una persona haciendo clic. Tampoco ejecuté las pruebas de extremo a extremo de solicitudes.
2. **No probé** el envío real del correo de verificación del registro (en QA está apagado): su fallo dentro del alta lo cubre una prueba con puertos falsos, no el servicio real.
3. **Empresas huérfanas ya existentes en producción** (§2.1): no las busqué. Es plausible que haya alguna si alguna alta falló alguna vez.
4. **Un detalle que dejé como está:** en «Empresas → Nueva» (sin solicitud) el alta publica la empresa por defecto (la columna nace publicada); la solicitud y el registro la crean sin publicar. Lo respeté tal cual (no es parte de 7.3), pero es una diferencia entre caminos que quizá quieras unificar.
5. `duplicarEmpresa` y el Supplier Lite siguen creando la empresa por su cuenta (§1).
6. El perfil público sigue pidiendo sus 27 campos aparte; 7.3 cubre las cuatro vías de **creación** de F-02, no «el perfil pide solo lo que falta».
7. Siguen sin empezar: **7.5** (onboarding), **7.6** (notificaciones; D-08 abierta), la fase 8, Car Wash y las tablas «Stitch».

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2, incluido el arreglo del rollback?
2. ¿Quieres que prepare la **consulta de solo lectura** para buscar empresas huérfanas en producción (§4.3)? No la ejecuto sin tu orden.
3. ¿Unifico que una empresa creada por el superadmin nazca **sin publicar** como las otras dos (§4.4), o la dejas publicada por defecto?
4. ¿Qué sigue? Propongo **7.5** (onboarding: sucursal, cobro y horario, y enlace de retorno). **7.6** espera tu decisión D-08.
5. Siguen abiertas: Car Wash, D-08, el arreglo aparte en `main` de la fecha de «Nueva reserva» y el push de las ramas apiladas.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/alta-empresa.test.ts
```

Con una cuenta de superadmin: abre una solicitud y pulsa «Crear con los datos precargados» (`/superadmin/empresas/nueva?solicitud=<id>`). **No hay servidor de QA levantado.**
