# ADR: atribución directa de reclamos a campañas

- Estado: aceptada e implementada en la siguiente rebanada de Growth Commerce
- Fecha: 2026-10-09
- Alcance: atribuir un reclamo de Deal a la campaña de cuyo enlace proviene ese reclamo y mostrar resultados atribuibles.

## Decisión

- La campaña distribuye un Deal mediante `/ofertas/{dealId}?campaign={campaignId}`. La ficha pública conserva ese origen al abrir la ficha exacta en la app y al regresar del inicio de sesión.
- Al reclamar, el servidor vuelve a resolver la campaña dentro de la misma empresa y comprueba que siga activa, dentro de su calendario/horario y asociada al mismo Deal. El dato del navegador nunca se acepta sin esa validación.
- Si la referencia es inválida, ajena, pausada o vencida, la reclamación sigue las reglas normales del Deal y queda sin atribución de campaña. Las reglas de Promotion, el descuento, el presupuesto, el cupo, el pedido y el QR mantienen sus autoridades actuales.
- Se conserva `OrderAttribution.campaignId` junto a `channel=PROMOTION_CLAIM`. El canal sigue describiendo el origen comercial del pedido; no se crea una fila, contador o motor de campañas paralelo, ni una migración de esquema.
- Los paneles muestran reclamos atribuidos y reclamos canjeados por campaña. Los reclamos anteriores al despliegue no se reconstruyen: cuando hay varias campañas elegibles no existe evidencia histórica para escoger una.

## Límites de medición

No se registran impresiones ni clics. Por eso, el producto puede informar reclamos atribuidos y canjes de esos reclamos, pero no una tasa de conversión de impresión/clic a reclamo. No se conserva una ventana de atribución de primera o última visita: solo cuenta la campaña que acompaña el reclamo actual. La atribución es analítica y no altera comisiones, presupuestos, beneficios ni derechos.
