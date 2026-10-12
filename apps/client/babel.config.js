module.exports = function (api) {
  const platform = api.caller((caller) => caller?.platform ?? null);
  api.cache.using(() => platform);

  const isWeb = platform === 'web';

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: isWeb ? 'react' : 'nativewind' }],
      ...(!isWeb ? ['nativewind/babel'] : []),
    ],
    plugins: isWeb ? [require.resolve('./babel-plugin-tailwind-web')] : [],
  };
};
