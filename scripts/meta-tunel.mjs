#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * META · FASE 0 — el túnel público para el webhook.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UN TÚNEL Y NO VALE `localhost`
 *
 * Meta da de alta la URL del webhook llamándola ÉL: manda un GET con
 * `hub.challenge` desde sus servidores y espera el eco. Una URL `localhost` no
 * existe para Meta, así que el alta falla antes de empezar — y sin URL dada de
 * alta no llega `account_update`, que es requisito del alta incrustada de
 * WhatsApp.
 *
 * Producción está vedada en esta rama (el compañero sigue con el diseño), así
 * que la salida es un túnel: una URL `https` pública de verdad que entrega en
 * el `next start` de esta máquina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ CLOUDFLARED Y NO OTRO
 *
 * Los túneles «rápidos» de Cloudflare dan https directo, sin cuenta y sin
 * página intermedia. Las alternativas gratuitas más comunes interponen un
 * aviso HTML en la primera visita: Meta recibiría ese HTML en vez del
 * `hub.challenge` y el alta se caería con un error que no dice nada.
 *
 * Este script NO instala nada. Si falta el binario, lo dice y se retira: en
 * esta máquina se instala con
 *
 *     winget install --id Cloudflare.cloudflared
 *
 * ────────────────────────────────────────────────────────────────────────────
 *     node scripts/meta-tunel.mjs [--puerto 3000]
 *
 * Deja la URL en `.next-qa/meta-tunel.txt` para que
 * `scripts/verificar-meta-fase0.mts` la encuentre sola. Vive mientras la
 * ventana viva: al cerrarla, la URL muere y hay que dar de alta la nueva en el
 * panel de Meta.
 */

const args = process.argv.slice(2)
function opcion(nombre, porDefecto) {
  const i = args.indexOf(`--${nombre}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto
}

const PUERTO = Number(opcion('puerto', '3000'))
const ARCHIVO_URL = join(process.cwd(), '.next-qa', 'meta-tunel.txt')

/** Dónde suele quedar `cloudflared.exe` en Windows, además del PATH. */
const CANDIDATOS = [
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
  process.env['ProgramFiles(x86)'] &&
    join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
  join(process.cwd(), '.next-qa', 'cloudflared.exe'),
].filter(Boolean)

function localizarCloudflared() {
  const enPath = spawnSync('cloudflared', ['--version'], { shell: true, stdio: 'pipe' })
  if (enPath.status === 0) return 'cloudflared'
  for (const ruta of CANDIDATOS) if (existsSync(ruta)) return ruta
  return null
}

async function puertoVivo(puerto) {
  try {
    await fetch(`http://127.0.0.1:${puerto}/`, {
      signal: AbortSignal.timeout(2500),
      redirect: 'manual',
    })
    return true
  } catch {
    return false
  }
}

const exe = localizarCloudflared()
if (!exe) {
  console.error(
    [
      'No encuentro `cloudflared` y este script no instala nada por su cuenta.',
      '',
      'Instálalo una sola vez con:',
      '',
      '    winget install --id Cloudflare.cloudflared',
      '',
      'Abre una terminal NUEVA después de instalarlo (el PATH no se refresca en',
      'las que ya estaban abiertas) y vuelve a lanzar este script.',
    ].join('\n')
  )
  process.exit(2)
}

if (!(await puertoVivo(PUERTO))) {
  console.error(
    [
      `Nada responde en http://localhost:${PUERTO}.`,
      '',
      'El túnel sin servidor detrás publica una URL que devuelve 502, y Meta',
      'rechaza el alta del webhook con ese error. Levanta antes la aplicación:',
      '',
      '    npm run build  &&  npx next start -p ' + PUERTO,
      '',
      '(o `npm run dev`, si prefieres recarga en caliente).',
    ].join('\n')
  )
  process.exit(3)
}

console.log(`Abriendo túnel hacia http://localhost:${PUERTO}…\n`)

const hijo = spawn(exe, ['tunnel', '--url', `http://localhost:${PUERTO}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: exe === 'cloudflared',
})

let anunciada = false

/**
 * cloudflared escupe la URL dentro de un recuadro de texto por la salida de
 * error. Se busca por patrón y no por número de línea: el recuadro cambia
 * entre versiones, el dominio no.
 */
function mirar(trozo) {
  const texto = trozo.toString()
  const encontrada = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  if (!encontrada || anunciada) return
  anunciada = true

  const base = encontrada[0]
  mkdirSync(join(process.cwd(), '.next-qa'), { recursive: true })
  writeFileSync(ARCHIVO_URL, base, 'utf8')

  console.log(
    [
      '',
      '═══════════════════════════════════════════════════════════════════',
      '  TÚNEL ARRIBA',
      '═══════════════════════════════════════════════════════════════════',
      '',
      `  Base pública:  ${base}`,
      '',
      '  Lo que se pega en el panel de Meta:',
      '',
      `    Webhook · URL de devolución de llamada`,
      `      ${base}/api/connect/meta/webhook`,
      '',
      `    Webhook · Token de verificación`,
      `      el valor de META_WEBHOOK_VERIFY_TOKEN de tu .env.local`,
      '      (no se imprime aquí a propósito: es un secreto)',
      '',
      `    Facebook Login for Business · Valid OAuth Redirect URI`,
      `      ${base}/api/connect/oauth/callback`,
      '',
      `    Configuración · Básica · App domains`,
      `      ${new URL(base).host}`,
      '',
      '═══════════════════════════════════════════════════════════════════',
      '',
      '  Comprueba que todo responde como Meta espera:',
      '',
      '      npm run verificar:meta-fase0',
      '',
      '  (encuentra esta URL sola; está anotada en .next-qa/meta-tunel.txt)',
      '',
      '  NO CIERRES ESTA VENTANA: al cerrarla la URL deja de existir y hay',
      '  que dar de alta la nueva en el panel. Ctrl+C para terminar.',
      '',
    ].join('\n')
  )
}

hijo.stderr.on('data', mirar)
hijo.stdout.on('data', mirar)

function despedirse() {
  // El archivo apunta a una URL que ya no entrega en ningún sitio: borrarlo
  // evita que la siguiente verificación pruebe contra un túnel muerto y
  // atribuya el fallo al código.
  rmSync(ARCHIVO_URL, { force: true })
  hijo.kill()
  process.exit(0)
}

process.on('SIGINT', despedirse)
process.on('SIGTERM', despedirse)
hijo.on('exit', (codigo) => {
  rmSync(ARCHIVO_URL, { force: true })
  process.exit(codigo ?? 0)
})
