/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2023: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.next/',
    'build/',
    'coverage/',
    '*.config.js',
    '*.config.cjs',
    '.expo/',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
    'no-restricted-syntax': [
      'error',
      {
        // Verhindert versehentliche String-Konkatenation in SQL (SQL-Injection-Schutz, §42).
        selector:
          "CallExpression[callee.property.name='query'] > BinaryExpression[operator='+']",
        message:
          'SQL darf nicht per String-Konkatenation gebaut werden. Parametrisierte Queries ($1, $2, ...) verwenden.',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/fixtures/**'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      // React-Oberflächen (Web-PWA, Admin-Portal). Die Hook-Regeln fangen
      // genau die Fehler ab, die man erst in Produktion bemerkt: fehlende
      // Abhängigkeiten in Effekten und bedingt aufgerufene Hooks.
      files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
      plugins: ['react-hooks'],
      env: { browser: true },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
    {
      // Service Worker: eigene globale Umgebung, kein DOM.
      files: ['apps/web/public/sw.js'],
      env: { serviceworker: true, browser: true },
    },
  ],
};
