# Rendimiento de la analítica y la conciliación

Sprint de cierre · Bloque E (2026-10-08). Medido, no estimado: las consultas **reales** del código
(`src/modules/analytics/queries.ts`, `src/modules/conciliacion/queries.ts`) contra una base desechable con
volumen. Esto **no** es producción ni un benchmark de hardware: PostgreSQL 16 local, un solo nodo, cachés
frías a medias. Sirve para comparar antes/después y para ver qué plan elige el optimizador.

## Cómo se reproduce

```bash
createdb -T membego_pg membego_perf        # copia de la base local de pruebas (nunca una base real)
psql membego_perf -v ON_ERROR_STOP=1 -f scripts/rendimiento/sembrar-volumen.sql   # ~50 s
# luego EXPLAIN (ANALYZE, BUFFERS) de la consulta que interese, o las funciones EnTx desde un script tsx
```

`sembrar-volumen.sql` apaga disparadores y FK **de su sesión** para sembrar filas coherentes a mano; por eso
solo es para bases desechables (lo dice su cabecera).

## Volumen sembrado

| Tabla | Filas |
|---|---:|
| `membego_orders` (120 empresas, 12 meses; 80 % completados, 8 % cancelados, 4 % reembolsados…) | 396 000 (94 MB) |
| `order_attributions` | 396 000 |
| `payment_evidences` (reportadas y verificadas) | ≈ 133 000 |
| `merchant_commissions` + `merchant_ledger_entries` | ≈ 158 000 + 158 000 |

La empresa de prueba es la de más pedidos (≈ 3 300). Ninguna empresa real de un piloto se acerca a eso.

## Tiempos (primera ejecución, mediana de la tanda)

| Consulta | 90 días | 365 días |
|---|---:|---:|
| Resultados de una empresa (`resultadosDeMembegoEnTx`, 9 consultas en paralelo) | 212 ms | 240 ms |
| Panorama de la plataforma (`panoramaDePlataformaEnTx`) | 1 104 ms | 2 077 ms |
| Conciliación, las 27 reglas, toda la plataforma | 3 592 ms | — (no depende del rango) |
| Conciliación, las 27 reglas, una empresa | 365 ms | — |

Reglas de conciliación individuales más lentas (plataforma entera): **C01 1 600 ms**, L01 794 ms, P03 472 ms;
las otras 24 tardan ≤ 209 ms. Los hallazgos de la siembra (C01 75 369, P01 12 654, P03 277 469, L01 396 000)
son artefactos del dato sintético —no hay líneas de pedido ni inventario sembrados—, no un fallo del código.

## Lectura de los planes

- **C01** («completado de marketplace/atribuible sin comisión»): `Hash Anti Join` contra
  `merchant_commissions` y contra `merchant_billing_configs`; lee 233 853 pedidos completados con un
  `Bitmap Heap Scan` y ordena 75 369 hallazgos para numerarlos (`row_number()`; 7 MB a disco). **Es una
  verificación de integridad que, por definición, mira todo lo completado**: ningún índice reduce el conjunto
  que hay que comprobar. 1,0 s de ejecución con 396 000 pedidos.
- **Panorama de plataforma**: filtra `status = 'COMPLETED' AND completedAt` por rango y une las comisiones por
  `orderId` (índice único). El coste lo marca el barrido de `merchant_commissions` (158 000 filas).

## Experimento de índice (no se añade)

Candidato: `CREATE INDEX … ON membego_orders ("completedAt") WHERE status = 'COMPLETED'` (7 MB).

| Agregado de plataforma, rango de 90 días | Tiempo (3 corridas) |
|---|---|
| Sin el índice | 83 · 90 · 97 ms |
| Con el índice parcial | 124 · 137 · 150 ms |

El optimizador usa el índice (`Bitmap Heap Scan`) y el resultado es **más lento**: el rango de 90 días ya
cubre ≈ 40 000 de 316 000 completados y el acceso por bitmap cuesta más que el barrido paralelo. **Decisión:
no añadir índices en este sprint.** Los existentes (`(companyId, status, createdAt)`, `(companyId, customerId,
createdAt)`, `(companyId, locationId, status)`, `(companyId, channel)` en atribuciones, `(companyId,
createdAt)` en el libro y las comisiones) cubren las consultas de empresa, que son las que corre un usuario
cada vez que abre una pantalla.

## Límites que ya existen en el código

- Rangos: los presets llegan a 365 días; la serie diaria se recorta a `MAX_DIAS_SERIE = 370` y pasa a semanal
  a partir de 62 días (`reportes/rango.ts`).
- Listas acotadas: ofertas de analítica `limite = 50`; ranking de empresas 15; ofertas de plataforma 10;
  muestra de cada regla de conciliación `1…50` (por defecto pocas filas) con el **total** exacto aparte.
