import mongoose from 'mongoose';

const agentRunSchema = mongoose.Schema(
	{
		traceId: {
			type: String,
			default: undefined
		},
		name: {
			type: String,
			default: 'Agent Run'
		},
		ranAt: {
			type: Date,
			default: Date.now,
			required: true
		},
		startedAt: {
			type: Date,
			default: undefined
		},
		endedAt: {
			type: Date,
			default: undefined
		},
		trigger: {
			type: String,
			enum: ['manual', 'scheduled'],
			default: 'scheduled'
		},
		requestedBy: {
			type: String,
			default: undefined
		},
		status: {
			type: String,
			enum: ['running', 'completed', 'skipped', 'failed'],
			default: 'completed'
		},
		durationMs: {
			type: Number,
			default: 0
		},
		quizzesGenerated: {
			type: Number,
			default: 0
		},
		quizzesSkipped: {
			type: Number,
			default: 0
		},
		recommendationsSent: {
			type: Number,
			default: 0
		},
		plannerAction: {
			type: String,
			enum: ['generate_quizzes', 'stand_down', 'observe'],
			default: undefined
		},
		plannedQuizCount: {
			type: Number,
			default: 0
		},
		selectedTopics: {
			type: [String],
			default: []
		},
		pendingQuizIds: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'QuizPending'
				}
			],
			default: []
		},
		sourceCitations: {
			type: [
				{
					url: String,
					title: String,
					domain: String
				}
			],
			default: []
		},
		toolTrace: {
			type: [
				{
					name: String,
					status: String,
					summary: String
				}
			],
			default: []
		},
		costUSD: {
			type: Number,
			default: 0
		},
		summary: {
			type: String,
			default: ''
		},
		plannerRationale: {
			type: String,
			default: ''
		},
		runErrors: {
			type: [String],
			default: []
		},
		metadata: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		}
	},
	{
		timestamps: true,
		collection: 'agent_runs'
	}
);

agentRunSchema.index({ traceId: 1 }, { unique: true, sparse: true });
agentRunSchema.index({ ranAt: -1 });
agentRunSchema.index({ startedAt: -1 });

export const AgentRun = mongoose.model('AgentRun', agentRunSchema);
