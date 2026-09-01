import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * CARDNET · la primera integración ADAPTADA (ajuste 3 del rediseño).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SIGNIFICA «ADAPTADA» Y POR QUÉ EXISTE ESTA CLASE
 *
 * CardNET ya funciona en Membego, fuera de Connect: tiene sus variables de
 * plataforma (`CARDNET_TOKENS_*`), su capacidad por empresa (PAGO_CARDNET),
 * su `MetodoPago`, sus `PagoIntento` y su panel en /admin/metodos-pago. Es
 * código en producción que mueve dinero.
 *
 * Migrarlo a Connect solo para que aparezca en una rejilla sería cambiar un
 * subsistema de cobros —que además tiene un incidente abierto— por una razón
 * de presentación. No se hace.
 *
 * Lo que sí se hace: Connect LO LEE. No crea fila en `conexiones_empresa`, no
 * guarda credenciales, no duplica estado. Traduce lo que el subsistema de
 * pagos ya sabe a un vocabulario común, y «Gestionar» lleva al módulo que de
 * verdad lo administra. El usuario ve un ecosistema; la arquitectura interna
 * no se toca.
 *
 * El día que se decida migrarlo, `clase` pasa de ADAPTADA a NATIVA y la
 * experiencia no cambia: ése es el punto.
 */
export const CARDNET: DefinicionProveedor = {
  metadatos: metadatosObligatorios('cardnet'),
  clase: 'ADAPTADA',
  autorizacion: {
    tipo: 'API_KEY',
    patron: 'CREDENCIAL',
  },
  capacidades: ['pagos.tarjeta'],
  // Vacío A PROPÓSITO: una integración adaptada no se da de alta desde aquí.
  // Su alta es la del módulo que la administra, y ahí es donde lleva el botón.
  pasos: [],
  versionAlta: 1,
  /**
   * Mismas dos llaves que exige `getTokensConfig()` en
   * `lib/payments/cardnet-tokens.ts`. Se comprueban aquí a mano porque aquel
   * módulo es `server-only` y este registro tiene que poder cargarse en las
   * pruebas; una prueba estructural vigila que las dos condiciones no se
   * separen.
   */
  disponible: () =>
    Boolean(
      process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim() &&
        process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()
    ),
  queFalta:
    'Faltan las credenciales de CardNET en el servidor (CARDNET_TOKENS_PUBLIC_KEY y CARDNET_TOKENS_PRIVATE_KEY).',
  rutaGestionExterna: '/admin/metodos-pago',
}
