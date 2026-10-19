-- INV-5e · rol de bodega: mueve existencias sin ver costos ni comprar. Aditivo e idempotente; el valor solo se agrega (no se usa en esta
-- migración).
ALTER TYPE "AppRole" ADD VALUE IF NOT EXISTS 'BODEGA';
