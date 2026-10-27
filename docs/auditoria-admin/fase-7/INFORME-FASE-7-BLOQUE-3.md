# Informe de la fase 7 · tercer bloque: `ExcursionForm` (22-10-2026)

> **Estado: construido, verificado en el navegador contra QA y commiteado en la rama local `claude/auditoria-fase7`, sin push; falta tu aprobación de este bloque.** Los bloques 1 y 2 (Parques y Tours, Plan y Promoción, «Nueva reserva» y la búsqueda de cliente) los aprobaste; este es lo que pediste a continuación. **Con él se cierra 7.2 en Parques y Tours.**
>
> **Lo que tienes que saber:** el formulario de crear y editar excursiones, actividades y combos (1 641 líneas) **borraba lo escrito cuando el servidor rechazaba algo**, y devolvía **un solo mensaje por intento**. Ahora lo escrito se conserva y cada campo dice su error. No encontré aquí un defecto como el de la fecha de la reserva: el formulario sí enviaba todo lo que las acciones leen (lo comprobé y ahora lo vigila una prueba).

## 1. Qué se hizo

| Qué | Dónde |
|---|---|
| **De un archivo de 1 641 líneas a un contenedor de 258** y siete piezas (ninguna pasa de 250): información general, horarios, precios, ubicación e inclusiones, las actividades del combo y su itinerario. El estado y las cuentas del combo salen a un hook (`useCombo`). | `components/excursiones/ExcursionForm.tsx`, `excursion/*` |
| **La parte pura** (horas, días, derivaciones de un combo, ahorro, agrupar el itinerario, lectura del formulario) en un módulo probado: 26 pruebas nuevas. | `modules/excursiones/catalogo/formulario.ts` |
| **El error de cada campo.** `crearExcursion` y `actualizarExcursion` leen el formulario con un parser **antes de tocar la base** y devuelven `campos`: nombre, capacidad, impuesto, precios, horas de salida, actividades del combo. Salen junto a su campo, con `aria-invalid`, y **el foco va al primero**. | `actions.ts` |
| **Lo escrito ya no se pierde.** Los campos de texto eran de valor inicial (`defaultValue`): React 19 los reinicia cuando la acción falla. Ahora son controlados. Lo verifiqué en QA: un nombre en blanco con una descripción y un precio escritos → el error sale en el nombre y **la descripción y el precio siguen ahí**. | secciones |
| **`Campo` en todos los campos** (etiqueta siempre visible, error enlazado). Los grupos de botones (tipo de ítem, horas, días, tarifas del combo) son grupos con nombre y dicen cuál está elegido (`aria-pressed`). | secciones |

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **Capacidad y impuesto ilegibles** (p. ej. una capacidad de `0` o `1,5`; un impuesto de `-3` o `abc`) **se marcan**; antes el servidor los guardaba como «sin capacidad» o como vacío en silencio. (El navegador ya frena `0` y `120` con `min`/`max`; esto cubre lo que llegue sin pasar por el navegador.)
2. **Un precio opcional ilegible** (niño, residente, niño residente) ya no se guarda como vacío: se marca.
3. **Una actividad sin ninguna hora de salida** se rechaza con su mensaje; antes se creaba sin horarios (y nunca salía).
4. **Al editar, una capacidad sin declarar queda vacía.** Antes el formulario mostraba un **30 que nadie había escrito** y, al guardar, lo grababa (el sistema usa 50 cuando no hay capacidad declarada: guardar sin querer ese 30 cambiaba el cupo). Al crear sigue arrancando en 30.
5. **Las etiquetas** pasan del estilo de microtítulos al de `Campo`, igual que en los bloques anteriores. El resto del diseño se conserva.
6. Las sugerencias de categoría («+ Playa y Catamarán»…) ya no escriben en el campo tocando el DOM a mano: rellenan el valor del formulario.

## 3. Medición

### 3.1 Pruebas y compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** (código de salida 0) |
| Pruebas nuevas | **26** (`tests/excursion-formulario.test.ts`): cuentas de horas y días, derivaciones del combo, ahorro, itinerario anidado, la lectura con cada error, el contrato con las acciones y el marcado de cada sección |
| `npm test` completo | **5 106 pruebas, 0 fallos** (§3.3) |
| eslint sobre lo tocado, `rls:cobertura` | 0 problemas; ✔ |
| Contrato | **todo campo que leen las acciones de excursión viaja en el formulario con su `name`** (menos `companyId`, del superadmin, y `precioTurista`, opcional, que este formulario no pide) |

