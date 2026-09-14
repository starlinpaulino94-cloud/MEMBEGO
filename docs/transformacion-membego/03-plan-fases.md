# Plan de fases F3–F8 · programa de transformación del cliente

Reconstruido con el usuario el 2026-09-08. Lo anterior (P0, P1A, P1B, F1, F2)
está cerrado y verificado; su acta está en `02-baseline-contratos.md`.

Este archivo existe porque el plan maestro vivía en una conversación y se
perdió. Cada fase de aquí en adelante se escribe antes de tocar código.

---

## Principios que no cambian entre fases

1. **Corte vertical.** Cada fase entrega un recorrido completo: pantalla del
   cliente + su control administrativo + su fuente de datos. Nunca pantallas
   sueltas.
2. **Ninguna sección decorativa.** Lo que el cliente ve sale de un dato con
   dueño. Si algo no tiene quién lo administre, la fase incluye esa pantalla o
   el contenido no se pinta (D08).
3. **Sin restos de la estructura anterior.** Al cerrar una fase, las pantallas
   viejas de ese recorrido se retiran, no se dejan tras una bandera indefinida.
4. **El aislamiento no se debilita.** Toda tabla nueva entra por el mecanismo
   genérico de RLS (Capas 1 y 2, que deducen del esquema) y se comprueba
   sembrando dos empresas en `scripts/probar-rls.mjs`, nunca con un script
   propio.
5. **Pruebas de conducta.** Buscar texto en un archivo no es una prueba: se
   rompe cuando el código se muda de sitio y no cuando se rompe la conducta.

---

## F2d · D10 · El Inicio anterior se retira (en curso)

**Problema.** El Inicio tiene dos pantallas. `InicioComercial` (retail) solo
aparece si la empresa publicó composición; el resto del tiempo se ve
`InicioPrevio`, que es la app anterior íntegra. Y `InicioPrevio` es el único
hogar de seis capacidades reales: wallet, motor de experiencias, prueba
social, gamificación, onboarding y novedades.

**Decisión (D10, aprobada).** Las seis se llevan al contrato retail y
`InicioPrevio` se borra en el mismo corte.

**Arquitectura.** El Inicio pasa a tener dos mitades con dueños distintos:

- **Franja comercial** — los 7 bloques que la empresa compone y publica
  (F2a/F2b). Los controla el administrador.
- **Franja personal** — wallet, experiencia elegida por el motor, onboarding,
  prueba social, gamificación y novedades. Sale del estado de ESA persona y
  **no es configurable**: un administrador no puede apagarle la wallet a
  nadie. Su orden lo decide el contexto, no un panel.

Esa separación es la razón de que las seis no se conviertan en bloques nuevos
del modelo de composición.

**Fuera de alcance.** Cambiar el motor de experiencias, la gamificación o el
onboarding. Aquí solo cambian de casa y de aspecto.

**Hecho.** `InicioRetail` compone las dos mitades; `cargarPanelPersonal` trae
la personal en una sola ola; `RetailExperiencia`, `RetailWallet`,
`RetailOfertas` y `RetailDescubreMas` visten lo que antes vestían los banners
con degradado. `InicioPrevio`, `ExperienciaHero`, `CampanaBanner`,
`DescubreMas` y `BuscadorSimple` se retiran. Los primitivos
`PromoBanner`/`FlashPromotion`/`Shine` viven en `packages/ui` y quedan sin
consumidor: su retirada es de F8, no de aquí.

---

## F3 · Descubrimiento

**Recorrido.** Buscar → explorar → ver qué hay cerca → entrar a una empresa →
abrir una promoción. Es el camino al que el Inicio nuevo ya empuja, y hoy
todas esas pantallas siguen con el diseño anterior: la costura se ve al primer
toque.

**Cliente.** `/cliente/buscar`, `/cliente/explorar`, `/cliente/cerca`,
`/cliente/empresas`, `/cliente/empresas/[slug]`, `/cliente/promociones`,
`/cliente/promociones/[id]`.

**Administración.** Categorías y etiquetas del catálogo, perfil público de la
empresa, sucursales con coordenadas y horarios, y **la pantalla de sinónimos
que hoy no existe**: `guardarSinonimo` está escrito y no lo llama nadie, así
que la tabla de F2a no tiene dueño. Se administra en dos ámbitos (decisión del
usuario): los globales desde `/superadmin`, los de empresa desde `/admin`, y
los de empresa mandan sobre los globales, que es lo que el modelo ya soporta.

**Datos.** Ninguna tabla nueva prevista salvo la administración de sinónimos,
que ya existe. Revisar índices de búsqueda antes de ampliar filtros.

