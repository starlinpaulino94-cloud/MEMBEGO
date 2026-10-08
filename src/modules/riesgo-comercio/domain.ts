/**
 * SEÑALES DE RIESGO · reglas puras (Fase 9). Sin Prisma ni Next.
 *
 * Una señal es un INDICIO, no un veredicto: «esta empresa canceló la mitad de sus pedidos del último mes» puede
 * ser fraude, una temporada mala o un error de operación. Por eso este módulo solo MIRA y ordena lo que merece
 * una llamada; no suspende, no bloquea, no cobra ni cambia nada. La decisión es de una persona.
 *
 * Los umbrales son constantes con nombre para que cambiarlos sea una decisión visible (y probada), y todo lo que
 * depende de un tamaño de muestra exige un mínimo de pedidos: dos cancelaciones de dos pedidos no son una tasa.
 */

export type Severidad = 'ALTA' | 'MEDIA'

export type TipoDeSenal =
  | 'EMPRESA_CANCELA_MUCHO'
  | 'EMPRESA_REEMBOLSA_MUCHO'
  | 'EMPRESA_NO_RESPONDE'
  | 'EMPRESA_AJUSTA_MUCHO'
  | 'EMPRESA_CREDITO_AL_LIMITE'
  | 'EMPRESA_CUENTA_RESTRINGIDA'
  | 'CLIENTE_CANCELA_MUCHO'
  | 'CLIENTE_CUPONES_VENCIDOS'
  | 'CLIENTE_RAFAGA'

export const VENTANA_DIAS = 30

export const UMBRALES = {
  /** Pedidos mínimos en la ventana para hablar de una tasa. */
  minimoDePedidos: 5,
  cancelacion: { media: 0.3, alta: 0.5 },
  /** Sobre los pedidos cerrados (completados + reembolsados). */
  reembolso: { media: 0.1, alta: 0.2 },
  /** Pedidos esperando respuesta más de `horasSinAtender` horas. */
  horasSinAtender: 24,
  sinAtender: { media: 3, alta: 8 },
  /** Un ajuste «grande» mueve el monto más de esta fracción del subtotal. */
  ajusteGrande: 0.25,
  /** Fracción de los pedidos con un ajuste grande. */
  ajustes: { media: 0.2, alta: 0.4 },
  /** Saldo ÷ límite de crédito. */
  credito: { media: 0.8, alta: 1 },
  cliente: {
    cancelados: { media: 5, alta: 10 },
    cuponesVencidos: { media: 3, alta: 6 },
    /** Pedidos creados en las últimas 24 horas. */
    rafaga: { media: 10, alta: 20 },
  },
} as const

export interface Sujeto {
  tipo: 'EMPRESA' | 'CLIENTE'
  id: string
  nombre: string
  /** Correo, solo para clientes. */
  contacto?: string
}

export interface Senal {
  tipo: TipoDeSenal
  severidad: Severidad
  sujeto: Sujeto
  titulo: string
  detalle: string
  /** El número medido y el umbral que cruzó, para que se pueda discutir. */
  valor: number
  umbral: number
}

export interface MetricasDeEmpresa {
  companyId: string
  empresa: string
  /** Pedidos del marketplace creados en la ventana. */
  pedidos: number
  cancelados: number
  completados: number
  reembolsados: number
  /** Pedidos esperando a la empresa desde hace más de `horasSinAtender`. */
  sinAtender: number
  /** Pedidos de la ventana con un ajuste de más de `ajusteGrande` del subtotal. */
  conAjusteGrande: number
  /** Lo que la empresa debe a Membego (saldo del libro) y su límite; `null` si no tiene cuenta. */
  saldo: number | null
  limiteDeCredito: number | null
  estadoDeCuenta: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | null
}

export interface MetricasDeCliente {
  clave: string
  nombre: string
  correo: string
  empresas: number
  pedidos: number
  cancelados: number
  cuponesVencidos: number
  pedidosEnUnDia: number
}

const pct = (x: number) => `${Math.round(x * 100)} %`
const nivel = (valor: number, u: { media: number; alta: number }): Severidad | null => (valor >= u.alta ? 'ALTA' : valor >= u.media ? 'MEDIA' : null)

