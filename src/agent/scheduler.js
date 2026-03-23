import cron from 'node-cron';
import { config } from '../config/index.js';
import { runTrackedAgentCycle } from './index.js';

export const initAgentScheduler = () => {
	if (!config.agent.enabled) {
		console.log('[Agent] Agent is disabled. Scheduler not started.');
		return;
	}

	cron.schedule('0 */6 * * *', async () => {
		try {
			console.log('[Agent] Scheduled run triggered');
			const execution = await runTrackedAgentCycle({ trigger: 'scheduled' });

			if (execution.alreadyRunning) {
				console.log(
					'[Agent] Scheduled run skipped because another run is already in progress.'
				);
				return;
			}

			console.log('[Agent] Run complete:', execution.result);
		} catch (error) {
			console.error('[Agent] Scheduled run failed:', error.message);
		}
	});

	console.log('[Agent] Scheduler started (every 6 hours)');
};