### 3.2 En el navegador, contra QA (empresa «QA Tours Punta Cana») — **esto SÍ escribió**

Crea y archiva dos ítems de prueba («QA fase 7 · actividad de prueba» y «QA fase 7 · combo de prueba»; correo y colas de QA apagados). **22 de 23 comprobaciones pasan; la que no pasó era una expectativa mía mal puesta** (ver B3).

* **Crear una actividad:** un nombre en blanco se marca en su campo con su mensaje y el foco; **lo demás no se borra**; una sugerencia de categoría rellena el campo; el servidor guardó nombre, descripción, categoría, capacidad 10, horario 09:00, duración 3 h, regreso calculado 12:00 y la variante «Estándar» a 55.
* **Editarla:** el formulario trae lo guardado, **no pide el precio base** (viven en las variantes); se guardó la descripción y el impuesto (18); **una capacidad vacía queda sin declarar**.
  **B3:** un impuesto de 120 % **lo frena el propio navegador** (`max=100`) antes de llegar al servidor; la regla del servidor para ese caso está cubierta por las pruebas del parser, no por el navegador.
* **Crear un combo** con «Hoyo Azul y Scape Park» y «Ciudad Colonial · Tour histórico»: se reconoce («Combo válido con 2 actividades»); **sus turnos se cruzan, lo dice y no deja crear**; al permitir el solapamiento de una el itinerario es válido y sale «Días comunes: Mar, Jue, Sáb» y la duración derivada (5 h); se creó como combo con sus 2 actividades, el solapamiento elegido y sus horarios en martes, jueves y sábado.
* **Editar el combo:** sus 2 actividades vienen marcadas y «Solapar» recuerda la que se eligió; se guardó sin perder ni las actividades ni el solapamiento.
* **A 390 px: 0 píxeles de desborde horizontal** en el alta y en la edición.
* **Limpieza:** los dos ítems quedaron **archivados**. Además queda en QA Tours la reserva de prueba **cancelada** del bloque anterior (EXC-2026-000013). Si alguien graba o recorre esa empresa (hay otra sesión grabando un video del panel), verá esos tres registros en «Todas».

### 3.3 Suite completa

**5 106 pruebas; 5 099 pasan, 0 fallan, 7 omitidas**, sobre el árbol final (el bloque 2 cerró en 5 080: **+26**, todas nuevas; ninguna existente se modificó).

### 3.4 Algo que probé y NO era un defecto

Sospeché que `actualizarExcursion` fallaba al guardar un combo (escribe `horarioFijo: null` en un `createMany`, y en la creación hay un comentario que dice que Prisma exige `DbNull`). Lo probé **dentro de una transacción que se revierte siempre**: Prisma 6 acepta `null` en `createMany`. Guardar un combo editado funciona, como se vio en D3. No lo toqué.

## 4. Lo que NO está hecho o NO se sabe

1. **No probé** con lector de pantalla, Firefox ni Safari, ni subir imágenes (el cargador de imágenes no se tocó).
2. **No probé** crear un combo con un pase de día ni con turnos fijos (`horarioFijo`): el formulario no los edita, solo los conserva al editar; la lógica está en pruebas unitarias, no en el navegador.
3. **El editor de variantes** (`VariantesEditor`, con precios dinámicos) y **`ReservaExcursionForm`** (la pantalla del cliente, 1 514 líneas, otra copia del asistente) no se tocaron.
4. Siguen sin empezar: el resto de 7.1 (plataforma/supply, reportes, inventario, facturas, conciliación…), 7.3, 7.5 y 7.6. Car Wash y D-08 siguen siendo tuyos.
5. El servidor de QA fue de **desarrollo**, el navegador de pruebas sin la CSP de la página (en desarrollo, Next usa `eval`). Apagado y limpiado.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque (`ExcursionForm`) y los cambios de §2?
2. Con esto **7.2 queda cerrada en Parques y Tours**. ¿Sigo con el resto de 7.1? Propongo **plataforma/supply** (las tablas de `superadmin/supply` son la mayor parte de las 49 crudas del panel) o, si prefieres cerrar primero el panel de empresa, **reportes, inventario y facturas**.
3. Pendiente de la vez anterior: ¿el defecto de la fecha de «Nueva reserva» merece **un arreglo aparte sobre `main`** antes de subir la rama? (`main` sigue sin poder crear reservas desde el panel.)

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npm test
```

En QA (`qa-admin-tours`): `/admin/excursiones/catalogo/nueva` — pon un nombre en blanco y una descripción, y envía. **El servidor de QA queda apagado.**
