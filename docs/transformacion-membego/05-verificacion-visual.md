# R0: verificacion visual sin autoaceptar baselines

## Estado y alcance

Harness implementado y probado; **aceptacion de la aplicacion BLOQUEADA**. Ningun resultado de este documento aprueba fidelidad Stitch ni marca la tarea 2 del plan como terminada.

Se reutilizan Node y tsx del proyecto, sharp, Zod y Playwright ya instalados. No se requiere Bun. `.github/workflows/ci.yml` instala Node 22 y usa npm ci/npm test; los subprocesses usan `process.execPath` y `createRequire(import.meta.url).resolve('tsx/cli')`, nunca un runtime buscado en PATH. No se agregan dependencias ni se modifica `package.json`, `tsconfig.json`, el manifiesto o `src/`. Tampoco se modifica ni ejecuta `scripts/verificar-home-e2e.mts`: contiene trabajo dirty del usuario y su integracion queda pendiente de un entorno autorizado.

| Modulo | Responsabilidad |
| --- | --- |
| `scripts/visual/compare.ts` | CLI de comparacion y reporte |
| `scripts/visual/pixels.ts` | Decodificacion PNG y diferencia RGBA |
| `scripts/visual/reference.ts` | Resolucion de IDs e integridad de referencias |
| `scripts/visual/contracts.ts` | Contratos de entrada y errores |
| `scripts/visual/evidence.ts` | Creacion exclusiva de directorios de evidencia |
| `scripts/visual/capture-self-test.ts` | Captura de fixture sintetico aislado |
| `scripts/visual/verify.ts` | Ejecucion y registro de gates locales |
| `tests/stitch-visual.test.ts` | Caracterizacion, pruebas de pixeles, integracion y CLI |

Todos los modulos y el archivo de pruebas deben permanecer por debajo de 250 LOC puros; `verify.ts` registra la medicion y los hashes actuales en cada ejecucion.

## Contrato del comparador

- PNG de un solo frame, 8 bits, firma PNG real, decodificacion estricta y limite de 40 millones de pixeles. Formatos no soportados, PNG truncado/corrupto o lectura fallida producen error explicito.
- Se compara RGBA en sRGB a coordenadas identicas. El canal alfa participa. No se redimensiona, recorta, rota, enmascara ni suaviza para ocultar cambios. Perfiles de color se convierten a sRGB; el hash sigue siendo el de los bytes originales.
- `changedPixels`: numero de pixeles con al menos un canal distinto; `totalPixels`: area de referencia; `actualTotalPixels`: area actual; `ratio = changedPixels / totalPixels`.
- Se reportan ambas `dimensions`, `referenceHash`, `actualHash`, `tolerance`, `diffArtifact`, rutas y momento de comparacion. El diff marca diferencias en magenta opaco y deja el resto transparente; un visor puede mostrar el fondo transparente negro.
- Si las dimensiones difieren, falla con `DIMENSION_MISMATCH`; `changedPixels`, `ratio` y `diffArtifact` son `null`, pues no existe una rejilla comun. Se conservan ambos tamanos, areas y hashes. Nunca se transforma la imagen para forzar comparabilidad.
- La tolerancia predeterminada es **0**. Solo `--max-ratio` explicito admite un decimal entre 0 y 0.01 inclusive. Es una fraccion de pixeles, no un umbral de color: 0.01 significa 1%. Una tolerancia aprobada por el operador queda registrada y no certifica fidelidad. No hay tolerancias por defecto escondidas ni exclusion de antialiasing.
- Exit 0: `PIXELS_EQUAL` o `WITHIN_EXPLICIT_TOLERANCE`. Exit 1: `PIXEL_MISMATCH` o `DIMENSION_MISMATCH`. Exit 2: argumentos, integridad, metadatos, imagen o E/S invalidos. stdout contiene JSON salvo `--help`.
- Todo reporte incluye `fidelityApproval: NOT_GRANTED`, incluso con exit 0. La igualdad de bitmap no acredita ruta, permisos, contenido correcto, responsive ni autenticidad de la captura.

## Integridad e IDs

`--screen ID` usa exclusivamente `docs/transformacion-membego/stitch-manifest.json`. Los doce IDs y dieciocho rutas se conservan; un ID desconocido produce `UNKNOWN_SCREEN`, sin fallback.

Antes de leer la captura de aplicacion se comprueban siempre SHA256 del PNG, HTML y DESIGN versionados de la pantalla seleccionada. Se exige que los IDs sean unicos y que las dimensiones decodificadas coincidan con el manifiesto. Por defecto el reporte registra `referenceIntegrity: REPOSITORY_VERIFIED`; `source_root` del manifiesto es procedencia historica, no un requisito de CI. Un checkout con los assets fijados puede verificarse sin OneDrive. Los hashes fijados no se omiten ni se actualizan.

