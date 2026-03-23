import mongoose from 'mongoose';

const agentMemorySchema = mongoose.Schema(
	{
		_id: {
			type: String,
			default: 'singleton'
		},
		adminPreferences: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		userInsights: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		contentInsights: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		experiments: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		recentRuns: {
			type: [
				{
					ranAt: Date,
					summary: String,
					quizzesGenerated: Number,
					quizzesSkipped: Number,
					plannerAction: String,
					selectedTopics: [String],
					citationsCount: Number
				}
			],
			default: []
		}
	},
	{
		timestamps: true,
		collection: 'agent_memory'
	}
);

export const AgentMemory = mongoose.model('AgentMemory', agentMemorySchema);
