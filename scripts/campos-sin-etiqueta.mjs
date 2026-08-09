#!/usr/bin/env node
/**
 * CAMPOS DE FORMULARIO SIN NOMBRE ACCESIBLE — DS 2.0 · Fase 19.
 *
 * Un `<Input>` sin nombre se anuncia como "cuadro de edición" y nada más: quien
 * navega sin ver no puede saber qué escribir. Las dos trampas frecuentes:
 *
 *  · `placeholder` NO cuenta. Desaparece en cuanto se escribe y los lectores
 *    de pantalla no lo anuncian de forma fiable.
 *  · Un `<Label>` colocado al lado, sin `htmlFor` y sin envolver al campo,
 *    solo está asociado a la vista. Para el navegador son dos cosas sueltas.
 *
 * Vale con cualquiera de estos: `aria-label`, `aria-labelledby`, un `<Label
 * htmlFor>` que apunte a su `id`, o estar dentro de un `<label>`.
 *
 * El recorrido de atributos NO usa una regex de un solo paso: `className={cn(
 * a > b)}` o una función flecha meten `>` dentro del propio elemento y cortan
 * la captura antes de tiempo. Se equilibran llaves para encontrar el cierre
 * real — la primera versión de esto contó de más por ese motivo.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CAMPOS = /<(Input|Textarea|select)\b/g

/** Índice del `>` que cierra la etiqueta de apertura, respetando `{...}` y comillas. */
function finDeApertura(src, desde) {
  let llaves = 0
  let comilla = null
  for (let i = desde; i < src.length; i++) {
    const c = src[i]
    if (comilla) {
      if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') comilla = c
    else if (c === '{') llaves++
    else if (c === '}') llaves--
    else if (c === '>' && llaves === 0) return i
  }
  return -1
}

export function camposSinNombre(raiz = 'src') {
  const out = []
  const archivos = []
  ;(function recorrer(dir) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (p.endsWith('.tsx')) archivos.push(p)
    }
  })(raiz)

  for (const archivo of archivos) {
    const src = readFileSync(archivo, 'utf8')
    // Se recogen las DOS formas de escribir el destino: `htmlFor="email"` y
    // `htmlFor={`efectivo-${orden.id}`}`. Mirar solo la primera daba falsos
    // positivos en cada lista con ids generados, que es donde más se usan.
    const htmlFor = new Set([
      ...[...src.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/htmlFor=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => m[1].trim()),
    ])
    for (const m of src.matchAll(CAMPOS)) {
      const fin = finDeApertura(src, m.index)
      if (fin === -1) continue
      const attrs = src.slice(m.index, fin)
      if (/aria-label|aria-labelledby/.test(attrs)) continue
      const idTexto = attrs.match(/\bid="([^"]+)"/)
      if (idTexto && htmlFor.has(idTexto[1])) continue
      const idExpr = attrs.match(/\bid=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/)
      if (idExpr && htmlFor.has(idExpr[1].trim())) continue
      // `id={id}` dentro de un helper: el `<Label htmlFor>` vive en quien lo
      // llama, así que el archivo sí tiene la asociación aunque no en la misma
      // línea. Se acepta cuando el archivo declara algún `htmlFor`.
      if (idExpr && htmlFor.size > 0) continue
      // Envuelto en <label>…</label>: también nombra al campo.
      const antes = src.slice(Math.max(0, m.index - 400), m.index)
      if (/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/.test(antes)) continue
      out.push(`${archivo}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  return out
}

if (process.argv[1]?.endsWith('campos-sin-etiqueta.mjs')) {
  const lista = camposSinNombre()
  for (const x of lista) console.log(x)
  console.log(`\n${lista.length} campos sin nombre accesible.`)
}
