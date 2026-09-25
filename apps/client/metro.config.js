// Metro config is loaded by the Metro bundler as CJS; require() is mandatory here.
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const bunRoot = path.resolve(monorepoRoot, 'node_modules/.bun');

function findBunPackage(packageName) {
  const prefix = packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '+') + '@'
    : packageName + '@';
  const directory = fs.readdirSync(bunRoot).find((entry) => entry.startsWith(prefix));
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

module.exports = withNativeWind(config, { input: './global.css' });
