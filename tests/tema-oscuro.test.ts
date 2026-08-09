import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * GUARDIA DEL TEMA OSCURO.
 *
 * El tema por defecto de MembeGo es OSCURO. Usar blanco no es el error —un
 * ticket impreso, el fondo de un QR o un botón sobre un degradado de marca
 * deben ser blancos—. El error es MEZCLAR las dos capas dentro de una misma
 * pantalla: una superficie blanca fija con texto de token (que en oscuro es
 * casi blanco) queda ilegible, y una superficie de token con texto slate fijo
 * también.
 *
 * La comprobación es POR ARCHIVO a propósito: en JSX la superficie casi nunca
 * está en la misma línea que el texto que la habita (la tarjeta es un <div> y
 * el texto un <p> anidado). Mirar línea por línea deja pasar justo el caso
 * real. Cada archivo que legítimamente mezcla ambos mundos se declara aquí con
 * su motivo — así, mezclar deja de ser un descuido y pasa a ser una decisión.
 */

const RAICES = ['src', 'packages/ui/src']

/** Superficie clara fija. `bg-white/40` es un velo sobre otro fondo: no cuenta. */
const BLANCO_SOLIDO = /\bbg-white(?![/\w-])/
/** Texto que cambia con el tema: en oscuro es claro. */
const TEXTO_DE_TOKEN = /\btext-(foreground|muted-foreground|card-foreground)\b/
/** Superficie que cambia con el tema: en oscuro es casi negra. */
const SUPERFICIE_DE_TOKEN = /\bbg-(card|background|popover|muted)(?![/\w-])/
/** Texto oscuro fijo: solo legible sobre claro. */
const TEXTO_OSCURO_FIJO = /\btext-(slate|neutral|gray|zinc|stone)-(700|800|900)\b|\btext-black\b/

/** Archivos donde la mezcla es intencional, con el porqué. */
const DECLARADOS = new Map<string, string>([
  // Impresión: el papel es blanco pase lo que pase.
  ['src/components/caja/CierreCajaDialog.tsx', 'ticket impreso'],
  ['src/components/caja/ReporteDiaDialog.tsx', 'ticket impreso'],
  ['src/components/facturas/FacturaPrintDialog.tsx', 'comprobante impreso'],
  ['src/components/scanner/ComprobanteReceipt.tsx', 'comprobante impreso'],
  ['src/components/admin/ReceiptTemplateEditor.tsx', 'vista previa del ticket impreso'],
  ['src/app/(admin)/admin/registros/page.tsx', 'reporte imprimible'],
  // QR: el lector necesita blanco real detrás del código.
  ['src/components/cliente/IdMembegoCard.tsx', 'fondo del QR'],
  ['src/components/admin/CompanyQRRegistro.tsx', 'fondo del QR'],
  ['src/components/wallet/WalletStack.tsx', 'reverso de la tarjeta con el QR'],
  // Superficie sobre un degradado de marca, que siempre es oscuro.
  ['src/components/cliente/FeedNovedades.tsx', 'CTA sobre degradado de marca'],
  ['src/components/engagement/MarketingCampaignForm.tsx', 'vista previa sobre degradado'],
  ['src/components/engagement/Gamificacion.tsx', 'barra de progreso sobre degradado'],
  // PromotionCard salió de aquí en la Fase 4: sus chips pasaron de `bg-white/90`
  // a `bg-card/90`, que se adapta al tema. Ya no mezcla capas.
  // Terceros y controles con blanco funcional.
  ['src/components/membresia/PagoTarjetaCardnet.tsx', 'marco del formulario de CardNET'],
  ['src/components/membresia/PagoTokenCardnet.tsx', 'perilla del interruptor'],
  // Piezas públicas con paleta clara propia y completa. (FacturaSheet,
  // ReceiptTicket y CampanaLanding NO están aquí: usan blanco fijo CON texto
  // oscuro fijo, que es una pareja coherente y la guardia no la señala.)
  ['src/app/(cliente)/cliente/invita-y-gana/page.tsx', 'sección festiva de tema claro'],
])

function archivosTsx(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTsx(ruta, salida)
    else if (ruta.endsWith('.tsx')) salida.push(ruta)
  }
  return salida
}

/** Contenido del archivo sin las líneas que ya declaran su variante `dark:`. */
function cuerpoSinVariantes(ruta: string): string {
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .filter((l) => !l.includes('dark:'))
    .join('\n')
}

function mezclas(a: RegExp, b: RegExp): string[] {
  const encontrados: string[] = []
  for (const raiz of RAICES) {
    for (const archivo of archivosTsx(raiz)) {
      const ruta = archivo.replace(/\\/g, '/')
      if (DECLARADOS.has(ruta)) continue
      const cuerpo = cuerpoSinVariantes(archivo)
      if (a.test(cuerpo) && b.test(cuerpo)) encontrados.push(ruta)
    }
  }
  return encontrados.sort()
}

test('ningún archivo nuevo mezcla superficie blanca fija con texto del tema', () => {
  const fallos = mezclas(BLANCO_SOLIDO, TEXTO_DE_TOKEN)
  assert.deepEqual(
    fallos,
    [],
    'En tema oscuro ese texto es claro sobre blanco (ilegible). Usa bg-card / ' +
      'bg-background, o declara el archivo en DECLARADOS con su motivo:\n' +
      fallos.join('\n')
  )
})

test('ningún archivo nuevo mezcla superficie del tema con texto oscuro fijo', () => {
  const fallos = mezclas(SUPERFICIE_DE_TOKEN, TEXTO_OSCURO_FIJO)
  assert.deepEqual(
    fallos,
    [],
    'En tema oscuro ese texto desaparece sobre la superficie. Usa ' +
      'text-foreground / text-muted-foreground, o declara el motivo:\n' +
      fallos.join('\n')
  )
})

test('la guardia detecta de verdad una mezcla (prueba de la prueba)', () => {
  // Una guardia que no se puede ver fallar no protege nada: se comprueba con
  // un archivo declarado, quitándolo de la lista para exigir que salte.
  const declarado = 'src/components/cliente/IdMembegoCard.tsx'
  const motivo = DECLARADOS.get(declarado)
  assert.ok(motivo, 'el archivo de referencia debe seguir declarado')

  DECLARADOS.delete(declarado)
  try {
    assert.ok(
      mezclas(BLANCO_SOLIDO, TEXTO_DE_TOKEN).includes(declarado),
      'la guardia debería señalar el archivo al quitarle la exención'
    )
  } finally {
    DECLARADOS.set(declarado, motivo!)
  }
})

test('todo lo declarado existe y sigue mezclando', () => {
  for (const [archivo, motivo] of DECLARADOS) {
    assert.doesNotThrow(() => statSync(archivo), `Declarado inexistente (${motivo}): ${archivo}`)
    const cuerpo = cuerpoSinVariantes(archivo)
    const mezcla =
      (BLANCO_SOLIDO.test(cuerpo) && TEXTO_DE_TOKEN.test(cuerpo)) ||
      (SUPERFICIE_DE_TOKEN.test(cuerpo) && TEXTO_OSCURO_FIJO.test(cuerpo))
    // Una exención que ya no aplica es ruido que tapará el próximo error real.
    assert.ok(mezcla, `Exención sobrante (${motivo}): ${archivo} ya no mezcla; bórrala`)
  }
})
