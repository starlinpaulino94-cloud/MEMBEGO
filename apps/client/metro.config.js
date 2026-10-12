// Metro config is loaded by the Metro bundler as CJS; require() is mandatory here.
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const bunRoot = path.resolve(monorepoRoot, 'node_modules/.bun');
const bunPackageDirectories = fs.existsSync(bunRoot) ? fs.readdirSync(bunRoot) : [];

function findBunPackage(packageName) {
  const prefix = packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '+') + '@'
    : packageName + '@';
  const directory = bunPackageDirectories.find((entry) => entry.startsWith(prefix));
  return directory
    ? path.resolve(bunRoot, directory, 'node_modules', packageName)
    : path.resolve(projectRoot, 'node_modules', packageName);
}

const config = getDefaultConfig(projectRoot);

config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [
  `${projectRoot}/node_modules`,
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;
config.maxWorkers = 2;
config.resolver.extraNodeModules = {
  '@expo/metro-runtime': path.resolve(projectRoot, 'node_modules/@expo/metro-runtime'),
  '@expo/log-box': findBunPackage('@expo/log-box'),
  'react-native-css-interop': findBunPackage('react-native-css-interop'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native' || moduleName.startsWith('react-native-web/'))
  ) {
    const reactNativeWebPath = path.resolve(
      projectRoot,
      'node_modules/react-native-web',
      moduleName === 'react-native' ? 'dist/index.js' : moduleName.slice('react-native-web/'.length),
    );

    return context.resolveRequest(
      context,
      reactNativeWebPath,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.native.css' });
