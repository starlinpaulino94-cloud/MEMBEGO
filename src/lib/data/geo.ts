/**
 * CATÁLOGO GEOGRÁFICO DE REPÚBLICA DOMINICANA (seed oficial, G-3/G-4)
 *
 * Fuentes públicas: división territorial oficial de la República Dominicana
 * (ONE / Congreso Nacional) para provincias y municipios; sectores y puntos de
 * referencia aproximados de OpenStreetMap. Nada de esto es "datos simulados":
 * es el catálogo real que MembeGo siembra (docs/GEOLOCALIZACION.md §11).
 *
 * Convenciones:
 *  - `regionLabel: 'Provincia'` → el campo de 2º nivel se etiqueta "Provincia"
 *    en la UI (decisión G-6 · etiqueta por país).
 *  - `isVerified: true` para provincias/municipios (división oficial) y para
 *    los sectores más conocidos (OSM). Los sectores adicionales que escriban
 *    los usuarios nacen con `isVerified: false` y pasan por revisión del
 *    superadmin.
 *  - Las coordenadas de sector son APROXIMADAS (punto de referencia para
 *    centrar el mapa); nunca son la ubicación exacta de una persona.
 */

export interface GeoSectorSeed {
  name: string
  lat: number
  lng: number
}

export interface GeoCitySeed {
  name: string
  sectors: GeoSectorSeed[]
}

export interface GeoRegionSeed {
  name: string
  cities: GeoCitySeed[]
}

export const COUNTRY_DO = {
  isoCode: 'DO',
  name: 'República Dominicana',
  regionLabel: 'Provincia',
}

