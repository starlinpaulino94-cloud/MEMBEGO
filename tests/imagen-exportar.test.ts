import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matrizDeExportacion, type Matriz } from '../src/lib/imagen/exportar'
import { recorteDesde, zoomMinimo, type Encuadre } from '../src/lib/imagen/formatos'

/** Aplica la matriz de `ctx.setTransform` a un punto. */
const aplicar = ([a, b, c, d, e, f]: Matriz, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f]
const cerca = (p: [number, number], q: [number, number], eps = 1e-6) => {
  assert.ok(Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps, `(${p}) ≉ (${q})`)
}
const enc = (e: Partial<Encuadre>): Encuadre => ({ x: 0, y: 0, w: 1000, h: 1000, giro: 0, fondo: '#ffffff', ...e })

test('sin giro: el recorte se lleva al lienzo escalado', () => {
  // Foto 2000×1000, recorte cuadrado de 1000 a partir de x=500, salida 600.
  const m = matrizDeExportacion(2000, 1000, enc({ x: 500, y: 0, w: 1000, h: 1000 }), 600)
  cerca(aplicar(m, 500, 0), [0, 0]) // esquina del recorte → esquina del lienzo
  cerca(aplicar(m, 1500, 1000), [600, 600]) // esquina opuesta
  cerca(aplicar(m, 1000, 500), [300, 300]) // centro
})

test('giro 90°: la esquina superior izquierda de la foto pasa a la superior DERECHA', () => {
  // Foto 400×200 girada 90° es 200×400. Recorte = toda la foto girada (200×400 → aquí 200×200 cuadrado arriba).
  const m = matrizDeExportacion(400, 200, enc({ x: 0, y: 0, w: 200, h: 200, giro: 90 }), 200)
  cerca(aplicar(m, 0, 0), [200, 0]) // (0,0) de la foto → arriba a la derecha
  cerca(aplicar(m, 0, 200), [0, 0]) // abajo-izquierda de la foto → arriba a la izquierda
  cerca(aplicar(m, 200, 0), [200, 200]) // x crece hacia abajo
})

test('giro 180° y 270° llevan los puntos donde les toca', () => {
  const m180 = matrizDeExportacion(400, 200, enc({ x: 0, y: 0, w: 400, h: 400, giro: 180 }), 400)
  cerca(aplicar(m180, 0, 0), [400, 200])
  cerca(aplicar(m180, 400, 200), [0, 0])
  // 270°: foto 400×200 → 200×400. (0,0) → u = y = 0, v = ancho - x = 400.
  const m270 = matrizDeExportacion(400, 200, enc({ x: 0, y: 0, w: 200, h: 200, giro: 270 }), 200)
  cerca(aplicar(m270, 0, 0), [0, 400])
  cerca(aplicar(m270, 400, 0), [0, 0])
})

test('foto alejada: el recorte negativo la deja dentro del lienzo con márgenes', () => {
  // Foto 3000×2000, marco 3000×3000 alejado al máximo, salida 600 (escala 0,2).
  const z = zoomMinimo(3000, 2000, 1)
  const r = recorteDesde(3000, 2000, 1, z)
  const m = matrizDeExportacion(3000, 2000, enc({ ...r }), 600)
  cerca(aplicar(m, 0, 0), [0, 100]) // la foto empieza 100 px más abajo (500 px × 0,2)
  cerca(aplicar(m, 3000, 2000), [600, 500]) // y termina 100 px antes del fondo
})

test('la matriz coincide con lo que genera el servidor: mismo punto de la foto, mismo píxel', () => {
  // Servidor: rota la foto, toma el rectángulo y lo escala a `salida`. Cliente: esta matriz. Para cualquier giro,
  // el centro del recorte debe caer en el centro del lienzo.
  for (const giro of [0, 90, 180, 270] as const) {
    const ancho = 2400
    const alto = 1600
    const dims = giro === 90 || giro === 270 ? { ancho: alto, alto: ancho } : { ancho, alto }
    const r = recorteDesde(dims.ancho, dims.alto, 1, 1.5, 0.4, 0.6)
    const m = matrizDeExportacion(ancho, alto, enc({ ...r, giro }), 800)
    // Centro del recorte en el sistema girado → inverso a la foto sin girar:
    const [cu, cv] = [r.x + r.w / 2, r.y + r.h / 2]
    const inverso: Record<number, [number, number]> = {
      0: [cu, cv],
      90: [cv, alto - cu],
      180: [ancho - cu, alto - cv],
      270: [ancho - cv, cu],
    }
    const [x, y] = inverso[giro]
    cerca(aplicar(m, x, y), [400, 400], 1e-6)
  }
})
