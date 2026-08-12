import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COLAS_TICKET } from '../src/lib/soporte'

/**
 * PANEL DE PLATAFORMA — coherencia y sistema (DS 2.0 · Fase 16).
 *
 * Los avisos de "Salud de la plataforma" son números que llevan a una pantalla.
 * Cuando el número y su destino cuentan cosas distintas, el aviso deja de ser
 * un aviso: se convierte en algo que hay que verificar a mano cada vez.
 *
 * Pasó de verdad. La Fase 15 hizo que la bandeja de tickets abriera en la cola
 * "Te toca a ti" (NUEVO + EN_PROCESO), pero el panel seguía contando también
 * ESPERANDO_CLIENTE: decía "7 tickets abiertos" y al pulsar aparecían 5. Nada
 * fallaba, y por eso habría durado.
 */

const AREA = join('src', 'app', '(superadmin)')

function paginas(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) paginas(ruta, acc)
    else if (ruta.endsWith('.tsx')) acc.push(ruta)
  }
  return acc
}

test('el aviso de tickets cuenta la misma cola que abre su destino', () => {
  // Los datos del panel salen de este módulo, no del archivo de la página: se
  // separaron para que todo se lea en UNA transacción (antes la página llamaba,
  // desde dentro de la suya, a funciones que abrían otra).
  const src = readFileSync(join('src', 'modules', 'superadmin', 'panel.ts'), 'utf8')
  assert.ok(
    src.includes('COLAS_TICKET.pendientes'),
    'el panel debe contar COLAS_TICKET.pendientes, no una lista de estados a mano: ' +
      'si se escriben aparte, la bandeja y el aviso se separan sin dar error'
  )
  // Y la cola tiene que seguir siendo la que la bandeja abre por defecto.
  assert.deepEqual([...COLAS_TICKET.pendientes], ['NUEVO', 'EN_PROCESO'])
})

/**
 * Y EL AVISO NO PUEDE SACARTE DEL PANEL.
 *
 * «Tickets abiertos» llevaba a `/admin/tickets`, que es el panel de EMPRESA: la
 * barra lateral cambiaba entera al pulsar un aviso del panel de plataforma.
 * La bandeja es la misma pantalla (`BandejaTickets`) montada en las dos rutas,
 * así que no hay motivo para cruzar de contexto.
 */
test('los avisos del panel de plataforma llevan a rutas del propio panel', () => {
  const src = readFileSync(join(AREA, 'superadmin', 'dashboard', 'page.tsx'), 'utf8')
  const fuera = [...src.matchAll(/href="(\/admin\/[^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(
    fuera,
    [],
    'el Centro de control no debe enlazar al panel de empresa: ' + fuera.join(', ')
  )
})

test('el panel de plataforma no baja del suelo tipográfico', () => {
  // El área quedó a cero en la Fase 16; aquí la exigencia ya no es un techo.
  for (const f of paginas(AREA)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      assert.ok(
        Number(m[1]) >= 12,
        `${f} usa ${m[0]}; el panel de plataforma ya está migrado y no puede volver a bajar`
      )
    }
  }
})

test('los estados se pintan con tokens, no con colores literales', () => {
  // `emerald-600 dark:emerald-400` era el patrón: el color semántico escrito a
  // mano, con su modo oscuro repetido. Aquí el color ES el dato —¿esto está
  // sano?—, así que dos pantallas no pueden decir "todo normal" en verdes
  // distintos.
  const prohibidos = /\b(?:text|bg|border|ring)-(?:emerald|green|teal|red|amber)-\d{3}\b/
  const infractores: string[] = []
  for (const f of paginas(AREA)) {
    const src = readFileSync(f, 'utf8')
    const m = src.match(prohibidos)
    if (m) infractores.push(`${f}: ${m[0]}`)
  }
  assert.deepEqual(
    infractores,
    [],
    'usa los tokens semánticos (success / warning / destructive / info):\n' +
      infractores.join('\n')
  )
})

test('las fechas pasan por el formateador del sistema', () => {
  // Un `Intl.DateTimeFormat` a mano clava locale y zona horaria en el archivo:
  // el servidor corre en UTC, así que quien lo olvide publica horas movidas.
  const infractores: string[] = []
  for (const f of paginas(AREA)) {
    const src = readFileSync(f, 'utf8')
    if (/new Intl\.DateTimeFormat|toLocaleDateString\(/.test(src)) infractores.push(f)
  }
  assert.deepEqual(infractores, [], 'usa `formatDate` / `formatDateTime` de @/lib/format')
})
