import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['out/**', 'node_modules/**', '.vscode-test/**', 'scripts/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/naming-convention': ['warn', { selector: 'import', format: ['camelCase', 'PascalCase'] }],
			'@typescript-eslint/no-explicit-any': 'off',
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
		},
	},
);
