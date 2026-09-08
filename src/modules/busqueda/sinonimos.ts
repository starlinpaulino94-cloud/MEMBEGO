import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'

/** Normaliza un término para comparar sin importar mayúsculas ni espacios. */
export function normalizarTermino(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Expande la consulta con sinónimos (puros, probados sin BD).
 * Devuelve la consulta más sus equivalencias, sin duplicados y con tope:
 * cada término extra multiplica ramas OR en la búsqueda.
 */
export function expandirConsulta(
  consulta: string,
  equivalencias: string[],
  tope = 5
): string[] {
  const base = normalizarTermino(consulta)
  if (!base) return []
  const salida = [base]
  for (const e of equivalencias) {
    const t = normalizarTermino(e)
    if (t && t !== base && !salida.includes(t)) salida.push(t)
    if (salida.length >= tope) break
  }
  return salida
}

/** Equivalencias vigentes: globales + las de la empresa (éstas mandan). */
export async function equivalenciasPara(
  termino: string,
  companyId?: string | null,
  idioma = 'es-DO'
): Promise<string[]> {
  const t = normalizarTermino(termino)
  if (!t) return []
  const filas = await sinEmpresa('búsqueda: sinónimos globales y de la empresa', (tx) =>
    tx.busquedaSinonimo.findMany({
      where: {
        idioma,
        termino: t,
        OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])],
      },
      select: { companyId: true, equivalencia: true },
    })
  ).catch(() => [])
  const propias = new Set(
    filas.filter((f) => f.companyId !== null).map((f) => f.equivalencia)
  )
  const salida: string[] = []
  for (const f of filas) {
    const esPropia = f.companyId !== null
    if (!esPropia && propias.size > 0) continue
    if (!salida.includes(f.equivalencia)) salida.push(f.equivalencia)
  }
  return salida
}

/** Términos de búsqueda: consulta + sinónimos (tope 5). */
export async function terminosBusqueda(
  consulta: string,
  companyId?: string | null,
  idioma = 'es-DO'
): Promise<string[]> {
  const eq = await equivalenciasPara(consulta, companyId, idioma)
  return expandirConsulta(consulta, eq)
}

/** Alta/actualización de un sinónimo (la administra la plataforma). */
export async function guardarSinonimo(input: {
  termino: string
  equivalencia: string
  companyId?: string | null
  idioma?: string
}): Promise<void> {
  const termino = normalizarTermino(input.termino)
  const equivalencia = normalizarTermino(input.equivalencia)
  if (!termino || !equivalencia || termino === equivalencia) {
    throw new Error('Sinónimo inválido.')
  }
  const alcance = input.companyId ?? null
  const idioma = input.idioma ?? 'es-DO'
  // findFirst + create/update en vez de upsert: el único incluye companyId
  // nulable y Prisma no admite NULL en el where de un upsert compuesto.
  const op = async (tx: Tx) => {
    const previo = await tx.busquedaSinonimo.findFirst({
      where: { companyId: alcance, idioma, termino },
      select: { id: true },
    })
    if (previo) {
      await tx.busquedaSinonimo.update({
        where: { id: previo.id },
        data: { equivalencia },
      })
      return
    }
    await tx.busquedaSinonimo.create({
      data: { companyId: alcance, idioma, termino, equivalencia },
    })
  }
  if (alcance) {
    await conEmpresa(alcance, op)
  } else {
    await sinEmpresa('búsqueda: guardar sinónimo global', op)
  }
}
