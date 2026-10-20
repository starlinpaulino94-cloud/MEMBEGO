# Informe de la fase 3 · Prototipos y aprobación visual (20-10-2026)

> **Estado:** 3.1 hecha. **3.2 NO se hizo** (exige tres personas reales). 3.3 medida en parte, con la salvedad de §3. **3.4 es tuya:** sin tu aprobación de la dirección visual no empieza la implementación masiva (`12` · fase 3; `10` §12). Nada del producto cambió: son archivos HTML estáticos en `docs/auditoria-admin/fase-3/prototipos/`.
> **Base:** rama `claude/auditoria-fase3`, sobre `claude/auditoria-fase2`, sobre `claude/ci-main-verde`, sobre `origin/main` `4243a0f8`. Nada está subido.

## 1. Qué se construyó (tarea 3.1)

Cinco pantallas de validación (`10` §12) más dos listas de apoyo para que los recorridos sean reales. Usan los **colores, radio y estados reales** de `globals.css` (azul `oklch(0.55 0.22 255)`, borde, éxito/aviso/info) y la **tipografía propuesta** en `10` §2 (Inter, base 14/20, títulos 600, cifra de KPI 28, cifras tabulares en todo el cuerpo).

| Archivo | Tipo de página (`10` §8) | Qué demuestra |
|---|---|---|
| `resumen.html` | Resumen | Un Resumen **por rol** (administrador, supervisor, marketing): «Hoy · requiere acción» (≤3 bloques), «Este mes» (4 cifras con su ventana escrita) y una gráfica con eje, valor del pico y tabla alternativa |
| `pagos.html` | Lista | Cinco colas, filtros con chips y «Limpiar», tabla con `caption`/`scope`, acciones por fila, hoja lateral con el comprobante, vacío real y vacío «sin resultados». **Aprobar y rechazar funcionan** (con confirmación y motivo) |
| `cliente.html` | Detalle | Cabecera con estado y acciones, pestañas, bloque principal y lateral de 320 px |
| `beneficio-nuevo.html` | Formulario | Un solo «Crear beneficio» para los cuatro tipos; secciones por intención; «Opciones avanzadas» plegadas; error enlazado al campo y foco al primer error; vista previa |
| `empresa.html` | Configuración | Navegación interna, **guardado por sección** con indicador de cambios, paleta de color cerrada con control de contraste |
| `clientes.html`, `beneficios.html` | Lista (apoyo) | Por dónde se llega a la ficha y al formulario; `Clientes` junta Directorio · Membresías · En riesgo · Segmentos como pestañas |
| `index.html` | — | Qué es, cómo usarlo, las tres tareas y el protocolo de prueba |

El menú es el propuesto en `03` · C.2: **8 grupos, 21 entradas** para el administrador, 8 para el supervisor y 6 para marketing. Las entradas sin pantalla avisan «no está en este prototipo».

**Modo de prueba** (panel negro, abajo a la derecha): el observador elige una tarea, la persona la hace sola y el panel cuenta **clics, pantallas y segundos**; al terminar se anota qué dijo o dónde dudó y «Resultados» junta todas las sesiones en CSV. Es lo que hace posible la tarea 3.2.

## 2. Decisiones de diseño que el prototipo toma (apruébalas o revócalas)

