/**
 * Las funciones que corren DENTRO de la WebView de captura, escritas como texto porque ahí no existe nuestro bundle.
 *
 * Son la copia de `extractCardnetToken` y `isAllowedCardnetFrameUrl` (security.ts) más el blindaje del `Close` del widget.
 * Que haya dos copias es el precio de que el documento sea autocontenido; el riesgo —que se separen— lo cubre
 * `tests/cardnet-client-capture.test.ts`, que EJECUTA este texto y comprueba que da lo mismo que las versiones de
 * TypeScript en cada caso. Si se toca una, la prueba obliga a tocar la otra.
 *
 * No usa nada que Hermes/Metro puedan transformar: es una cadena, no una función compilada (`Function.toString()` en
 * Hermes devuelve «[bytecode]»).
 */
export const CARDNET_PAGE_HELPERS = `
  var TOKEN_KEYS=['TokenId','tokenId','Token','token','TrxToken','trxToken','PWToken'];
  var TOKEN_WRAPPERS=['data','Data','detail','payload','Response','response'];
  var HAS=Object.prototype.hasOwnProperty;
  function validToken(v){return typeof v==='string'&&v.length>=8&&v.length<=512&&v.trim()===v&&!/[\\u0000-\\u0020\\u007f]/.test(v)}
  function tokenFrom(d,raw,depth){
    depth=depth||0;
    if(typeof d==='string'){
      var text=d.trim();
      if((text.charAt(0)==='{'||text.charAt(0)==='[')&&depth<3){try{return tokenFrom(JSON.parse(text),raw,depth+1)}catch(e){return null}}
      return raw&&depth===0&&validToken(text)?text:null;
    }
    if(!d||typeof d!=='object'||Array.isArray(d)||depth>=4)return null;
    for(var i=0;i<TOKEN_KEYS.length;i++){if(HAS.call(d,TOKEN_KEYS[i])&&validToken(d[TOKEN_KEYS[i]]))return d[TOKEN_KEYS[i]]}
    for(var j=0;j<TOKEN_WRAPPERS.length;j++){
      if(HAS.call(d,TOKEN_WRAPPERS[j])&&d[TOKEN_WRAPPERS[j]]){var nested=tokenFrom(d[TOKEN_WRAPPERS[j]],raw,depth+1);if(nested)return nested}
    }
    return null;
  }
  function frameMatches(src,cfg){
    try{
      var u=new URL(src);
      if(u.protocol!=='https:'||u.origin!==cfg.captureOrigin||u.pathname!==cfg.capturePath||u.username!==''||u.password!==''||u.hash!=='')return false;
      var k=u.searchParams.getAll('key'),s=u.searchParams.getAll('session_id');
      return k.length===1&&s.length===1&&k[0]===cfg.publicKey&&s[0]===cfg.uniqueId;
    }catch(e){return false}
  }
  function guardClose(sdk){
    try{
      var f=sdk&&sdk.Iframe;
      if(f&&typeof f.Close==='function'&&!f.Close.guarded){
        var original=f.Close.bind(f);
        var safe=function(){try{return original.apply(null,arguments)}catch(e){return undefined}};
        safe.guarded=true;
        f.Close=safe;
      }
    }catch(e){}
  }
`
