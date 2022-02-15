import mongoose from 'mongoose';

const attemptSchema = mongoose.Schema(
	{
		userId: {
			type: String,
			required: [true, 'An attempt must have a user.']
		},
		quiz: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Quiz',
			required: [true, 'An attempt has to be associated with a quiz']
		},
		score: {
			type: Number,
			required: [true, 'An attempt has to have a score.']
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

attemptSchema.virtual('responses', {
	ref: 'Response',
	foreignField: 'attempt',
	localField: '_id'
});

export const Attempt = mongoose.model('Attempt', attemptSchema);
