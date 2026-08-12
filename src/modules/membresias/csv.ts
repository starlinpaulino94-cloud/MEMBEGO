import { membresiaEstadoUi } from '@/lib/estados'
import type { MembresiaFila } from './lista'

/**
 * Las membresías en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * Mismas dos reglas que el CSV de empresas, y por los mismos motivos:
 *
 *  · El dinero va SIN símbolo ni separador de miles. Un «RD$1,600.00» entra en
 *    Excel como texto y deja de sumarse, y la coma de los miles se come el
 *    separador del propio archivo.
 *
 *  · Las fechas van en ISO (`2026-08-12`), no formateadas para leer. Es el
 *    único formato que Excel ordena bien en cualquier idioma, y este archivo se
 *    abre para ordenar y filtrar, no para leerlo de corrido.
 *
 * Y una tercera, propia de aquí: se exportan DOS columnas de estado —el estado
 * guardado y si está vigente HOY—. Son cosas distintas: `ACTIVA` significa
 * «nadie la ha tocado», no «vale hoy». Con una sola columna, quien abra el
 * archivo daría por hecho lo segundo.
 */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

const ENCABEZADOS = [
  'Cliente',
  'Correo',
  'Empresa',
  'Practica',
  'Plan',
  'Precio',
  'Estado',
  'Vigente hoy',
  'Usos restantes',
  'Inicio',
  'Vencimiento',
]

export function membresiasToCsv(filas: MembresiaFila[]): string {
  const lineas = filas.map((m) =>
    [
      m.clienteNombre,
      m.clienteEmail,
      m.empresaNombre,
      m.empresaEsDemo ? 'Si' : 'No',
      m.planNombre,
      m.planPrecio,
      membresiaEstadoUi(m.estado).label,
      m.vigente ? 'Si' : 'No',
      m.planEsIlimitado ? 'Ilimitado' : m.usosRestantes,
      iso(m.fechaInicio),
      iso(m.fechaVencimiento),
    ]
      .map(esc)
      .join(';')
  )
  // BOM para que Excel respete los acentos.
  return `﻿${[ENCABEZADOS.join(';'), ...lineas].join('\n')}`
}
