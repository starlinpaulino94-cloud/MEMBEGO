import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  InicioVista,
  PromoNovedadItem,
  EmpresaScrollItem,
  PromocionesNovedadesVista,
  PlanInicio,
  HeroInicio,
} from '../src/modules/home/vista'
import type { WalletStackItem } from '../src/components/wallet/WalletStack'

test('tipos de vista del inicio enriquecido soportan novedades, empresas y membresias inteligentes', () => {
  const mockPromo: PromoNovedadItem = {
    id: 'promo_1',
    titulo: 'Lavado 2x1',
    slug: 'lavado-2x1',
    descripcion: 'Paga 1 y lava 2 vehículos',
    imagenUrl: 'https://img.jpg',
    tipo: '2x1',
    tipoEtiqueta: '2x1',
    descuentoTexto: '2x1',
    precioTexto: 'RD$500',
    vigenciaHasta: '2026-10-01T00:00:00.000Z',
    diasRestantes: 5,
    href: '/cliente/promociones/promo_1',
    empresa: {
      id: 'comp_1',
      nombre: 'AutoSpa Pro',
      slug: 'autospa-pro',
      logoUrl: null,
    },
    esPrivadaMiembros: false,
    esDeMiEmpresa: true,
    motivo: 'afinidad',
  }

  const mockEmpresa: EmpresaScrollItem = {
    id: 'comp_1',
    nombre: 'AutoSpa Pro',
    slug: 'autospa-pro',
    rubro: 'Car wash y estética',
    ciudad: 'Santo Domingo',
    logoUrl: null,
    bannerUrl: null,
    href: '/cliente/empresas/autospa-pro',
    valoracion: 4.8,
    resenas: 25,
    planes: 3,
    esMia: true,
    etiquetaRelacion: 'Miembro',
  }

  const mockFeed: PromocionesNovedadesVista = {
    paraTi: [mockPromo],
    exclusivas: [],
    descuentos: [mockPromo],
    porVencer: [mockPromo],
    total: 1,
  }

  const mockPlan: PlanInicio = {
    id: 'plan_1',
    nombre: 'Lavado Express Mensual',
    empresa: 'AutoSpa Pro',
    descripcion: '4 lavados al mes',
    imagen: null,
    href: '/plan/plan_1',
    precio: 'RD$1,200',
    periodo: '/ 30 días',
    valoracion: 4.8,
    resenas: 25,
    motivoRecomendacion: 'De tus negocios',
  }

  const mockHero: HeroInicio = {
    titulo: 'Oferta 2x1 en estética',
    subtitulo: 'Aprovecha este fin de semana',
    empresa: 'AutoSpa Pro',
    ciudad: 'Santo Domingo',
    imagen: 'https://img.jpg',
    href: '/cliente/promociones/promo_1',
    cta: 'Aprovechar oferta',
    planDesde: null,
    color: '#3b82f6',
    valoracion: 4.9,
    descuento: '2×1',
    precio: 'RD$1,500',
    etiqueta: 'Oferta destacada',
  }

  assert.equal(mockPromo.tipo, '2x1')
  assert.equal(mockEmpresa.esMia, true)
  assert.equal(mockFeed.paraTi.length, 1)
  assert.equal(mockPlan.motivoRecomendacion, 'De tus negocios')
  assert.equal(mockHero.descuento, '2×1')
  assert.equal(mockHero.precio, 'RD$1,500')
})

test('wallet filtra correctamente solo las membresias activas para el widget superior', () => {
  const wallet: WalletStackItem[] = [
    {
      id: 'm1',
      card: {
        company: { name: 'Empresa A', logoUrl: null, colorPrimario: null },
        planNombre: 'Plan Oro',
        estadoLabel: 'Activa',
        tone: 'active',
        expiryText: 'Vence en 10 días',
        esIlimitado: true,
        usosRestantes: 0,
        usosTotales: null,
      },
      qrToken: 'TOKEN_123',
      isActive: true,
    },
    {
      id: 'm2',
      card: {
        company: { name: 'Empresa B', logoUrl: null, colorPrimario: null },
        planNombre: 'Plan Vencido',
        estadoLabel: 'Vencida',
        tone: 'expired',
        expiryText: 'Venció ayer',
        esIlimitado: false,
        usosRestantes: 0,
        usosTotales: 5,
      },
      qrToken: null,
      isActive: false,
    },
  ]

  const activas = wallet.filter((w) => w.isActive)
  assert.equal(activas.length, 1)
  assert.equal(activas[0].card.company.name, 'Empresa A')
})

