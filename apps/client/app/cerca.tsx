/**
 * Ruta base para /cerca — expo-router requiere un archivo sin sufijo de plataforma.
 * Selecciona la implementación correcta según la plataforma en runtime.
 */
import { Platform } from 'react-native'
import CercaWebScreen from './cerca.web'
import CercaNativeScreen from './cerca.native'

const CercaScreen = Platform.OS === 'web'
  ? CercaWebScreen
  : CercaNativeScreen

export default CercaScreen