El recheck externo se solicita explicitamente con `--source-root DIRECTORY` (solo junto a `--screen`), o `loadReference(id, sourceRoot)`. Primero se verifican las copias del repositorio y luego PNG, HTML y DESIGN de esa fuente. Si todo coincide, el reporte registra `REPOSITORY_AND_EXTERNAL_VERIFIED` y `referenceSourceRoot`. Fuente solicitada ausente o ilegible produce exit 2; bytes distintos producen `REFERENCE_DRIFT`. Un argumento vacio es invalido. Nunca se degrada silenciosamente a verificacion solo del repositorio.

Una discrepancia produce `REFERENCE_DRIFT`: conservar ambas versiones y resolver su procedencia, nunca reescribir manifiesto o baseline. Las pruebas copian los assets versionados a directorios unicos; solo cambian la ruta de procedencia de la copia de prueba a una ubicacion ausente, conservando todos los hashes fijados. Deterioran copias de PNG/HTML/DESIGN del repo o de la fuente explicita, nunca los originales. Un caso adicional conserva el manifiesto byte-identico y prueba que la deriva bloquea antes de leer una captura ausente. Los metadatos de contrato usados por estas pruebas no representan capturas autenticadas ni conceden fidelidad.

El modo `--self-test-reference` es independiente y solo emite `TOOLING_SELF_TEST` / `SELF_TEST_ONLY`. No puede presentarse como comparacion de una pantalla real. No existe comando de aprobar, actualizar o regenerar baselines.

## Uso local

Ejecutar desde la raiz del repositorio. `.omo/start-work/r0-visual/` y el padre del destino deben existir. Cada `--out` debe ser un directorio **nuevo** bajo esa raiz; no se reutilizan reportes. Se comprueba el padre real para impedir escapes por enlaces y se usan creacion exclusiva de directorio y escrituras `wx`. Entradas, referencias, archivos existentes y rutas externas no pueden ser destinos.

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --help
node node_modules/tsx/dist/cli.mjs --test tests/stitch-visual.test.ts
node node_modules/tsx/dist/cli.mjs scripts/visual/verify.ts
```

El runner equivalente del script npm existente es `node_modules/.bin/tsx --test tests/stitch-visual.test.ts` (`.cmd` en Windows). No necesita instalaciones ni cambios en CI. El verificador guarda stdout/stderr, argumentos, exits, hashes de codigo, LOC y hashes antes/despues de los cuatro archivos protegidos de R0. No contiene hashes historicos del usuario: compara los bytes observados al inicio y al final de esa ejecucion. Usa el ejecutable Node actual para pruebas, ESLint y TypeScript. Incluye el typecheck global con `--incremental false` para no escribir `tsconfig.tsbuildinfo`. No ejecuta tests de DB ni la aplicacion.

El verificador crea su raiz de evidencia si falta. Cada prueba que usa `mkdtemp` crea primero su padre; no depende de otra prueba, de su orden ni de directorios ignorados presentes en la maquina. Los fixtures son unicos por caso/proceso, con cleanup acotado. La regresion de portabilidad ejecuta Node por ruta absoluta con todas las variantes de PATH vacias y fuente historica ausente.

Captura real del fixture, sin instalar navegador:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/capture-self-test.ts --browser "C:\Users\starl\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe" --out ".omo/start-work/r0-visual/capture-$([guid]::NewGuid())"
```

La ruta es el ejecutable existente verificado en esta maquina, no una descarga ni una dependencia nueva. Si falta, proporcionar otro ejecutable instalado; el comando bloquea con `BROWSER_UNAVAILABLE` sin instalar. El Chromium completo instalado agoto 20s al arrancar; el headless-shell instalado funciono. No se atribuye una causa definitiva al timeout.

