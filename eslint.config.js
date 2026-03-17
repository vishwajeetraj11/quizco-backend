import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
	{
		ignores: ['node_modules/**']
	},
	js.configs.recommended,
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 2021,
			sourceType: 'module',
			globals: {
				console: 'readonly',
				process: 'readonly'
			}
		},
		rules: {
			'class-methods-use-this': 'off',
			'no-param-reassign': 'off',
			camelcase: 'off',
			'no-unused-vars': ['warn', { argsIgnorePattern: 'next' }]
		}
	},
	eslintPluginPrettierRecommended
];
