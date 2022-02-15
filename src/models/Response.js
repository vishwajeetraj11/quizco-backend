import mongoose from 'mongoose';

const responseSchema = mongoose.Schema(
	{
		userId: {
			type: String,
			required: [true, 'A response must have a user.']
		},
		quiz: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Quiz',
			required: [true, 'A response has to be associated with a quiz']
		},
		attempt: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Attempt',
			required: [true, 'A response has to be associated with an attempt.']
		},
		questionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Question',
			required: [true, 'A response has to be associated with a question.']
		},
		question: {
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
			response: {
				type: String
			}
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

//

export const Response = mongoose.model('Response', responseSchema);
function arrayLimit(val) {
	return val.length === 4;
}