Recomparar la evidencia final, usando un destino nuevo:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --self-test-reference .omo/start-work/r0-visual/capture-final-20260909/390-reference.png --actual .omo/start-work/r0-visual/capture-final-20260909/390-actual.png --metadata .omo/start-work/r0-visual/capture-final-20260909/390-actual.json --out ".omo/start-work/r0-visual/equal-$([guid]::NewGuid())"
node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --self-test-reference .omo/start-work/r0-visual/capture-final-20260909/390-reference.png --actual .omo/start-work/r0-visual/capture-final-20260909/390-changed.png --metadata .omo/start-work/r0-visual/capture-final-20260909/390-changed.json --out ".omo/start-work/r0-visual/changed-$([guid]::NewGuid())"
```

La primera comparacion debe salir 0, la segunda 1. Un argumento desconocido o `--max-ratio 1` debe salir 2. Las pruebas cubren estos caminos, corrupcion de ambas entradas, alfa, dimensiones, deriva y proteccion de salidas.

## Capturas y metadatos

El fixture es un documento minimo creado con `page.setContent`, sin copiar Stitch HTML ni renderizar producto. Contexto offline, service workers bloqueados y todas las rutas de red abortadas. No hay servidor, login, sesion de usuario ni DB. No se usan mascaras; la unica alteracion deliberada es un rectangulo de 100 x 40 pixeles.

Cada PNG se acompana de JSON con `label`, SHA256, navegador/version, viewport, DPR, locale, timezone, fuentes listas, politica de animaciones, escala CSS, fullPage=false y timestamp. El fixture registra tambien ejecutable, hashes del fixture/script y politica de red. Se espera `document.fonts.ready`; capturas con animaciones deshabilitadas y caret oculto.

El modo aplicacion exige `--metadata` con el contrato de `captureSchema` y `label: APPLICATION_CAPTURE`. Valida el hash contra el PNG y las dimensiones contra el viewport CSS. Este contrato soporta solo capturas de viewport con `scale: css` y `fullPage: false`; no se aceptan capturas full-page mal etiquetadas. Los metadatos son una declaracion del productor, no prueba criptografica de autenticacion o de la ruta.

## Correccion de portabilidad verificada

Se leyo el workflow real de CI: Node 22, npm ci y npm test, sin Bun. La ejecucion local de esta correccion uso Node 24.19.0 y tsx 4.22.4 instalados; no se afirma haber ejecutado GitHub Actions ni Linux/Node 22 en esta maquina.

TDD antes de cambiar tooling: `node_modules/.bin/tsx.cmd --test --test-name-pattern="Node portability" tests/stitch-visual.test.ts` produjo 9 pruebas, 1 pass y 8 fail (43375.8584ms). El caso repo-only fallo con ENOENT al intentar abrir OneDrive-absent; el recheck explicito fallo por opcion --source-root desconocida. La deriva del PNG local ya se bloqueaba. Despues de la correccion no hay skips por ausencia de fuente ni hashes nuevos para aceptar el fixture.

Verificaciones actuales:

- `node_modules/.bin/tsx.cmd --test tests/stitch-visual.test.ts`: **33 pass, 0 fail**, 96758.34ms, despues del ultimo cambio de codigo. Es el shim Windows del runner npm existente.
- Los casos `Node portability when repo-only without OneDrive` y `Node portability when explicit intact source` tambien se ejecutaron individualmente en dos procesos concurrentes; ambos 1 pass, 0 fail. Los fixtures no comparten directorios ni mutan el cwd global.
- `node node_modules/tsx/dist/cli.mjs scripts/visual/verify.ts`: **pass=true** en `.omo/start-work/r0-visual/verification-042f1b9b-39fa-4169-a256-92f95f5d9bc1/verification.json`. Tests 33/33; lint, typecheck estricto y global exit 0, sin TS5097. Los cuatro hashes antes/despues coinciden. Los errores previos del tipo ProcessEnv fueron corregidos con una anotacion de tipo, sin assertions ni cambios de tsconfig.
- Modulos modificados: captura 77, CLI 75, referencias 43, verificador 56 LOC puros; pruebas 192. No se modificaron `pixels.ts`, `contracts.ts` ni `evidence.ts` durante esta correccion.
- CLI actual sobre los PNG sinteticos existentes: `node-portability-equal-20260909/report.json` registra 0/93600 pixeles, ratio 0, tolerancia 0 y exit 0; `node-portability-changed-20260909/report.json` registra 4000/93600, ratio 0.042735042735042736, tolerancia 0 y exit 1. Ambos bajo `.omo/start-work/r0-visual/`, con diff nuevo y `TOOLING_SELF_TEST` / `NOT_GRANTED`.
- `--help` pasa con Node/tsx. Un comando con --screen inicio_membego y --source-root apuntando a `source-does-not-exist` fallo con INPUT_OUTPUT_ERROR/ENOENT y exit 2 antes de leer la captura, como se exige.

No se recapturo navegador: la captura solo cambio su invocacion de subprocess y ayuda CLI; no se alteraron fixture, viewport, fuentes, animaciones ni algoritmo de pixeles. No se inicio browser, servidor, DB ni sesion en esta correccion. Los procesos sincronicos finalizaron; cada test elimino exclusivamente su fixture temporal. La aceptacion autenticada de la aplicacion sigue bloqueada.

## Evidencia historica

Raiz exclusiva: `.omo/start-work/r0-visual/`. Los siguientes directorios son evidencia de la primera implementacion, NO validan la correccion posterior de portabilidad. Las imagenes sinteticas se pueden recomparar con el CLI actual; no se recapturan si solo cambia el runner del subprocess.

| Evidencia anterior | Resultado de aquella ejecucion |
| --- | --- |
| `tdd.md` | Caracterizacion pasa; CLI ausente falla antes de implementarlo; red/green y correccion de TS5097 registrados |
| `verification-e312f0e7-6648-4eec-9c89-ea558a72205e/verification.json` | 24 pruebas, lint, tipado estricto y tipado global pasan; hashes dirty preservados |
| `capture-final-20260909/` | 9 PNG nuevos, 9 metadatos, 6 comparaciones con logs/reportes/diffs y receipt de cierre |
| `visual-qa.md` | Lectura directa de las nueve capturas finales y limites de QA |
| `browser-investigation.md` | Timeout inicial, alternativa instalada y ejecucion interrumpida del verificador documentados |

Resultados del navegador Chromium 151.0.7922.34, DPR 1, locale en-US, timezone UTC, alto 240:

| Ancho | Pixeles totales | Pareja identica | Variante alterada | Ratio alterado |
| --- | ---: | --- | ---: | ---: |
| 390 | 93600 | 0 cambios, exit 0 | 4000 cambios, exit 1 | 0.042735042735042736 |
| 768 | 184320 | 0 cambios, exit 0 | 4000 cambios, exit 1 | 0.021701388888888888 |
| 1280 | 307200 | 0 cambios, exit 0 | 4000 cambios, exit 1 | 0.013020833333333334 |

Tolerancia 0 en las seis comparaciones. **Estas son pruebas del tooling, no pantallas de MEMBEGO**. No hay una captura autenticada nueva ni una aprobacion visual independiente.

## Integracion futura bloqueada

1. Disponer de entorno y fixtures locales de Auth aprobados conforme a los prerrequisitos de la tarea 3, sin reutilizar sesiones personales ni apuntar a datos reales.
2. Capturar las doce pantallas y sus estados/rutas contratados con revision de codigo, revision de datos, rol/ambito y metadatos medidos, en un directorio nuevo de evidencia. Revisar datos sensibles antes de conservar o compartir imagenes.
3. Resolver viewport CSS, DPR y escala de las referencias con el propietario del diseno. **390 pixeles CSS no equivalen al PNG de Inicio de 269 x 1600**. Una imagen de distinto tamano debe seguir fallando, no estirarse ni recortarse.
4. Integrar el comparador despues de la captura en `scripts/verificar-home-e2e.mts` solo cuando se autorice modificar ese archivo dirty. El subprocess debe propagar exit 1/2, nunca actualizar referencias ante fallos. El siguiente comando es el contrato exacto futuro, no una captura existente ni una ejecucion aprobada:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --screen inicio_membego --actual .omo/start-work/r0-visual/app-inicio-390.png --metadata .omo/start-work/r0-visual/app-inicio-390.json --out .omo/start-work/r0-visual/app-inicio-comparison-01
```

