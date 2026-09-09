import { conEmpresa } from '@/lib/tenant'
import { formatMoney } from '@/lib/format'
import type { HeroSlide } from './esquema'
import type { HeroInicio } from './vista'

export async function heroPublico(companyId: string, slide: HeroSlide): Promise<HeroInicio | null> {
  if (slide.empresaId !== companyId) return null
  return conEmpresa(companyId, async (tx) => {
    const empresa = await tx.company.findFirst({
      where: { id: companyId, isActive: true, isPublished: true, esDemo: false },
      select: {
        name: true, slug: true, bannerUrl: true, logoUrl: true, galleryImages: true,
        // El diseño pone la ciudad como sello sobre el hero y una fila
        // «Planes desde …» bajo el texto. Las dos salen de aquí.
        ciudad: true, moneda: true, idioma: true, colorPrimario: true,
      },
    })
    if (!empresa) return null
    const barato = await tx.plan.findFirst({
      where: { companyId, activo: true },
      orderBy: { precio: 'asc' },
      select: { precio: true, vigenciaDias: true },
    })
    const planDesde = barato
      ? `Planes desde ${formatMoney(Number(barato.precio), empresa)} / ${barato.vigenciaDias} días`
      : null
    const base = {
      titulo: slide.titulo, subtitulo: slide.subtitulo, empresa: empresa.name,
      ciudad: empresa.ciudad, cta: slide.ctaTexto, planDesde,
      color: empresa.colorPrimario && /^#[0-9a-fA-F]{6}$/.test(empresa.colorPrimario) ? empresa.colorPrimario : null,
    }
    let href: string
    let imagen: string | null
    const propias = [empresa.bannerUrl, empresa.logoUrl, ...empresa.galleryImages]
    switch (slide.ctaDestino.tipo) {
      case 'empresa':
        if (slide.ctaDestino.id !== companyId) return null
        href = `/cliente/empresas/${empresa.slug}`
        imagen = empresa.bannerUrl ?? empresa.logoUrl
        break
      case 'plan': {
        const plan = await tx.plan.findFirst({ where: { id: slide.ctaDestino.id, companyId, activo: true }, select: { id: true } })
        if (!plan) return null
        href = `/plan/${plan.id}`
        imagen = empresa.bannerUrl ?? empresa.logoUrl
        break
      }
      case 'promocion': {
        const ahora = new Date()
        const promo = await tx.promocion.findFirst({
          where: { id: slide.ctaDestino.id, companyId, activo: true, archivada: false, visibilidad: 'publica',
            publicadaEn: { lte: ahora }, vigenciaDesde: { lte: ahora },
            OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: ahora } }] },
          select: { id: true, imagenUrl: true, imagenes: true },
        })
        if (!promo) return null
        href = `/cliente/promociones/${promo.id}`
        imagen = promo.imagenUrl
        propias.push(promo.imagenUrl, ...promo.imagenes)
        break
      }
      case 'excursion': {
        const excursion = await tx.excursion.findFirst({
          where: { id: slide.ctaDestino.id, companyId, estado: 'ACTIVA' },
          select: { slug: true, portadaUrl: true },
        })
        if (!excursion) return null
        href = `/empresas/${empresa.slug}/excursiones/${excursion.slug}`
        imagen = excursion.portadaUrl
        propias.push(excursion.portadaUrl)
        break
      }
    }
    if (slide.imagenUrl) {
      if (!propias.includes(slide.imagenUrl)) return null
      imagen = slide.imagenUrl
    }
    return { ...base, href, imagen }
  })
}
