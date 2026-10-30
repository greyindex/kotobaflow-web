const eslint = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'vendor/**',
      'data/**',
      'experiments/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: [
      'js/**/*.js',
      'tests/**/*.js',
      'tools/resource_audit.js',
      'tools/generate_icons.js',
      'tools/generate_image_manifest.js',
      'tools/check_public_release*.cjs',
      'tools/build_public_release.cjs',
      'tools/build_site_pages.cjs',
      'tools/release_files.cjs',
      'tools/build_*_chunks.cjs',
      'tools/generate_sw_manifest.cjs',
      'tools/measure_loading.cjs',
      'tools/apply_learning_corrections.cjs',
      'tools/reviewed_resource_revisions*.cjs',
      'tools/textbook_text_pipeline.js',
      'tools/textbook_text_pipeline.test.cjs',
      'tools/repair_textbook_associations.cjs',
      '*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },
];
