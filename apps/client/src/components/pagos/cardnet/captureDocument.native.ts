import type { CardnetCaptureSession } from '../../../lib/api'
import { colors } from '../../../theme/tokens'
import { CARDNET_PAGE_HELPERS } from './pageHelpers'
import type { CardnetCaptureConfig } from './security'

function cssRgba(color: string, opacity: number): string {
  const hex = color.slice(1)
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

const captureCardShadow = cssRgba(colors.surface.foreground, 0.06)

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function buildCardnetCaptureDocument(
  session: CardnetCaptureSession,
  config: CardnetCaptureConfig
): string {
  const capture = {
    captureOrigin: config.origin,
    capturePath: '/servicios/tokens/v1/Capture/',
    iframeUrl: config.iframeUrl,
    uniqueId: session.uniqueId,
    sessionId: session.sessionId,
    captureNonce: session.captureNonce,
    publicKey: session.publicKey,
  }

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>Pago seguro con CardNET</title>
<style>
:root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${colors.surface.foreground};background:${colors.surface.background}}
*{box-sizing:border-box}body{margin:0;padding:16px;background:${colors.surface.background}}main{max-width:620px;margin:0 auto;padding:18px;border:1px solid ${colors.surface.border};border-radius:16px;background:${colors.surface.background};box-shadow:0 8px 28px ${captureCardShadow}}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:12px}.mark{width:38px;height:38px;border-radius:12px;background:${colors.primary[50]};color:${colors.primary.DEFAULT};display:grid;place-items:center;font-size:20px}.title{font-size:16px;font-weight:700;line-height:1.35}.sub{font-size:14px;line-height:1.5;color:${colors.surface.mutedForeground};margin:3px 0 14px}
.note{padding:12px;border:1px solid ${colors.surface.border};border-radius:12px;background:${colors.surface.muted};font-size:14px;line-height:1.5;color:${colors.surface.mutedForeground}}button{width:100%;min-height:48px;margin-top:16px;border:0;border-radius:12px;background:${colors.primary.DEFAULT};color:${colors.surface.background};font:600 15px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button:disabled{opacity:.55}#status{margin-top:10px;min-height:20px;text-align:center;font-size:13px;color:${colors.surface.mutedForeground}}
</style>
<script src="${escapeAttribute(config.scriptUrl)}" async></script>
</head>
<body><main>
<div class="brand"><div class="mark" aria-hidden="true">◈</div><div class="title">Pago seguro con CardNET</div></div>
<p class="sub">Los datos de tu tarjeta se capturan en el formulario protegido del proveedor.</p>
<div class="note">MembeGo no solicita ni almacena el número de tarjeta o el código de seguridad.</div>
<button id="open-capture" type="button" disabled>Preparando formulario seguro</button>
<div id="status" role="status" aria-live="polite">Conectando con CardNET…</div>
<form id="cardnet_capture_form" hidden><input id="PWToken" name="PWToken" type="hidden" /></form>
</main>
<script>
(function(){
  'use strict';
  const capture=${scriptJson(capture)};
  const button=document.getElementById('open-capture');
  const status=document.getElementById('status');
  ${CARDNET_PAGE_HELPERS}
  /*
   * POR QUÉ SOLO SE EXIGE HABER VISTO EL IFRAME, Y NO UN MENSAJE PREVIO DE ÉL.
   *
   * Antes el token solo se aceptaba si un 'message' crudo del iframe, con origen y fuente exactos, había llegado primero, y
   * si en ese instante el iframe seguía en el documento. Eran tres condiciones que podían fallar sin ruido: el widget
   * cierra el iframe ANTES de entregar el token, su Close puede reventar a medias, y el payload puede venir en otro
   * formato. La tarjeta quedaba registrada en CardNET y la sesión de pago vencía sin cobrar (18 sesiones seguidas).
   * El token no decide qué se cobra —el servidor lee el perfil nuevo de CardNET—, solo avisa de que la captura terminó;
   * basta con que el formulario correcto se haya abierto de verdad (frameSeen) y que el valor tenga forma de token.
   */
  let frameSeen=false;
  let consumed=false;
  function refreshFrame(){
    const frames=document.querySelectorAll('iframe');
    for(let i=0;i<frames.length;i++){if(frameMatches(frames[i].src,capture)){frameSeen=true;return}}
  }
  const observer=new MutationObserver(refreshFrame);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['src'],childList:true,subtree:true});
  refreshFrame();
  function deliver(token){
    if(consumed)return;
    consumed=true;
    clearInterval(poll);
    const message={type:'CARDNET_TOKEN_CREATED',sessionId:capture.sessionId,captureNonce:capture.captureNonce,token:token};
    if(window.ReactNativeWebView&&typeof window.ReactNativeWebView.postMessage==='function')window.ReactNativeWebView.postMessage(JSON.stringify(message));
    status.textContent='Captura recibida. Confirmando con el servidor…';
    button.disabled=true;
  }
  function receiveToken(payload){
    if(consumed)return;
    refreshFrame();
    const token=tokenFrom(payload,true);
    if(!token||!frameSeen)return;
    deliver(token);
  }
  // Plan B: con autoSubmit apagado el widget también deja el token en el campo oculto del formulario.
  const field=document.getElementById('PWToken');
  const poll=setInterval(function(){
    if(consumed||!frameSeen||!field)return;
    if(validToken(field.value))deliver(field.value);
  },500);
  function ready(){
    const sdk=window.PWCheckout;
    if(!sdk||typeof sdk.Bind!=='function'||typeof sdk.OpenIframeCustom!=='function'){
      status.textContent='No se pudo cargar el formulario seguro. Cierra e intenta nuevamente.';
      return;
    }
    try{
      guardClose(sdk);
      ['tokenCreated','TokenCreated','token_created'].forEach(function(name){try{sdk.Bind(name,receiveToken)}catch(e){}});
      sdk.SetProperties({button_label:'Continuar con CardNET',checkout_card:1,currency:${scriptJson(session.currency)},description:'Pago seguro',empty:true,form_id:'cardnet_capture_form',lang:'ESP',amount:${scriptJson(String(session.amount))},autoSubmit:false});
      button.disabled=false;
      button.textContent='Abrir formulario de CardNET';
      status.textContent='';
    }catch{
      status.textContent='No se pudo preparar el formulario seguro. Cierra e intenta nuevamente.';
    }
  }
  button.addEventListener('click',function(){
    if(consumed)return;
    try{
      const sdk=window.PWCheckout;
      if(!sdk||typeof sdk.OpenIframeCustom!=='function')throw new Error('unavailable');
      guardClose(sdk);
      refreshFrame();
      sdk.OpenIframeCustom(capture.iframeUrl,capture.uniqueId);
      refreshFrame();
      status.textContent='Completa el formulario dentro de CardNET.';
    }catch{status.textContent='No se pudo abrir el formulario seguro. Cierra e intenta nuevamente.'}
  });
  const script=document.querySelector('script[src]');
  if(window.PWCheckout)ready();
  else if(script){script.addEventListener('load',ready,{once:true});script.addEventListener('error',function(){status.textContent='No se pudo cargar el formulario seguro.'},{once:true});}
})();
</script>
</body></html>`
}
