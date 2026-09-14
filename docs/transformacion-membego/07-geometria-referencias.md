# R0: contrato de geometria de las referencias

## Decision operativa

**R0 puede registrar una discrepancia real y permitir comenzar R1.** No se exige que la aplicacion ya reproduzca los doce disenos para acreditar el comparador. Los fallos de dimensiones o de pixeles son baseline de discrepancias, no motivo para actualizar referencias ni esperar a terminar el rediseno.

Se adoptan muestras reproducibles **390 x 884 CSS para cliente**, **1280 x 1024 CSS para administracion** y **768 x 1024 CSS para tablet derivada**, con DPR 1 y captura de viewport. Son parametros de trabajo elegidos y medidos, no metadatos originales recuperados. Los anchos 390/1280 tienen fuerte apoyo empirico en los HTML y en la proporcion de los PNG. La altura del viewport original, su DPR y el algoritmo de exportacion siguen sin estar probados.

El otro lane es propietario de las capturas autenticadas y fixtures Supabase TEST autorizados. Este lane no inicia aplicacion, servidor, login, API ni BD. Si las capturas recibidas usan otra altura, se conserva su metadata y se registra la discrepancia; no se recortan para hacerlas pasar.

## Evidencia y metodo

Artefactos: `.omo/start-work/r0-visual/geometry-20260909/`. Cada `<id>-<ancho>.json` contiene dimensiones nativas, hashes PNG/HTML, tokens literales, cajas CSS calculadas, fuentes, imagenes, viewport, DPR, navegador, politica de animaciones y resultado del comparador sin transformaciones. PNG del mismo nombre es el render del HTML, **no** una captura de aplicacion. `geometry.json` agrupa las 14 observaciones; `network.json` registra respuestas publicas; `cleanup.json` registra cierre del navegador.