- Las dos pantallas pesadas (`/superadmin/analitica`, `/superadmin/conciliacion`) son solo del superadmin,
  de lectura, sin escribir y sin efectos laterales (pruebas `analytics-*` y `conciliacion-permisos`).

## Qué no se midió

- Producción, hardware real, pooler (Supabase/PgBouncer) ni latencia de red.
- Concurrencia de varios superadmins abriendo la conciliación a la vez.
- Volúmenes de otras tablas (`inventory_movements`, `deal_claims`, `supply_*`).
- Con el tamaño actual (decenas de pedidos por empresa) nada de esto importa: es un margen de crecimiento, no
  un problema de hoy. **Cuándo reabrirlo:** si la conciliación de plataforma pasa de ~10 s o el panorama de
  ~5 s con datos reales, antes de pensar en índices conviene materializar o partir la conciliación por empresa.

## Concurrencia y carga (cobertura existente + lo añadido)

No hace falta una suite de carga aparte: cada caso de la lista del sprint ya tiene su prueba concurrente
contra PostgreSQL real, en serie.

| Caso | Prueba |
|---|---|
| Reclamos de oferta simultáneos / último cupo de presupuesto | `deals.db` 5 (dos clics → un reclamo), 6 (16 personas, presupuesto para 5 → ganan 5 y se pausa) |
| Canje de QR (pedido) | `orders.db` 21 (6 escaneos simultáneos → un cierre, una venta), `pos.db` 17 (dos cajeros, un cobro) |
| Reserva de inventario / última unidad | `inventory.db` 15 (20 reservas de 5 → ganan 5), 16, 17 (misma clave ×5); `checkout.db` 7 |
| Creación de comisión | `billing.db` 5, 27 (varios cierres a la vez), 28 (cierre + barrido) |
| Ajuste por verificación | `billing.db` 42 (3 verificaciones → 1 ajuste) y **48 (nuevo): verificación contra reembolso a la vez, 4 rondas** |
| Libro de Merchant Billing | `billing.db` 26 (20 asientos simultáneos → posiciones 1…n, saldo exacto) |
| Redención de Supply / mismo QR / última unidad | `supply-v2-slice3` B, C; `slice5` C, F; `slice2` E, E2 |
| Mismo webhook dos veces | `slice9` A, B2·A (×5), B2·B (HTTP simultáneo) |
| Último uso de bono/cupón y presupuesto | `slice6` D, E; `slice7` C, D |
| Un derecho por unidad pagada (nuevo) | `supply-v2-slice2` K2 (la base rechaza derechos de más) |

## Peso del JavaScript del cliente (auditoría, sin cambios)

Medido con `npm run presupuesto` sobre el build del Bloque C (2026-10-08). «Antes» = último valor registrado en
el status (F9/lote de auditoría); «después» = esta rama tras los Bloques A–D (los únicos añadidos de cliente son
el formulario de verificación bancaria del superadmin y textos).

| Medida | Antes | Después | Tope |
|---|---:|---:|---:|
| JavaScript de cliente (todo) | 8 869 KB | 8 875 KB (+6) | 9 200 KB (96 %) |
| Entrada compartida (se baja siempre) | — | 867 KB | 1 000 KB (87 %) |
| Trozo individual mayor | — | 526 KB | 600 KB (88 %) |

Qué hay en los trozos grandes (buscando firmas en el código minificado, no con un analizador):

- **526 KB (`37664-…`) y 203 KB (`16425…`)**: el SDK de Sentry del cliente (repetición de sesión + trazas +
  migas). Es lo más pesado y se baja en todas las páginas.
- **395 KB (`87672-…`)**: `recharts`, solo en las pantallas con gráficas (carga por ruta, no compartida).
- `leaflet` sigue en uso (`MapaUbicacion`, `MapaConfirmarVivienda`, `MapaCercaDeMi`): no es peso muerto.

**No se tocó nada**, a propósito: la única palanca grande es cargar la repetición de sesión de Sentry de forma
diferida o quitarla, y eso cambia qué se observa en producción. Queda como decisión:

> **DECISIÓN DE PRODUCTO / PRIVACIDAD (no técnica):** `src/instrumentation-client.ts` graba repeticiones con
> `maskAllText: false` (el texto visible de las pantallas —nombres, montos, referencias— se ve en la
> repetición; los campos de formulario sí se enmascaran con `maskAllInputs`, y hay máscara explícita de
> contraseña, token y correo). Para un piloto con datos reales de clientes lo prudente es `maskAllText: true`
> o no grabar repeticiones; hoy no lo cambio porque altera lo que el equipo ve al depurar.

Si el total se acerca al tope (> 98 %), el orden de palancas es: (1) repetición de Sentry diferida,
(2) `recharts` solo en las dos pantallas de analítica, (3) revisar `date-fns` por importaciones de todo el paquete.
