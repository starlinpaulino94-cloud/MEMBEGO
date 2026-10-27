# Informe de la fase 7 · cuarto bloque: las tablas de plataforma/supply (22-10-2026)

> **Estado: construido y commiteado en la rama local `claude/auditoria-fase7` (`c8579094`), sin push; falta tu aprobación de este bloque.** Los bloques 1, 2 y 3 los aprobaste; este es lo que pediste a continuación («plataforma/supply, las tablas de superadmin/supply»).
>
> **Lo que tienes que saber:** este bloque es **solo de tablas** (7.1) y **no pude verlo en un navegador**: las pantallas de Supply son del superadmin y el entorno de QA no tiene un superadmin con el que entrar (ver §4). Lo que lo respalda es el compilador, las pruebas de marcado y una prueba que vigila que **ningún `data-testid` que usan las pruebas de extremo a extremo de Supply se haya perdido**. Esas pruebas de extremo a extremo **no las ejecuté**.

## 1. Qué se hizo

**22 `<table>` pintadas a mano en `superadmin/supply` pasan a la `Tabla` del sistema** (caption para el lector de pantalla, `scope` en cabeceras, primera columna como identificador de fila, columnas que se ocultan por prioridad en pantallas estrechas, paginación como pie de la tabla).

| Grupo | Tablas | Dónde |
|---|---|---|
| **Listados de finanzas (6)** | facturas, depósitos, obligaciones, pagos, liquidaciones, conciliaciones | `components/supply-v2/finanzas/tablas.tsx` |
| **Scorecard de proveedores (1)** | 12 columnas; las tres primeras siempre visibles, el resto por prioridad | `components/supply-v2/proveedores/tabla-scorecard.tsx` |
| **Detalles (9)** | líneas de conciliación, de factura, de liquidación y de orden de compra; movimientos de un depósito; libro de una oferta y de un lote; catálogo de un proveedor; lotes de un producto | `components/supply-v2/tablas-detalle.tsx` |
| **Beneficio, campaña y prevista (6)** | asignaciones, usos y movimientos de un beneficio; cupones e historial de una campaña; prevista de liquidación | `components/supply-v2/tablas-beneficio-campana.tsx` |

* **17 páginas** reescritas para usarlas; las tarjetas que envolvían los listados se quitaron (la `Tabla` ya trae su marco).
* **`Tabla` gana dos props**, `testId` y `testIdFila` (`packages/ui/src/ui/tabla.tsx`). Solo se escriben si se piden: sin ellas el marcado es el de siempre.
* Los **botones dentro de las tablas** (cancelar asignación, reversar aplicación, cancelar cupón, confirmar pago) se conservan y siguen apareciendo **solo con el permiso** que ya tenían.
* El dinero conserva **el formato de cada pantalla** (algunas escriben `RD$1,500.00`, otras el formateador propio de la página): lo pasa la pantalla, no se unificó.
* **Los totales** que estaban en un `<tfoot>` (suma de un depósito, impuestos y total de una compra, neto de una prevista) pasan al pie de la tabla con sus `testid`.

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **Aspecto:** las tablas toman el estilo común (cabecera, filas, alineación del dinero a la derecha), igual que las de Parques y Tours. Ya no van dentro de una tarjeta propia.
2. **En pantallas estrechas** las columnas menos importantes se ocultan (como en el resto de las tablas migradas) en vez de obligar a deslizar de lado. Lo que se oculta se decide por columna; el identificador, el estado y el importe principal no se ocultan.
3. **Pagos:** la pantalla ya no pide el usuario para decidir los botones; el permiso se evalúa una vez y entra como `puedoConfirmar`. El comportamiento es el mismo.
4. **Lector de pantalla:** cada tabla tiene título (`caption`) y cabeceras con `scope`; antes no tenían ninguno.

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **16** (`tests/supply-tablas.test.ts`), todas pasan |
| eslint sobre lo tocado | **0 errores**; 1 aviso en `supply-v2/panel-visita.tsx` (`set-state-in-effect`), **archivo que no toqué** |
| `npm test` completo | **5 122 pruebas: 5 114 pasan, 1 falla, 7 omitidas** (ver nota) |
| Techo `tablaCruda` | **49 → 27** (`tests/deuda-diseno.test.ts`, medido con `scripts/auditar-diseno.mjs`) |