Comando ejecutado:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/reference-geometry.ts --browser "C:\Users\starl\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe" --source-root "C:\Users\starl\OneDrive\Desktop\stitch_membego_mobile_e_commerce_experience (1)\stitch_membego_mobile_e_commerce_experience" --out .omo/start-work/r0-visual/geometry-20260909
```

Un rerun necesita un destino nuevo. El ejecutable ya estaba instalado. Se leyeron PNG/HTML externos reales, se comprobaron contra los digests fijados del manifiesto y se renderizo el HTML sin editarlo mediante `page.setContent`. Al terminar se revalidaron los PNG/HTML/DESIGN del repo y de la fuente para las doce pantallas. Resultado: `ALL_REPOSITORY_AND_SOURCE_HASHES_VERIFIED`; originales y hashes del manifiesto intactos.

Navegador medido: Chromium headless-shell **151.0.7922.34**, DPR 1, locale `es-DO`, timezone `UTC`, modo claro, reduced-motion reduce; screenshots `scale: css`, `fullPage: false`, animaciones deshabilitadas y caret oculto. Se espero carga de fuentes e imagenes. Inter y Material Symbols usados aparecen cargados; otras declaraciones/subsets no usados pueden aparecer `unloaded`, lo que no equivale a un fallo. No se inventa una version de fuente original.

Red limitada a GET de script/stylesheet/font/image en cdn.tailwindcss.com, fonts.googleapis.com, fonts.gstatic.com y lh3.googleusercontent.com, sin sesiones personales, service workers ni llamadas a la aplicacion. El registro no contiene BLOCKED, ERR_, FAILED ni respuestas 4xx/5xx. Los assets publicos fueron descargados por el navegador; no se envio codigo del proyecto a un servicio externo. Estos recursos remotos no estan versionados en el manifiesto: su variacion y la rasterizacion del navegador siguen siendo fuentes de incertidumbre.

## Medidas de las doce referencias

`Wc` es el ancho CSS de trabajo. `s = Wpng / Wc` es una **escala efectiva candidata**, no DPR medido. `Hproporcion = Hpng * Wc / Wpng` es la altura CSS que conservaria la proporcion de la imagen suministrada. `Hdoc` es `document.documentElement.scrollHeight` realmente medido al renderizar el HTML al ancho Wc y altura de muestra. Valores fraccionarios redondeados a 3 decimales solo en esta tabla; formulas y JSON conservan precision.

| ID del manifiesto | PNG nativo (px) | Wc (CSS) | s candidata | Hproporcion (CSS) | Hdoc medido (CSS) |
| --- | --- | ---: | ---: | ---: | ---: |
| inicio_membego | 269 x 1600 | 390 | 269/390 = 0.689744 | 2319.703 | 2323 |
| cuenta_membego | 429 x 1600 | 390 | 429/390 = 1.1 | 1454.545 | 1454 |
| men_membego | 706 x 1600 | 390 | 706/390 = 1.810256 | 883.853 | 884 |
| mi_qr_sin_beneficio_membego | 464 x 1600 | 390 | 464/390 = 1.189744 | 1344.828 | 1344 |
| editor_de_inicio_de_la_app_membego | 1578 x 1600 | 1280 | 1578/1280 = 1.232813 | 1297.845 | 1298 |
| resumen_administrativo_membego | 1600 x 1590 | 1280 | 1.25 | 1272 | 1272 |
| gesti_n_de_membres_as_y_planes_membego | 1228 x 1600 | 1280 | 1228/1280 = 0.959375 | 1667.752 | 1668 |
| centro_de_canjes_y_validaci_n_qr_membego | 1215 x 1600 | 1280 | 1215/1280 = 0.949219 | 1685.597 | 1675 |
| pagos_y_comprobantes_membego | 1329 x 1600 | 1280 | 1329/1280 = 1.038281 | 1541.008 | 1541 |
| marketing_y_notificaciones_membego | 1206 x 1600 | 1280 | 1206/1280 = 0.942188 | 1698.176 | 1698 |
| prospectos_y_crm_membego | 1600 x 1760 | 1280 | 1.25 | 1408 | 1408 |
| fidelizaci_n_y_crecimiento_membego | 879 x 1600 | 1280 | 879/1280 = 0.686719 | 2329.920 | 2319 |

Interpretacion acotada:

- Menu: 390 x 884 del HTML explica 706 x 1600 del PNG dentro del redondeo. Por eso 706 no debe tratarse como viewport movil CSS original.
- Resumen y CRM: alturas medidas 1272 y 1408 multiplicadas por 1.25 producen exactamente 1590 y 1760. Es evidencia fuerte de escala efectiva, no de DPR 1.25 original.
- Cuenta, QR, Editor, Planes, Pagos y Marketing difieren menos de 1 CSS px entre Hproporcion y Hdoc. El redondeo de exportacion es una explicacion plausible, no un hecho medido de su pipeline.
- Home difiere 3.297 CSS px; Canjes 10.597; Fidelizacion 10.920. No se eliminan esos residuos con un stretch vertical ni tolerancias inventadas. Pueden deberse a contenido, fuentes, wrapping o exportacion; esta medicion no adjudica una causa unica.
- Once PNG tienen el lado mayor igual a 1600, pero CRM mide 1600 x 1760. No hay prueba para imponer a todos una regla universal de lado mayor limitado a 1600.

## Anclas CSS y limites del bitmap

En los cuatro HTML cliente, los tokens literales y el navegador concuerdan: `h-14` = **56 CSS px**, `header-location-height: 2.25rem` = **36**, header total **92**, `bottom-nav-height: 3.5rem` = **56**. Raiz 16px; body 14px/20px e Inter; headline-lg 22px. `width: 100vw` resulta en body/scrollWidth 390. `min-height: max(884px,100dvh)` es un minimo, no prueba de la altura original de captura.

En el render administrativo de Resumen: aside fijo **256 x 1024**, header fijo **x=256, y=0, ancho=1024, alto=64**, main ancho 1024, documento 1272; body 16px/24px, headline-lg 22px. No hay que convertir indiscriminadamente todo texto admin al token body-md de 14px. Las cajas de cada export se conservan en su JSON.

La medicion nativa `leadingLeftEdgeRun` cuenta filas consecutivas exactamente iguales al pixel superior izquierdo, sin tolerancia: Home 37, Cuenta 60, Menu 100, QR 65. Es un **run de color exacto**, no una altura CSS ni la frontera completa de la barra: interpolacion/sombras pueden cambiar el ultimo pixel antes de la frontera visible. No se divide ese run por 56 para anunciar un viewport exacto.

El PNG de Home contiene todo el contenido largo y la navegacion al final; la muestra 390 x 884 coloca el nav fijo en y=828 y solo muestra la parte superior. Son encuadres distintos. Los PNG nativos no se equiparan a capturas de viewport ni se infiere el tratamiento original de elementos fijos de una mera altura de imagen.

## Normalizacion de presentacion, no baseline

Para revision lado a lado se define **REFERENCE_PRESENTATION / NOT_APPROVED**, exclusivamente visual:

- Entrada: PNG nativo inmutable y su SHA256 del manifiesto.
- Salida de presentacion: caja CSS `Wc x (Hpng * Wc / Wpng)`, usando Wc=390 para cliente y 1280 para admin, como en la tabla. Son dimensiones de visualizacion, **no PNG nuevos medidos**.
- Formula uniforme: x' = x * Wc/Wpng; y' = y * Wc/Wpng. No se usa Hdoc para deformar el eje vertical.
- Metodo: visualizar el archivo con ancho CSS Wc y `height:auto`; interpolacion de imagen del navegador. No es un nuevo render responsive ni una regeneracion de baseline. La rasterizacion fraccionaria del visor no sirve como contrato de igualdad de pixeles.
- Motivo: la calibracion anterior permite leer texto y distancias en una escala de trabajo comun. La prueba pixel-perfect continua usando los bytes originales o un contrato de derivados expresamente aprobado posteriormente; no hay tal aprobacion en R0.

En esta ejecucion **no se generaron archivos PNG reescalados**: `transformsApplied:false` en geometry.json. Si posteriormente se materializa una presentacion como PNG, se debe registrar origen/hash, dimensiones de entrada/salida enteras, factor exacto, redondeo, filtro/kernel, hash del derivado, motivo y NOT_APPROVED en un artefacto separado. Nunca dentro de `comparePixels`, nunca reemplazando `png.path` o su digest.

## Separacion de evidencias

| Clase | Evidencia | Uso permitido |
| --- | --- | --- |
| NATIVE_SUPPLIED_PNG | 12 originales fijados en stitch-manifest.json | Autoridad de apariencia; dimensiones de bitmap |
| RENDERED_HTML_REFERENCE | 12 capturas nuevas a 390 x 884 / 1280 x 1024 | Medir CSS y encuadre; NOT_APPROVED como sustituto del PNG |
| DERIVED_RESPONSIVE_HTML_REFERENCE | Home 768 x 1024 y Resumen 390 x 884 | Diagnostico de reflow; no referencia responsive aprobada |
| REFERENCE_PRESENTATION | Politica CSS proporcional definida arriba, no PNG generado | Lectura lado a lado; no aceptacion ni responsive |
| APPLICATION_CAPTURE | La entrega del otro worker | Baseline real por ruta/rol/estado/revision; ausente en este lane |

Las 12 PNG nativas y las 14 capturas del HTML se abrieron directamente con Read. Las capturas contienen el contenido de exportacion, no datos obtenidos de la aplicacion. No se accionaron formularios, botones de pago, canje o sesion.

Home tablet tiene scrollWidth 768 y scrollHeight **2398**, no los 4568.030 que resultarian de ampliar proporcionalmente su PNG a 768: responsive no es zoom. Resumen movil tiene viewport 390 pero scrollWidth **513** y scrollHeight **4162**; el aside sigue ocupando 256 px y el contenido se recorta. Este export no proporciona un admin movil utilizable y no se aprueba por el solo hecho de renderizarlo. No bloquea el baseline R0; alimenta el trabajo responsive posterior.

## Apariencia: resolver el primario con evidencia

Precedencia: **PNG suministrado > HTML como evidencia auxiliar > prose/tokens en conflicto de DESIGN**.

Conteo exacto sRGB de pixeles #006194 en las doce imagenes, en el orden del manifiesto: **6046, 6435, 3433, 29732, 23388, 51777, 20417, 22030, 32963, 16066, 23308, 9707**. #0284C7 tiene **0** en las primeras once y **1945** en Fidelizacion. Los doce configs HTML declaran primary #006194 y el .bg-primary calculado confirma rgb(0,97,148).

Recomendacion para implementar componentes primarios: **#006194**, no el #0284C7 global de la prosa conflictiva. Conservar #0284C7 donde el PNG y HTML lo usan como color de dato de la ruleta: `fidelizaci_n_y_crecimiento_membego/code.html` lineas 290, 296, 376, 419-420 lo identifican explicitamente. No reemplazar todos los azules por uno solo. La recomendacion no modifica DESIGN ni ningun original; diferencias de gradientes, iconografia/rasterizacion y estados aun se revisan contra PNG.

## Fallo explicito util y paso siguiente

Se ejecuto el CLI existente, sin cambios al algoritmo:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --self-test-reference docs/transformacion-membego/stitch/inicio_membego/screen.png --actual .omo/start-work/r0-visual/geometry-20260909/inicio_membego-390.png --out .omo/start-work/r0-visual/geometry-dimension-proof-20260909
```

