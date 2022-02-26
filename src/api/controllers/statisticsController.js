import { users } from '@clerk/clerk-sdk-node';
import mongoose from 'mongoose';
import { Attempt } from '../../models/Attempted.js';
import { Question } from '../../models/Question.js';
import { Quiz } from '../../models/Quiz.js';
import { Response } from '../../models/Response.js';
import { errorMessages } from '../../shared/constants.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getStatsByQuiz = catchAsync(async (req, res, next) => {
	const { quizId } = req.params;
	const userLoggedInId = req.user.id;

	const isAuthorInQuiz = await Quiz.exists({ author: userLoggedInId });

	if (!isAuthorInQuiz) {
		return next(new AppError(errorMessages.ACCESS_DENIED, 403));
	}

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
		uniqueUsers.map(
			(userId) => Attempt.findOne({ userId, quiz: quizId }).sort({ createdAt: 1 }) //.populate('responses')
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

export const getStatsByQuizQuestionId = catchAsync(async (req, res, next) => {
	const { quizId, questionId } = req.params;
	const userLoggedInId = req.user.id;

	const isAuthorInQuiz = await Quiz.exists({ author: userLoggedInId });

	if (!isAuthorInQuiz) {
		return next(new AppError(errorMessages.ACCESS_DENIED, 403));
	}

	const question = await Question.findOne({ quiz: quizId, _id: questionId });

	if (!question) {
		return next('Question not found.', 404);
	}

	const totalResponses = await Response.countDocuments({ quiz: quizId, questionId });
	const totalEmptyResponses = await Response.countDocuments({
		quiz: quizId,
		questionId,
		'question.response': ''
	});
	const totalCorrectResponses = await Response.countDocuments({
		quiz: quizId,
		questionId,
		$expr: { $eq: ['$question.response', '$question.correct'] }
	});

	const aggregations = await Response.aggregate([
		{
			$match: {
				quiz: mongoose.Types.ObjectId(quizId),
				questionId: mongoose.Types.ObjectId(questionId)
			}
		},
		{
			$group: {
				_id: { $toLower: '$question.response' },
				count: { $sum: 1 }
			}
		},
		{
			$group: {
				_id: null,
				counts: {
					$push: { k: '$_id', v: '$count' }
				}
			}
		},
		{
			$replaceRoot: {
				newRoot: { $arrayToObject: '$counts' }
			}
		}
	]);

	if (aggregations.length === 0) {
		return next(new AppError(errorMessages.NO_RESPONSE_EXISTS, 404));
	}

	const optionsWithFrequency = aggregations[0];
	const optionsWithFrequencyKey = Object.keys(optionsWithFrequency);

	const updatedQuestion = {
		_id: question._id,
		title: question.title,
		correct: question.correct,
		options: question.options
	};

	const updatedOptions = updatedQuestion.options.map((option) => {
		const updatedOption = { ...option.toObject() };
		const optionValue = updatedOption.value.toLowerCase();

		if (optionsWithFrequencyKey.includes(optionValue)) {
			updatedOption.frequency = optionsWithFrequency[optionValue];
		} else {
			updatedOption.frequency = 0;
		}

		return updatedOption;
	});

	updatedQuestion.options = updatedOptions;

	return res.status(200).json({
		status: 'success',
		question: updatedQuestion,
		totalResponses,
		totalEmptyResponses,
		totalCorrectResponses,
		totalIncorrectResponses: totalResponses - totalCorrectResponses
	});
});
