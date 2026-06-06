// ESLint flat config (GAP-ANALYSIS F3) — WARN-FIRST.
//
// Deliberately curated rather than inheriting the full recommended presets:
// every rule is a *warning*, so `npm run lint` is informative and exits clean
// against the existing backlog instead of failing on ~90 pre-existing nits.
// Ratchet individual rules to "error" (and wire `lint` into CI as blocking) as
// the codebase is brought clean per category. The inline-color / CSS-token
// gates stay the dedicated check-*.mjs scripts in package.json `build`.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'scripts/**', '*.config.{js,ts}'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // Suppression / type-safety discipline (DESIGN.app.md) — warn-first now,
      // promote to error once clean.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // console.* should be intentional; the few diagnostic sites carry an
      // explicit eslint-disable. Enabling the rule makes those directives
      // meaningful (not "unused") and flags stray logging.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Hooks correctness — the highest-value lint for this codebase.
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // Accessibility essentials (App-UI a11y).
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/aria-role': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      // DESIGN.app.md: no emoji used as icons — use the Lucide ui/icons set.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXText[value=/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]",
          message: 'No emoji as icons (DESIGN.app.md) — use a ui/icons Lucide icon.',
        },
      ],
    },
  },
);
