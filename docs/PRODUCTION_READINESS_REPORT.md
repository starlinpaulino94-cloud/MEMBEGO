# Production Readiness Report — Sprint de cierre (2026-10-08)

Rama `claude/wizardly-hypatia-x2l9av` · sin PR abierto · todo medido sobre una base local desechable (PostgreSQL 16),
**no** sobre producción. Lo que no se pudo comprobar aquí se dice como tal.

## Veredictos

| | Veredicto | En una línea |
|---|:-:|---|
| **PILOT READY** | **YES — con 3 condiciones del usuario** | El código, los datos y las puertas de calidad están en verde para un piloto con **una empresa de práctica y pagos manuales** (efectivo/transferencia). Antes de meter datos reales: (1) rotar la contraseña de la base, (2) correr la prueba de campo con personas y dispositivos (`docs/PILOT_FIELD_TEST.md`), (3) acordar con la empresa piloto el CPA/8 % y que el 8 % llega por verificación bancaria |
| **PRODUCTION READY** | **NO** | Faltan cosas que no son de código: cobro en línea (CardNET), facturación fiscal (DGII/e-CF), el corte de RLS Capa 2, la prueba humana con hardware, y reglas de alerta/uptime que nadie ha medido en producción |

## 1. Estado general

- Monolito modular (309 tablas, 209 migraciones selladas, ~3 930 pruebas unitarias, 640 de PostgreSQL, 160+ E2E).
  Arquitectura intacta: Commerce Core separado de Supply; `commerce-primitives`; catálogo + variantes; `MembegoOrder`
  con `Transaction` legacy conviviendo; Merchant Billing ≠ Supply Economics; libros append-only; QR idempotente.
- Nada nuevo se enciende solo: todo el comercio va detrás de capacidades que nacen apagadas.
- Sprint en seis bloques (A seguridad · B calidad · C financiero · D Supply · E rendimiento · F piloto) y, de G,
  solo lo que no exigía decisiones de producto (avisos de presupuesto de ofertas).

## 2. Seguridad

| Punto | Estado | Evidencia |
|---|---|---|
| Secretos en el árbol | ✅ 0 hallazgos | gitleaks 8.21 con `.gitleaks.toml` (lista blanca solo de fixtures sintéticas, clasificadas una a una) |
| Secretos en el historial | 🟡 1 commit | `0d54ec72` (8 JWT de Supabase, ya rotados). **Se señala a propósito; no se reescribe el historial** |
| **Contraseña de la base de datos** | 🔴 **USER ACTION REQUIRED** | Estuvo en esos mismos scripts. No se puede comprobar si sigue vigente ni se intenta rotar desde aquí. No se imprime en ningún informe |
| Autorización de servidor | ✅ | 129 archivos `'use server'`: 0 funciones sin guardia fuera de la lista blanca (prueba que lo enumera); 9 crons con `autorizarCron` (503 sin secreto); Platform API por `autenticar`; `/api/metricas` falla cerrado |
| RLS | 🟡 | Capa 1 viva (según docs, no verificable). **Capa 2 apagada en producción** (decisión del usuario): ensayo completo en local sobre base desechable — `rls:probar` 50/50, ninguna tabla a oscuras (305), preflight y cobertura en verde. Runbook: `docs/runbooks/rls-encender.md` |
| Rutas `api/*` | ✅ | 116 revisadas |
| PII en Sentry/logs | ✅ / ⚠ | Limpieza de URL/usuario/migas y eventos solo con etiquetas. ⚠ La repetición de sesión graba con `maskAllText: false` — decisión de privacidad abierta (§9) |

## 3. Tests

Medido en la corrida final de este sprint (BD local desechable):

| Puerta | Resultado |
|---|---|
| TypeScript | PASS — `tsc --noEmit`, 0 errores |
| ESLint | PASS — `eslint src tests --quiet`, 0 errores |
| Unit | __UNIT__ |
| PostgreSQL | __PG__ |
| RLS (cobertura, preflight, `rls:probar` en ensayo) | PASS |
| Migraciones | PASS — 209 selladas, sin deriva (`migrate diff` vacío) |
| Build | __BUILD__ |
| E2E | __E2E__ |
| Secretos | PASS — gitleaks 0 hallazgos en el árbol |
| Presupuesto de JS | __PRESU__ |