export const REGIONS_DO: GeoRegionSeed[] = [
  {
    name: 'Distrito Nacional',
    cities: [
      {
        name: 'Santo Domingo',
        sectors: [
          { name: 'Gazcue', lat: 18.4683, lng: -69.8989 },
          { name: 'Naco', lat: 18.4705, lng: -69.9416 },
          { name: 'Piantini', lat: 18.4773, lng: -69.9443 },
          { name: 'Arroyo Hondo', lat: 18.5097, lng: -69.9605 },
          { name: 'Bella Vista', lat: 18.4555, lng: -69.9504 },
          { name: 'Evaristo Morales', lat: 18.4627, lng: -69.9306 },
          { name: 'La Esperilla', lat: 18.4667, lng: -69.9306 },
          { name: 'Los Prados', lat: 18.4806, lng: -69.9461 },
          { name: 'Mirador Sur', lat: 18.4524, lng: -69.9631 },
          { name: 'Los Cacicazgos', lat: 18.4495, lng: -69.9623 },
          { name: 'Ciudad Universitaria', lat: 18.465, lng: -69.954 },
          { name: 'Ensanche La Paz', lat: 18.4877, lng: -69.943 },
          { name: 'Villa Juana', lat: 18.4833, lng: -69.9066 },
          { name: 'Villa Consuelo', lat: 18.4874, lng: -69.9085 },
          { name: 'Villa Francisca', lat: 18.4754, lng: -69.901 },
          { name: 'San Carlos', lat: 18.4723, lng: -69.9057 },
          { name: 'Simón Bolívar', lat: 18.4934, lng: -69.9144 },
          { name: 'Cristo Rey', lat: 18.4957, lng: -69.9144 },
          { name: 'Capotillo', lat: 18.4922, lng: -69.907 },
          { name: 'Ensanche Luperón', lat: 18.4759, lng: -69.9125 },
          { name: 'Gascue', lat: 18.4683, lng: -69.8989 },
          { name: 'Honduras del Norte', lat: 18.5, lng: -69.926 },
          { name: 'La Julia', lat: 18.4639, lng: -69.9347 },
          { name: 'Mata Hambre', lat: 18.4892, lng: -69.9284 },
          { name: 'Palma Real', lat: 18.453, lng: -69.9419 },
          { name: 'Los Restauradores', lat: 18.4858, lng: -69.946 },
        ],
      },
    ],
  },
  {
    name: 'Santo Domingo',
    cities: [
      { name: 'Santo Domingo Este', sectors: [{ name: 'Los Mina', lat: 18.4922, lng: -69.876 }] },
      { name: 'Santo Domingo Norte', sectors: [{ name: 'Villa Mella', lat: 18.5309, lng: -69.9027 }] },
      { name: 'Santo Domingo Oeste', sectors: [{ name: 'Herrea', lat: 18.4774, lng: -69.977 }] },
      { name: 'Boca Chica', sectors: [{ name: 'Playa Boca Chica', lat: 18.4535, lng: -69.6066 }] },
      { name: 'San Antonio de Guerra', sectors: [] },
      { name: 'Los Alcarrizos', sectors: [] },
      { name: 'Pedro Brand', sectors: [] },
    ],
  },
  {
    name: 'Santiago',
    cities: [
      {
        name: 'Santiago de los Caballeros',
        sectors: [
          { name: 'Centro Histórico', lat: 19.4517, lng: -70.697 },
          { name: 'Los Jardines Metropolitanos', lat: 19.441, lng: -70.71 },
          { name: 'Los Pepines', lat: 19.466, lng: -70.7 },
          { name: 'Bella Vista', lat: 19.473, lng: -70.694 },
          { name: 'La Trinitaria', lat: 19.465, lng: -70.709 },
          { name: 'Villa Olga', lat: 19.46, lng: -70.709 },
          { name: 'Nibaje', lat: 19.47, lng: -70.713 },
          { name: 'Ensanche Bolívar', lat: 19.458, lng: -70.704 },
          { name: 'El Ensueño', lat: 19.471, lng: -70.707 },
          { name: 'Reparto del Este', lat: 19.458, lng: -70.689 },
          { name: 'Cerro Alto', lat: 19.4776, lng: -70.691 },
          { name: 'Urbanización Los Reyes', lat: 19.4699, lng: -70.6866 },
        ],
      },
      { name: 'Bisonó (Navarrete)', sectors: [] },
      { name: 'Jánico', sectors: [] },
      { name: 'Licey al Medio', sectors: [] },
      { name: 'San José de las Matas', sectors: [] },
      { name: 'Tamboril', sectors: [] },
      { name: 'Villa González', sectors: [] },
    ],
  },
  {
    name: 'La Altagracia',
    cities: [
      {
        name: 'Higüey',
        sectors: [{ name: 'Centro de Higüey', lat: 18.618, lng: -68.707 }],
      },
      {
        name: 'Punta Cana',
        sectors: [
          { name: 'Bávaro', lat: 18.6809, lng: -68.4372 },
          { name: 'Verón', lat: 18.63, lng: -68.45 },
          { name: 'Cabeza de Toro', lat: 18.648, lng: -68.392 },
          { name: 'El Cortecito', lat: 18.682, lng: -68.435 },
          { name: 'Los Corales', lat: 18.646, lng: -68.396 },
        ],
      },
      { name: 'San Rafael del Yuma', sectors: [] },
    ],
  },
  {
    name: 'La Romana',
    cities: [
      {
        name: 'La Romana',
        sectors: [
          { name: 'Centro', lat: 18.427, lng: -68.973 },
          { name: 'Villa Hermosa', lat: 18.44, lng: -68.996 },
        ],
      },
      { name: 'Guaymate', sectors: [] },
      { name: 'Villa Hermosa', sectors: [] },
    ],
  },
  {
    name: 'San Cristóbal',
    cities: [
      {
        name: 'San Cristóbal',
        sectors: [
          { name: 'Centro', lat: 18.417, lng: -70.106 },
          { name: 'Madre Vieja', lat: 18.405, lng: -70.126 },
        ],
      },
      { name: 'Bajos de Haina', sectors: [] },
      { name: 'Cambita Garabitos', sectors: [] },
      { name: 'Los Cacaos', sectors: [] },
      { name: 'Sabana Grande de Palenque', sectors: [] },
      { name: 'San Gregorio de Nigua', sectors: [] },
      { name: 'Villa Altagracia', sectors: [] },
      { name: 'Yaguate', sectors: [] },
    ],
  },
  {
    name: 'Puerto Plata',
    cities: [
      {
        name: 'San Felipe de Puerto Plata',
        sectors: [
          { name: 'Centro', lat: 19.7974, lng: -70.6918 },
          { name: 'Playa Dorada', lat: 19.783, lng: -70.664 },
          { name: 'El Mamey', lat: 19.776, lng: -70.704 },
        ],
      },
      {
        name: 'Sosúa',
        sectors: [{ name: 'El Batey', lat: 19.75, lng: -70.521 }],
      },
      { name: 'Altamira', sectors: [] },
      { name: 'Imbert', sectors: [] },
      { name: 'Luperón', sectors: [] },
      { name: 'Villa Isabela', sectors: [] },
      { name: 'Villa Montellano', sectors: [] },
    ],
  },
  {
    name: 'La Vega',
    cities: [
      {
        name: 'Concepción de la Vega',
        sectors: [{ name: 'Centro', lat: 19.222, lng: -70.528 }],
      },
      { name: 'Constanza', sectors: [] },
      { name: 'Jarabacoa', sectors: [] },
      { name: 'Jima Abajo', sectors: [] },
    ],
  },
  {
    name: 'San Pedro de Macorís',
    cities: [
      {
        name: 'San Pedro de Macorís',
        sectors: [{ name: 'Centro', lat: 18.4539, lng: -69.3086 }],
      },
      { name: 'Consuelo', sectors: [] },
      { name: 'Guayacanes', sectors: [] },
      { name: 'Quisqueya', sectors: [] },
      { name: 'Ramón Santana', sectors: [] },
      { name: 'San José de los Llanos', sectors: [] },
    ],
  },
  {
    name: 'Duarte',
    cities: [
      {
        name: 'San Francisco de Macorís',
        sectors: [{ name: 'Centro', lat: 19.301, lng: -70.252 }],
      },
      { name: 'Arenoso', sectors: [] },
      { name: 'Castillo', sectors: [] },
      { name: 'Eugenio María de Hostos', sectors: [] },
      { name: 'Las Guáranas', sectors: [] },
      { name: 'Pimentel', sectors: [] },
      { name: 'Villa Riva', sectors: [] },
    ],
  },
  {
    name: 'Espaillat',
    cities: [
      {
        name: 'Moca',
        sectors: [{ name: 'Centro', lat: 19.394, lng: -70.523 }],
      },
      { name: 'Cayetano Germosén', sectors: [] },
      { name: 'Gaspar Hernández', sectors: [] },
      { name: 'Jamao al Norte', sectors: [] },
      { name: 'San Víctor', sectors: [] },
    ],
  },
  {
    name: 'Samaná',
    cities: [
      {
        name: 'Santa Bárbara de Samaná',
        sectors: [{ name: 'Centro', lat: 19.207, lng: -69.336 }],
      },
      {
        name: 'Las Terrenas',
        sectors: [{ name: 'Pueblo de los Pescadores', lat: 19.317, lng: -69.543 }],
      },
      { name: 'Sánchez', sectors: [] },
    ],
  },
  {
    name: 'Azua',
    cities: [
      {
        name: 'Azua de Compostela',
        sectors: [{ name: 'Centro', lat: 18.4531, lng: -70.7344 }],
      },
    ],
  },
  {
    name: 'Baoruco',
    cities: [{ name: 'Neiba', sectors: [] }],
  },
  {
    name: 'Barahona',
    cities: [
      {
        name: 'Santa Cruz de Barahona',
        sectors: [{ name: 'Centro', lat: 18.2086, lng: -71.0992 }],
      },
    ],
  },
  {
    name: 'Dajabón',
    cities: [{ name: 'Dajabón', sectors: [] }],
  },
  {
    name: 'El Seibo',
    cities: [
      {
        name: 'Santa Cruz de El Seibo',
        sectors: [{ name: 'Centro', lat: 18.7657, lng: -69.0358 }],
      },
    ],
  },
  {
    name: 'Elías Piña',
    cities: [{ name: 'Comendador', sectors: [] }],
  },
  {
    name: 'Hato Mayor',
    cities: [
      {
        name: 'Hato Mayor del Rey',
        sectors: [{ name: 'Centro', lat: 18.7638, lng: -69.2563 }],
      },
    ],
  },
  {
    name: 'Hermanas Mirabal',
    cities: [{ name: 'Salcedo', sectors: [] }],
  },
  {
    name: 'Independencia',
    cities: [{ name: 'Jimaní', sectors: [] }],
  },
  {
    name: 'María Trinidad Sánchez',
    cities: [
      {
        name: 'Nagua',
        sectors: [{ name: 'Centro', lat: 19.3796, lng: -69.8476 }],
      },
    ],
  },
  {
    name: 'Monseñor Nouel',
    cities: [
      {
        name: 'Bonao',
        sectors: [{ name: 'Centro', lat: 18.9368, lng: -70.4093 }],
      },
    ],
  },
  {
    name: 'Monte Cristi',
    cities: [
      {
        name: 'San Fernando de Monte Cristi',
        sectors: [{ name: 'Centro', lat: 19.8487, lng: -71.6457 }],
      },
    ],
  },
  {
    name: 'Monte Plata',
    cities: [{ name: 'Monte Plata', sectors: [] }],
  },
  {
    name: 'Pedernales',
    cities: [{ name: 'Pedernales', sectors: [] }],
  },
  {
    name: 'Peravia',
    cities: [
      {
        name: 'Baní',
        sectors: [{ name: 'Centro', lat: 18.2796, lng: -70.3316 }],
      },
    ],
  },
  {
    name: 'San José de Ocoa',
    cities: [{ name: 'San José de Ocoa', sectors: [] }],
  },
  {
    name: 'San Juan',
    cities: [
      {
        name: 'San Juan de la Maguana',
        sectors: [{ name: 'Centro', lat: 18.8063, lng: -71.2308 }],
      },
    ],
  },
  {
    name: 'Sánchez Ramírez',
    cities: [
      {
        name: 'Cotuí',
        sectors: [{ name: 'Centro', lat: 19.0567, lng: -70.1498 }],
      },
    ],
  },
  {
    name: 'Santiago Rodríguez',
    cities: [{ name: 'San Ignacio de Sabaneta', sectors: [] }],
  },
  {
    name: 'Valverde',
    cities: [
      {
        name: 'Santa Cruz de Mao',
        sectors: [{ name: 'Centro', lat: 19.5767, lng: -71.0779 }],
      },
    ],
  },
]