**Código muerto que hereda esta fase.** `BuscadorInicio`, `BuscadorUnificado` y
`BuscadorExcursiones` no tienen consumidor y ya lo eran antes del programa
(no los dejó huérfanos D10). Se retiran aquí, que es donde vive el buscador, y
no antes: borrar una pantalla de búsqueda mientras se rediseña otra es la
forma más fácil de perder una función sin enterarse.

**Riesgo principal.** `/cliente/cerca` depende del consentimiento de
geolocalización; su estado sin permiso tiene que ser un camino, no un muro.

---

## F4 · Membresías, pase y canje

**Recorrido.** Elegir plan → contratar → llevar el pase → canjear en el
mostrador → ver qué me queda.

**Cliente.** `/mis-membresias`, `/membresia/[id]`, `/cliente/planes`,
`/cliente/mis-promociones` (+ detalle, agendar y regalo).

**Administración.** Planes, membresías, ofertas y promociones, y el escáner
(`/admin/scanner`) como la otra mitad del canje.

**Dependencia.** Después de F3: el catálogo de planes se descubre desde ahí.

**Cuidado.** `/cliente/dashboard` y `/cliente/membresia` son redirecciones a
`/mis-membresias`; se conservan como compatibilidad de enlaces guardados.

---

## F5 · Reservas y agenda

**Recorrido.** Reservar una cita o una excursión, verla, presentarse.

**Cliente.** `/cliente/citas`, `/cliente/excursiones` (+ buscar y detalle),
`/cliente/mis-excursiones` (+ detalle), `/cliente/vehiculos` (+ nuevo).

**Administración.** Configuración de citas, agenda y disponibilidad,
excursiones con variantes y cupos, sucursales y empleados.

**Cuidado.** La reserva de cita ya es atómica desde P1B; esta fase no puede
aflojar ese candado. Los vehículos solo tienen sentido en el vertical de
lavado: la pantalla aparece según capacidad, nunca cambiando la navegación.

---

## F6 · Dinero, y los módulos sin diseño de Stitch

**Recorrido.** Pagar, guardar el comprobante, consultar el historial.

**Cliente.** `/cliente/pagos`, `/cliente/historial`.

**Administración.** Pagos, facturas, conciliación, métodos de pago.

**D04 (pendiente desde P1A).** Los módulos administrativos sin pantalla de
Stitch se derivan del sistema, no se inventan: heredan la retícula, los
componentes y los estados de los que sí la tienen.

**Cuidado.** P1B separó el cobro de su cumplimiento; el historial tiene que
saber contar esa diferencia en vez de enseñar «pagado» sobre una entrega
fallida.

---

## F7 · Notificaciones y crecimiento

**Recorrido.** Enterarse de lo que pasa, invitar, recibir y regalar.

**Cliente.** Centro de notificaciones (nuevo — **D09**: la campana de la
pantalla de Cuenta se omitió a propósito hasta que exista),
`/cliente/referidos`, `/cliente/invita-y-gana`, `/cliente/regalos` (+ enviar,
giftcard, regalar), `/cliente/ruleta`, `/cliente/intereses`.

**Administración.** Notificaciones, campañas, referidos, regalos,
gamificación, audiencias.

**Dependencia.** Después de F2d: la gamificación y las novedades ya habrán
encontrado sitio en el Inicio, y aquí se les da su pantalla completa.

---

## F8 · Superadministración y retirada

**D03 (pendiente desde P1A).** `/superadmin` adopta el sistema visual del hub,
con su ámbito claramente separado del de empresa: quién mira y sobre qué
trabaja tiene que leerse en la pantalla, no deducirse.

**Retirada.** Se borra lo que quedó sin consumidor a lo largo del programa:
componentes duplicados, tokens antiguos marcados «no se borran todavía» en
`globals.css`, y las rutas de compatibilidad cuyo plazo haya vencido. La
guardia de deuda de diseño (`tests/deuda-diseno.test.ts`) baja sus topes en
esta fase, no antes.

---

## Orden y por qué

F2d va primero porque hoy hay dos Inicios y el nuevo casi no se ve: es la
incoherencia más visible y bloquea juzgar cualquier otra pantalla.

F3 sigue porque el Inicio ya manda ahí. F4 depende de F3 (los planes se
descubren). F5 y F6 son independientes entre sí y pueden intercambiarse si
cambia la prioridad del negocio. F7 necesita que F2d haya colocado
gamificación y novedades. F8 va al final porque la retirada solo es segura
cuando nadie consume lo retirado.
