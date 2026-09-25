/**
 * Ruta base para /cerca — expo-router requiere un archivo sin sufijo de plataforma.
 * Selecciona la implementación correcta según la plataforma en runtime.
 */
import { Platform } from 'react-native'

const CercaScreen = Platform.OS === 'web'
  ? require('./cerca.web').default
  : require('./cerca.native').default

export default CercaScreen
