import mongoose from 'mongoose';

const quizSchema = mongoose.Schema(
	{
		title: {
			type: String,
			required: [true, 'Quiz title required']
		},
		description: {
			type: String,
			default: 'No Description'
		},
		tags: [
			{
				type: String,
				required: [true, 'Tags are required']
			}
		],
		status: {
			type: String,
			default: 'draft',
			enum: ['draft', 'active', 'inactive']
		},
		deleted: {
			type: Boolean,
			default: false,
			select: false
		},
		author: {
			type: String,
			required: [true, 'A quiz needs an author.']
		},
		embedding: {
			type: [Number],
			select: false,
			default: undefined
		},
		format: {
			type: String,
			enum: ['speed_round', 'deep_dive', 'standard', 'streak'],
			default: 'standard'
		},
		generatedBy: {
			type: String,
			enum: ['human', 'agent'],
			default: 'human'
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
		plannerNotes: {
			type: String,
			default: ''
		},
		generationSignals: {
			type: mongoose.Schema.Types.Mixed,
			default: {}
		},
		agentConfidence: {
			type: Number,
			min: 0,
			max: 1,
			default: undefined
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

quizSchema.virtual('questions', {
	ref: 'Question',
	foreignField: 'quiz',
	localField: '_id'
});

// https://github.com/Automattic/mongoose/issues/7573#issuecomment-516440616
quizSchema.virtual('questionsCount', {
	ref: 'Question',
	foreignField: 'quiz',
	localField: '_id',
	count: true
});

quizSchema.virtual('attemptsCount', {
	ref: 'Attempt',
	foreignField: 'quiz',
	localField: '_id',
	count: true
});

// quizSchema.pre(/^find/, function (next) {
//     this.find({ deleted: { $ne: true } })
//     next()
// })

export const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', quizSchema);
