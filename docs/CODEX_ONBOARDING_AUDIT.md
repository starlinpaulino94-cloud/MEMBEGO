# MEMBEGO — auditoría de onboarding y limpieza de fundaciones

Fecha: **2026-10-09**. Revisión local; sin acceso ni cambios a producción. La fuente de estado y arquitectura mantenible es [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); este informe registra evidencia y resultados de esta intervención.

## A. Conclusión arquitectónica

Membego ya tiene Commerce Core operativo en código: catálogo con variantes, stock por sucursal, pedidos, atribución, checkout, Deals, POS y Merchant Billing. Next.js concentra autorización y servicios transaccionales; Expo y el satélite de restaurante consumen APIs. Las invariantes importantes están en servicios y migraciones, además de las pruebas: no se pueden sustituir por restricciones de UI.

Supply V2 conserva compras, derechos y economía propios. El bridge proyecta sus ofertas y compras pagadas; no duplica el cobro. Merchant Billing queda separado de Supply Economics. El siguiente trabajo debe ordenar la coexistencia de Promocion legacy, Promotion universal, Deals y los motores de Supply antes de añadir otro motor.

La revisión da confianza alta en la existencia y comportamiento local cubierto por las pruebas citadas. **No certifica producción, pagos reales, rendimiento bajo carga real ni experiencia física.**

## B. Estado Git y fuentes