> **Nota sobre el fallo:** `entorno-e2e-remoto.test.ts › attestation stays offline when the explicit execution flags are absent` falló en la suite completa (15,3 s) y **pasa solo** (17 de 17, 4,7 s). Lanza un subproceso y no tiene relación con lo tocado; parece lentitud de la máquina con la suite entera. Lo dejo dicho, no lo arreglé.

### 3.2 Qué comprueban las pruebas nuevas

* **Ninguna pantalla de Supply del superadmin pinta ya una `<table>` a mano** (lee el código fuente, sin comentarios).
* **Cada `data-testid` que había dentro de una tabla antes de migrarla sigue existiendo** (lista fija, sacada de la versión anterior de cada pantalla: 18 pantallas, 41 identificadores). Son los que usan las pruebas de extremo a extremo de Supply.
* Cada pantalla usa **el componente**, no una copia; los tres listados con paginación la conservan como pie.
* **`Tabla`**: `testId`/`testIdFila` aparecen solo si se piden y solo en las filas de datos.
* Cada una de las tablas, pintada a HTML con filas de ejemplo: caption, primera columna como `<th scope="row">`, dinero a la derecha, enlaces, el chip de estado, lo que sale solo con permiso («registró X» en un pago pendiente, botón de cancelar), y los totales del pie.

## 4. Lo que NO está hecho o NO se sabe

1. **No lo vi en un navegador.** Las pantallas de Supply son del superadmin y en QA no hay superadmin con el que entrar (el proyecto de Supabase de QA tiene empresas y administradores, no una cuenta de plataforma). Por eso **no sé cómo se ven**: el ancho de cada columna, qué se oculta a 390 px, ni si algún texto largo desborda. Es la comprobación que más falta.
2. **No ejecuté las pruebas de extremo a extremo de Supply** (`tests/e2e/supply-v2-*.spec.ts`): necesitan ese mismo superadmin. Lo que hice fue asegurar que **sus selectores existen**; no que sus pasos pasen.
3. **Las 11 tablas que traen los propios componentes de supply-v2** (el diseño «Stitch», con vista de tarjetas en móvil y de tabla en escritorio) **no se tocaron a propósito**: son otro diseño, con su propio comportamiento responsivo, y migrarlas es cambiar cómo se ven, no solo con qué se pintan. Siguen contando en `tablaCrudaEnModulos` (28). **Es una decisión tuya** (§5).
4. Quedan **27 `<table>` en el panel** de empresa (reportes, inventario, facturas, regalos, registros, seguimiento…) y 28 en módulos. Siguen sin empezar: Car Wash, 7.3, 7.5 y 7.6 (D-08 sigue abierta).
5. El aviso de eslint de `panel-visita.tsx` y el fallo lento del test de entorno existían antes de este bloque o no tienen relación; no los toqué.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2, sabiendo que **no lo vi en un navegador**? Si tienes una cuenta de superadmin, abrir `/superadmin/supply/finanzas/facturas` y `/superadmin/supply/proveedores/scorecard` a 390 px sería la comprobación más útil.
2. ¿Qué sigue? Propongo cerrar el **panel de empresa**: **reportes, inventario y facturas** (las 27 `<table>` restantes del panel). La otra opción es migrar las 11 tablas «Stitch» de supply-v2 (§4.3), pero antes tendrías que decidir si ese diseño se conserva.
3. Pendientes de antes: el arreglo aparte en `main` del defecto de la fecha de «Nueva reserva», Car Wash y D-08.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/supply-tablas.test.ts
```

Sin servidor de QA levantado: no hay nada que apagar.
