import mongoose from 'mongoose';

const SPAN_TYPES = ['llm_call', 'tool_call', 'decision', 'error', 'custom'];

const agentSpanSchema = mongoose.Schema(
	{
		traceId: {
			type: String,
			default: undefined
		},
		runId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'AgentRun',
			required: [true, 'Agent span requires a runId']
		},
		parentSpanId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'AgentSpan',
			default: undefined
		},
		type: {
			type: String,
			enum: SPAN_TYPES,
			required: [true, 'Agent span type is required'],
			default: 'custom'
		},
		name: {
			type: String,
			required: [true, 'Agent span name is required']
		},
		input: {
			type: mongoose.Schema.Types.Mixed,
			default: undefined
		},
		output: {
			type: mongoose.Schema.Types.Mixed,
			default: undefined
		},
		startedAt: {
			type: Date,
			default: Date.now,
			required: true
		},
		endedAt: {
			type: Date,
			default: undefined
		},
		durationMs: {
			type: Number,
			default: undefined
		},
		metadata: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		}
	},
	{
		timestamps: true,
		collection: 'agent_spans'
	}
);

agentSpanSchema.index({ traceId: 1 }, { unique: true, sparse: true });
agentSpanSchema.index({ runId: 1, startedAt: 1 });
agentSpanSchema.index({ runId: 1, parentSpanId: 1 });

export const AgentSpan = mongoose.model('AgentSpan', agentSpanSchema);
