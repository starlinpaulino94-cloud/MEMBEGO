# Informe de la fase 4 · infraestructura visual y compuertas (21-10-2026)

> **Estado: construida y medida; commit en la rama local `claude/auditoria-fase4`, sin push.** Base: `claude/auditoria-fase3`, sobre `claude/auditoria-fase2`, sobre `main` (`5571363e` ya incluye `ci-main-verde`). **Ninguna pantalla cambia**: las primitivas no tienen consumidor todavía (es lo que pide la fase), y el ámbito `.panel-ds` está definido y apagado.
>
> **Quién hizo qué.** Otra sesión dejó el trabajo sin guardar en este worktree (11 archivos modificados, ~15 nuevos) antes de tu aprobación visual. Tras tu aprobación de la dirección visual (3.4), esta sesión **lo midió de forma independiente, corrigió un defecto y lo cerró**. Todo lo que dice este informe como medido lo medí yo ahora.

## 1. Qué contiene (tareas 4.1 a 4.10 de `12`)

| Tarea | Pieza | Archivo |
|---|---|---|
| 4.1 | `PageHeader` ampliado: icono, migas, estado, enlace de vuelta, variante de formulario | `packages/ui/src/ui/page-header.tsx` |
| 4.2 | `Campo`: etiqueta + control + ayuda + error enlazado (`aria-describedby`, `aria-invalid`, `role="alert"`); lo opcional se marca, lo obligatorio no | `campo.tsx` |
| 4.3 | `Tabla` de servidor: celdas tipadas, `caption`, `scope`, orden por URL con `aria-sort`, vacío en dos variantes, «Sin dato», scroll dentro de la tabla | `tabla.tsx` |
| 4.4 | `BarraFiltros`: formulario GET, chips de filtros activos que se quitan, «Limpiar»; funciona sin JavaScript | `barra-filtros.tsx` |
| 4.5 | `estadoUi(dominio, estado)` y `EstadoChip`: un chip y un mapa de estados | `estado-chip.tsx`, `src/lib/estados.ts` |
| 4.6 | `NavSeccion` + `pestanasVisibles`: pestañas de módulo con `aria-current` | `nav-seccion.tsx` |
| 4.7 | `StatCard` variante `panel` (ventana escrita, pie con tono, «Sin permiso») y `BarrasSimples` (eje, valor del pico, tabla alternativa) | `stat-card.tsx`, `barras-simples.tsx` |
| 4.8 | Escala tipográfica del panel (Inter, base 14/20, cifras tabulares) detrás de **`.panel-ds`**, y la clase nueva `.text-kpi`; `SelectorColor` con paleta cerrada de ocho y su contraste | `src/app/globals.css`, `fuente-panel.ts`, `selector-color.tsx`, `company-branding.ts` |
| 4.9 | Regla de importación diferida de `recharts`, `leaflet` y `html5-qrcode` | `tests/importaciones-pesadas.test.ts` |
| 4.10 | Compuertas nuevas con techo que solo baja: botones de solo icono sin nombre (13) y `outline-none` sin foco (25); la lista de primitivas en espera solo puede encogerse | `scripts/auditar-diseno.mjs`, `tests/deuda-diseno.test.ts` |

Además: una ficha por pieza (`FICHAS.md`, como pide `10` §7) y una galería estática de las piezas reales (`npm run docs:galeria-panel`).