Resultado real **exit 1 / DIMENSION_MISMATCH** (la categoria DIFFERENT_DIMENSIONS esperada): referencia **269 x 1600**, actual **390 x 884**, areas **430400 / 344760**, tolerancia **0**, `changedPixels:null`, `ratio:null`, `diffArtifact:null`. Hashes completos y diagnostico en `geometry-dimension-proof-20260909/report.json`. Los 14 pares del medidor tambien fallan por dimensiones; no se inventa un porcentaje de diferencia entre rejillas incompatibles. El CLI etiqueta esta demostracion TOOLING_SELF_TEST, no fidelidad de la aplicacion.

Para la captura real del otro lane, usar `--screen ID --actual <png> --metadata <json> --out <directorio-nuevo>` del contrato docs05. Retener exit 1 como baseline R0 si las dimensiones o pixeles difieren. El gate de integridad/ejecucion exige archivos validos y metadatos medidos, no igualdad con una pantalla R1 todavia no implementada. Hacer coincidir el diseno y aprobar estados/derivados pertenece a R1 en adelante.

## Pruebas y cierre de recursos

TDD nuevo, separado de los 33 tests originales: `tsx --test tests/stitch-geometry.test.ts` fallo 3/3 antes de existir el medidor (9277.6909ms); luego paso 3/3 (12909.0795ms). La prueba de pixeles usa una PNG 2 x 3 conocida para distinguir dimensiones y conteos exactos. El render real de los 14 casos constituye la ejecucion de integracion del medidor.

Verificacion final: `.omo/start-work/r0-visual/verification-0f0a2060-0748-4cea-aa3d-0e6baeba608d/verification.json` registra pass=true: 33 tests originales, lint, tipado estricto y tipado global pasan; los cuatro archivos protegidos conservan hashes antes/despues. El medidor tiene 125 LOC puros. Adicionalmente `tsx --test tests/stitch-geometry.test.ts` vuelve a pasar 3/3 (12885.3829ms) y ESLint del medidor y test nuevo termina sin diagnosticos. El algoritmo y los 33 tests del comparador no se editaron. Revision: responsabilidad de medicion aislada, entradas parseadas, sin assertions de tipos, sin helpers especulativos ni mutaciones de fuentes; contadores locales y salida estructurada en el CLI.

El navegador se cerro en finally; cleanup.json registra browserClosed=true, completedCaptures=14, appServerStarted=false, dbTouched=false. Sin instalaciones, servidores, conexiones de BD, sesiones autenticadas, commits, deploy ni workers anidados. Las instrucciones antiguas que exigian Bun y la carpeta OneDrive para todo uso quedan **sustituidas por Node + tsx portables** de docs05: hashes del repo siempre obligatorios; fuente externa solo cuando se solicita explicitamente.
