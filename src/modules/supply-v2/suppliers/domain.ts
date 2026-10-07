/**
 * MEMBEGO SUPPLY · proveedores: reglas puras.
 */

export interface DatosProveedorExterno {
  commercialName: string
  legalName?: string | null
  taxId?: string | null
  contactName?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  countryCode?: string | null
  currency?: string | null
  paymentTermsDays?: number | null
  paymentTermsText?: string | null
  notes?: string | null
}

const t = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null)

export function validarProveedorExterno(d: DatosProveedorExterno): string | null {
  if (!d.commercialName?.trim()) return 'El proveedor necesita un nombre comercial.'
  if (d.commercialName.trim().length > 160) return 'El nombre comercial es demasiado largo.'
  if (d.email && d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    return 'El correo del proveedor no es válido.'
  }
  if (d.paymentTermsDays != null && (!Number.isInteger(d.paymentTermsDays) || d.paymentTermsDays < 0)) {
    return 'Los días de pago tienen que ser un entero no negativo.'
  }
  return null
}

/** Limpia y normaliza lo que se guarda: recortes, nulos y valores por defecto. */
export function normalizarProveedor(d: DatosProveedorExterno) {
  return {
    commercialName: d.commercialName.trim(),
    legalName: t(d.legalName),
    taxId: t(d.taxId),
    contactName: t(d.contactName),
    phone: t(d.phone),
    whatsapp: t(d.whatsapp),
    email: t(d.email)?.toLowerCase() ?? null,
    address: t(d.address),
    city: t(d.city),
    countryCode: (t(d.countryCode) ?? 'DO').toUpperCase().slice(0, 2),
    currency: (t(d.currency) ?? 'DOP').toUpperCase().slice(0, 3),
    paymentTermsDays: d.paymentTermsDays ?? null,
    paymentTermsText: t(d.paymentTermsText),
    notes: t(d.notes),
  }
}