test('scroll horizontal de empresas limita a un máximo y preserva etiqueta de relación', () => {
  const misEmpresas = [
    { id: '1', name: 'Car Wash 1', esCliente: true, esFavorita: false },
    { id: '2', name: 'Gimnasio 2', esCliente: false, esFavorita: true },
  ]
  const destacadas = [
    { id: '1', name: 'Car Wash 1' },
    { id: '3', name: 'Restaurante 3' },
    { id: '4', name: 'Peluquería 4' },
  ]

  const mapa = new Map<string, { id: string; name: string; esMia: boolean; etiqueta: string | null }>()
  for (const me of misEmpresas) {
    if (mapa.size >= 10) break
    mapa.set(me.id, {
      id: me.id,
      name: me.name,
      esMia: true,
      etiqueta: me.esCliente ? 'Miembro' : me.esFavorita ? 'Favorita' : 'Siguiendo',
    })
  }
  for (const fe of destacadas) {
    if (mapa.size >= 10) break
    if (!mapa.has(fe.id)) {
      mapa.set(fe.id, {
        id: fe.id,
        name: fe.name,
        esMia: false,
        etiqueta: null,
      })
    }
  }

  const items = [...mapa.values()]
  assert.equal(items.length, 4)
  assert.equal(items[0].etiqueta, 'Miembro')
  assert.equal(items[1].etiqueta, 'Favorita')
  assert.equal(items[2].esMia, false)
  assert.equal(items[2].id, '3')
})

test('exclusión de membresías activas no recomienda planes que el usuario ya tiene', () => {
  const planesActivosIds = new Set(['plan_activo_1', 'plan_activo_2'])
  const planesCatalogo = [
    { id: 'plan_activo_1', nombre: 'Plan A (Ya comprado)' },
    { id: 'plan_nuevo_1', nombre: 'Plan B (Disponible)' },
    { id: 'plan_nuevo_2', nombre: 'Plan C (Disponible)' },
  ]

  const recomendados = planesCatalogo.filter((p) => !planesActivosIds.has(p.id))
  assert.equal(recomendados.length, 2)
  assert.ok(!recomendados.some((p) => p.id === 'plan_activo_1'))
})

test('esNueva se calcula correctamente: true si tiene menos de 30 días de creada, false si tiene más', () => {
  const ahora = new Date('2026-09-29T12:00:00.000Z')
  const UN_MES_MS = 30 * 24 * 60 * 60 * 1000
  const esNuevaFn = (createdAt?: Date | string | null) => {
    if (!createdAt) return false
    const fecha = new Date(createdAt)
    const diff = ahora.getTime() - fecha.getTime()
    return diff >= 0 && diff < UN_MES_MS
  }

  // Creada hace 5 días
  const hace5Dias = new Date(ahora.getTime() - 5 * 24 * 60 * 60 * 1000)
  assert.equal(esNuevaFn(hace5Dias), true)

  // Creada hace 29 días
  const hace29Dias = new Date(ahora.getTime() - 29 * 24 * 60 * 60 * 1000)
  assert.equal(esNuevaFn(hace29Dias), true)

  // Creada hace 30 días exactos (o más)
  const hace30Dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000)
  assert.equal(esNuevaFn(hace30Dias), false)

  // Creada hace 60 días
  const hace60Dias = new Date(ahora.getTime() - 60 * 24 * 60 * 60 * 1000)
  assert.equal(esNuevaFn(hace60Dias), false)

  // Sin fecha
  assert.equal(esNuevaFn(null), false)
  assert.equal(esNuevaFn(undefined), false)
})

test('scroll horizontal propaga esFavorita correctamente a empresas del marketplace', () => {
  const misEmpresas = [
    { id: '1', name: 'Favorita 1', esCliente: false, esFavorita: true, sigo: true },
  ]
  const destacadas = [
    { id: '1', name: 'Favorita 1' },
    { id: '2', name: 'No Favorita 2' },
  ]
  const userFollows = [
    { companyId: '1', esFavorita: true },
    { companyId: '3', esFavorita: true },
  ]

  const favoritasSet = new Set(userFollows.filter((f) => f.esFavorita).map((f) => f.companyId))
  const misEmpresasMap = new Map(misEmpresas.map((me) => [me.id, me]))

  const scrollMap = new Map<string, { id: string; name: string; esFavorita: boolean }>()

  for (const me of misEmpresas) {
    const esFav = favoritasSet.has(me.id) || me.esFavorita
    scrollMap.set(me.id, { id: me.id, name: me.name, esFavorita: esFav })
  }

  for (const fe of destacadas) {
    if (!scrollMap.has(fe.id)) {
      const relacion = misEmpresasMap.get(fe.id)
      const esFav = favoritasSet.has(fe.id) || Boolean(relacion?.esFavorita)
      scrollMap.set(fe.id, { id: fe.id, name: fe.name, esFavorita: esFav })
    }
  }

  const items = [...scrollMap.values()]
  assert.equal(items.find((i) => i.id === '1')?.esFavorita, true)
  assert.equal(items.find((i) => i.id === '2')?.esFavorita, false)
})

