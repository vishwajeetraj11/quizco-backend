import crypto from 'crypto';
import { ingestTraceEvent } from './traceStore.js';

const randomTraceId = () => crypto.randomUUID();

class AgentTracer {
	async startRun(name, metadata = {}) {
		const traceId = randomTraceId();

		try {
			const result = await ingestTraceEvent({
				event: 'run_start',
				run: {
					id: traceId,
					name: name || 'Agent Run',
					status: 'running',
					startedAt: new Date().toISOString(),
					metadata
				}
			});

			return {
				id: traceId,
				runId: result.runId,
				traceId: result.runTraceId || traceId
			};
		} catch (error) {
			console.warn('[AgentTrace] Failed to start run:', error.message);
			return null;
		}
	}

	async endRun(runId, status = 'completed', metadata = {}) {
		if (!runId) {
			return null;
		}

		try {
			return await ingestTraceEvent({
				event: 'run_end',
				run: {
					id: runId,
					status,
					endedAt: new Date().toISOString(),
					metadata
				}
			});
		} catch (error) {
			console.warn('[AgentTrace] Failed to end run:', error.message);
			return null;
		}
	}

	async startSpan(runId, opts = {}) {
		if (!runId) {
			return null;
		}

		const traceId = opts.id || randomTraceId();

		try {
			const result = await ingestTraceEvent({
				event: 'span_start',
				span: {
					id: traceId,
					runId,
					parentSpanId: opts.parentSpanId,
					type: opts.type || 'custom',
					name: opts.name || 'Unnamed span',
					input: opts.input,
					startedAt: new Date().toISOString(),
					metadata: opts.metadata
				}
			});

			return {
				id: traceId,
				spanId: result.spanId
			};
		} catch (error) {
			console.warn('[AgentTrace] Failed to start span:', error.message);
			return null;
		}
	}

	async endSpan(spanId, output, metadata = {}) {
		if (!spanId) {
			return null;
		}

		try {
			return await ingestTraceEvent({
				event: 'span_end',
				span: {
					id: spanId,
					output,
					endedAt: new Date().toISOString(),
					metadata
				}
			});
		} catch (error) {
			console.warn('[AgentTrace] Failed to end span:', error.message);
			return null;
		}
	}
}

export const tracer = new AgentTracer();
