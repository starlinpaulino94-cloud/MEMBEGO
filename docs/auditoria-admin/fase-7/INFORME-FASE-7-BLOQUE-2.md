# Informe de la fase 7 · segundo bloque: «Nueva reserva» (22-10-2026)

> **Estado: construido, verificado contra la base de QA y en el navegador, y commiteado en la rama local `claude/auditoria-fase7` (`009ef0f9`), sin push; falta tu aprobación de este bloque.** El primer bloque (Parques y Tours, Plan y Promoción) lo aprobaste hoy; este es lo que pediste a continuación: **`ReservaForm` y la búsqueda de cliente**.
>
> **Lo primero que tienes que saber:** al leer el formulario encontré que **«Nueva reserva» del panel no podía crear ninguna reserva**. Su campo de fecha no tenía `name`, no se enviaba, y la acción rechaza toda reserva sin fecha. Estaba así **desde el 26-08-2026** (commit `67b02fcb`, el asistente de pasos) y **`origin/main` tiene el mismo defecto**. Ya está arreglado y probado creando una reserva de verdad en QA (§3.3). Si en producción alguien intentó crear una reserva desde ahí, vio «Elige la fecha de la excursión» sin poder elegir otra cosa.

## 1. Qué se hizo

| Tarea | Qué | Dónde |
|---|---|---|
| **Defecto: la fecha no viajaba** | Cada control del formulario lleva ahora su `name`; solo lo elegido con botones o calculado (excursión, tarifa, hora, pasajeros, itinerario del combo) va en campos ocultos. **Una prueba de contrato** compara todo lo que lee la acción con lo que manda el formulario: contra el formulario de antes, falla señalando exactamente `fecha`. | `ReservaForm.tsx`, `reserva/*`, `tests/reserva-formulario.test.ts` |
| **7.4 · Buscar el cliente** | El selector traía los **200 clientes más recientes**: el cliente 201 no se podía elegir. Ahora se **busca en la base** (nombre, teléfono o correo) sobre todos los de la empresa. Es un *combobox* accesible: flechas, Intro (que no envía el formulario), Escape, la lista se anuncia. Muestra **10** y, si hay más, **lo dice**; si no hay ninguno, ofrece «Crear cliente nuevo» con lo escrito. | `reserva/ClienteBuscador.tsx`, acción `buscarClientes`, `buscarClientesParaReserva` |
| **7.2 · Descomponer `ReservaForm`** | **De 1 371 líneas en un archivo a un contenedor de 223 y nueve piezas** (ninguna pasa de 220): un paso por componente, el resumen, el buscador y la programación del combo. Lo que se decide sin navegador (fechas, itinerario, importes, lectura del formulario, búsqueda) vive en un módulo puro de 343 líneas con 29 pruebas. | `components/excursiones/reserva/`, `modules/excursiones/reservas/formulario.ts` |
| **Errores por campo** | `crearReserva` lee el formulario con un parser (`leerReservaDeFormulario`) y devuelve el error **de cada campo** (excursión, tarifa, fecha, pasajeros, descuento, cliente, nombre, correo): salen junto a su campo y **el foco va al primero**. Antes, un solo mensaje por intento. | `formulario.ts`, `actions.ts` |
| **`Campo` en todos los controles** | Etiqueta siempre visible, ayuda y error enlazados. **Campos sin nombre accesible: 88 → 77** (el techo baja). | `tests/accesibilidad-formularios.test.ts` |

## 2. Lo que cambia para quien reserva (te lo digo porque se ve)

1. **Las etiquetas** pasan del estilo de microtítulos en mayúsculas al de `Campo` (frase normal, más legible). El resto del diseño se conserva.
2. **El selector de cliente ya no es una lista**: se escribe (mínimo 2 letras) y aparecen resultados. «Cliente existente» / «Nuevo cliente» se ofrece siempre; arranca en «existente» si la empresa tiene clientes y en «nuevo» si no tiene ninguno.
3. **Correo del cliente nuevo:** ahora se exige que tenga forma de correo (con dominio con punto); antes cualquier texto con `@` pasaba y se provisionaba una cuenta con él.
4. **Descuento inválido** (negativo o no numérico) **se marca** en su campo; antes se tomaba como 0 en silencio.
5. **Un combo por días separados** se fecha con la **primera actividad**; antes, con la fecha de partida del formulario (que no cambiaba al mover las fechas de cada actividad), y el check-in y los reportes agrupan por esa fecha.
6. Los botones de elegir (excursión, tarifa, turno, atajos de fecha) dicen si están elegidos (`aria-pressed`) y los contadores de pasajeros anuncian la cifra al cambiar.

## 3. Medición