1. **El Resumen se compone por rol** y ordena así: lo que exige acción hoy → cuatro cifras del mes con su ventana → una gráfica → enlace a Reportes. Quedan fuera del Resumen los seguidores, los referidos históricos, «Pico», la actividad en vivo y el bloque «Estado en App Móvil» (`05` · §3, `02` · U-06).
2. **Quien no puede ver dinero no ve un hueco que diga «Sin permiso»: el bloque no existe.** Hoy, tras la fase 1, la tarjeta dice «Sin permiso». Marketing, además, recibe un bloque honesto: «Interacciones del mes: **Sin dato**», porque los contadores de vistas no guardan fecha (`05` · D-29): no se inventa un periodo.
3. **Pagos abre en la cola que tiene más dinero esperando**, no en «En sucursal». Hoy el Resumen enlaza a `/admin/pagos` sin cola y el usuario cae en «En sucursal» aunque lo urgente sean transferencias. Es una regla de diseño, no impuesta por el modelo: revisable.
4. **Aprobar un pago conserva su confirmación** (mueve dinero; `13` · R-05) pero el texto lo dice con claridad; **rechazar** exige motivo y lo pide en la hoja lateral, con el comprobante delante.
5. **«Crear beneficio» tiene cuatro tipos**, no tres: la auditoría contó tres, pero el hub de Ofertas ya incluye «Oferta sobre un producto o servicio». «Promoción pública» viene preseleccionada y la modalidad (2×1, 3×2, descuento…) es un grupo de opciones, no un `Select` de 12.
6. **«Caja» aparece en el menú del administrador** (D-09, adoptada) y **«Cambio de empresa»** sigue en la tarjeta lateral.
7. **El color de la empresa solo colorea sus propios objetos**, con paleta cerrada de ocho y aviso de contraste (`04` · F-07). Ocho colores es una propuesta. **Los ocho pasan AA con texto blanco** (de 4,9:1 el azul a 10,4:1 la pizarra, calculado con la fórmula de luminancia relativa), así que el aviso «no pasa AA» del prototipo solo saltaría con un color que no esté en la paleta: el control existe por si algún día se permite un color libre, y no se muestra en la demostración.

## 3. Línea base y medida (tarea 3.3)

**Cómo se contó.** *Hoy:* leyendo el código de `origin/main` `4243a0f8` (no cronometrado, no ejecutado en vivo). *Prototipo:* ejecutando el flujo (la tarea 1, con clics reales en el navegador; la 2, con eventos de clic escritos a mano sobre la misma cadena de controles; la 3, leyendo el Resumen, sin clics). Un clic = una pulsación sobre algo interactivo; una pantalla = una ruta distinta (cambiar de cola o de pestaña dentro de la misma no cuenta). Todas las tareas empiezan en el Resumen.

| Tarea | Hoy | Prototipo |
|---|---|---|
| **1 · Aprobar una transferencia** | Menú «Pagos» → pestaña «Transferencias» (aterriza en «En sucursal») → «Aprobar» → «Aprobar» en el diálogo = **4 clics, 2 pantallas** | «Pagos» (ya abre en Transferencias) → «Aprobar» → «Aprobar» en el diálogo = **3 clics, 2 pantallas** |
| **2 · Crear una promoción 2×1** | «Ofertas» → «Nueva promoción» → abrir «Tipo» → «2x1» → «Publicar promoción» = **5 clics, 3 pantallas** (hub, formulario; el tipo por defecto es «Descuento %»; Título y Descripción son obligatorios). Controles a la vista: ≈18 etiquetas en una columna (25 controles según `04`) | «Beneficios» → «Crear beneficio» → «2×1» → «Publicar» = **4 clics, 3 pantallas**. A la vista: **7 controles** (tipo, modalidad, título, descripción opcional, inicio, fin, descuento; con 2×1 son 6) |
| **3a · Saber cuánto se vendió este mes** | Ya está en el Resumen: **0 clics, 1 pantalla** (con la ventana «mes calendario», sin escribirla) | **0 clics, 1 pantalla**; ahora con la ventana escrita («1–20 oct 2026») y la comparación contra el mismo tramo de septiembre |
| **3b · …y cuántas membresías se perdieron** | Menú «Reportes» → «Membresías» (las bajas están ahí) = **2 clics, 3 pantallas** (`04` §4.9 decía «al menos dos, probablemente tres») | **0 clics, 1 pantalla**: «Membresías activas 23 · +5 altas · −2 bajas este mes» |

**Lectura honesta del criterio de `12` («las tres tareas bajan en pantallas y clics»):**
- **Clics:** bajan en 1, 2 y 3b; **3a no puede bajar** (ya estaba en 0): lo que mejora es la claridad, no el conteo.
- **Pantallas:** solo bajan en 3b. En 1 y 2 **no bajan**, porque ya estaban en el mínimo razonable (Pagos ya tenía las colas como pestañas; crear algo es lista → formulario). **El criterio, tal como está escrito, no se cumple**: o se reinterpreta («clics y campos a la vista») o se rediseña más. Te propongo reinterpretarlo; es tu decisión.
- **El dato de 3b (bajas y altas en el Resumen) existe** (`modules/reportes/membresias.ts` expone `renovadas` y `bajas`) pero **no se calcula hoy en el Resumen**: añadirlo cuesta una consulta, y debe usar la misma definición que Reportes (`05` · D-10). Es una decisión de producto, no solo visual.
- **Sin cronómetro todavía:** los tiempos y los errores salen de la fase 3.2.

