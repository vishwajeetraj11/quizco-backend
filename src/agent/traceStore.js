import mongoose from 'mongoose';
import { AgentRun } from '../models/AgentRun.js';
import { AgentSpan } from '../models/AgentSpan.js';

const TRACE_EVENTS = new Set(['run_start', 'span_start', 'span_end', 'run_end']);
const SPAN_TYPES = new Set(['llm_call', 'tool_call', 'decision', 'error', 'custom']);
const RUN_STATUSES = new Set(['running', 'completed', 'failed', 'skipped']);

const isPlainObject = (value) =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toDate = (value, fallback = undefined) => {
	if (!value) {
		return fallback;
	}

	const date = value instanceof Date ? value : new Date(value);

	return Number.isNaN(date.getTime()) ? fallback : date;
};

const toObjectId = (value) => {
	if (!value) {
		return null;
	}

	if (value instanceof mongoose.Types.ObjectId) {
		return value;
	}

	if (typeof value !== 'string') {
		return null;
	}

	if (!mongoose.Types.ObjectId.isValid(value)) {
		return null;
	}

	return new mongoose.Types.ObjectId(value);
};

const normalizeRunStatus = (value, fallback = 'running') =>
	typeof value === 'string' && RUN_STATUSES.has(value) ? value : fallback;

const normalizeSpanType = (value, fallback = 'custom') =>
	typeof value === 'string' && SPAN_TYPES.has(value) ? value : fallback;

const computeDurationMs = ({ startedAt, endedAt, fallback = 0 }) => {
	if (!startedAt || !endedAt) {
		return fallback;
	}

	return Math.max(0, endedAt.getTime() - startedAt.getTime());
};

const resolveRunByIdentifier = async (identifier) => {
	if (!identifier || typeof identifier !== 'string') {
		return null;
	}

	const objectId = toObjectId(identifier);

	if (objectId) {
		const byObjectId = await AgentRun.findById(objectId);

		if (byObjectId) {
			return byObjectId;
		}
	}

	return AgentRun.findOne({ traceId: identifier });
};

const resolveSpanByIdentifier = async (identifier) => {
	if (!identifier || typeof identifier !== 'string') {
		return null;
	}

	const objectId = toObjectId(identifier);

	if (objectId) {
		const byObjectId = await AgentSpan.findById(objectId);

		if (byObjectId) {
			return byObjectId;
		}
	}

	return AgentSpan.findOne({ traceId: identifier });
};

const mapTraceRun = (run, spanCount = 0) => {
	const startedAt = run.startedAt || run.ranAt || run.createdAt || null;
	const endedAt = run.endedAt || null;
	const durationMs =
		typeof run.durationMs === 'number'
			? run.durationMs
			: computeDurationMs({
					startedAt,
					endedAt,
					fallback: 0
				});

	return {
		id: run.traceId || run._id.toString(),
		_id: run._id.toString(),
		traceId: run.traceId || null,
		name: run.name || 'Agent Run',
		status: run.status || 'completed',
		startedAt,
		endedAt,
		durationMs,
		spanCount,
		metadata: isPlainObject(run.metadata) ? run.metadata : {}
	};
};

const mapTraceSpan = (span) => ({
	id: span.traceId || span._id.toString(),
	_id: span._id.toString(),
	traceId: span.traceId || null,
	runId: span.runId?.toString?.() || null,
	parentSpanId: span.parentSpanId?.toString?.() || null,
	type: span.type,
	name: span.name,
	input: span.input,
	output: span.output,
	startedAt: span.startedAt || span.createdAt || null,
	endedAt: span.endedAt || null,
	durationMs:
		typeof span.durationMs === 'number'
			? span.durationMs
			: computeDurationMs({
					startedAt: span.startedAt,
					endedAt: span.endedAt,
					fallback: 0
				}),
	metadata: isPlainObject(span.metadata) ? span.metadata : {},
	createdAt: span.createdAt || null,
	updatedAt: span.updatedAt || null
});