### 3.1 Pruebas y compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **29** (`tests/reserva-formulario.test.ts`): el contrato con la acción, fechas, combos, importes, la lectura con cada error, la búsqueda y el teclado, y el marcado de cada paso |
| `npm test` completo | **5 080 pruebas, 0 fallos** (§3.4) |
| eslint sobre lo tocado, `rls:cobertura` | 0 problemas; ✔ |
| Campos sin nombre accesible | 94 → 88 (bloque 1) → **77** |

### 3.2 En el navegador, contra QA (empresa «QA Tours Punta Cana»)

**Sin escribir nada** (el envío se interceptó y se abortó antes de llegar al servidor):

* El formulario de antes enviaba sus campos **sin `fecha`**; el de ahora la envía (y `modoCliente` y `vendedorId`).
* El buscador: una letra no busca; «an» muestra 6; «809» (todos los clientes de la empresa) muestra **exactamente 10 y el aviso «Hay más de 10 clientes que coinciden»**; sin coincidencias dice «Ningún cliente coincide» y «Crear cliente nuevo» pasa a cliente nuevo con lo buscado en el nombre.
* Teclado: flecha abajo activa la primera opción, **Intro elige y NO envía el formulario**, el cliente elegido viaja como `clienteId`, «Cambiar» vuelve al buscador y quita el id.
* Sin cliente elegido, el error sale **junto al buscador** con su mensaje y **el foco va ahí**; un correo sin dominio se marca en su campo («Ese correo no parece válido.»).
* A 390 px: **0 píxeles de desborde horizontal** de la página.

### 3.3 Crear una reserva de verdad (esto SÍ escribió en QA)

Con el cliente existente «Ana Beltré» (sin crear cuentas; el correo, los pagos y las colas de QA están apagados), una excursión y fecha 2026-12-01: el formulario envió, el servidor creó **EXC-2026-000013** y redirigió a su ficha. Lo guardado: **fecha 2026-12-01 (la elegida)**, 2 adultos, total **RD$4 248** (2 × RD$1 800 más 18 % de impuesto), canal «Mostrador», cliente y empresa correctos. **Después la cancelé por la pantalla con motivo** («Prueba de QA de la fase 7»): queda **una reserva cancelada de más** en QA Tours (13 en vez de 12). Es lo que hacía falta para demostrar que el defecto está arreglado de punta a punta.

### 3.4 Suite completa

**5 080 pruebas; 5 073 pasan, 0 fallan, 7 omitidas**, corrida sobre el árbol final (el primer bloque cerró en 5 051: **+29**). Sin ninguna prueba tocada para que pasara: las 29 son nuevas y el resto no cambió.

## 4. Lo que NO está hecho o NO se sabe

1. **`ExcursionForm`** (la otra mitad de 7.2) **no se tocó.**
2. **El portal del vendedor** (`ReservaVendedorForm`, 1 284 líneas) **tiene el mismo selector de 200 clientes** y es de la fase 8; **la pantalla del cliente** (`ReservaExcursionForm`, 1 514 líneas) **es otra copia del mismo asistente**. Con lo extraído aquí (módulo puro y pasos) se podrían compartir; no lo hice porque no es del panel de administración. Esas dos **sí envían la fecha** (comprobado).
3. **No probé** con lector de pantalla ni con Firefox/Safari; el combobox sigue el patrón de ARIA y se comprobó el marcado y el teclado, no el anuncio real.
4. **No probé** crear una reserva con un **combo**, con **cliente nuevo** (eso crea una cuenta y manda un correo) ni con vendedor y descuento elegidos: el parser y el itinerario están cubiertos por pruebas unitarias; la ruta de punta a punta la probé solo con una excursión simple y cliente existente.
5. **El resto de 7.1, 7.3, 7.5 y 7.6** siguen sin empezar (plataforma/supply, reportes…; `crearEmpresa`, onboarding, notificaciones). D-08 y Car Wash siguen siendo tuyos.
6. El servidor de QA se levantó en **modo desarrollo** y el navegador de pruebas se lanzó sin la CSP de la página (en desarrollo, Next usa `eval`, que la CSP de producción no admite). Lo apagué al terminar.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque (la fecha arreglada, la búsqueda de cliente y el formulario descompuesto), incluidos los cambios de §2?
2. ¿**El defecto de la fecha merece un arreglo aparte en `main`** antes de que esta rama suba? Es una línea; la rama de la fase 7 aún no está en GitHub y `main` sigue sin poder crear reservas desde el panel.
3. Siguiente: ¿**`ExcursionForm`** (cierra 7.2 en Parques y Tours) o paso a **plataforma/supply** (7.1)?

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npm test
```

En QA (`qa-admin-tours`): `/admin/excursiones/reservas/nueva` — escribe «809» en «Buscar cliente» y recorre la lista con las flechas. **El servidor de QA queda apagado.**