| Dato | Evidencia |
|---|---|
| Repositorio | [starlinpaulino94-cloud/MEMBEGO](https://github.com/starlinpaulino94-cloud/MEMBEGO) |
| Base comprobada | `origin/main`, `2f57b6aca41ed055ff2034289e719efc7636d8a1` |
| Rama local | `codex/onboarding-foundation-cleanup` |
| Rama auditada | `codex/onboarding-foundation-cleanup`; base `origin/main` `2f57b6aca41ed055ff2034289e719efc7636d8a1` |
| Integraciones recientes | [PR #583](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/583), merge `57a88910`; [PR #584](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/584), merge `2f57b6ac`; ambos fusionados el 2026-10-09 |
| Commits / push / PR | Commit y PR de esta rama se enlazan al completar la entrega; no se hará merge |

Se leyó el Plan Maestro, los estados Commerce/Supply, Production Readiness, reglas financieras, rendimiento, checklist de campo, ambas auditorías y el informe F0–F9. `COMMERCE_EXPERIENCE_AUDIT.md` estaba en **0 bytes** en el commit base; la inspección `git log --follow` encontró su contenido versionado (171 líneas, 25.255 caracteres) en `3d958bb8`, luego eliminado en `126c2e47`. Se restauró el documento histórico con una advertencia de vigencia. Se revisaron los módulos, schema, migraciones, capacidades, navegación, autorización, tenant, eventos y los dos flujos CardNET directamente.

Los [checks de GitHub del commit base](https://github.com/starlinpaulino94-cloud/MEMBEGO/actions/runs/37935153477) mostraban éxito en tipos/lint/unit, build, esquema, dependencias y secretos. El [Recorrido público](https://github.com/starlinpaulino94-cloud/MEMBEGO/actions/runs/37935153437/job/113835548500) ejecutó 160 tests, con 206 skip y 10 no ejecutados; falló una aserción de `pedidos-membego.spec.ts:143`. Su consulta por `dedupeKey` aceptaba la notificación del cliente (“Pedido recibido”) cuando el test buscaba la de empresa (“Nuevo pedido Membego”); ambos avisos comparten esa clave y la consulta no filtraba por título. Se afinó la consulta para seleccionar el aviso esperado. Es un fallo determinista de la aserción ambigua, preexistente en main; no un fallo de configuración ni una regresión de esta rama, y tampoco hay evidencia para llamarlo flaky. El CI de la rama en GitHub debe confirmar la corrección y los demás E2E.

## C. Contradicciones resueltas en la memoria operativa

| Afirmación antigua | Estado contrastado / evidencia |
|---|---|
| Todo comercio apagado | `CAPACIDADES_COMERCIO` se incluye en los cinco paquetes; catálogo, pedidos y Deals ON por defecto. Overrides reales desconocidos. |
| F6–F9 sin PR / commit actual 51273c4 / F2 siguiente | Los PR #583/#584 están fusionados y la base es 2f57b6ac; existen F0–F9 parciales y experiencia comercial. |
| Solo catálogo e inventario; no MembegoOrder ni billing | `orders/service.ts`, `billing/service.ts`, esquemas pedidos/facturación y suites PG ejercitan órdenes, comisiones, cortes y reversos. |
| Nadie consume stock / no hay wrapper de Supply | Pedidos/POS usan inventario; `supply-bridge/pedido.ts` envuelve compras pagadas de forma idempotente. |
| Cliente sin avisos ni eventos | `orders/avisos.ts` y `inventory/avisos.ts` notifican con dedupe; el bus persiste DomainEvent. Emisión posterior a la transacción, sin atomicidad con ella. Riesgo: `transaction committed → process crashes → notification/event may never persist`. El Outbox transaccional existente de Supply V2 puede orientar una reutilización posterior, pero requiere modelar Commerce y sus tenancy/consumidores; no se implementó aquí. |
| No taxonomía ni experiencia transversal | Navegación Comercio, ficha compuesta y vitrinas usan catálogo/ofertas/categorías existentes; `modules/comercio` y tests de experiencia comercial. No implica booking ni Discovery 2.0. |
| Referencia tecleada = pago verificado | `MERCHANT_REPORTED` difiere de verificación externa; fuente, referencia y fecha importan. Ver `orders/domain.ts` y pruebas de verificación. |
| Comisión congelada sin ajuste / solo importa origin | `VERIFICATION_ADJUSTMENT` append-only, también negativo; atribución demostrable puede comisionar otros orígenes. Supply siempre excluido. `billing/domain.ts` y PG billing. |
| Supply V1 sigue vivo / borrar sus tablas | Código retirado, 30 modelos históricos retenidos; dos tienen consumidores. No hubo borrado ni migración. |
| CardNET directo en pausa / sin ruta activa / solo CARTOWN | Las rutas aceptaban PAN/CVV de CLIENTE autorizado. No hay guard de identidad CARTOWN. Ahora HTTP 410; tokenizado permanece. |
| Todas las cifras de tests son actuales | Se separaron resultados por ejecución; los históricos quedaron enlazados a su commit. Los E2E locales actuales no se ejecutaron. |
| 190/206/208 migraciones, última 20261051 | 209 migraciones; última 20261052; replay desde cero y diff actual comprobados. |
| 26 reglas de conciliación | Hay 27, incluida P05 sobre comisión porcentual con pago solo reportado. Nueve señales en `riesgo-comercio`. |

## D. Cambios realizados

### Documentación

Se reemplazó el estado acumulativo por **ESTADO ACTUAL** y **HISTORIA / FASES ANTERIORES**. Conserva límites, invariantes, decisiones financieras y próximos pasos; el original completo queda enlazado al commit base. Los informes antiguos recibieron aviso de snapshot para que sus PASS, ramas y capacidades no se interpreten como vigentes. Se corrigieron la documentación de CardNET y el comentario obsoleto de pedidos en el catálogo de capacidades.

### ESLint y cliente Expo

La dependencia de Hooks ya existía. El preset de Next registra plugins para JS/TS/JSX/TSX y ciertas variantes, pero excluye `.cjs`; el override global intentaba aplicar reglas de Hooks al stub CommonJS. Se ajustó el alcance del override al del preset. Se conservaron `rules-of-hooks`, `immutability` y `purity` como errores; `exhaustive-deps` conserva su nivel anterior.

Al ejecutar el comando oficial aparecieron ocho errores reales adicionales fuera de `src/tests`. Se corrigieron las animaciones mediante la API `get/set` de SharedValue en ruleta/confeti/wallet y la lectura de reloj del render con estado y efecto en las tarjetas de ofertas. La excepción de `require` se limita a imágenes estáticas de Expo, como requiere Metro. Referencias: [Reanimated SharedValue](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/), [imágenes React Native](https://reactnative.dev/docs/images), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).

CI ahora usa `npm run lint`, igual que local. `tests/eslint-config.test.ts` comprueba CommonJS y que las reglas de Hooks sigan activas tanto en web como Expo. No se desactivaron reglas de Hooks para conseguir verde.

### CardNET: hallazgo y cierre

- **Quién podía entrar:** `/iniciar` y `/completar` exigían sesión CLIENTE y pertenencia/objetivo, además de rate limit y capacidad/configuración. Eso limitaba acceso, pero seguían recibiendo datos de tarjeta en `req.json()`.
- **Consumidores:** `PagoTarjetaCardnet.tsx` era el único caller de esas rutas y no tiene importadores en `src`/`apps`. Las pantallas vigentes usan `PagoTokenCardnet` y el BFF móvil tokenizado.
- **Tránsito:** el camino directo enviaba PAN/CVV desde el backend al proveedor. No hay columnas explícitas PAN/CVV en PagoIntento, pero esa ausencia no prueba que los JSON de evidencia estuvieran libres de tarjeta.
- **Persistencia potencial:** `sinTarjeta` de `cardnet-core.ts` era superficial; no elimina claves anidadas. `cardnet3ds.ts` tiene una rama que persiste `estado.crudo` sin ese filtro. Son vías potenciales; **no se inspeccionaron filas reales ni se demostró que guardaran PAN/CVV**.
- **Logs/telemetría potenciales:** los catch legacy usaban `logErrorBd` y mensajes/respuestas del proveedor. Esta rama elimina `request.data` tanto en limpieza de eventos como Edge; Replay ahora enmascara todo texto e inputs. No se puede afirmar ausencia histórica de datos sensibles en logs.
- **Corrección:** las tres rutas directas, incluido retorno GET/POST, devuelven un JSON fijo 410 y `no-store`, sin leer la petición, autenticar, persistir, consultar el proveedor ni reflejar datos en HTML. El retorno antiguo también dejaba de ser necesario al retirar el flujo. No se redirigen peticiones con datos de tarjeta.
- **Compatibilidad conservada:** siguen los endpoints tokenizados web/móvil y `montoDeObjetivo`, utilizado desde `cardnet3ds.ts`. No se inventó una integración ni se modificó la semántica de importe/activación. Un consumidor externo no registrado del flujo directo recibirá 410 y deberá migrar; no es posible demostrar que no exista uno fuera del repositorio.
- **Privacidad Replay:** no se halló una razón documentada para capturar texto visible. `maskAllText`, `maskAllInputs` y `blockAllMedia` quedan en `true`; breadcrumbs de consola se desactivan. `limpiarEvento` elimina `request.data`, cookies y campos de identidad distintos del id opaco; `limpiarUrl` filtra tokens, email, teléfono, direcciones y referencias de pago incluso con variaciones de mayúsculas/guiones. El `beforeSend`/`beforeBreadcrumb` se instala en cliente, servidor y Edge.
- **Límite:** no se puede probar que todo mensaje arbitrario de excepción o log creado fuera de Sentry esté libre de datos personales; los errores enviados por capturas de aplicación aún requieren evitar incluir valores de formularios en el mensaje. La política evita capturar campos/texto multimedia de Replay y cuerpos del request, no limpia el historial ya enviado.

Pruebas: cuatro handlers invocados con una petición Proxy que lanza ante cualquier lectura y fetch bloqueado (`cardnet-legacy-retirado.test.ts`); limpieza de objetos anidados/cuerpos serializados (`observabilidad.test.ts`); suites tokenizadas existentes dentro de Unit. La spec HTTP nueva se dejó lista, **sin afirmar ejecución**.

### Otros ajustes de fundación

- `.gitattributes` fija LF para texto: los guards estáticos asumían saltos LF y fallaban en un checkout CRLF de Windows. Cuatro pruebas normalizan separadores de ruta conservando todas sus assertions. La primera suite dio 26 fallos de portabilidad; la final no presenta fallos.
- `permisos-catalogo.mjs` usa `fileURLToPath`, evitando `C:\\C:\\...`. `probar-rls.mjs` pone opciones antes de la URL y envía SQL por stdin UTF-8: el cliente Windows ignoraba opciones tras el argumento posicional y dañaba acentos en argv. No se cambiaron políticas SQL.
- Expo declara Zod 4 explícitamente en su package y lock. La instalación aislada resolvía Zod 3 transitivo y producía 34 errores de tipos en contratos de pago; tras declarar la dependencia el typecheck de Expo pasa.
- Sin cambios de esquema, tarifas, capacidades efectivas, RLS de producción ni grandes funcionalidades. Sin skip/only nuevos, assertions eliminadas, any añadido ni supresiones genéricas.

## E. Verificación ejecutada

Entorno: Windows, Node **24.19.0**, Bun **1.4.1**, Next **16.3.8**, Prisma **6.19.3**, PostgreSQL **16**. Instalación raíz `npm ci`; Expo `bun install --frozen-lockfile` y actualización controlada del lock para Zod. PostgreSQL se ejecutó en clusters de prueba nuevos bajo `work/pg-*`, limitados a `127.0.0.1:55439/55440`; no se usó el servicio PostgreSQL existente ni su base.

| Verificación | Estado | Comando / resultado y alcance |
|---|---|---|
| TypeScript raíz | PASS | `npm run typecheck`, sin errores. El build omite tipos por configuración existente; por eso se ejecutó tsc aparte. |
| TypeScript Expo | PASS | `bunx tsc --noEmit -p apps/client/tsconfig.json`, sin errores tras declarar Zod. |
| ESLint | PASS | `npm run lint` (`eslint .`): 0 errores, 178 warnings. No equivale a cero deuda. |
| Unit | PASS | `npm test`: **3943 totales, 3937 pasan, 0 fallan, 6 omitidas heredadas**. Incluye regresiones nuevas y sellos de migraciones. |
| PostgreSQL | PASS | `npm run test:db`: **648/648**, cero omitidas, sobre 209 migraciones aplicadas desde vacío, con collation ICU `en-US`. |
| E2E relevante | **NOT RUN local** | `playwright --list` descubrió 86 casos en `cardnet-legacy.spec.ts`, `comercio-experiencia.spec.ts`, `publico.spec.ts` y `pedidos-membego.spec.ts` (proyectos móvil/escritorio). El arranque local fue rechazado por revisión automática; no se ejecutaron casos ni se alteraron skips. El workflow E2E de PR ejecuta el suite completo. |
| Build | PASS | `npm run build` (`next build --webpack`), compilación y prerender terminados. Sin pago real ni configuración de producción. |
| Migraciones | PASS | `prisma validate`; `prisma migrate deploy` de **209**; `migrate diff --from-url ... --to-schema-datamodel prisma/schema --exit-code`: **No difference detected**; sellos originales pasan en Unit. |
| RLS estático | PASS | Cobertura: 580 archivos con contexto, 24 excepciones justificadas/80 sitios; preflight: 305 tablas, sin tablas indebidamente denegadas detectadas. No prueba producción. |
| RLS conductual | PASS | **50 comprobaciones, 0 fallos**, con capas 1/2 aplicadas a otra base efímera migrada. Incluye ledger/órdenes/Deals, sin omitir sus triggers. |
| Permisos | PASS | `node scripts/permisos-catalogo.mjs`: 107 funciones con guardia en ambas direcciones. |
| Presupuesto de bundle | PASS, poco margen | **8883/9200 KB (97%)**; entrada compartida 868/1000 KB; mayor chunk 526/600 KB. Top 5 client chunks: `37664-479e1db6fd98a7ca.js` 526 KB (Sentry marker); `main-0d2518672ec885a5.js` 442 KB (Sentry/Replay; root main); `87672-1819654aead2c37a.js` 395 KB (`recharts`, `lucide`); `7cb1fa1f.1c1ae9528425130c.js` 281 KB (paquete vendor sin marker identificable); `16425.a8027df998141c9b.js` 203 KB (Sentry Replay/Zod). `main`/root chunks son client-side; los demás se sirven al cliente por ruta/uso. Recomendación: confirmar paquetes opacos con bundle analyzer; después lazy-load de gráficos analíticos e importaciones de iconos individuales. Replay queda fuera del registro de texto/inputs/media y no se habilitan breadcrumbs de consola. No se aumentó el límite. |

Diagnóstico de entorno conservado: la primera base se creó con locale C y dio **647/648**, al no tratar `Café`/`CAFÉ` como iguales. No se aflojó la prueba ni el dominio: se creó otra base con ICU, se reaplicaron las migraciones y se repitió la suite completa. La primera ejecución del script RLS tampoco era válida por argumentos/encoding de psql en Windows; los 50 PASS son posteriores a corregir y ejecutar realmente sus consultas.

Los E2E no son PASS. La revisión automática rechazó tanto el arranque inicial como el restringido a `127.0.0.1`; el único motivo proporcionado fue **“blocked by policy”**. No se intentó sortear el bloqueo con otra herramienta. Requieren ejecutarse en un entorno que autorice ese servidor, antes de aprobar la integración.

## F. Riesgos abiertos

1. **Producción no auditada:** rotación histórica de secretos, contraseña de BD, RLS efectivo, migraciones y overrides de capacidades. Los documentos anteriores dicen que una clave fue rotada; no se verificó esa afirmación aquí. No tratar un gitleaks limpio del árbol como prueba de rotación.
2. **Puerta E2E pendiente en esta auditoría:** los E2E locales no se pudieron ejecutar porque la política bloqueó el servidor. La causa del fallo anterior de Recorrido público se identificó y la aserción ambigua se corrigió; el workflow E2E de este PR debe confirmar el resultado real antes de aprobar/mergear. No presentar la limpieza como lista para producción mientras ese check esté pendiente o falle.
3. **CardNET:** falta QA con proveedor y datos autorizados; no hubo cobros reales. Helpers directos quedan por dependencia de cálculo y no deben reactivarse. Revisar con operaciones la posible retención histórica de cuerpos/evidencias sin copiar datos sensibles a reportes.
4. **Privacidad:** Replay enmascara texto, inputs y multimedia; los breadcrumbs de consola se desactivan y las URLs/cuerpos/cookies/datos de identidad se filtran. Queda pendiente vigilar que errores y logs construidos por código no interpolen campos sensibles. No hubo prueba con datos de usuario reales; la limpieza no sanea historial ya enviado.
5. **Negocio/finanzas:** comercio ON hace material la comunicación de tarifas; fiscalidad/e-CF, cobro externo de merchant, devoluciones monetarias POS/Supply y prueba de campo siguen abiertos. Reversión de inventario o comisión no equivale a haber devuelto dinero al cliente.
6. **Entrega y consistencia eventual:** avisos se emiten después del commit; puede perderse el evento antes de persistir. El bridge Supply depende de sincronización y casa/sucursal configuradas. No hay garantía de entrega multicanal comercial.
7. **Calidad/rendimiento:** 178 advertencias lint, seis unitarias omitidas heredadas y bundle al 97%. Las animaciones Expo pasan lint/tipos, pero no se probaron visualmente en dispositivo ni se compiló Android/iOS. Storage, lector y térmica no se ensayaron.

## G. Próxima fase recomendada, no implementada

**Growth Commerce Unification: Promotion → Deal → Coupon → Campaign.** Primero cerrar E2E y redactar una decisión breve que identifique la autoridad de cada entidad, permisos por empresa/sucursal, reglas económicas, migración/compatibilidad de Promocion legacy y Promotion, y separación de Supply.

Criterios mínimos del diseño: una sola evaluación del descuento en servidor; producto/variante sin duplicación; snapshot y atribución trazables; obtención/canje idempotentes; reserva y liberación de presupuesto/stock; aislamiento entre empresas; compatibilidad de beneficios existentes; pruebas de carreras, cancelación, vencimiento y reembolso. Empezar por una rebanada de regla → Deal sobre el catálogo existente. No construir todavía booking, bundles, Discovery 2.0 ni nuevos canales de notificación.