const ensureRun = async ({ event, run = {}, span = {}, now }) => {
	let runDoc = null;

	if (typeof run.id === 'string') {
		runDoc = await resolveRunByIdentifier(run.id);
	}

	if (!runDoc && typeof span.runId === 'string') {
		runDoc = await resolveRunByIdentifier(span.runId);
	}

	if (!runDoc && event === 'run_start') {
		const startedAt = toDate(run.startedAt, now);
		const metadata = isPlainObject(run.metadata) ? run.metadata : {};
		const status = normalizeRunStatus(run.status, 'running');
		runDoc = await AgentRun.create({
			traceId: typeof run.id === 'string' ? run.id : undefined,
			name: run.name || 'Agent Run',
			ranAt: startedAt,
			startedAt,
			endedAt: undefined,
			status,
			metadata,
			durationMs: 0
		});

		return runDoc;
	}

	if (!runDoc) {
		return null;
	}

	const updatedRun = runDoc;
	const startedAt = toDate(run.startedAt, updatedRun.startedAt || updatedRun.ranAt || now);
	const endedAt = toDate(
		run.endedAt,
		event === 'run_end' ? now : updatedRun.endedAt || undefined
	);
	const statusFromEvent = event === 'run_start' ? 'running' : undefined;
	const defaultEndStatus = event === 'run_end' ? 'completed' : updatedRun.status || 'running';
	const status = normalizeRunStatus(run.status || statusFromEvent, defaultEndStatus);
	const metadata = isPlainObject(run.metadata)
		? { ...(isPlainObject(updatedRun.metadata) ? updatedRun.metadata : {}), ...run.metadata }
		: isPlainObject(updatedRun.metadata)
			? updatedRun.metadata
			: {};

	updatedRun.name = run.name || updatedRun.name || 'Agent Run';
	updatedRun.ranAt = updatedRun.ranAt || startedAt || now;
	updatedRun.startedAt = startedAt || updatedRun.startedAt;
	updatedRun.status = status;
	updatedRun.metadata = metadata;

	if (endedAt) {
		updatedRun.endedAt = endedAt;
		updatedRun.durationMs = computeDurationMs({
			startedAt: updatedRun.startedAt || updatedRun.ranAt,
			endedAt,
			fallback: updatedRun.durationMs || 0
		});
	}

	if (typeof run.id === 'string' && !updatedRun.traceId) {
		updatedRun.traceId = run.id;
	}

	await updatedRun.save();

	return updatedRun;
};

