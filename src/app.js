import express from 'express';
import { initAgentScheduler } from './agent/scheduler.js';
import { config } from './config/index.js';
import { connectDB } from './loaders/index.js';
import { initExpress } from './loaders/initExpress.js';

connectDB();

try {
	const app = express();
	initExpress({ app });

	app.listen(config.port, () => {
		console.log(`
      ################################################
      Server listening on port: ${config.port}
      ################################################
    `);
		initAgentScheduler();
	}).on('error', (err) => {
		console.log(err);
		process.exit(1);
	});
} catch (e) {
	console.log('App LevelError');
	console.log(e);
}
