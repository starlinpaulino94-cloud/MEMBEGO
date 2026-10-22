# Informe de la fase 7 · noveno bloque: el onboarding (tarea 7.5) (22-10-2026)

> **Estado: construido, verificado en el navegador contra QA (solo navegación, no guardó nada) y commiteado en la rama local `claude/auditoria-fase7` (`10241a34`), sin push; falta tu aprobación de este bloque.** Los bloques 1 a 8 los aprobaste; este es 7.5, lo que pediste a continuación.
>
> **Lo que tienes que saber:** el inventario decía que al asistente le faltaban **sucursal, cobro y horario y un enlace de retorno**. **La sucursal ya estaba** (se añadió el 8-oct con la «experiencia comercial»; el inventario se escribió sobre código anterior). Añadí **horario** y **cobro**, y **el camino de vuelta**. Horario y cobro **se recomiendan pero no bloquean publicar**: decidí no cambiar la puerta de publicación para no dejar de pronto «sin lista» a empresas que ya lo estaban.

## 1. Qué se hizo

| Qué | Cómo |
|---|---|
| **Paso «Horario de atención»** | Hecho si el perfil tiene texto de horario (en blanco no cuenta) **o** alguna sucursal activa tiene horario estructurado (el horario detallado vive en cada sucursal, no en la empresa). Lleva al perfil, donde está el campo «Horario de atención». |
| **Paso «Cómo cobras»** | Hecho con **al menos un método de pago activo** (transferencia o pago en sucursal). Lleva a «Nuevo método de pago». |
| **El camino de vuelta** | Cada enlace del asistente lleva `?desde=onboarding`. Una franja en el panel (`RetornoAlAsistente`, montada en el layout del admin) lo recoge y ofrece **«← Volver a configurar tu empresa»**, con una X para quitarla. Se **recuerda en la pestaña** (`sessionStorage`), no solo en la dirección: casi todas esas pantallas, al guardar, te llevan a otra (de «Nueva sucursal» a la lista) y la marca se perdería justo cuando haría falta. Se va al volver al asistente, al pulsar la X o al cerrar la pestaña. No sale dentro del propio asistente. |
| **El asistente dice la verdad sobre lo que bloquea** | Cada paso no obligatorio dice **«Recomendado · no impide publicar»**; el aviso de abajo dice **«Te faltan N pasos obligatorios…; los demás son recomendados»** (antes: «Completa todos los pasos para poder publicar», que no era cierto para los del comercio). |
| **La lista, partida para probarla** | `pasosDeOnboarding` (pura) arma los pasos desde datos planos; `getOnboardingEmpresa` solo consulta y se la pasa. Son **14 pasos** (eran 12). |

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **El asistente y el checklist del Resumen** (usan la misma lista) **pasan de 12 a 14 pasos**: los porcentajes de progreso de las empresas existentes **bajan un poco** hasta que hagan el horario y el cobro. Quien ya tenía el perfil completo **sigue pudiendo publicar** (probado).
2. **Defecto corregido de paso:** al intentar publicar con el perfil incompleto, el error decía «Completa antes: …» y **listaba también los pasos opcionales** (sucursal, producto, oferta…), como si bloquearan. Ahora lista solo los que de verdad bloquean.
3. **Los enlaces del asistente** terminan en `?desde=onboarding`; las pantallas de destino deberían ignorar ese parámetro: **solo comprobé el perfil** (carga sin error); las otras cinco (sucursales, métodos de pago, catálogo, inventario, ofertas y planes) no las abrí con la marca.
4. La franja aparece en **todo el panel** mientras vengas del asistente en esa pestaña (no solo en la pantalla de destino).

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **10** (`tests/onboarding-empresa.test.ts`): el orden de los 14 pasos, el horario (texto, solo espacios, sucursal), el cobro, que **ninguno de los dos bloquea publicar**, el progreso, que **todo enlace lleva la marca**, la marca sobre enlaces con consulta o ancla (sin duplicarse, idempotente), que la franja **no arrastra la base de datos al navegador** (por eso la marca vive en un módulo sin dependencias), y el texto de «recomendado» y del aviso de publicar |
| `npm test` completo | **5 177 pruebas, 5 170 pasan, 0 fallan, 7 omitidas** (el bloque anterior cerró en 5 167: **+10**; una primera pasada falló una prueba de deuda de diseño porque puse una esquina `rounded-md` fuera del vocabulario: la cambié a `rounded-lg`) |
| `rls:cobertura`, eslint | ✔ · 0 problemas |

### 3.2 En el navegador, contra QA (empresa «QA Tours Punta Cana», `qa-admin-tours`) — **solo navegación**

* **`/onboarding`:** 14 pasos en el orden pensado; los pendientes de comercio dicen «Recomendado · no impide publicar»; los enlaces terminan en `?desde=onboarding`.
* **El camino de vuelta:** desde el primer paso pendiente (`/admin/perfil?desde=onboarding`) **la franja aparece**; al **cambiar a otra pantalla sin la marca** (`/admin/clientes`) **sigue ahí**; el enlace **lleva a `/onboarding`**; y al volver a Clientes **ya no está**. 0 errores de consola.
* **En AquaShine y Bella Vita `/onboarding` no mostró ningún paso** (será la pantalla de «¡está lista!» o una redirección; no lo distinguí), así que ahí no había nada que ver; Tours sí tiene pasos pendientes.

## 4. Lo que NO está hecho o NO se sabe

1. **No creé ni publiqué ninguna empresa nueva en un navegador**: el recorrido «registro → asistente completo → publicar» de extremo a extremo no lo hice. Lo cubren las pruebas del orden y de la puerta de publicación, y la navegación de arriba.
2. **No probé que el horario guardado en el perfil marque el paso como hecho** (no escribí en QA): lo cubre la prueba de la lista pura y la consulta es de lectura (`horario` del perfil o un horario estructurado de una sucursal).
3. **No añadí «sucursal» al asistente: ya existía.** Y **tampoco unifiqué** el «horario» con el de las sucursales: el campo de horario de atención del perfil es un texto libre; el estructurado por sucursal sigue editándose en su pantalla. El paso cuenta cualquiera de los dos.
4. **El asistente sigue sin tener formularios propios**: cada paso te manda a la pantalla que ya existe (como decía el informe 04). Hacer que el asistente pida el horario o el cobro **dentro** de sí mismo sería otro diseño; no lo hice.
5. No probé con lector de pantalla ni en móvil la franja (es una línea que envuelve; no medí 390 px).
6. Siguen sin empezar: **7.6** (notificaciones; **D-08 abierta**), la fase 8, Car Wash y las tablas «Stitch».

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2?
2. **¿Horario y cobro deben ser obligatorios para publicar?** Hoy son «recomendados». Hacerlos obligatorios es una línea, pero las empresas que ya están en marcha pasarían a estar «sin lista».
3. **7.6 (notificaciones: historial y puente desde «En riesgo») depende de D-08**, que sigue abierta. ¿La decides ahora, o doy por terminada la fase 7 con lo hecho y paso al informe de cierre?
4. Siguen abiertas: Car Wash, el arreglo aparte en `main` de la fecha de «Nueva reserva», las empresas huérfanas del bloque anterior (consulta de solo lectura) y el push de las ramas apiladas.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/onboarding-empresa.test.ts
```

En QA (`qa-admin-tours`): `/onboarding`, pulsa un paso y luego navega a otra pantalla: la franja de arriba te devuelve al asistente. **No hay servidor de QA levantado.**
