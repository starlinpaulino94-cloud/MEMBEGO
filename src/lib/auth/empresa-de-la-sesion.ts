/**
 * ¿Puede esta sesión operar sobre algo que es de `companyId`?
 *
 *  · SUPERADMIN: sí, de cualquier empresa.
 *  · Cualquier otro rol: solo de la empresa de su sesión.
 *  · Un rol que no es SUPERADMIN y cuya sesión NO trae empresa: NUNCA. (Antes los
 *    escáneres y los canjes comprobaban `role !== 'SUPERADMIN' && companyId && distinta`:
 *    sin `companyId` en la sesión la comprobación se saltaba y la persona podía operar
 *    sobre los pedidos, ofertas y membresías de CUALQUIER empresa — hallazgo M11 de la
 *    auditoría del 2026-10-07. Falla cerrado.)
 *
 * Es una función pura sobre la sesión: no importa Prisma y se puede probar sin base.
 */
export function puedeOperarEnEmpresa(user: { metadata: { role: string; companyId?: string | null } }, companyId: string): boolean {
  if (user.metadata.role === 'SUPERADMIN') return true
  const propia = user.metadata.companyId
  return typeof propia === 'string' && propia !== '' && typeof companyId === 'string' && companyId !== '' && propia === companyId
}
