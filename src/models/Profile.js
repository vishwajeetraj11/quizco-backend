import mongoose from 'mongoose';

const profileSchems = mongoose.Schema(
	{
		userId: {
			type: String,
			required: [true, 'A profile must have a user.']
		},
		attempted: {
			type: [{ quiz: mongoose.Schema.Types.ObjectId, score: Number }]
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

export const Profile = mongoose.model('Profile', profileSchems);
