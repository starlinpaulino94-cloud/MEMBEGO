import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * WHATSAPP · Meta Cloud API.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOKEN A MANO ES PROVISIONAL, Y ESTÁ ESCRITO QUE LO ES
 *
 * La experiencia objetivo es el Alta Incrustada de Meta (Embedded Signup): la
 * empresa pulsa «Conéctese con Facebook», autoriza, elige su cuenta de
 * WhatsApp Business y su número, y termina. Sin tokens, sin paneles ajenos.
 *
 * Hoy no se puede: Meta exige Verificación de Negocio y Revisión de la App
 * antes de habilitar ese flujo, y ese trámite no está iniciado. Los requisitos
 * exactos están en `docs/connect/whatsapp-embedded-signup.md`.
 *
 * Mientras tanto, el token permanente de Usuario del Sistema funciona y no se
 * retira, porque retirarlo dejaría a las empresas que ya lo usan sin canal.
 *
 * LO QUE HACE QUE LA SUSTITUCIÓN SEA BARATA: el token a mano es UN PASO de
 * esta lista, marcado con `provisional`. Cuando Meta apruebe, ese paso se
 * cambia por uno de tipo COMPONENTE con el diálogo de Meta y NADA MÁS cambia
 * — ni las credenciales (mismo sellado, misma tabla), ni la salud, ni el
 * envío, ni las automatizaciones, ni los webhooks, ni la bitácora. El secreto
 * que produzca el alta incrustada se guarda exactamente donde se guarda hoy.
 */
export const WHATSAPP: DefinicionProveedor = {
  metadatos: metadatosObligatorios('whatsapp'),
  clase: 'NATIVA',
  autorizacion: {
    tipo: 'API_KEY',
    patron: 'CREDENCIAL',
    provisional: {
      motivo:
        'El Alta Incrustada de Meta exige Verificación de Negocio y Revisión de la App, un trámite que todavía no está completado.',
      sustituyePor: 'Meta Embedded Signup (patrón POPUP)',
    },
  },
  capacidades: ['mensajes.enviar'],
  pasos: [
    {
      id: 'requisitos',
      titulo: 'Antes de empezar',
      descripcion:
        'Necesitas una cuenta de WhatsApp Business en Meta y un número dado de alta en ella.',
      tipo: 'INFORMATIVO',
    },
    {
      id: 'credencial',
      // Este es el paso que desaparece cuando Meta apruebe: se sustituye por
      // uno igual de COMPONENTE con el diálogo del alta incrustada, y nada
      // más cambia.
      titulo: 'Conecta tu número',
      descripcion:
        'Los dos datos salen del panel de WhatsApp de Meta, en «API Setup». Comprobamos el número con Meta antes de guardar nada: si el token no sirve, no se guarda.',
      tipo: 'COMPONENTE',
      componente: 'AltaWhatsapp',
      // EL TOKEN NO PASA POR `setupState`. Va directo a la credencial sellada
      // (AES-256-GCM), y el paso se da por hecho porque esa credencial existe.
      cumpleCon: 'autorizado',
    },
  ],
  // Sube a 2 en la Fase 12: el alta pasa por el asistente y el paso de
  // validación separado desaparece — validar contra Meta ya ocurre dentro del
  // propio guardado, que es donde tiene que estar.
  versionAlta: 2,
  // No depende de configuración de la plataforma: cada empresa trae su token y
  // su número. Por eso está disponible siempre.
  disponible: () => true,
  queFalta: '',
}
