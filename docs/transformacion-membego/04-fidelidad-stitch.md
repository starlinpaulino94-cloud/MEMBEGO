# Fidelidad a Stitch · matriz pantalla por pantalla

Los diseños son la especificación obligatoria, no una referencia aproximada.
Viven versionados en `docs/transformacion-membego/stitch/` (12 pantallas +
`retail_commercial_mobile/DESIGN.md`). Antes solo existían en el Escritorio.

Decisión del usuario (2026-09-08): **exactamente este diseño**. Los colores más
vivos son una conversación posterior; ahora no se añaden.

---

## 1. Las doce pantallas y a qué corresponden

| Stitch | Ámbito | Ruta MEMBEGO | Estado |
|---|---|---|---|
| `inicio_membego` | Cliente | `/cliente/inicio` | Construida · **fidelidad parcial** |
| `cuenta_membego` | Cliente | `/cliente/perfil` | Construida · fidelidad por auditar |
| `men_membego` | Cliente | `/cliente/menu` | Construida · **fidelidad alta** |
| `mi_qr_sin_beneficio_membego` | Cliente | `/cliente/qr` | Construida · fidelidad por auditar |
| `editor_de_inicio_de_la_app_membego` | Admin | `/admin/personalizacion` | Construida · **falta la carcasa hub** |
| `resumen_administrativo_membego` | Admin | `/admin/dashboard` | No abordada (F3+) |
| `gesti_n_de_membres_as_y_planes_membego` | Admin | `/admin/planes`, `/admin/membresias` | No abordada (F4) |
| `centro_de_canjes_y_validaci_n_qr_membego` | Admin | `/admin/scanner` | No abordada (F4) |
| `pagos_y_comprobantes_membego` | Admin | `/admin/pagos`, `/admin/conciliacion` | No abordada (F6) |
| `marketing_y_notificaciones_membego` | Admin | `/admin/campanas`, `/admin/notificaciones` | No abordada (F7) |
| `prospectos_y_crm_membego` | Admin | `/admin/crm`, `/admin/clientes` | No abordada (F7) |
| `fidelizaci_n_y_crecimiento_membego` | Admin | `/admin/gamificacion`, `/admin/referidos`, `/admin/regalos` | No abordada (F7) |

**D04 queda cancelada.** Decía que los módulos administrativos sin pantalla de
Stitch se derivarían del sistema. Sí las hay: siete. Se usan.

## 2. La arquitectura administrativa, confirmada por los diseños

El `code.html` del resumen trae la navegación completa del hub, y coincide casi
literalmente con la agrupación que el encargo proponía:

```
PRINCIPAL           Resumen
EXPERIENCIA CLIENTE Editor de Inicio · Navegación · Cerca de ti · Mi QR
CATÁLOGO            Membresías(8) · Beneficios · Ofertas(Hot) · Servicios · Excursiones
OPERACIONES         Canjes y QR(14) · Reservas y Citas · Pagos & Facturación
CLIENTES            Directorio · Segmentos · En Riesgo(3)
MARKETING           Campañas · Banners · Fidelización
ANALÍTICA           Métricas · Ingresos · Rendimiento
AJUSTES             Empresa · Sucursales · Roles y Permisos
```

Los contadores junto a las etiquetas (8, 14, 3, «Hot») son datos vivos, no
adorno: cada uno necesita su consulta o no se pinta (D08).

## 3. El sistema visual: lo que acertamos y lo que no

**Acertado en F1.** La paleta es exactamente la nuestra: `#0284C7` primario,
`#0369A1` estados activos, `#06B6D4` acento, `#F0F9FF` barra de ubicación,
`#F59E0B` estrellas, `#111827` texto, `#E5E7EB` bordes, Inter. El degradado de
cabecera `#0284C7 → #06B6D4` y el dock de 4 destinos también.

**No acertado — y hay que corregirlo:**