export const ingestTraceEvent = async ({ event, run = {}, span = {} }) => {
	if (!TRACE_EVENTS.has(event)) {
		throw new Error(
			`Invalid trace event "${event}". Allowed values: ${Array.from(TRACE_EVENTS).join(', ')}.`
		);
	}

	const now = new Date();
	let runDoc = await ensureRun({ event, run, span, now });
	let spanDoc = null;

	if (typeof span.id === 'string') {
		spanDoc = await resolveSpanByIdentifier(span.id);

		if (!runDoc && spanDoc) {
			runDoc = await AgentRun.findById(spanDoc.runId);
		}
	}

	if (!runDoc && typeof span.runId === 'string') {
		runDoc = await resolveRunByIdentifier(span.runId);
	}

	if ((event === 'span_start' || event === 'span_end') && !runDoc) {
		throw new Error('A valid run is required for span events.');
	}

	if (event === 'run_end' && !runDoc) {
		throw new Error('A valid run is required for run_end events.');
	}

	if ((event === 'span_start' || event === 'span_end') && !span) {
		throw new Error('Span payload is required for span events.');
	}

	if (event === 'span_start' || event === 'span_end') {
		const existingMetadata = isPlainObject(spanDoc?.metadata) ? spanDoc.metadata : {};
		const mergedMetadata = isPlainObject(span.metadata)
			? { ...existingMetadata, ...span.metadata }
			: existingMetadata;
		const runId = runDoc?._id || spanDoc?.runId;
		let parentSpanId = spanDoc?.parentSpanId || undefined;

		if (typeof span.parentSpanId === 'string') {
			const parentSpan = await resolveSpanByIdentifier(span.parentSpanId);
			parentSpanId = parentSpan?._id || toObjectId(span.parentSpanId) || undefined;
		}

		const spanStartedAt = toDate(span.startedAt, spanDoc?.startedAt || now);
		const spanEndedAt = toDate(
			span.endedAt,
			event === 'span_end' ? now : spanDoc?.endedAt || undefined
		);
		const durationMs =
			typeof span.durationMs === 'number'
				? Math.max(0, span.durationMs)
				: computeDurationMs({
						startedAt: spanStartedAt,
						endedAt: spanEndedAt,
						fallback: spanDoc?.durationMs || 0
					});

		if (spanDoc) {
			spanDoc.runId = runId || spanDoc.runId;
			spanDoc.parentSpanId =
				parentSpanId && spanDoc._id?.toString() !== parentSpanId.toString()
					? parentSpanId
					: undefined;
			spanDoc.type = normalizeSpanType(span.type, spanDoc.type || 'custom');
			spanDoc.name = span.name || spanDoc.name || 'Unnamed span';
			spanDoc.input = span.input !== undefined ? span.input : spanDoc.input;
			spanDoc.output = span.output !== undefined ? span.output : spanDoc.output;
			spanDoc.startedAt = spanStartedAt;
			spanDoc.endedAt = spanEndedAt;
			spanDoc.durationMs = durationMs;
			spanDoc.metadata = mergedMetadata;

			if (typeof span.id === 'string' && !spanDoc.traceId) {
				spanDoc.traceId = span.id;
			}

			await spanDoc.save();
		} else {
			if (!runId) {
				throw new Error('Unable to resolve run for new span.');
			}

			spanDoc = await AgentSpan.create({
				traceId: typeof span.id === 'string' ? span.id : undefined,
				runId,
				parentSpanId,
				type: normalizeSpanType(span.type, 'custom'),
				name: span.name || 'Unnamed span',
				input: span.input,
				output: span.output,
				startedAt: spanStartedAt,
				endedAt: spanEndedAt,
				durationMs,
				metadata: mergedMetadata
			});
		}

		if (runDoc?.status !== 'running' && event === 'span_start') {
			runDoc.status = 'running';
			await runDoc.save();
		}
	}

	if (event === 'run_end' && runDoc) {
		const endStatus = normalizeRunStatus(run.status, 'completed');
		const runEndedAt = toDate(run.endedAt, now);
		const runStartedAt = runDoc.startedAt || runDoc.ranAt || now;
		const mergedMetadata = isPlainObject(run.metadata)
			? {
					...(isPlainObject(runDoc.metadata) ? runDoc.metadata : {}),
					...run.metadata
				}
			: isPlainObject(runDoc.metadata)
				? runDoc.metadata
				: {};

		runDoc.name = run.name || runDoc.name || 'Agent Run';
		runDoc.status = endStatus;
		runDoc.endedAt = runEndedAt;
		runDoc.startedAt = runStartedAt;
		runDoc.ranAt = runDoc.ranAt || runStartedAt;
		runDoc.metadata = mergedMetadata;
		runDoc.durationMs = computeDurationMs({
			startedAt: runStartedAt,
			endedAt: runEndedAt,
			fallback: runDoc.durationMs || 0
		});

		if (typeof run.id === 'string' && !runDoc.traceId) {
			runDoc.traceId = run.id;
		}

		await runDoc.save();
	}

	return {
		runId: runDoc?._id?.toString() || null,
		spanId: spanDoc?._id?.toString() || null,
		runTraceId: runDoc?.traceId || null,
		spanTraceId: spanDoc?.traceId || null
	};
};

export const getTraceRuns = async ({ limit = 20, page = 1 } = {}) => {
	const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
	const safePage = Math.max(parseInt(page, 10) || 1, 1);
	const skip = (safePage - 1) * safeLimit;
	const [runs, total] = await Promise.all([
		AgentRun.find({})
			.sort({ startedAt: -1, ranAt: -1, createdAt: -1 })
			.skip(skip)
			.limit(safeLimit)
			.lean(),
		AgentRun.countDocuments({})
	]);
	const runIds = runs.map((run) => run._id);
	const spanCounts = runIds.length
		? await AgentSpan.aggregate([
				{
					$match: {
						runId: {
							$in: runIds
						}
					}
				},
				{
					$group: {
						_id: '$runId',
						count: {
							$sum: 1
						}
					}
				}
			])
		: [];
	const spanCountLookup = new Map(spanCounts.map((entry) => [entry._id.toString(), entry.count]));

	return {
		page: safePage,
		limit: safeLimit,
		total,
		runs: runs.map((run) => mapTraceRun(run, spanCountLookup.get(run._id.toString()) || 0))
	};
};

export const getTraceRunDetail = async (runIdentifier) => {
	const run = await resolveRunByIdentifier(runIdentifier);

	if (!run) {
		return null;
	}

	const spans = await AgentSpan.find({ runId: run._id })
		.sort({ startedAt: 1, createdAt: 1 })
		.lean();

	return {
		run: mapTraceRun(run.toObject ? run.toObject() : run, spans.length),
		spans: spans.map(mapTraceSpan)
	};
};
