import { test, expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo } from './catalogo-arnes'

/**
 * EDITOR DE ENCUADRE · lo que se SUBE es la imagen final.
 *
 * Elegir una foto abre el editor y, en las secciones que no guardan el
 * original (aquí, el formulario de planes), la imagen que viaja a Storage es la
 * pintada en un lienzo: WebP, del tamaño único de la sección, con el encuadre y
 * el giro elegidos. Se intercepta la subida y se comprueban los BYTES: es la
 * única forma de saber que el lienzo hace lo que dice el editor.
 *
 * Entra con una sesión firmada localmente (ver `supply-v2-sesion.ts`) y no
 * necesita Supabase: la subida a Storage se responde desde la propia prueba.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)

/** Mitad izquierda roja, mitad derecha azul: se nota hacia dónde quedó cada lado. */
async function mitades(ancho: number, alto: number): Promise<Buffer> {
  const izq = await sharp({ create: { width: ancho / 2, height: alto, channels: 3, background: '#ff0000' } }).png().toBuffer()
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#0000ff' } })
    .composite([{ input: izq, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

async function abrirEditor(p: Page, buffer: Buffer) {
  await p.locator('input[type=file]').first().setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer })
  await expect(p.getByRole('heading', { name: 'Encuadra tu foto' })).toBeVisible({ timeout: 20_000 })
  await expect(p.getByRole('status')).toBeVisible({ timeout: 20_000 })
}

const pixel = (d: { data: Buffer; info: { width: number; height: number; channels: number } }, fx: number, fy: number) => {
  const x = Math.floor(d.info.width * fx)
  const y = Math.floor(d.info.height * fy)
  const i = (y * d.info.width + x) * d.info.channels
  return [d.data[i], d.data[i + 1], d.data[i + 2]]
}

test.describe('Editor de imágenes · lo que se sube', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('el plan sube un WebP 16:9 de 1600×900 con el encuadre y el giro elegidos', async ({ browser }) => {
    test.setTimeout(120_000)
    const con = await empresaCatalogo(sufijo, 'edi', { capacidad: true })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    const subidas: Buffer[] = []
    await p.route('**/storage/v1/object/**', async (ruta) => {
      const req = ruta.request()
      if (req.method() === 'POST' || req.method() === 'PUT') {
        const cuerpo = req.postDataBuffer()
        if (cuerpo) subidas.push(cuerpo)
      }
      await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'promociones/x', Id: 'x' }) })
    })
    // El cuerpo es un multipart: el archivo empieza donde empieza el RIFF del WebP.
    const leerSubida = async (cuerpo: Buffer) => sharp(cuerpo.subarray(cuerpo.indexOf(Buffer.from('RIFF')))).raw().toBuffer({ resolveWithObject: true })

    // 1) Sin tocar nada: la foto ya es 16:9, sale igual y a 1600×900.
    await p.goto('/admin/planes/nuevo')
    await abrirEditor(p, await mitades(1600, 900))
    await p.getByRole('button', { name: 'Aplicar y subir' }).click()
    await expect.poll(() => subidas.length, { timeout: 20_000 }).toBeGreaterThan(0)
    const plano = await leerSubida(subidas[0])
    expect([plano.info.width, plano.info.height]).toEqual([1600, 900])
    expect(pixel(plano, 0.25, 0.5)[0]).toBeGreaterThan(200) // rojo a la izquierda
    expect(pixel(plano, 0.75, 0.5)[2]).toBeGreaterThan(200) // azul a la derecha

    // 2) Girada 90° a la derecha, la mitad roja (la izquierda) queda ARRIBA.
    subidas.length = 0
    await p.goto('/admin/planes/nuevo')
    await abrirEditor(p, await mitades(1600, 900))
    await p.getByRole('button', { name: 'Girar a la derecha' }).click()
    await p.getByRole('button', { name: 'Aplicar y subir' }).click()
    await expect.poll(() => subidas.length, { timeout: 20_000 }).toBeGreaterThan(0)
    const girada = await leerSubida(subidas[0])
    expect([girada.info.width, girada.info.height]).toEqual([1600, 900])
    expect(pixel(girada, 0.5, 0.05)[0]).toBeGreaterThan(200)
    expect(pixel(girada, 0.5, 0.95)[2]).toBeGreaterThan(200)

    // 3) Alejada hasta ver la foto entera: la foto cuadrada queda en el centro y los lados son del color de fondo.
    subidas.length = 0
    await p.goto('/admin/planes/nuevo')
    await abrirEditor(p, await mitades(1000, 1000))
    await p.getByRole('slider', { name: 'Nivel de zoom' }).evaluate((el: HTMLInputElement) => {
      const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      poner.call(el, el.min)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await p.getByRole('button', { name: 'Aplicar y subir' }).click()
    await expect.poll(() => subidas.length, { timeout: 20_000 }).toBeGreaterThan(0)
    const alejada = await leerSubida(subidas[0])
    expect([alejada.info.width, alejada.info.height]).toEqual([1600, 900])
    expect(pixel(alejada, 0.03, 0.5).every((c) => c > 240), 'a los lados queda el fondo blanco').toBe(true)
    expect(pixel(alejada, 0.44, 0.5)[0]).toBeGreaterThan(200) // la foto, entera, en el centro: rojo...
    expect(pixel(alejada, 0.56, 0.5)[2]).toBeGreaterThan(200) // ...y azul
  })
})