export function evaluarEmpresa(m: MetricasDeEmpresa): Senal[] {
  const sujeto: Sujeto = { tipo: 'EMPRESA', id: m.companyId, nombre: m.empresa }
  const salida: Senal[] = []
  const U = UMBRALES
  const ventana = `en los últimos ${VENTANA_DIAS} días`

  if (m.pedidos >= U.minimoDePedidos) {
    const tasa = m.cancelados / m.pedidos
    const s = nivel(tasa, U.cancelacion)
    if (s) salida.push({ tipo: 'EMPRESA_CANCELA_MUCHO', severidad: s, sujeto, titulo: 'Muchos pedidos cancelados', detalle: `${m.cancelados} de ${m.pedidos} pedidos ${ventana} (${pct(tasa)}). Incluye las que pidió el cliente y las que el sistema hizo porque la empresa no respondió; no cuenta los cupones que el cliente dejó vencer.`, valor: tasa, umbral: s === 'ALTA' ? U.cancelacion.alta : U.cancelacion.media })
    if (m.conAjusteGrande > 0) {
      const f = m.conAjusteGrande / m.pedidos
      const a = nivel(f, U.ajustes)
      if (a) salida.push({ tipo: 'EMPRESA_AJUSTA_MUCHO', severidad: a, sujeto, titulo: 'Cambia el monto de muchos pedidos', detalle: `${m.conAjusteGrande} de ${m.pedidos} pedidos ${ventana} (${pct(f)}) tuvieron un ajuste de más del ${pct(U.ajusteGrande)} del subtotal. Puede ser una diferencia de precio con el catálogo.`, valor: f, umbral: a === 'ALTA' ? U.ajustes.alta : U.ajustes.media })
    }
  }

  const cerrados = m.completados + m.reembolsados
  if (cerrados >= U.minimoDePedidos) {
    const tasa = m.reembolsados / cerrados
    const s = nivel(tasa, U.reembolso)
    if (s) salida.push({ tipo: 'EMPRESA_REEMBOLSA_MUCHO', severidad: s, sujeto, titulo: 'Muchos reembolsos', detalle: `${m.reembolsados} de ${cerrados} pedidos cerrados ${ventana} (${pct(tasa)}) se reembolsaron.`, valor: tasa, umbral: s === 'ALTA' ? U.reembolso.alta : U.reembolso.media })
  }

  const sa = nivel(m.sinAtender, U.sinAtender)
  if (sa) salida.push({ tipo: 'EMPRESA_NO_RESPONDE', severidad: sa, sujeto, titulo: 'Pedidos sin atender', detalle: `${m.sinAtender} pedidos llevan más de ${U.horasSinAtender} horas esperando a la empresa.`, valor: m.sinAtender, umbral: sa === 'ALTA' ? U.sinAtender.alta : U.sinAtender.media })

  if (m.saldo !== null && m.limiteDeCredito !== null && m.limiteDeCredito > 0 && m.saldo > 0) {
    const uso = m.saldo / m.limiteDeCredito
    const c = nivel(uso, U.credito)
    if (c) salida.push({ tipo: 'EMPRESA_CREDITO_AL_LIMITE', severidad: c, sujeto, titulo: 'Crédito casi agotado', detalle: `Debe ${m.saldo.toFixed(2)} de un límite de ${m.limiteDeCredito.toFixed(2)} (${pct(uso)}).`, valor: uso, umbral: c === 'ALTA' ? U.credito.alta : U.credito.media })
  }
  if (m.estadoDeCuenta === 'GRACE_PERIOD' || m.estadoDeCuenta === 'SUSPENDED') {
    salida.push({ tipo: 'EMPRESA_CUENTA_RESTRINGIDA', severidad: 'ALTA', sujeto, titulo: m.estadoDeCuenta === 'SUSPENDED' ? 'Cuenta Membego suspendida' : 'Cuenta Membego en periodo de gracia', detalle: m.estadoDeCuenta === 'SUSPENDED' ? 'No puede recibir pedidos nuevos hasta que regularice su cuenta.' : 'Pasó su límite de crédito: si no regulariza, se suspende.', valor: 1, umbral: 1 })
  }
  return salida
}

