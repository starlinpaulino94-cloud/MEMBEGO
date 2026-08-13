import { armarCsvBloques } from '@/lib/csv'
import type { ReporteGlobal } from './globales'
import type { Rango } from './rango'

/**
 * El reporte de plataforma en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * TRES BLOQUES Y NO UNO. Un reporte no es una tabla: son unos totales, un
 * desglose por empresa y el contexto de qué periodo y qué alcance se miraron.
 * Exportar solo la tabla de empresas obligaría a apuntar el resto a mano, y el
 * archivo dejaría de poder defenderse solo dentro de una semana.
 *
 * EL ALCANCE VA ESCRITO EN EL ARCHIVO. Es la parte que más importa: dos
 * exportaciones del mismo día pueden diferir en si incluían las empresas de
 * práctica, y sin esa línea son indistinguibles. Un CSV que no dice de qué es,
 * es un CSV que alguien va a interpretar mal.
 *
 * El dinero va sin símbolo ni separador de miles: «RD$66,200.00» entra en Excel
 * como texto y deja de sumarse.
 */
export function reporteGlobalToCsv(r: ReporteGlobal, rango: Rango, incluyeDemo: boolean): string {
  return armarCsvBloques([
    {
      titulo: 'Alcance del reporte',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Periodo', `${rango.desdeDia} a ${rango.hastaDia}`],
        ['Dias', rango.dias],
        ['Periodo anterior', `${rango.anterior.desdeDia} a ${rango.anterior.hastaDia}`],
        ['Empresas de practica', incluyeDemo ? 'Incluidas' : 'Excluidas'],
        ['Empresas en el reporte', r.empresas.length],
        // Que una consulta fallara tiene que viajar CON los datos: el aviso de
        // la pantalla no se descarga, y el archivo se lee semanas después.
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
      ],
    },
    {
      titulo: 'Totales',
      encabezados: ['Metrica', 'Periodo', 'Periodo anterior', 'Variacion %'],
      filas: [
        ...r.ingresos.map((m) => [
          `Ingresos cobrados (${m.moneda})`,
          m.total.toFixed(2),
          // La comparación solo existe para la moneda principal: comparar
          // dólares de este mes con el total mezclado del anterior sería
          // inventar un dato.
          m.moneda === r.monedaPrincipal ? r.ingresoPrincipal.anterior.toFixed(2) : '',
          m.moneda === r.monedaPrincipal ? (r.ingresoPrincipal.variacion ?? '') : '',
        ]),
        ['Usos', r.usos.valor, r.usos.anterior, r.usos.variacion ?? ''],
        [
          'Clientes nuevos',
          r.clientesNuevos.valor,
          r.clientesNuevos.anterior,
          r.clientesNuevos.variacion ?? '',
        ],
        // Foto de hoy: no dependen del periodo, así que no se comparan.
        ['Membresias activas (hoy)', r.activas, '', ''],
        ['Por vencer en 7 dias (hoy)', r.porVencer, '', ''],
      ],
    },
    {
      titulo: 'Por empresa',
      encabezados: [
        'Empresa',
        'Moneda',
        'Practica',
        'Ingresos',
        'Membresias activas',
        'Usos',
        'Por vencer (7 dias)',
      ],
      filas: r.empresas.map((e) => [
        e.nombre,
        e.moneda,
        e.esDemo ? 'Si' : 'No',
        e.ingresos.toFixed(2),
        e.activas,
        e.usos,
        e.porVencer,
      ]),
    },
  ])
}
