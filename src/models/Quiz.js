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