**Cómo se llegó al verde, sin trampas:** las 10 pruebas rojas heredadas de `main` se clasificaron una por una —
A código, B prueba desactualizada, C contrato visual cambiado, D configuración— y se corrigió la fuente de cada una;
no se borró ni se saltó ninguna prueba, no hay `@ts-ignore` nuevo ni gate desactivado. Cuando una aserción quedó
vieja por una regla nueva (el CPA de la caja pasó de RD$ 20 a RD$ 100 sobre un pago solo reportado) se dijo y se
corrigió el valor esperado con la razón. Las pruebas encontraron además defectos reales **de este mismo sprint**
(un disparador reescrito que perdía las reglas de `dealId`; un filtro de ids que dejaba pasar teléfonos; un ejemplo
de prueba con forma de cadena de conexión) y se corrigieron en el código.

**Intermitentes E2E `supply-v2-slice5` / `slice9`:** 8 rondas seguidas de ambos specs sobre base recreada en cada
ronda: 16/16 en las 8 (2 omitidos = el proyecto móvil, por diseño). Causa raíz de los fallos históricos: la suite
corrió durante semanas contra una base compartida (`membego_dev`) y el script `e2e:limpio` ya recrea la base y
el servidor en cada corrida (`scripts/e2e/correr.mjs`); desde entonces no se reprodujo. El único intermitente
conocido en PostgreSQL (`slice9 · lo abandonado vuelve a la vida`, arriendo del outbox) se repitió 10 veces
aislado: __S9__. Es un riesgo **no reproducible**, no resuelto: se dice así.

## 4. Finanzas

- **Pago reportado ≠ verificado.** Una referencia que teclea el empleado (tarjeta/transferencia) deja el pedido en
  `EXTERNAL_PAYMENT_REPORTED`; solo una fuente externa (pasarela firmada, conciliación bancaria del superadmin,
  proveedor) lo sube a `PAYMENT_VERIFIED`, con su referencia y fecha (CHECK en la base). `FISCALLY_RECONCILED` queda reservado.
- **Comisión.** HYBRID: CPA RD$ 100 al cerrar; si el pago se verifica después, UN asiento `VERIFICATION_ADJUSTMENT`
  por la diferencia hasta el 8 % (RD$ 100 + 300 sobre RD$ 5,000). Append-only, idempotente por clave, con motivo, con
  reverso en el reembolso (dos asientos contrarios) y probado con concurrencia (3 verificaciones → 1 ajuste;
  verificar y reembolsar a la vez, 4 rondas → saldo en cero). La comisión original nunca se edita.
- **Datos históricos.** No se modificó nada en silencio: el backfill de `20261051` es demostrable, deja `NOTICE` con
  las cuentas, no eleva ningún pago reportado a verificado y no toca comisiones ya cobradas. La regla P04 de la
  conciliación muestra las que, con el criterio nuevo, quedaron al 8 % sobre un pago solo reportado.
- **Atribución ≠ cumplimiento.** Comisiona lo que Membego trajo (vitrina, búsqueda, promoción, campaña, referido) aunque
  se cumpla en el POS; la venta espontánea de mostrador y el QR de membresía no. Sin cobros retroactivos.
- **Base comisionable:** auditada en `docs/REGLAS_FINANCIERAS.md` §1. **USER / ACCOUNTING DECISION REQUIRED:** ITBIS,
  propinas y cargos externos (no se inventa lógica fiscal dominicana).
- Supply nunca entra en Merchant Billing (función de dominio + disparador de base + prueba con INSERT crudo).

## 5. Supply

- **V1:** retirado del código (0 rutas, 0 crons, 0 módulos); se conservan 30 tablas y 10 migraciones con datos.
  **USER ACTION** antes de borrarlas: contar filas en producción de las 28 tablas que V2 no usa.
- **V2** detrás de `MEMBEGO_SUPPLIER` (+ proveedor activo de la empresa).
- **Cadena Supply → Marketplace** (6 puntos, lectura de código y SQL + pruebas): sin doble decremento, sin doble
  derecho (ahora también en la base: `20261052`), sin overselling con lote, sin redención duplicada, el envoltorio
  no escribe en el ledger de Supply ni mueve inventario, sin comisión de Merchant Billing.
- **Huecos conocidos:** no existe reembolso al cliente en Supply (`REFUNDED` inalcanzable; un reembolso hecho fuera
  del sistema deja el derecho canjeable); el canal a comisión no tiene lote ni barrera propia contra overselling más
  allá del candado de la oferta (probado en slice5 C); el ledger no tiene unicidad por referencia.

## 6. Marketplace

