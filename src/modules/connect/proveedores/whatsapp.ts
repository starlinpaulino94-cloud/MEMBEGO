import { metaConfigurado } from '@/modules/connect/metaNucleo'
import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor, PasoConexion } from '@/modules/connect/proveedores/tipos'

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
 * LO QUE LA INVESTIGACIÓN DE LA FASE 14 CORRIGIÓ: la Verificación de Negocio y
 * la Revisión de la App NO son bloqueantes para empezar. Meta permite dar de
 * alta hasta 10 clientes cada 7 días sin ninguna de las dos; el trámite sube
 * ese límite a 200. Lo que sí hace falta antes es ser Proveedor Técnico y
 * tener una configuración de Inicio de Sesión de Facebook para Empresas.
 * Todos los requisitos, con sus fuentes, en
 * `docs/connect/whatsapp-embedded-signup.md`.
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
/**
 * EL GUION BUENO: el Alta Incrustada de Meta.
 *
 * Un botón, el diálogo de Meta, y listo. Sin paneles ajenos y sin tokens.
 * Solo se ofrece si la plataforma tiene su app de Meta configurada — misma
 * regla que Google: lo que no está configurado no se enseña.
 */
const PASOS_META: readonly PasoConexion[] = [
  {
    id: 'requisitos',
    titulo: 'Antes de empezar',
    descripcion:
      'Necesitas una cuenta de empresa en Meta y un número de teléfono que NO esté en uso en la app normal de WhatsApp. Al terminar, Meta te pedirá añadir un método de pago en tu cuenta: te factura a ti el uso de la mensajería.',
    tipo: 'INFORMATIVO',
  },
  {
    id: 'credencial',
    titulo: 'Conéctate con Facebook',
    descripcion:
      'Se abre una ventana de Meta donde eliges tu cuenta de WhatsApp Business y tu número. Membego no ve ni guarda tu contraseña.',
    tipo: 'COMPONENTE',
    componente: 'AltaMetaWhatsapp',
    // El alta incrustada guarda la credencial sellada al canjear: el paso se da
    // por hecho porque esa credencial existe, no porque alguien pasara por aquí.
    cumpleCon: 'autorizado',
  },
]

/**
 * EL GUION PROVISIONAL: el token pegado a mano.
 *
 * Funciona, no se retira mientras haya empresas usándolo, y está marcado como
 * provisional en la definición para que la interfaz lo diga en voz alta.
 */
const PASOS_TOKEN: readonly PasoConexion[] = [
  {
    id: 'requisitos',
    titulo: 'Antes de empezar',
    descripcion:
      'Necesitas una cuenta de WhatsApp Business en Meta y un número dado de alta en ella.',
    tipo: 'INFORMATIVO',
  },
  {
    id: 'credencial',
    titulo: 'Conecta tu número',
    descripcion:
      'Los dos datos salen del panel de WhatsApp de Meta, en «API Setup». Comprobamos el número con Meta antes de guardar nada: si el token no sirve, no se guarda.',
    tipo: 'COMPONENTE',
    componente: 'AltaWhatsapp',
    // EL TOKEN NO PASA POR `setupState`. Va directo a la credencial sellada
    // (AES-256-GCM), y el paso se da por hecho porque esa credencial existe.
    cumpleCon: 'autorizado',
  },
]

export const WHATSAPP: DefinicionProveedor = {
  metadatos: metadatosObligatorios('whatsapp'),
  clase: 'NATIVA',
  // La forma de autorizar cambia con el despliegue, y con ella el patrón: el
  // alta incrustada es un diálogo del SDK que devuelve el resultado a la
  // ventana que lo abrió (POPUP), no una redirección OAuth normal.
  get autorizacion() {
    return metaConfigurado()
      ? ({ tipo: 'OAUTH2', patron: 'POPUP' } as const)
      : ({
          tipo: 'API_KEY',
          patron: 'CREDENCIAL',
          provisional: {
            motivo:
              'El Alta Incrustada de Meta todavía no está configurada en esta plataforma.',
            sustituyePor: 'Meta Embedded Signup (patrón POPUP)',
          },
        } as const)
  },
  // API_KEY EN LOS DOS CAMINOS, y esto es lo que la Fase 14 se dejó: con el
  // alta incrustada la autorización es OAuth, pero lo que acaba sellado es un
  // token de negocio que se usa como clave. Deducirlo del tipo de autorización
  // hacía que el asistente buscara una credencial que nunca se escribía.
  tipoCredencial: 'API_KEY',
  capacidades: ['mensajes.enviar'],
  pasos: () => (metaConfigurado() ? PASOS_META : PASOS_TOKEN),
  versionAlta: 2,
  // No depende de configuración de la plataforma: cada empresa trae su token y
  // su número. Por eso está disponible siempre.
  disponible: () => true,
  queFalta: '',
}
