import { users } from '@clerk/clerk-sdk-node';
import { Attempt } from '../../models/Attempted.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getStatsByQuiz = catchAsync(async (req, res, next) => {
	const { quizId } = req.params;

	const usersAttempted = await Attempt.find({ quiz: quizId }).select('userId');
	// [{"_id":"PLACEHOLDER_VALUES","userId":"PLACEHOLDER_VALUES","id":"PLACEHOLDER_VALUES"}]

	const uniqueUsers = [...new Set(usersAttempted.map((user) => user.userId))];

	const usersFromClerk = await Promise.all(
		uniqueUsers.map((userId) => users.getUserList({ userId }))
	);

	const formattedUniqueUsers = usersFromClerk.map((userArr) => {
		const user = userArr[0];
		return {
			email: user.emailAddresses[0].emailAddress,
			firstName: user.firstName,
			lastName: user.lastName,
			photo: user.profileImageUrl,
			userId: user.id
		};
	});

	const firstAttempts = await Promise.all(
		uniqueUsers.map((userId) =>
			Attempt.findOne({ userId, quiz: quizId }).sort({ createdAt: 1 })
		)
	);

	const maxAttemptsPerUniqueUsers = await Promise.all(
		uniqueUsers.map((userId) =>
			Attempt.countDocuments({ quiz: quizId, userId }).then((val) => {
				return {
					userId,
					val
				};
			})
		)
	);

	const formattedUsersWithFirstAttempt = [];

	firstAttempts.forEach((attempt) => {
		const userFoundIndex = formattedUniqueUsers.findIndex(
			(formattedUser) => formattedUser.userId === attempt.userId
		);
		const maxAttemptsIndex = maxAttemptsPerUniqueUsers.findIndex(
			(user) => user.userId === attempt.userId
		);
		if (userFoundIndex !== -1 && maxAttemptsIndex !== -1) {
			formattedUsersWithFirstAttempt.push({
				attempt,
				user: formattedUniqueUsers[userFoundIndex],
				maxAttempts: maxAttemptsPerUniqueUsers[maxAttemptsIndex]
			});
		}
	});

	// TODO: Find max score of all unique users. --><--
	/*
  $match
  {
  quiz: ObjectId(''),
  userId: ''
  },

  $group 
  {
  _id: '_id',
  maxScore: {
    $avg: '$score'
  }
  }
  */

	// const noOfAttempts = await Attempt.countDocuments({ quiz: quizId });
	// const avgScore = await Attempt.aggregate([
	// 	{
	// 		$match: { quiz: mongoose.Types.ObjectId(quizId) } // Documents Matching a condition
	// 	},
	// 	{
	// 		$group: {
	// 			_id: '_id',
	// 			avgScore: { $avg: '$score' },
	// 			maxScore: { $max: '$score' },
	// 			minScore: { $min: '$score' }
	// 		}
	// 	}
	// ]);

	/*
  	Attempt.aggregate([
				{
					$match: { userId, quiz: mongoose.Types.ObjectId(quizId) }
				},
				{
					$group: { _id: '_id', maxAttempts: { $max: '$score' } }
				}
			])
  */

	return res.status(200).json({
		status: 'success',
		users: formattedUsersWithFirstAttempt
	});
});
