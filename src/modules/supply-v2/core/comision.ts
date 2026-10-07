/**
 * MEMBEGO SUPPLY · SLICE 5 · MOTOR DE PRECIOS DE COMISIÓN (§20–§23, §53–§56).
 *
 * Reexporta commerce-primitives/comision (Fase 0): el motor de reparto es
 * genérico y vive en src/lib/commerce-primitives/ para que Merchant Billing
 * y Supply V2 lo comparten sin duplicarlo. `SupplyV2PricingEngine` sigue
 * siendo el nombre canónico que importan checkout, redención y liquidación.
 */
export * from '@/lib/commerce-primitives/comision'
