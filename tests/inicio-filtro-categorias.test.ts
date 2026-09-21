import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

test('InicioVista incluye el campo categoriaActiva', () => {
  const vista = leer('src/modules/home/vista.ts')
  assert.match(
    vista,
    /readonly categoriaActiva\?: string \| null/,
    'InicioVista debe exponer categoriaActiva opcional para la UI'
  )
})

test('getInicioVista admite categoriaSlug como segundo argumento y lo refleja', () => {
  const lectura = leer('src/modules/home/lectura.ts')
  assert.match(
    lectura,
    /export async function getInicioVista\(\s*user:\s*SessionUser,\s*categoriaSlug\?: string\s*\)/,
    'getInicioVista debe admitir categoriaSlug opcional'
  )
  assert.match(
    lectura,
    /categoriaActiva:\s*categoriaSlug \?\? null/,
    'getInicioVista debe propagar categoriaActiva en el resultado'
  )
})

test('VibeCategorias redirige al Inicio (/cliente/inicio) y no a /cliente/explorar', () => {
  const comp = leer('src/components/cliente/inicio/VibeCategorias.tsx')
  assert.doesNotMatch(
    comp,
    /href="\/cliente\/explorar"/,
    'VibeCategorias no debe enviar a /cliente/explorar en "Todos"'
  )
  assert.doesNotMatch(
    comp,
    /href=\{`\/cliente\/explorar\?category=/,
    'VibeCategorias no debe enviar a /cliente/explorar en cada categoría'
  )
  assert.match(
    comp,
    /\/cliente\/inicio/,
    'VibeCategorias debe enlazar al Inicio'
  )
  assert.match(
    comp,
    /scroll=\{false\}/,
    'VibeCategorias debe usar scroll={false} para evitar saltos al filtrar'
  )
})

test('InicioCliente (page.tsx) lee searchParams y los pasa a getInicioVista', () => {
  const page = leer('src/app/(cliente)/cliente/inicio/page.tsx')
  assert.match(
    page,
    /searchParams/,
    'InicioCliente debe aceptar searchParams'
  )
  assert.match(
    page,
    /getInicioVista\(user,\s*categoria\)/,
    'InicioCliente debe pasar la categoría a getInicioVista'
  )
})

test('InicioComercial propaga categoriaActiva a los bloques hijos', () => {
  const comp = leer('src/components/cliente/inicio/InicioComercial.tsx')
  assert.match(
    comp,
    /categoriaActiva=\{data\.categoriaActiva\}/,
    'InicioComercial debe pasar categoriaActiva a los componentes'
  )
})

test('VibeEmpresasScroll y VibeRelacionado propagan la categoría a sus enlaces Ver más', () => {
  const empresas = leer('src/components/cliente/inicio/VibeEmpresasScroll.tsx')
  assert.match(
    empresas,
    /\/cliente\/explorar\?category=/,
    'VibeEmpresasScroll debe enlazar con category si está filtrado'
  )

  const planes = leer('src/components/cliente/inicio/VibeRelacionado.tsx')
  assert.match(
    planes,
    /\/cliente\/planes\?todos=1&categoria=/,
    'VibeRelacionado debe enlazar con categoria si está filtrado'
  )
})
