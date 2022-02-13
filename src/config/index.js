import dotenv from 'dotenv';

// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const envFound = dotenv.config();

if (process.env.NODE_ENV !== 'production') {
	if (envFound.error) {
		// This error should crash whole process

		throw new Error("⚠️  Couldn't find .env file  ⚠️");
	}
}

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
	}
};