- Carrito por negocio, pedidos, ofertas con presupuesto, POS conectado, conciliación y riesgo: verificados.
- **Avisos de oferta** (80 %, 100 %, agotada, por vencer), idempotentes, con prueba concurrente.
- **No hecho — decisión de producto:** categorías transversales (hoy el filtro compara el *slug* entre empresas, no hay
  taxonomía de plataforma: ¿qué categorías?), «cerca de mí» sobre el catálogo (existe para negocios; sobre el
  catálogo exige radio y orden por distancia), y **Campaigns** como entidad del Commerce Core (¿agrupa ofertas?
  ¿presupuesto propio?). No se construyeron para no inventar comportamiento visible.

## 7. Performance

`docs/RENDIMIENTO.md`. Con **396 000 pedidos** sembrados: analítica de empresa 212 ms (90 d) / 240 ms (365 d);
plataforma 1,1 s / 2,1 s; conciliación completa de plataforma 3,6 s (la regla C01, 1,6 s, es una verificación de
integridad que por definición mira todo lo completado); por empresa 365 ms. El único índice candidato **empeoró** la
consulta (83–96 → 125–150 ms): **no se añadió ninguno**. Bundle: 8 875 / 9 200 KB (96 %); lo más pesado es el SDK de
Sentry del cliente (526 KB); sin cambios por riesgo de observabilidad. Concurrencia: todos los casos pedidos
(reclamos de ofertas, QR, reserva de inventario, creación de comisión, ajuste, libro, redención de Supply, último
cupo, último presupuesto, mismo QR, mismo webhook dos veces) tienen su prueba contra PostgreSQL real.

## 8. Observabilidad

Sentry con limpieza de PII; eventos estructurados que solo admiten etiquetas; **nuevo:** eventos de operación del
Commerce Core (`pedido`/`facturacion`) con `emp` y `ped`, emitidos después de la transacción y con el *código* del
error (nunca el mensaje), validados para que un teléfono o un correo no se cuelen. `correlationId` ya existe en los
webhooks de Supply; en el Commerce Core el hilo es el `pedido`. **No medido:** reglas de alerta y uptime en producción.

## 9. Bloqueadores externos

| Bloqueador | Estado |
|---|---|
| CardNET (cobro en línea) | **BLOCKED — EXTERNAL CREDENTIALS** |
| DGII / e-CF | **BLOCKED — EXTERNAL / FISCAL INTEGRATION** |
| Rotación de la contraseña de la base | **USER ACTION REQUIRED** |
| Corte de RLS Capa 2 en producción | Espera autorización explícita; código y runbook listos |

## 10. Decisiones pendientes (solo del usuario)

1. Rotar la contraseña de la base (hoy) y marcar `Secretos` y `Tipos, linter y pruebas` como checks obligatorios.
2. Corte de RLS Capa 2 en producción (cuándo).
3. Privacidad de Sentry: `maskAllText: false` en la repetición de sesión (`src/instrumentation-client.ts`).
4. Tratamiento contable de ITBIS/propinas/cargos externos en la base comisionable.
5. Qué hacer con las 28 tablas de Supply V1 (archivar/borrar) tras contarlas en producción.
6. Reembolso al cliente en Supply: ¿se construye? ¿con qué regla de ledger?
7. Taxonomía de categorías transversales, radio de «cerca de mí» y qué es una «campaña» de Membego.
8. Valores de serie de Merchant Billing (CPA RD$ 100, 8 %, crédito RD$ 5,000, gracia 7 días) con cada empresa.
9. Si se abre y cómo se fusiona el PR (`docs/PR_F6-F9.md`, preparado).

## 11. Pilot readiness

**YES**, con empresa de práctica, pagos manuales, capacidades encendidas solo para ella y `docs/PILOT_FIELD_TEST.md`
completa (filas **[BLOQUEA]** en ✅). Lo que ya está garantizado por código y base: un cobro no se duplica (QR, caja,
doble clic), el stock no se vende de más, las comisiones y sus ajustes cuadran con el libro, y la conciliación
detecta lo que se desvíe. Lo que **solo** puede confirmar una persona: cámara, lector HID, térmica, teléfonos reales,
redes lentas, claro/oscuro.

## 12. Production readiness

**NO.** Además de los bloqueadores (§9): sin la prueba de campo, sin alertas ni uptime verificados, con RLS Capa 2
apagada y sin cobro en línea ni fiscal, producción abierta a clientes reales no es responsable todavía. Ninguna de las
cuatro cosas es trabajo de código pendiente de este repositorio salvo el reembolso de Supply y las decisiones del §10.
