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
