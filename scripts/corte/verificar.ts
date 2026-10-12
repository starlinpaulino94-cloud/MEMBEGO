#!/usr/bin/env tsx
/**
 * bun run corte:verificar <origen-landing> <origen-app> [--cookie-domain .membego.com] [--permanente] [--via host:puerto]
 *
 * Comprueba contra un despliegue REAL que el corte `membego.com` / `app.membego.com` hace lo prometido (ver
 * `comprobaciones.ts` y `docs/F7_CORTE_POR_ANFITRION.md`). Sale con código 1 si algo falla.
 *
 *   --cookie-domain  el valor de NEXT_PUBLIC_COOKIE_DOMAIN: activa las comprobaciones de cookies compartidas y heredadas.
 *   --permanente     espera 308 en vez de 307 (cuando ANFITRIONES_REDIRECCION_PERMANENTE=1).
 *   --via            conecta a esa dirección en vez de resolver el DNS, enviando el Host y el SNI de cada origen. Sirve para
 *                    probar un servidor local con los dominios de prueba (`--via 127.0.0.1:3210`) o un despliegue antes de
 *                    cambiar el DNS.
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { comprobarCorte, resumir, type OpcionesDePeticion, type Pedir, type Respuesta } from './comprobaciones'

function analizar(argv: string[]) {
  const posicionales: string[] = []
  const opciones: { cookieDomain?: string; permanente: boolean; via?: string; ayuda: boolean } = { permanente: false, ayuda: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--permanente') opciones.permanente = true
    else if (a === '--help' || a === '-h') opciones.ayuda = true
    else if (a === '--cookie-domain') opciones.cookieDomain = argv[++i]
    else if (a === '--via') opciones.via = argv[++i]
    else if (a.startsWith('--')) throw new Error(`opción desconocida: ${a}`)
    else posicionales.push(a)
  }
  return { posicionales, ...opciones }
}

export function pedirReal(via?: string): Pedir {
  return (origen: string, ruta: string, opciones: OpcionesDePeticion = {}) =>
    new Promise<Respuesta>((resolver, rechazar) => {
      const destino = new URL(origen)
      const [hostVia, puertoVia] = via ? via.split(':') : [destino.hostname, destino.port]
      const seguro = destino.protocol === 'https:'
      const abrir = seguro ? httpsRequest : httpRequest
      const req = abrir(
        {
          host: hostVia,
          port: Number(puertoVia || (seguro ? 443 : 80)),
          path: ruta,
          method: opciones.method ?? 'GET',
          servername: destino.hostname,
          headers: { host: destino.host, 'user-agent': 'membego-corte-verificar', accept: '*/*', ...opciones.headers },
          timeout: 15_000,
        },
        (res) => {
          const partes: Buffer[] = []
          res.on('data', (d: Buffer) => partes.push(d))
          res.on('end', () => {
            const headers: Record<string, string> = {}
            for (const [k, v] of Object.entries(res.headers)) if (k !== 'set-cookie') headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
            resolver({ status: res.statusCode ?? 0, headers, setCookies: res.headers['set-cookie'] ?? [], body: Buffer.concat(partes).toString('utf8') })
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('tiempo agotado')))
      req.on('error', rechazar)
      req.end()
    })
}

async function main() {
  const { posicionales, cookieDomain, permanente, via, ayuda } = analizar(process.argv.slice(2))
  if (ayuda || posicionales.length !== 2) {
    console.log('Uso: bun run corte:verificar <origen-landing> <origen-app> [--cookie-domain .membego.com] [--permanente] [--via host:puerto]')
    process.exit(ayuda ? 0 : 2)
  }
  const [landing, app] = posicionales
  for (const o of [landing, app]) new URL(o)
  console.log(`Corte: landing ${landing} · app ${app}${via ? ` · vía ${via}` : ''}${cookieDomain ? ` · cookie ${cookieDomain}` : ''}${permanente ? ' · permanente' : ''}`)
  const { texto, fallos } = resumir(await comprobarCorte({ landing, app, dominioCookie: cookieDomain, permanente }, pedirReal(via)))
  console.log(texto)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(2)
})