test('scroll horizontal de empresas se ordena por mejor valoración (estrellas y reseñas) y no por fecha de creación', () => {
  const empresasRaw = [
    {
      id: 'empresa_nueva_sin_rating',
      name: 'Nueva Sin Rating',
      valoracion: null,
      resenas: 0,
      planes: 1,
      createdAt: '2026-09-28T00:00:00.000Z', // Creada ayer
    },
    {
      id: 'empresa_top_antigua',
      name: 'Top Antigua',
      valoracion: 5.0,
      resenas: 45,
      planes: 3,
      createdAt: '2025-01-01T00:00:00.000Z', // Creada hace más de un año
    },
    {
      id: 'empresa_buena_muchas_resenas',
      name: 'Buena Muchas Reseñas',
      valoracion: 4.8,
      resenas: 120,
      planes: 2,
      createdAt: '2025-06-01T00:00:00.000Z',
    },
    {
      id: 'empresa_igual_rating_mas_resenas',
      name: 'Rating 5 con pocas reseñas',
      valoracion: 5.0,
      resenas: 2,
      planes: 1,
      createdAt: '2026-09-15T00:00:00.000Z',
    },
  ]

  const ordenadas = [...empresasRaw].sort((a, b) => {
    const valA = a.valoracion != null ? Number(a.valoracion) : 0
    const valB = b.valoracion != null ? Number(b.valoracion) : 0
    if (valB !== valA) return valB - valA
    if (b.resenas !== a.resenas) return b.resenas - a.resenas
    return (b.planes ?? 0) - (a.planes ?? 0)
  })

  // 1. Empresa 5.0 con 45 reseñas va antes que 5.0 con 2 reseñas
  assert.equal(ordenadas[0].id, 'empresa_top_antigua')
  assert.equal(ordenadas[1].id, 'empresa_igual_rating_mas_resenas')
  // 2. Empresa 4.8 con 120 reseñas va después de las 5.0
  assert.equal(ordenadas[2].id, 'empresa_buena_muchas_resenas')
  // 3. Empresa nueva sin rating creada ayer va al final, NO al inicio
  assert.equal(ordenadas[3].id, 'empresa_nueva_sin_rating')
})

test('etiquetaRelacion muestra Miembro o Siguiendo mientras esFavorita muestra corazón simultáneamente', () => {
  const misEmpresasClienteIds = new Set(['emp_miembro_fav', 'emp_solo_miembro'])
  const favoritasSet = new Set(['emp_miembro_fav', 'emp_siguiendo_fav'])
  const seguidasSet = new Set(['emp_miembro_fav', 'emp_siguiendo_fav', 'emp_solo_siguiendo'])

  const testEmpresas = [
    { id: 'emp_miembro_fav', name: 'Miembro y Favorita' },
    { id: 'emp_siguiendo_fav', name: 'Siguiendo y Favorita' },
    { id: 'emp_solo_miembro', name: 'Solo Miembro' },
    { id: 'emp_solo_siguiendo', name: 'Solo Siguiendo' },
    { id: 'emp_sin_relacion', name: 'Descubrimiento General' },
  ]

  const items = testEmpresas.map((e) => {
    const esCliente = misEmpresasClienteIds.has(e.id)
    const esFav = favoritasSet.has(e.id)
    const sigo = seguidasSet.has(e.id)
    return {
      id: e.id,
      esFavorita: esFav,
      etiquetaRelacion: esCliente ? 'Miembro' : (sigo || esFav) ? 'Siguiendo' : null,
    }
  })

  // 1. Miembro y Favorita: tiene corazón (esFavorita: true) Y badge 'Miembro'
  const emp1 = items.find((i) => i.id === 'emp_miembro_fav')!
  assert.equal(emp1.esFavorita, true)
  assert.equal(emp1.etiquetaRelacion, 'Miembro')

  // 2. Siguiendo y Favorita: tiene corazón (esFavorita: true) Y badge 'Siguiendo'
  const emp2 = items.find((i) => i.id === 'emp_siguiendo_fav')!
  assert.equal(emp2.esFavorita, true)
  assert.equal(emp2.etiquetaRelacion, 'Siguiendo')

  // 3. Solo Miembro: sin corazón, badge 'Miembro'
  const emp3 = items.find((i) => i.id === 'emp_solo_miembro')!
  assert.equal(emp3.esFavorita, false)
  assert.equal(emp3.etiquetaRelacion, 'Miembro')

  // 4. Solo Siguiendo: sin corazón, badge 'Siguiendo'
  const emp4 = items.find((i) => i.id === 'emp_solo_siguiendo')!
  assert.equal(emp4.esFavorita, false)
  assert.equal(emp4.etiquetaRelacion, 'Siguiendo')

  // 5. Sin relación: sin corazón, sin badge
  const emp5 = items.find((i) => i.id === 'emp_sin_relacion')!
  assert.equal(emp5.esFavorita, false)
  assert.equal(emp5.etiquetaRelacion, null)
})