export function evaluarCliente(m: MetricasDeCliente): Senal[] {
  const sujeto: Sujeto = { tipo: 'CLIENTE', id: m.clave, nombre: m.nombre, contacto: m.correo }
  const U = UMBRALES.cliente
  const salida: Senal[] = []
  const c = nivel(m.cancelados, U.cancelados)
  if (c) salida.push({ tipo: 'CLIENTE_CANCELA_MUCHO', severidad: c, sujeto, titulo: 'Cancela muchos pedidos', detalle: `${m.cancelados} pedidos cancelados en ${m.empresas === 1 ? '1 empresa' : `${m.empresas} empresas`} en los últimos ${VENTANA_DIAS} días (de ${m.pedidos}). Aparta existencias que no recoge. No cuenta los cupones que dejó vencer (van aparte) ni los pedidos que la empresa no respondió.`, valor: m.cancelados, umbral: c === 'ALTA' ? U.cancelados.alta : U.cancelados.media })
  const v = nivel(m.cuponesVencidos, U.cuponesVencidos)
  if (v) salida.push({ tipo: 'CLIENTE_CUPONES_VENCIDOS', severidad: v, sujeto, titulo: 'Deja vencer cupones de ofertas', detalle: `${m.cuponesVencidos} cupones vencidos sin canjear en los últimos ${VENTANA_DIAS} días. Cada uno aparta presupuesto de una oferta ajena.`, valor: m.cuponesVencidos, umbral: v === 'ALTA' ? U.cuponesVencidos.alta : U.cuponesVencidos.media })
  const r = nivel(m.pedidosEnUnDia, U.rafaga)
  if (r) salida.push({ tipo: 'CLIENTE_RAFAGA', severidad: r, sujeto, titulo: 'Ráfaga de pedidos', detalle: `${m.pedidosEnUnDia} pedidos creados en las últimas 24 horas.`, valor: m.pedidosEnUnDia, umbral: r === 'ALTA' ? U.rafaga.alta : U.rafaga.media })
  return salida
}

const PESO: Record<Severidad, number> = { ALTA: 0, MEDIA: 1 }

/** Primero lo grave; dentro de lo mismo, lo que pasó más lejos del umbral; al final, por nombre (orden estable). */
export function ordenarSenales(s: readonly Senal[]): Senal[] {
  return [...s].sort((a, b) => PESO[a.severidad] - PESO[b.severidad] || b.valor / (b.umbral || 1) - a.valor / (a.umbral || 1) || a.sujeto.nombre.localeCompare(b.sujeto.nombre) || a.tipo.localeCompare(b.tipo))
}

export interface ResumenDeRiesgo {
  empresas: number
  clientes: number
  porSeveridad: Record<Severidad, number>
}

export function resumirRiesgo(s: readonly Senal[]): ResumenDeRiesgo {
  const empresas = new Set<string>()
  const clientes = new Set<string>()
  const porSeveridad: Record<Severidad, number> = { ALTA: 0, MEDIA: 0 }
  for (const x of s) {
    ;(x.sujeto.tipo === 'EMPRESA' ? empresas : clientes).add(x.sujeto.id)
    porSeveridad[x.severidad]++
  }
  return { empresas: empresas.size, clientes: clientes.size, porSeveridad }
}

export const ETIQUETA_TIPO_DE_SENAL: Readonly<Record<TipoDeSenal, string>> = {
  EMPRESA_CANCELA_MUCHO: 'Cancelaciones',
  EMPRESA_REEMBOLSA_MUCHO: 'Reembolsos',
  EMPRESA_NO_RESPONDE: 'Sin atender',
  EMPRESA_AJUSTA_MUCHO: 'Ajustes de monto',
  EMPRESA_CREDITO_AL_LIMITE: 'Crédito',
  EMPRESA_CUENTA_RESTRINGIDA: 'Cuenta restringida',
  CLIENTE_CANCELA_MUCHO: 'Cancelaciones',
  CLIENTE_CUPONES_VENCIDOS: 'Cupones vencidos',
  CLIENTE_RAFAGA: 'Ráfaga',
}
