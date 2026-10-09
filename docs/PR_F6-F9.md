# PR · F6–F9 + auditorías + sprint de cierre → `main`

> **Estado: PREPARADO, NO ABIERTO NI FUSIONADO.** Este archivo es el cuerpo del PR para quien lo abra. No se
> hizo ninguna fusión destructiva ni se tocó `main`: la rama `claude/wizardly-hypatia-x2l9av` ya contiene
> `origin/main` (0 commits por detrás) y se puede fusionar sin conflictos. La decisión de abrirlo y fusionarlo es
> del usuario (ver «Antes de fusionar»).

## Qué trae

| Bloque | Contenido | Dónde mirar |
|---|---|---|
| **F6** Analítica | Resultados de Membego para la empresa y panorama de plataforma (GMV, toma, canales, ofertas) | `src/modules/analytics`, `/admin/resultados-membego`, `/superadmin/analitica` |
| **F7** POS conectado | La caja cobra pedidos Membego con su QR y vende del catálogo; capacidad `POS_MEMBEGO` | `src/modules/pos`, `/empleado/caja` |
| **F8** Checkout del marketplace | Carrito por negocio, pedido multi-línea, pago al recoger o por transferencia (intención) | `src/modules/checkout`, `/carrito` |
| **F9** Conciliación y riesgo | 27 reglas de coherencia (solo lectura) y 9 señales de riesgo; paneles de superadmin | `src/modules/conciliacion`, `src/modules/riesgo` |
| **Auditoría F5–F9** | 1 alto + 17 medios corregidos con su prueba cada uno; informe `docs/AUDITORIA_2026-10-07_F5-F9.md` | commits `9a07736`…`6438ccc` |
| **CI** | `tsc` en 0 y 16 pruebas heredadas de `main` que el CI nunca llegaba a correr | `51273c4` |
| **Informe F0–F9** | Auditoría final y E2E completa: `docs/INFORME_2026-10-08_F0-F9.md` | `cf6d614`, `3c0fe49` |
| **Sprint de cierre A** | gitleaks con lista blanca de fixtures sintéticas; ensayo de RLS Capa 2 en local | `e733f23` |
| **Sprint de cierre B** | Las 10 pruebas heredadas en verde corrigiendo la fuente | `a992da3` |
| **Sprint de cierre C** | Pago reportado ≠ verificado; ajuste de comisión append-only; atribución ≠ cumplimiento | `aecdb57`, `docs/REGLAS_FINANCIERAS.md` |
| **Sprint de cierre D–G** | Un derecho por unidad pagada en la base (Supply); eventos de operación; rendimiento medido; prueba de campo; avisos de presupuesto de ofertas | ver «Sprint de cierre» en `docs/IMPLEMENTATION_STATUS.md` |

Todo el comercio nuevo sigue **apagado por capacidad** (`CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO`, `POS_MEMBEGO`,
`DEALS_MARKETPLACE`): fusionar no cambia lo que ve ninguna empresa existente.

## Migraciones (3, aditivas, selladas: 209 en `prisma/migrations/SUMAS.txt`)

| Migración | Qué hace | Datos existentes |
|---|---|---|
| `20261050_verificacion_de_pago_enums` | Valores nuevos de enum (`EXTERNAL_PAYMENT_REPORTED`, `VERIFICATION_ADJUSTMENT`, 2 acciones de auditoría) y el enum `MembegoPaymentEvidenceSource` | Ninguno |
| `20261051_verificacion_de_pago` | `payment_evidences.source/verifiedAt/verificationRef/verifiedByUserId` (+CHECK), 5 columnas en `merchant_commissions`, CHECK del libro y disparador de comisiones (fusionado con las reglas de cuota de oferta de `20261048`) | **Backfill demostrable con `NOTICE`**: constancias del envoltorio de Supply → `PROVIDER_VERIFIED`; pedidos `PAYMENT_VERIFIED` por una constancia solo reportada → `EXTERNAL_PAYMENT_REPORTED`. **No se toca ninguna comisión ya cobrada.** Ningún pago reportado a mano se eleva a verificado |
| `20261052_supply_v2_derechos_por_linea` | Disparadores: un derecho pertenece a una línea de su orden y no hay más derechos que unidades | Solo cuenta (`NOTICE`) las líneas que ya estuvieran por encima; no modifica nada |

