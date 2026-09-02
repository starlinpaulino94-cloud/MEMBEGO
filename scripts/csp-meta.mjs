#!/usr/bin/env node
/**
 * ¿LA CSP DE PRODUCCIÓN DEJA FUNCIONAR EL ALTA INCRUSTADA DE META, Y SIGUE
 * BLOQUEANDO LO DEMÁS?
 *
 * Se comprueba en un navegador de verdad, sirviendo la cabecera EXACTA que
 * emite `next.config.ts`. No hace falta que Meta sea alcanzable: lo que se
 * mide es si el navegador emite `securitypolicyviolation` — es decir, si la
 * POLÍTICA lo permite. Un fallo de red es otra cosa y se distingue.
 *
 * Se ejecuta a mano (`node scripts/csp-meta.mjs`) y no en el portón de CI,
 * porque necesita Chromium. La prueba que sí corre siempre
 * (`tests/connect-meta.test.ts`) vigila que los orígenes exactos sigan en su
 * directiva y que no aparezcan comodines nuevos.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const DIRECTIVAS_CONOCIDAS =
  /^(default|script|style|img|font|connect|frame|worker|object|base|form)-(src|uri|action|ancestors)|^frame-ancestors|^base-uri|^form-action|^object-src/

/** La CSP real, leída del fuente para que no se pueda separar de él. */
function cspDeProduccion() {
  const fuente = readFileSync('next.config.ts', 'utf8')
  const bloque = fuente.slice(fuente.indexOf("key: 'Content-Security-Policy'"))
  const valor = bloque.slice(bloque.indexOf('value: ['), bloque.indexOf("].join('; ')"))
  return [...valor.matchAll(/["`]([a-z-]+ [^"`]*)["`]/g)]
    .map((m) => m[1].replace(/\$\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim())
    // Los comentarios del archivo también casan con el patrón: se descartan
    // por nombre de directiva en vez de por posición.
    .filter((d) => DIRECTIVAS_CONOCIDAS.test(d))
    .join('; ')
}

const PRUEBAS = [
  { nombre: 'SDK de Meta', url: 'https://connect.facebook.net/en_US/sdk.js', permitir: true },
  { nombre: 'Host no autorizado', url: 'https://evil.example.com/x.js', permitir: false },
  {
    nombre: 'Suplantación de Meta por sufijo',
    url: 'https://connect.facebook.net.evil.com/x.js',
    permitir: false,
  },
]

const CSP = cspDeProduccion()
const servidor = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP })
  res.end('<!doctype html><html><body></body></html>')
})
await new Promise((r) => servidor.listen(0, r))
const puerto = servidor.address().port

const ejecutable =
  process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const navegador = await chromium.launch({ executablePath: ejecutable })
const pagina = await navegador.newPage()
const violaciones = []
await pagina.exposeFunction('anotar', (uri) => violaciones.push(uri))
await pagina.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => window.anotar(e.blockedURI))
})
await pagina.goto(`http://127.0.0.1:${puerto}/`)

console.log('CSP servida:\n  ' + CSP.split('; ').join('\n  ') + '\n')

let fallos = 0
for (const p of PRUEBAS) {
  violaciones.length = 0
  await pagina.evaluate((url) => {
    const s = document.createElement('script')
    s.src = url
    document.body.appendChild(s)
  }, p.url)
  await pagina.waitForTimeout(600)
  const bloqueado = violaciones.some((v) => v.startsWith(new URL(p.url).origin))
  const ok = p.permitir ? !bloqueado : bloqueado
  if (!ok) fallos++
  console.log(
    `${ok ? '✓' : '✗'} ${p.nombre}: ${bloqueado ? 'BLOQUEADO por CSP' : 'permitido por la política'}` +
      ` (esperado: ${p.permitir ? 'permitido' : 'bloqueado'})`
  )
}

violaciones.length = 0
await pagina.evaluate(() => {
  const f = document.createElement('iframe')
  f.src = 'https://www.facebook.com/dialog/'
  document.body.appendChild(f)
})
await pagina.waitForTimeout(600)
const marcoBloqueado = violaciones.some((v) => v.includes('facebook.com'))
if (marcoBloqueado) fallos++
console.log(
  `${marcoBloqueado ? '✗' : '✓'} Marco del diálogo de Meta: ${marcoBloqueado ? 'BLOQUEADO' : 'permitido por la política'}`
)

await navegador.close()
servidor.close()
console.log(fallos === 0 ? '\nCSP correcta.' : `\n${fallos} comprobaciones fallaron.`)
process.exit(fallos === 0 ? 0 : 1)
