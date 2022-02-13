import mongoose from 'mongoose';

const questionSchema = mongoose.Schema(
	{
		quiz: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Quiz',
			required: [true, 'A question has to be associated with a quiz required']
		},
		title: {
			type: String,
			required: [true, 'Question title required']
		},
		correct: {
			type: String,
			required: [true, 'Correct option required']
		},
		options: {
			type: [{ value: String }],
			validate: [arrayLimit, '{PATH} length should only be 4']
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

export const Question = mongoose.models.Question || mongoose.model('Question', questionSchema);

// https://stackoverflow.com/questions/28514790/how-to-set-limit-for-array-size-in-mongoose-schema
function arrayLimit(val) {
	return val.length === 4;
}
