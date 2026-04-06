import mongoose from 'mongoose';

const quizPendingSchema = mongoose.Schema(
	{
		title: {
			type: String,
			required: [true, 'Pending quiz title required']
		},
		description: {
			type: String,
			default: 'No Description'
		},
		topic: {
			type: String,
			required: [true, 'Topic is required for pending quiz']
		},
		tags: [
			{
				type: String
			}
		],
		format: {
			type: String,
			enum: ['speed_round', 'deep_dive', 'standard', 'streak'],
			default: 'standard'
		},
		questions: [
			{
				title: { type: String, required: true },
				correct: { type: String, required: true },
				options: [
					{
						value: { type: String, required: true }
					}
				]
			}
		],
		embedding: {
			type: [Number],
			select: false
		},
		generatedAt: {
			type: Date,
			default: Date.now
		},
		inspiredBy: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: 'Quiz'
			}
		],
		trendSummary: {
			type: String,
			default: ''
		},
		sourceType: {
			type: String,
			enum: ['internal', 'web', 'blended'],
			default: 'internal'
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
		plannerAction: {
			type: String,
			enum: ['generate_quizzes', 'stand_down', 'observe'],
			default: 'generate_quizzes'
		},
		plannerNotes: {
			type: String,
			default: ''
		},
		generationSignals: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		validationIssues: {
			type: [
				{
					status: {
						type: String,
						default: 'failed'
					},
					stage: {
						type: String,
						default: 'validation'
					},
					code: {
						type: String,
						default: 'validation_issue'
					},
					message: String
				}
			],
			default: []
		},
		verificationReport: {
			type: {
				overallVerdict: String,
				summary: String,
				factCheckRequired: Boolean,
				followUpActions: [String],
				questionReports: [
					{
						questionIndex: Number,
						claim: String,
						verdict: String,
						explanation: String,
						citations: [
							{
								url: String,
								title: String,
								domain: String
							}
						]
					}
				],
				sourceCitations: [
					{
						url: String,
						title: String,
						domain: String
					}
				]
			},
			default: undefined
		},
		revisionCount: {
			type: Number,
			default: 0
		},
		agentConfidence: {
			type: Number,
			min: 0,
			max: 1,
			required: [true, 'Agent confidence score is required']
		},
		status: {
			type: String,
			enum: ['pending', 'approved', 'rejected'],
			default: 'pending'
		},
		reviewedAt: {
			type: Date,
			default: undefined
		},
		reviewedBy: {
			type: String,
			default: undefined
		},
		rejectionReason: {
			type: String,
			default: undefined
		},
		approvedQuizId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Quiz',
			default: undefined
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true,
		collection: 'quizzes_pending'
	}
);

export const QuizPending = mongoose.model('QuizPending', quizPendingSchema);
