# ADR: Growth Commerce Unification

- Estado: primera rebanada completada (PR #588)
- Fecha: 2026-10-09
- Alcance de esta fase: conectar reglas de Promotion con reclamos nuevos de Deals y distribuir Deals mediante MarketingCampaign.

## Contexto

El código mantiene dominios distintos: `Promocion` legacy alimenta superficies públicas; `Promotion` es una definición administrativa con reglas y acciones genéricas; `Deal` controla el descuento, el presupuesto, los cupos, el pedido y el canje; Supply conserva su propia economía y campañas. Antes de esta rebanada, ningún consumidor comercial llamaba a `PromotionEngine`; ahora el reclamo de Deal lo usa solo para elegibilidad.

El motor de promociones delega las condiciones al Rule Engine, pero antes no comprobaba el estado ni la ventana de la promoción. También cargaba reglas por ID y las evaluaba sin comprobar que pertenecieran a la misma empresa ni que estuvieran publicadas, activas y vigentes. Por tanto, una asociación inválida podía resultar elegible.

## Autoridad elegida para la primera integración

- `Promotion` aporta elegibilidad y segmentación mediante reglas del Rule Engine.
- `Deal` sigue siendo la autoridad del descuento, producto/variante, tarifa, presupuesto, cupos, reserva, voucher y ciclo de canje.
- Una acción genérica de Promotion no modifica el precio de Deal. No se usa el Action Engine para conceder descuentos en esta rebanada.
- `Promocion` legacy y Supply no se migran ni se fusionan con este cambio.
- Las condiciones se evalúan en servidor con datos derivados del tenant. El cliente nunca decide el resultado.

## Implementado en esta primera rebanada

`Deal.promotionId` es opcional y tiene una clave foránea compuesta con `companyId`; un Deal no puede apuntar a la promoción de otra empresa. El formulario de alta solo presenta promociones activas y vigentes de la empresa actual. El servidor vuelve a validar la asociación al crear el Deal.

`reclamarOfertaEnTx` evalúa la Promotion asociada antes de reservar cupos o presupuesto. `PromotionEngine.evaluate` solo considera elegible una promoción `ACTIVE`, dentro de `startsAt`/`endsAt` (límites inclusivos) y del mismo `companyId` que el contexto. Solo evalúa reglas de esa empresa cuando están `PUBLISHED`, activas y vigentes según el instante del contexto. Referencias faltantes o no elegibles fallan cerrado. Promociones con acciones o restricciones activas también fallan cerrado porque esta primera rebanada no implementa esos efectos. El selector de Deals solo ofrece promociones sin esas funciones activas. El contexto contiene únicamente IDs de cliente, sucursal, Deal y variante; no incluye datos de contacto.

Una Promotion sin reglas es incondicional mientras siga activa y vigente. Las reglas se aplican con AND. Rechazar elegibilidad sucede antes de cualquier reserva. El descuento, Merchant Billing, reserva, pedido/QR y canje permanecen en Deal. La atribución financiera existente sigue registrando el ID del Deal.

La política de reglas vivas quedó fijada: los cambios afectan reclamos futuros. No reescriben pedidos ni cupones emitidos; un `DealClaim` válido conserva su pedido, reserva y vigencia para canje bajo el ciclo existente.

La asociación se captura en el audit log del reclamo con el ID y la versión de Promotion y los IDs/versiones de Rule evaluados. No se incluyen email, teléfono, dirección, tokens ni otros datos personales en el contexto.

## Campañas de Commerce

`MarketingCampaign` distribuye un Deal opcional. La clave compuesta `(dealId, companyId)` impide enlazar una oferta de otra empresa. La Promotion se consulta a través del Deal (`MarketingCampaign → Deal → Promotion`); no se guarda una segunda Promotion en Campaign para evitar dos fuentes que pudieran discrepar. Supply conserva `SupplyV2Campaign` y `SupplyV2Coupon` sin cambios.

El CTA de una campaña enlazada abre `/ofertas/{dealId}`, una ficha pública que vuelve a comprobar vigencia, estado, límites, cuenta, capacidades y disponibilidad de la Promotion. Una campaña deja de mostrarse cuando su Deal está pausado, fuera de ventana o sin cupos/presupuesto. Los límites efectivos son siempre los del Deal; `MarketingCampaign.maxReclamos` sigue siendo solo urgencia visual de campañas sin Deal. La validación del reclamo vuelve a ejecutarse en servidor antes de reservar recursos.

Esta rebanada no persiste atribución de reclamos a una campaña ni cambia `DealClaim`; el vínculo permite distribución y navegación directa. No se agrega otro motor Coupon: el cupón sigue siendo `DealClaim` más pedido/QR. No se agregan stackability, bundles, booking, canales multicanal, nuevo motor de descuentos ni migración de `Promocion`; tampoco cambia Merchant Billing ni la atribución financiera de pedidos.

## Hallazgos para la siguiente rebanada

- En Commerce, el cupón ya emitido es `DealClaim` más el pedido/QR asociado: tiene unicidad por `(dealId, customerId)`, vencimiento, estados de reclamo/canje y fotos de cuota/ahorro. No se añadirá otra tabla de cupón para Deals mientras este modelo cubra el ciclo; crear un `Coupon Engine` duplicaría esa autoridad.
- `SupplyV2Coupon` y `SupplyV2Campaign` pertenecen al flujo y la economía de Supply. Mantienen sus reservas, financiación, beneficios y redenciones; no se trasladan a Merchant Billing ni al nuevo enlace.
- `MarketingCampaign` se amplió para distribuir Deals con FK tenant-safe. `SupplyV2Campaign` continúa siendo una campaña de beneficios/cupones de Supply con presupuesto y aprobación; no se fusiona.
- La atribución de reclamos y su medición se documentan en [ADR-CAMPAIGN-CLAIM-ATTRIBUTION.md](ADR-CAMPAIGN-CLAIM-ATTRIBUTION.md).

## Verificación requerida para ampliar esta fase

- Tenant cruzado para Promotion y Rule es rechazado por clave compuesta y validación en servidor; cliente y sucursal se resuelven dentro de la empresa.
- Reglas faltantes, inactivas, no publicadas o fuera de ventana rechazan nuevos reclamos sin reservar presupuesto/cupo.
- Un reclamo válido conserva la transacción de pedido, stock, presupuesto y `DealClaim` existente.
- Cambiar o pausar Promotion no modifica cupones ya emitidos.
- Carreras, expiración, cancelación, reembolso y tarifas existentes siguen cubiertos por las pruebas PostgreSQL de Deals.