## 4. Lo que el prototipo destapó sobre la auditoría

1. Los **cuatro** tipos de beneficio (no tres) ya viven detrás del hub de Ofertas.
2. El enlace del Resumen a Pagos **no lleva cola**: aterriza en «En sucursal» (`pagos/page.tsx`, valor por defecto), así que la alerta «Pagos por validar» puede dejarte lejos de lo que avisaba.
3. El formulario actual de promociones **pide Título y Descripción** y tiene «Descuento %» por defecto: para un 2×1 hay que cambiar el tipo a mano.
4. Con el sistema de diseño propuesto, **el Resumen cabe en 3 bloques de acción + 4 cifras**, frente a las 20–23 cifras sobre el pliegue de hoy (`05` · §1). Lo que cuesta: tres decisiones de qué sale (§2.1).

## 5. Verificación técnica del prototipo

| Qué | Resultado |
|---|---|
| 7 pantallas × 3 roles × 3 anchos (390, 768, 1280) = 63 combinaciones, cada una cargada y medida | **0 desbordes horizontales, un solo `<h1>` en todas, 0 controles sin nombre accesible, 0 errores de JavaScript, menú de 21 / 8 / 6 entradas, acceso denegado exactamente donde `03` · C.3 lo dice** |
| Medidas de escritorio (1280) | Barra lateral 280 px, cabecera 56 px, 4 cifras en fila, ficha 577 + 320, configuración 200 + contenido, Inter 14/20 con `tabular-nums`, título 24/600, cifra 28 |
| Flujos con clics reales | «Aprobar» (diálogo → fila «Aprobado» → aviso → contadores de cola, pestaña y menú bajan a la vez) y «Crear 2×1» (error enlazado y foco al título → el descuento desaparece con 2×1 → publica) |
| Defectos que el arnés encontró y se corrigieron | El aviso «No tienes acceso» se pisaba con la pantalla; Pagos se desbordaba 42 px a 768 px (columna `auto` de una cuadrícula); la barra de acciones fija dejaba pasar el texto; `hidden` no ocultaba por un `display` de componente; datos de ejemplo incoherentes entre Resumen, Clientes y Ficha |

**No verificado:** lector de pantalla real (solo la estructura: `caption`, `scope`, `aria-current`, `aria-describedby`, `role="alertdialog"`, foco atrapado en diálogos); Firefox y Safari; impresión; contraste de **todos** los pares (se confía en los tokens ya auditados por `scripts/contraste.mjs`, y el único contraste calculado es el del selector de color); comparación píxel a píxel con la línea base de la fase 0 (no aplica: no hay pantalla nueva en producción).

## 5 bis. Una cosa que pasó durante las pruebas

Mientras corría mis comprobaciones automáticas, la pestaña del prototipo cambió de URL y de cola sin que yo la tocara y el «Modo de prueba» quedó activo con 7 clics: alguien estaba usando el prototipo a la vez en el panel del navegador. Eso afectó a mis mediciones y las repetí en una pestaña aparte. No es un defecto, pero explica por qué el contador del modo de prueba puede arrancar «sucio»: **pulsar «Cancelar» o «Iniciar» lo reinicia**.

## 6. Qué falta para cerrar la fase 3

1. **Mirarlo y decidir (3.4).** Las siete decisiones de §2; en especial 1, 2 y 3.
2. **Pruebas con tres personas (3.2):** una dueña de negocio, un cajero, un supervisor. El protocolo y el panel de conteo están en `index.html`. Esto **no puede hacerlo un asistente** y no se simula.
3. **Reinterpretar o no el criterio de aceptación** (§3).
4. **Las dos respuestas de la fase 2:** D-08 (invitar por correo) y D-11 (telemetría).

## 7. Cómo verlo

```bash
cd docs/auditoria-admin/fase-3/prototipos
npx --yes http-server -p 4173
```

Abre `http://localhost:4173/`. También funciona abriendo `index.html` directamente en Chrome; necesita internet para Inter y los iconos (sin ella se ve con la fuente del sistema y sin iconos). Cambia de rol con el selector «Ver como» de la barra superior.
