import mongoose from 'mongoose';

const profileSchems = mongoose.Schema(
	{
		userId: {
			type: String,
			required: [true, 'A profile must have a user.']
		},
		attempted: {
			type: [{ quiz: mongoose.Schema.Types.ObjectId, score: Number }]
		},
		preferences: {
			topics: {
				type: [
					{
						name: { type: String, required: true },
						rank: { type: Number, default: 0 }
					}
				],
				default: []
			},
			playStyle: {
				type: String,
				enum: ['casual', 'competitive', 'learner', 'explorer'],
				default: undefined
			},
			onboardedAt: {
				type: Date,
				default: undefined
			},
			inferredDifficulty: {
				type: String,
				enum: ['beginner', 'intermediate', 'advanced'],
				default: undefined
			},
			inferredFormat: {
				type: String,
				enum: ['speed_round', 'deep_dive', 'standard', 'streak'],
				default: undefined
			},
			lastActive: {
				type: Date,
				default: undefined
			}
		}
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true
	}
);

export const Profile = mongoose.model('Profile', profileSchems);