| Elemento | Stitch | Nuestro | Acción |
|---|---|---|---|
| Radio de tarjeta | **8px** (`0.5rem`) | `rounded-xl` = 12px | Bajar a 8px |
| Botón primario | **Píldora** (9999px), alto 36–40px | `rounded-lg` | Convertir a píldora |
| Botón secundario | 8px + borde 1px | variado | Unificar |
| Chips de filtro | Píldora, borde `#E5E7EB`, 13px/500 | no existen | Crear |
| Sombra de tarjeta | `0 1px 2px rgb(0 0 0 / .05)` | `elevation-1` | Verificar equivalencia |
| Barra de ubicación | alto 36px | `py-2` libre | Fijar 36px |
| Buscador | alto 44–48px, borde `#CBD5E1` | 44px, borde `--border` | Ajustar borde |
| Dock inferior | 56px | `--dock-inferior` | Verificar |

**Nota de contraste.** El DESIGN.md manda el banner de ofertas con degradado
`#0284C7 → #0369A1`. Con texto blanco eso da entre **4.10:1 y 5.93:1**: el
extremo claro no llega al 4.5:1 que WCAG AA pide para texto normal. Nuestro
azul sólido `#0369A1` (5.93:1) cumple en todo el banner. **Se conserva el
sólido** salvo que decidas priorizar el degradado sobre la accesibilidad; es la
única desviación deliberada del diseño y queda anotada aquí.

## 4. `/cliente/inicio` · brecha detallada

El esqueleto y el orden de bloques coinciden. Falta densidad — que es
justamente lo que define este diseño.

| Bloque | Falta respecto a Stitch |
|---|---|
| Categorías | Es una fila de **píldoras con icono en cuadro redondeado y etiqueta debajo**, con scroll horizontal y una píldora «Todos». Hoy es una retícula plana. |
| Hero | Falta el **badge de ubicación** («Higüey»), el **badge sobre la imagen** («Hasta 40% ahorro en membresía»), la **fila de precio** («Planes desde RD$1,850/mes») y el CTA en píldora. La segunda tarjeta debe **asomar** por el borde. |
| Empresas destacadas | Faltan «Ver todas ›», badges **«Abierto ahora»** y **«2 planes»**, **estrellas + nº de reseñas**, la **fila de chip de beneficio** con botón circular, y el botón **«Explorar más de N empresas asociadas ›»**. |
| Membresías | Faltan badges (**«Popular»**, **«VIP Gastronómico»**), **precio tachado** anterior, y el **botón píldora «Unirme» a todo el ancho**. Hoy hay un botón circular. Falta **«Ver todas las N membresías activas ›»**. |
| Experiencias | Stitch es una **lista vertical** con miniatura, badge de duración («Full Day», «4 horas»), precio y píldora «Reservar cupo». Hoy es una retícula. |
| Código de comercio | **No existe.** Tarjeta «¿Tienes un código de comercio?» con píldora «Ingresar» y el texto del PIN en tienda. Es una capacidad nueva, no solo visual. |

Las estrellas, las reseñas, «Abierto ahora», los cupos y el precio anterior son
**datos**, no decoración: cada uno necesita su fuente o el elemento no se pinta.
Eso es trabajo de backend, no de CSS, y por eso este no es un retoque.

## 5. Lo que la fidelidad reabre

- **D09 se revierte.** `cuenta_membego` **sí** lleva campana de notificaciones
  con punto rojo, y también la píldora **DO / ES**. Se omitieron por no tener
  centro de notificaciones ni i18n. Vuelven a estar en alcance: la campana con
  F7, la píldora cuando haya i18n real. Hasta entonces no se pinta ninguna de
  las dos (D08 manda sobre la fidelidad cuando el dato no existe).
- **D03 se amplía.** No es solo `/superadmin`: los diseños definen la carcasa
  del **hub administrativo** completo (barra lateral agrupada, selector de
  empresa, barra superior con búsqueda, turno, «Canje Rápido», notificaciones).
  Eso es fundamento de todas las pantallas admin, así que sube de F8 a **F3**.

## 6. Criterios de aceptación de fidelidad

Por pantalla, y en los tres anchos (**390 / 768 / 1280**):

1. Mismos bloques, en el mismo orden, con la misma jerarquía.
2. Radios, altos de barra y espaciados según §3.
3. Sin desbordamiento horizontal (ya automatizado en el E2E).
4. Contraste **WCAG AA** en todo texto; cualquier desviación del diseño por
   accesibilidad se anota aquí con su medición.
5. Ningún elemento con dato inventado: si no hay fuente, no se pinta.
6. Captura comparada contra `stitch/<pantalla>/screen.png` antes de cerrar.
