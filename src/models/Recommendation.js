import mongoose from 'mongoose';

const recommendationSchema = mongoose.Schema(
	{
		userId: {
			type: String,
			required: [true, 'A recommendation must have a user.'],
			index: true
		},
		quizId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Quiz',
			required: [true, 'A recommendation must reference a quiz.']
		},
		type: {
			type: String,
			enum: ['trending', 'personalized', 'new_format', 'challenge', 'revisit'],
			required: true
		},
		message: {
			type: String,
			default: ''
		},
		generatedAt: {
			type: Date,
			default: Date.now
		},
		shownAt: {
			type: Date,
			default: undefined
		},
		clicked: {
			type: Boolean,
			default: false
		},
		expiresAt: {
			type: Date,
			required: [true, 'Recommendation must have an expiry date.']
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

recommendationSchema.index({ userId: 1, generatedAt: -1 });
recommendationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Recommendation = mongoose.model('Recommendation', recommendationSchema);
