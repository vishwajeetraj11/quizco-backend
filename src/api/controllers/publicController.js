import { users } from '@clerk/clerk-sdk-node';
import { Attempt } from '../../models/Attempted.js';
import { Quiz } from '../../models/Quiz.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getStat = catchAsync(async (req, res, next) => {
	const quizesCount = await Quiz.count({});
	const attemptsCount = await Attempt.count({});
	const noOfUsers = await users.getUserList({ limit: 100 });

	const result = {
		users: '',
		timesQuizesPlayed: '',
		quizes: ''
	};

	if (noOfUsers) {
		result.users = noOfUsers.length;
	}

	if (attemptsCount) {
		result.timesQuizesPlayed = attemptsCount;
	}

	if (quizesCount) {
		result.quizes = quizesCount;
	}

	return res.status(200).json({
		status: 'success',
		...result
	});
});
