/**
 * LA VENTANA DE CARDNET QUE LA APP MÓVIL ABRE EN EL NAVEGADOR DEL TELÉFONO — HTML puro.
 *
 * Por qué existe (14-10-2026): en Android, dentro de la WebView de la app, CardNET respondía «la autenticación falló» a
 * las tarjetas cuyo banco pide verificación 3D Secure, mientras la MISMA tarjeta se registraba bien en membego.com desde
 * Chrome en el mismo teléfono. La verificación del banco necesita lo que un navegador completo da y una WebView no
 * (ventanas emergentes, el reto del banco pintado en un marco de nuestra página, cookies del banco). En vez de imitar
 * Chrome dentro de la WebView, la app abre ESTA página en una pestaña de Chrome (Custom Tab) o en Safari: el mismo motor
 * en el que ya funciona.
 *
 * La página solo pinta el formulario oficial de CardNET con los mismos parámetros que la pantalla web. Cuando CardNET
 * entrega el token, vuelve a la app por `RETORNO_APP_CARDNET` con el token; la app lo confirma con su sesión y su nonce,
 * como hacía con la WebView. Si esa vuelta se pierde (el cliente cierra la pestaña), el servidor igual ve la tarjeta nueva
 * en CardNET y avanza el pago en el siguiente sondeo de la app (`reconciliarCapturaAbierta`).
 *
 * Sin `server-only` a propósito: es texto, lo prueban las pruebas ejecutando el script contra un SDK simulado.
 */

/** Adónde vuelve la pestaña al terminar. Es el `scheme` de la app (`apps/client/app.json`); la app lo espera igual. */
export const RETORNO_APP_CARDNET = 'membego://pago-cardnet'

export interface DatosVentanaCardnet {
  readonly sessionId: string
  /** `CaptureURL` de la sesión, ya validado contra la base de CardNET del ambiente. */
  readonly captureUrl: string
  /** `PWCheckout.js` del ambiente (el host que el propio widget exige). */
  readonly scriptUrl: string
  readonly publicKey: string
  /** `UniqueID` del Customer: el `session_id` del formulario. */
  readonly uniqueId: string
  /** Texto del botón de CardNET y del encabezado, ya formateado («RD$1,250.00»). */
  readonly montoTexto: string
  readonly moneda: string
  /** Nombre de la empresa tal como lo verá el cliente en el formulario. */
  readonly comercio: string
}

/**
 * Texto seguro para el widget: lo arrastra a la URL de su ventana sin escapar, y un `&` (como el de «CARTOWN Wash &
 * Detailing») parte la consulta y CardNET responde 500. Misma regla que `textoSeguroWidget` de la pantalla web.
 */
