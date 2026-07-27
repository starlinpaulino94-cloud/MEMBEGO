import { anotarFallo } from '@/lib/prisma-errors'
/**
 * Puerto de transporte de impresión (Receipt Engine, Fase E4).
 *
 * El Receipt Engine no depende de una impresora ni de un canal concreto: los
 * bytes ESC/POS se entregan a un `PrinterTransport`. Agregar soporte para un
 * canal nuevo = registrar un driver que implemente esta interfaz; el motor y
 * las plantillas no cambian.
 *
 * Canales previstos: usb (WebUSB), serial (Web Serial), bluetooth (Web
 * Bluetooth), ethernet/wifi (vía backend/agente local, el navegador no abre
 * sockets crudos) y browser (window.print del render HTML — el canal activo
 * hoy, compatible con la 2Connect POS80-01 V8 instalada como impresora del
 * sistema).
 */

export type TransportKind =
  | 'usb'
  | 'serial'
  | 'bluetooth'
  | 'ethernet'
  | 'wifi'
  | 'browser'

export interface PrinterTransport {
  readonly kind: TransportKind
  /** ¿El canal está disponible en este entorno/dispositivo? */
  isAvailable(): boolean | Promise<boolean>
  /** Envía los bytes ESC/POS al dispositivo. */
  write(data: Uint8Array): Promise<void>
  close?(): Promise<void>
}

const registry = new Map<TransportKind, () => PrinterTransport>()

/** Registra un driver de transporte (sobrescribe si ya existía). */
export function registerTransport(kind: TransportKind, factory: () => PrinterTransport) {
  registry.set(kind, factory)
}

export function getTransport(kind: TransportKind): PrinterTransport | null {
  const factory = registry.get(kind)
  return factory ? factory() : null
}

export function listTransports(): TransportKind[] {
  return Array.from(registry.keys())
}

/**
 * Tipos estructurales mínimos de WebUSB (la lib DOM de TS no los incluye).
 * Solo lo que el driver usa; sin dependencia de @types externos.
 */
interface UsbEndpointLike {
  endpointNumber: number
  direction: 'in' | 'out'
}
interface UsbDeviceLike {
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(endpoint: number, data: ArrayBuffer): Promise<unknown>
  configuration: {
    interfaces: { alternate: { endpoints: UsbEndpointLike[] } }[]
  } | null
}
interface UsbNavigatorLike {
  usb?: {
    requestDevice(options: { filters: { classCode: number }[] }): Promise<UsbDeviceLike>
  }
}

/**
 * Driver WebUSB genérico (clase impresora estándar, sin comandos de
 * fabricante). Disponible solo en navegadores con WebUSB y bajo gesto de
 * usuario.
 */
export function createWebUsbTransport(): PrinterTransport {
  let device: UsbDeviceLike | null = null
  return {
    kind: 'usb',
    isAvailable() {
      return typeof navigator !== 'undefined' && 'usb' in navigator
    },
    async write(data: Uint8Array) {
      if (!device) {
        const usb = (navigator as unknown as UsbNavigatorLike).usb
        if (!usb) throw new Error('WebUSB no está disponible en este navegador.')
        device = await usb.requestDevice({
          filters: [{ classCode: 7 }], // 7 = printer class
        })
        await device.open()
        if (device.configuration === null) await device.selectConfiguration(1)
        await device.claimInterface(0)
      }
      const iface = device.configuration?.interfaces[0]
      const endpoint = iface?.alternate.endpoints.find((e) => e.direction === 'out')
      if (!endpoint) throw new Error('La impresora USB no expone un endpoint de salida.')
      const buf = new ArrayBuffer(data.byteLength)
      new Uint8Array(buf).set(data)
      await device.transferOut(endpoint.endpointNumber, buf)
    },
    async close() {
      await device?.close().catch(anotarFallo('receipts:cerrar-impresora'))
      device = null
    },
  }
}

// El canal por defecto hoy es 'browser' (render HTML + window.print), que no
// pasa por este puerto: imprime el DOM. Los canales de bytes crudos (usb,
// serial, bluetooth) se registran desde el cliente cuando el dispositivo los
// soporte; ethernet/wifi requerirán un agente local o endpoint del backend.
