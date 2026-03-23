import dotenv from 'dotenv';

// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const envFound = dotenv.config({ quiet: true });

if (process.env.NODE_ENV !== 'production') {
	if (envFound.error) {
		// This error should crash whole process

		throw new Error("⚠️  Couldn't find .env file  ⚠️");
	}
}

process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || process.env.CLERK_API_KEY || '';

export const config = {
	/**
	 * Your favorite port
	 */
	port: parseInt(process.env.PORT, 10),

	/**
	 * That long string from mongodb
	 */
	databaseURL: process.env.MONGODB_URI,

	/**
	 * MongoDB (DB) password
	 */
	databasePassword: process.env.DB_PASSWORD,

	/**
	 * API configs
	 */
	api: {
		prefix: '/api/v1'
	},

	agent: {
		enabled: process.env.AGENT_ENABLED === 'true',
		model: process.env.AGENT_MODEL || 'claude-sonnet-4-20250514',
		plannerModel: process.env.AGENT_PLANNER_MODEL || 'gpt-5-mini',
		anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
		maxDailySpend: parseFloat(process.env.AGENT_MAX_DAILY_SPEND) || 5,
		maxRevisionAttempts: parseInt(process.env.AGENT_MAX_REVISIONS, 10) || 2,
		webSearchContextSize: process.env.AGENT_WEB_SEARCH_CONTEXT_SIZE || 'medium',
		webSearchLocation: {
			country: process.env.AGENT_WEB_SEARCH_COUNTRY || '',
			region: process.env.AGENT_WEB_SEARCH_REGION || '',
			city: process.env.AGENT_WEB_SEARCH_CITY || '',
			timezone:
				process.env.AGENT_WEB_SEARCH_TIMEZONE ||
				process.env.TZ ||
				Intl.DateTimeFormat().resolvedOptions().timeZone ||
				''
		}
	}
};