function textoWidget(valor: string, reserva: string): string {
  const v = valor.replace(/[&?#=+%]/g, ' ').replace(/\s+/g, ' ').trim()
  return (v || reserva).slice(0, 60).trim()
}

function escaparHtml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** JSON que puede ir dentro de un <script> sin cerrarlo ni romperlo. */
function jsonEnScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Colores del sistema (claro/oscuro según el teléfono): la página no trae paleta propia. */
const ESTILOS = [
  ':root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '*{box-sizing:border-box}body{margin:0;padding:20px 16px;background:Canvas;color:CanvasText}',
  'main{max-width:560px;margin:0 auto}',
  'h1{font-size:18px;margin:0 0 4px}p{font-size:14px;line-height:1.5;margin:0 0 12px;color:GrayText}',
  '.total{font-size:15px;font-weight:600;color:CanvasText;margin-bottom:16px}',
  'button,a.boton{display:block;width:100%;min-height:48px;margin-top:12px;border-radius:12px;font:600 15px system-ui,sans-serif;text-align:center;text-decoration:none;line-height:48px}',
  'button{border:0;background:CanvasText;color:Canvas}button:disabled{opacity:.5}',
  'a.boton{border:1px solid GrayText;color:CanvasText}',
  '#estado{min-height:20px;margin-top:12px;font-size:13px;text-align:center}',
].join('')

/**
 * El script de la página. Las piezas de leer el token son las mismas que la WebView usaba (`pageHelpers.ts` de la app):
 * el widget ha entregado el token con varios nombres de evento y en varias formas, cierra su ventana ANTES de entregarlo
 * (y su `Close` puede reventar), y con `autoSubmit` apagado también lo deja en el campo oculto `PWToken`.
 */
const SCRIPT = `
(function(){
  'use strict';
  var v=window.__ventanaCardnet;
  var boton=document.getElementById('abrir');
  var estado=document.getElementById('estado');
  var campo=document.getElementById('PWToken');
  var volver=document.getElementById('volver');
  var CLAVES=['TokenId','tokenId','Token','token','TrxToken','trxToken','PWToken'];
  var ENVOLTORIOS=['data','Data','detail','payload','Response','response'];
  var TIENE=Object.prototype.hasOwnProperty;
  var abierto=false;
  var entregado=false;
  function tokenValido(t){return typeof t==='string'&&t.length>=8&&t.length<=512&&t.trim()===t&&!/[\\u0000-\\u0020\\u007f]/.test(t)}
  function tokenDe(d,crudo,prof){
    prof=prof||0;
    if(typeof d==='string'){
      var texto=d.trim();
      if((texto.charAt(0)==='{'||texto.charAt(0)==='[')&&prof<3){try{return tokenDe(JSON.parse(texto),crudo,prof+1)}catch(e){return null}}
      return crudo&&prof===0&&tokenValido(texto)?texto:null;
    }
    if(!d||typeof d!=='object'||Array.isArray(d)||prof>=4)return null;
    for(var i=0;i<CLAVES.length;i++){if(TIENE.call(d,CLAVES[i])&&tokenValido(d[CLAVES[i]]))return d[CLAVES[i]]}
    for(var j=0;j<ENVOLTORIOS.length;j++){
      if(TIENE.call(d,ENVOLTORIOS[j])&&d[ENVOLTORIOS[j]]){var anidado=tokenDe(d[ENVOLTORIOS[j]],crudo,prof+1);if(anidado)return anidado}
    }
    return null;
  }
  function blindarCierre(sdk){
    try{
      var f=sdk&&sdk.Iframe;
      if(f&&typeof f.Close==='function'&&!f.Close.blindado){
        var original=f.Close.bind(f);
        var seguro=function(){try{return original.apply(null,arguments)}catch(e){return undefined}};
        seguro.blindado=true;
        f.Close=seguro;
      }
    }catch(e){}
  }
  function entregar(token){
    if(entregado)return;
    entregado=true;
    clearInterval(sondeo);
    var destino=v.retorno+'?s='+encodeURIComponent(v.sessionId)+'&t='+encodeURIComponent(token);
    boton.disabled=true;
    // Chrome puede no dejar que la página salte sola a la app si el último toque fue dentro del formulario de CardNET:
    // el botón de volver lleva el token, y un toque del cliente siempre abre la app.
    if(volver)volver.setAttribute('href',destino);
    estado.textContent='Tarjeta registrada. Si no vuelves a MembeGo solo, toca «Volver a MembeGo».';
    window.location.replace(destino);
  }
  function recibir(datos){
    if(entregado||!abierto)return;
    var token=tokenDe(datos,true);
    if(token)entregar(token);
  }
  // Plan B: con autoSubmit apagado el widget también deja el token en el campo oculto del formulario.
  var sondeo=setInterval(function(){
    if(entregado||!abierto||!campo)return;
    if(tokenValido(campo.value))entregar(campo.value);
  },500);
  function abrir(){
    if(entregado)return;
    var sdk=window.PWCheckout;
    try{
      blindarCierre(sdk);
      sdk.SetProperties(v.propiedades);
      var abrirVentana=sdk.OpenIframeCustom||sdk.OpenIframe;
      abrirVentana.call(sdk,v.iframeUrl,v.uniqueId);
      blindarCierre(sdk);
      abierto=true;
      boton.textContent='Volver a abrir el formulario';
      estado.textContent='Completa el formulario de CardNET.';
    }catch(e){
      estado.textContent='No se pudo abrir el formulario seguro. Toca el botón para intentarlo de nuevo.';
    }
  }
  boton.addEventListener('click',abrir);
  var sdk=window.PWCheckout;
  if(!sdk||typeof sdk.Bind!=='function'||typeof sdk.SetProperties!=='function'||(typeof sdk.OpenIframeCustom!=='function'&&typeof sdk.OpenIframe!=='function')){
    estado.textContent='No se pudo cargar el formulario seguro. Vuelve a MembeGo e inténtalo de nuevo.';
    return;
  }
  blindarCierre(sdk);
  ['tokenCreated','TokenCreated','token_created'].forEach(function(nombre){try{sdk.Bind(nombre,recibir)}catch(e){}});
  boton.disabled=false;
  boton.textContent='Abrir formulario de CardNET';
  abrir();
})();
`

export function construirVentanaCardnet(d: DatosVentanaCardnet): string {
  const iframe = new URL(d.captureUrl)
  iframe.searchParams.set('key', d.publicKey)
  iframe.searchParams.set('session_id', d.uniqueId)
  const script = new URL(d.scriptUrl)
  script.searchParams.set('key', d.publicKey)

  const marca = textoWidget(d.comercio, 'Pago seguro')
  const config = {
    sessionId: d.sessionId,
    uniqueId: d.uniqueId,
    iframeUrl: iframe.toString(),
    retorno: RETORNO_APP_CARDNET,
    // Los mismos que la pantalla web (`PagoTokenCardnet`), que es la que funciona con estas tarjetas.
    propiedades: {
      name: marca,
      email: '',
      button_label: textoWidget(`Pagar ${d.montoTexto}`, 'Pagar'),
      description: textoWidget(`Pago ${marca}`, 'Pago seguro'),
      currency: d.moneda,
      lang: 'ESP',
      form_id: 'cardnet_capture_form',
      checkout_card: 1,
      autoSubmit: 'false',
      empty: 'false',
    },
  }
  const volver = `${RETORNO_APP_CARDNET}?s=${encodeURIComponent(d.sessionId)}`

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Pago seguro con CardNET</title>
<style>${ESTILOS}</style>
<script src="${escaparHtml(script.toString())}"></script>
</head>
<body><main>
<h1>Pago seguro con CardNET</h1>
<p>Los datos de tu tarjeta se escriben en el formulario de CardNET. MembeGo no los ve ni los guarda.</p>
<div class="total">${escaparHtml(marca)} · ${escaparHtml(d.montoTexto)}</div>
<button id="abrir" type="button" disabled>Preparando formulario seguro…</button>
<a id="volver" class="boton" href="${escaparHtml(volver)}">Volver a MembeGo</a>
<div id="estado" role="status" aria-live="polite"></div>
<form id="cardnet_capture_form" hidden><input id="PWToken" name="PWToken" type="hidden" /></form>
</main>
<script>window.__ventanaCardnet=${jsonEnScript(config)};</script>
<script>${SCRIPT}</script>
</body></html>`
}

/** Lo que ve quien abre una ventana vencida, ya usada o inexistente: nada que adivinar, y el camino de vuelta. */
export function construirVentanaNoDisponible(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Pago seguro con CardNET</title>
<style>${ESTILOS}</style>
</head>
<body><main>
<h1>Esta ventana de pago ya no está disponible</h1>
<p>Venció o ya se usó. Vuelve a MembeGo e inicia el pago otra vez.</p>
<a class="boton" href="${RETORNO_APP_CARDNET}">Volver a MembeGo</a>
</main></body></html>`
}
