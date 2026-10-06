/**
 * MEMBEGO SUPPLY · FEFO — First Expire, First Out.
 *
 * Reexporta commerce-primitives/fefo (Fase 0): el algoritmo es genérico y
 * vive en src/lib/commerce-primitives/ para que Inventory (Commerce Core) y
 * Supply V2 lo comparten sin duplicarlo.
 */
export * from '@/lib/commerce-primitives/fefo'
