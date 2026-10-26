import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.smoke/**', 'apps/web/test/*.cjs', 'scripts/verify/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Dados do torneio ficam no IndexedDB (SPECS §9.4). localStorage só para preferências.' }],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['!./*', '!../*'], message: 'O domínio só importa a si mesmo (SPECS §3.1).' }] }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use o Rng injetado.' }, { object: 'Date', property: 'now', message: 'Use o relógio do contexto.' }],
    },
  },
  { files: ['apps/web/src/**/*.{ts,tsx}'], rules: { 'no-restricted-globals': 'off' } },
);