El comando requiere esos archivos autenticados reales y un destino nuevo. Con una captura 390 y la referencia 269, debe terminar en `DIMENSION_MISMATCH`; corregir el contrato de escala antes de pretender aceptacion. Ni un exit 0 posterior es aprobacion automatica.

Para revalidar tambien una exportacion externa, agregar `--source-root "C:\ruta\exportacion-stitch"` al comando anterior. Esa ruta debe contener los directorios de pantalla y `retail_commercial_mobile/DESIGN.md`; si falta, el comando falla. No es necesario ni apropiado provisionar la carpeta personal original en CI.

5. Revisar visualmente referencias y capturas actuales en todos los estados; completar revision independiente de fidelidad y accesibilidad. Cliente escritorio/tablet, admin movil/tablet, plataforma y QR activo siguen derivados no aprobados. El conflicto DESIGN `#006194` frente a `#0284C7` sigue sin resolverse.

## Limpieza y revision

El navegador se cierra con `finally`; el receipt final lo registra. Las pruebas eliminan solo su propio directorio `test-*` creado con `mkdtemp`; no hay barrido de `.omo`, baselines, capturas historicas ni procesos ajenos. Los intentos fallidos se conservan como evidencia negativa. No se iniciaron procesos de servidor/DB ni workers anidados; no hubo commits ni deploy.

Revision arquitectonica: responsabilidades separadas; entradas parseadas con Zod; sin `any`, assertions de tipos o null-assertions; sin discriminacion parcial de uniones etiquetadas; guardas limitadas a fronteras; sin helpers especulativos ni funciones de mas de tres parametros; pruebas de comportamiento y CLI reales; sin comprobacion redundante tras borrados; nombres positivos; salida estructurada solo en fronteras CLI, sin logger nuevo. Los fingerprints y gates completos estan en el reporte final, no en una afirmacion de fidelidad.
