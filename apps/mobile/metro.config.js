// Metro-Konfiguration mit Monorepo-Unterstützung.
// Ohne diese Einstellungen findet Metro die Workspace-Pakete (@swissov/*)
// nicht, weil pnpm sie ausserhalb von apps/mobile/node_modules ablegt.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm verwendet Symlinks — Metro muss ihnen folgen.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
