import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { config } from './config/index.js';
import { connectDB } from './loaders/index.js';
import { initExpress } from './loaders/initExpress.js';

dotenv.config();

connectDB();

try {
	const app = express();
	initExpress({ app });
	app.use(cors());

	app.listen(config.port, () => {
		console.log(`
      ################################################
      🛡️  Server listening on port: ${config.port} 🛡️
      ################################################
    `);
	}).on('error', (err) => {
		console.log(err);
		process.exit(1);
	});
} catch (e) {
	console.log('App LevelError');
	console.log(e);
}
