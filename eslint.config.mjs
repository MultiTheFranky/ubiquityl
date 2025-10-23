import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin/use-at-your-own-risk/raw-plugin';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const testGlobals = {
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.flatConfigs['flat/recommended'],
  ...tseslint.flatConfigs['flat/stylistic'],
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.es2021,
        ...globals.node,
        ...testGlobals,
      },
    },
  },
];