Orden de despliegue: `prisma migrate deploy` **antes** de desplegar el código nuevo (el código nuevo escribe
`payment_evidences.source`). Con el código viejo y la base nueva todo sigue funcionando (columnas con valor por
defecto), por eso el orden seguro es migrar primero.

## Reversa

- **Código:** `vercel rollback` al despliegue anterior (runbook `docs/runbooks/revertir-despliegue.md`). El código
  anterior es compatible con la base migrada: `source` tiene valor por defecto `MERCHANT_REPORTED`.
- **Base:** las migraciones son **hacia adelante**; los valores de enum no se pueden quitar. Si hubiera que
  deshacer: (a) `DROP TRIGGER` de `20261052` (inocuo), (b) las columnas nuevas pueden quedarse sin uso. **Lo que no
  se debe hacer** es revertir el código y seguir cerrando cortes de facturación con ajustes
  `VERIFICATION_ADJUSTMENT` ya asentados: el código anterior no los suma en `adjustments` y el cuadre del corte
  (que la base comprueba) lo rechazaría en voz alta, no en silencio. Con la capacidad apagada no hay ajustes.
- **Interruptor funcional:** apagar `PEDIDOS_MEMBEGO`/`POS_MEMBEGO` por empresa detiene todo lo nuevo sin tocar
  código ni base.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El criterio de «pago verificado» cambia: lo que escribe un empleado ya no vale como verificado | Empresas en modelo `HYBRID` pagan CPA (RD$ 100) en vez del 8 % hasta que el superadmin verifica contra el banco | Es intencional (`docs/REGLAS_FINANCIERAS.md`); el ajuste posterior asienta la diferencia sin editar lo cobrado. **Avisar a las empresas antes de encender** |
| Trigger de `merchant_commissions` reescrito | Un descuido haría desaparecer una regla anterior (ya pasó una vez: `dealId`) | Prueba PG `deals.db` 25 y 5 reglas de la base; `billing.db` 41–48 |
| `notificarAdmins` ahora devuelve un número | Cambio de firma interna | Los 17 usos existentes ignoran el valor (la mayoría con `void`); `tsc` limpio |
| Datos de piloto reales | Primera vez con dinero real | `docs/PILOT_FIELD_TEST.md`; empezar con una empresa de práctica |
| La contraseña de la base sigue en el historial de git (`0d54ec72`) | Credencial expuesta si no se rotó | **USER ACTION REQUIRED** antes de cualquier dato real |

## Verificación (BD local desechable, no producción)

| Puerta | Resultado |
|---|---|
| `tsc --noEmit` | 0 errores |
| `eslint src tests --quiet` | 0 errores |
| Unit (`npm test`) | 3 929 / 3 935, 0 fallan, 6 omitidas |
| PostgreSQL (`npm run test:db`) | 641 / 641 |
| Build | OK |
| E2E completa (`npm run e2e:limpio`) | 162 pasan, 0 fallan, 191 omitidas |
| Migraciones | 209 selladas, sin deriva |
| Secretos (gitleaks) | 0 hallazgos en el árbol |
| RLS (cobertura + preflight) | OK; ensayo Capa 2 en local: `rls:probar` 50/50 |
| Presupuesto de JS | 8 876 / 9 200 KB |

Detalle, incluidas las dos corridas E2E rojas previas y su causa, en `docs/PRODUCTION_READINESS_REPORT.md` §3.

## Antes de fusionar (lo decide el usuario)

1. Rotar la contraseña de la base de Supabase del proyecto `ybzhvfmybyyomwpjpaud` (no es verificable desde aquí).
2. Marcar `Secretos` y `Tipos, linter y pruebas` como checks obligatorios de la rama.
3. Decidir el corte de RLS Capa 2 (`docs/runbooks/rls-encender.md`): **es independiente de este PR**.
4. Si se quiere un historial limpio: este PR tiene unos 35 commits; se puede fusionar con *squash* sin perder las
   referencias de los informes (que citan hashes de commit, no números de PR).

---
_Cuerpo del PR preparado por Claude Code; no se abrió el PR._
