export const CLAVE_COMPACTO = 'membego.nav.compacto.v1'

/**
 * Se ejecuta antes del primer pintado en el HTML del servidor (RootLayout).
 * Va en texto plano y sin dependencias para que corra de inmediato sin retrasos.
 */
export const SCRIPT_COMPACTO = `try{document.documentElement.dataset.navCompacto=localStorage.getItem('${CLAVE_COMPACTO}')==='1'?'1':'0'}catch(e){}`