## 2. Medición (hecha ahora, sobre el árbol completo)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| `npm test` | **4 832 pruebas; 4 825 pasan, 0 fallan, 7 omitidas.** La fase 3 tenía 4 782: **+50 pruebas** de la fase 4 |
| `npm run lint` | **0 errores**, 199 avisos, **ninguno en un archivo de esta fase** |
| `rls:cobertura` | en verde |
| `scripts/contraste.mjs` | todos los pares cumplen su umbral (el nuevo «Texto pendiente» 4,96:1; mínimo 4,5) |
| **CSS solo aditivo** (compilado con el mismo Tailwind y las mismas fuentes, regla por regla, frente a `origin/main`) | 2 746 → 2 757 reglas: **0 eliminadas, 0 cambiadas, 11 nuevas**, todas `.text-kpi` o `.panel-ds…`; **0 fuera de ese ámbito** |
| **No regresión de los 4 componentes ampliados** | Las 8 capturas «antes» (`tests/fixtures/panel-fase4-antes.json`) **coinciden con lo que pinta el código ORIGINAL** (las volví a generar en un checkout sin tocar) y con lo que pinta el código ampliado, byte a byte |
| Galería de las primitivas (Playwright, 1 280 px) | 0 errores de JavaScript, sin desborde horizontal; revisada a ojo, cada pieza se ve como describe su ficha |

## 3. Un defecto heredado, corregido

La otra sesión añadió a `globals.css` un segundo `--color-pending: var(--pending)` con el comentario «el token ya existía; faltaba exponerlo a Tailwind». **Era falso**: ya estaba expuesto en `@theme inline` desde antes de la fase. Era un duplicado inofensivo con una explicación equivocada. **Lo quité**, y su prueba (`panel-ds.test.ts`) ahora exige que se declare **una sola vez**; la ficha dice que ya existía.

## 4. Criterios de aceptación de `12` · fase 4

| Criterio | Estado |
|---|---|
| Primitivas con su ficha y sin consumidores aún | **Cumplido** (7 nuevas, 4 ampliadas; una ficha cada una; la prueba exige que sigan sin importador) |
| Compuertas activas | **Cumplido** (corren dentro de `npm test`, que es lo que ejecuta el CI) |
| **Capturas del cliente idénticas a la línea base** | **Cumplido por demostración, no por capturas.** No hay línea base visual del cliente (quedó fuera del alcance de la auditoría), así que no se puede comparar píxel a píxel. Lo que sí se demostró: el CSS es solo aditivo (0 reglas cambiadas) y los cuatro componentes ampliados pintan lo mismo que antes. Una pantalla que no use las clases nuevas no puede cambiar. **NO VERIFICADO en un navegador sobre el cliente.** |
| Contraste de pares nuevos | **Cumplido** |

## 5. Lo que NO está hecho o NO se sabe

1. **`.panel-ds` está apagado a propósito.** Encenderlo es un solo cambio en `AppShell` (clase en la raíz + la variable de la fuente), y cambia la tipografía de las ~200 pantallas del panel. Eso es la fase 5 y **hay que medirlo antes y después con el harness de capturas**; la prueba obliga a actualizar su contador de usos.
2. **El panel hoy carga Geist y Plus Jakarta, no Inter.** Hasta que se encienda `.panel-ds`, la decisión D-02 (tipografía única) no se refleja en pantalla.
3. **Inter se pide a Google Fonts en la galería** (necesita internet); en la aplicación se carga con `next/font`, que la sirve desde el propio dominio.
4. **Las dos compuertas nuevas de accesibilidad cuentan CANDIDATOS**, no defectos seguros (un `{...props}` podría traer el nombre). Bajarlas abre la tarea; las resuelve de raíz el tipo de `Button` en la fase 7.
5. **La variante de tarjetas para colas con botones (Pagos) no existe**: está anotada como pendiente de la fase 5 (tarea 5.2).
6. **Sin lector de pantalla real, Firefox ni Safari.** Solo estructura y marcado.

## 6. Cómo verlo

- `npm run docs:galeria-panel` escribe `.next-qa/galeria-panel/index.html` (ignorado por git) con el HTML y el CSS reales de cada pieza, junto al aspecto de hoy.
- `npx tsx --test tests/primitivas-panel.test.ts tests/panel-ds.test.ts` para el contrato y la no regresión.

## 7. Condición de finalización

`12` dice «informe y aprobación». **Falta tu aprobación de esta fase.** Nada de esto está subido a GitHub.
