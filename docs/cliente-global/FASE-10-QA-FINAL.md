# Membego global · Fase 10 — QA final

**Cierre de las fases 4 a 9.** Fecha: 2026-08-11.

---

## 1 · Lo que se cerró: RLS

Cada verificación de las fases 4 a 9 llevaba la misma advertencia:

> «Esto no prueba RLS. Las políticas viven en `prisma/migrations_manual/`, que
> `migrate deploy` no aplica, y la aplicación se conecta con un rol que se las
> salta. Lo verificado es la PRIMERA barrera: que el `where` esté acotado.»

Ahora está probada la segunda. Se aplicaron las políticas a una base
desechable y se ejecutó **todo lo de las fases 4-9 conectando como
`membego_app`**, que es `NOBYPASSRLS`:

```
DATABASE_URL=postgresql://membego_app:…  SEED_DATABASE_URL=postgresql://<dueño>…
npm run verificar:rls-cliente-global      → 16/16
```

| Qué | Resultado |
|---|---|
| `current_user` = `membego_app`, `rolbypassrls` = false | ✅ la prueba es real |
| `misClienteIds`, regalos, citas, tickets, vehículos, pagos | ✅ siguen viéndose |
| Vitrina pública y mapa (SQL crudo) | ✅ siguen viéndose |
| Perfil escrito en las dos fichas, cada una con `conEmpresa` | ✅ |
| Con el contexto en una empresa, no se ven fichas de otra | ✅ |
| `update` cruzado desde otra empresa | ✅ bloqueado, fila intacta |

Además, la prueba de aislamiento que ya existía en el proyecto
(`npm run rls:probar`) pasa sus 6 casos sobre la misma base: **137 tablas con
política, 0 fallos**.

> **Importante:** esto prueba que *el código nuevo es compatible con RLS*, no
> que RLS esté encendido en producción. Encenderlo sigue siendo una decisión
> aparte —cambia el rol de conexión— documentada en `docs/RLS.md`.

---

## 2 · Rendimiento: una optimización probada y rechazada

`misClienteIds` se llama desde **36 sitios**, y una sola pantalla la dispara
varias veces (`/cliente/regalos` la pide dos veces: regalos y gift cards).
Envolverla en `cache()` de React —como ya hacen `getRegionalPrefs` y
`getCampanaPorCodigoInvitacion`— une esas consultas.

**Se implementó, se midió y se quitó.** Dos razones:

1. La lista **cambia dentro de la propia petición**:
   `asegurarClienteEnEmpresa` crea una ficha al reclamar una recompensa de un
   negocio nuevo. Una lectura posterior con la lista memorizada de antes del
   alta escondería la recompensa recién reclamada — el fallo exacto que estas
   fases se dedicaron a quitar, reintroducido por una optimización.
2. **No se puede verificar desde un script**: `cache` solo deduplica dentro del
   contexto de petición de Next; fuera devuelve una caché nueva cada vez
   (comprobado: dos llamadas seguidas devuelven referencias distintas).

Queda anotado en el código, con lo que haría falta para adoptarla.

**Lo que sí está anotado como deuda medible:** el buscador de ofertas ejecuta
dos consultas en modo búsqueda y no tiene paginación (`limit` en ambas). Con
catálogos grandes habrá que paginar.

---

## 3 · Accesibilidad

`node scripts/campos-sin-etiqueta.mjs` → **99 campos sin nombre accesible**.
Ninguno está en las pantallas de las fases 4-9: los buscadores nuevos llevan
`aria-label`, los chips `aria-current`, y las marcas nuevas son texto, no
color. Los 99 son deuda anterior, ya inventariada como fase 3 del sistema de
diseño.

`node scripts/auditar-diseno.mjs` → sin crecimiento. La guardia de deuda
(`tests/deuda-diseno.test.ts`) atrapó durante la fase 5 un `text-[11px]` que se
había colado en el catálogo global de planes; se corrigió en el momento.

---

## 4 · Regresiones

| Comprobación | Resultado |
|---|---|
| `npm test` | 827 pruebas, 0 fallos |
| `tsc --noEmit` | limpio |
| `eslint src --max-warnings=0` | limpio |
| `npm run build` | correcto |
| `verificar:cliente-global` (fase 4) | 21/21 |
| `verificar:descubrimiento` (fase 5) | 24/24 |
| `verificar:perfil-empresa` (fase 6) | 14/14 |
| `verificar:invitaciones` (fase 7) | 16/16 |
| `verificar:cuenta-y-ayuda` (fase 8) | 13/13 |
| `verificar:cerca-de-mi` (fase 9) | 13/13 |
| `verificar:rls-cliente-global` (fase 10) | 16/16 |
| `rls:probar` | 6/6 |

**117 comprobaciones ejecutadas contra PostgreSQL real**, cada una con su
control negativo. Seis de ellas se probaron por mutación: al revertir la
corrección que vigilan, fallan.

---

## 5 · Lo que NO está verificado

Dicho sin adornos, porque es la parte que más importa de un QA:

- **Nada se ha visto renderizado en un navegador.** Las pantallas compilan y
  las consultas devuelven lo correcto; el aspecto en un teléfono está sin
  mirar.
- **Las server actions no se ejecutan** en ninguna verificación: necesitan
  sesión de Supabase. Cubiertas por guardias de texto, por el compilador y
  —cuando se pudo extraer la lógica— por su función (`propagarDatosPersonales`).
- **El camino PostGIS del mapa**: esta base no tiene la extensión, así que lo
  ejecutado es el respaldo con Haversine. La columna nueva es idéntica en ambos
  caminos (el JOIN es compartido), pero no se ha ejecutado con PostGIS.
- **El embudo completo de referidos** (compartir → clic → registro →
  recompensa pagada): se verificó la pieza que la fase 7 cambia, no el resto.
- **Rendimiento con datos reales**: no hay medición con volumen. Lo anotado en
  § 2 son riesgos razonados, no números.

---

## 6 · Decisiones abiertas

| # | Decisión | Estado |
|---|---|---|
| D-3 | ¿Apagar el modo marca única? | Pendiente. Con una sola empresa publicada, recomendé no tocarlo |
| D-4 | El selector de empresa del cliente | Ya desaparece con menos de dos empresas |
| — | ¿Un negocio despublicado desaparece también para sus clientes? | Hoy **no**: quien ya es cliente conserva el acceso a su ficha (fase 6) |
| — | ¿Un vehículo debería ser uno solo para toda la plataforma? | Hoy **no**: fusionar categorías y tarifas es una decisión comercial (fase 8) |
| — | Paginación del buscador de ofertas | Deuda anotada |
| — | Encender RLS en producción | Probado que el código lo soporta; encenderlo es decisión aparte |
