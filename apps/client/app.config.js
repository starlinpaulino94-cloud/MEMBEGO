const iosGoogleMapsApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    googleMapsIosConfigured: Boolean(iosGoogleMapsApiKey),
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
        iosGoogleMapsApiKey,
      },
    ],
  ],
})
