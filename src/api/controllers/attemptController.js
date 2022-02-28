import { Attempt } from '../../models/Attempted.js';
import { Response } from '../../models/Response.js';
import { errorMessages } from '../../shared/constants.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const createAttempt = catchAsync(async (req, res, next) => {
	const { score, responses } = req.body;
	const { quizId } = req.params;
	const userId = req.user.id;

	if (!quizId || !score.toString()) {
		return next(new AppError('Please responses array and score.', 400));
	}

	if (!Array.isArray(responses)) {
		return next(new AppError('Please responses as an array.', 400));
	}
	if (!(responses.length > 0)) {
		return next(new AppError('Please do not send empty response.', 400));
	}

	const attemptExists = await Attempt.exists({ userId, quiz: quizId });

	const attempt = await Attempt.create({ userId, quiz: quizId, score });

	if (!attemptExists) {
		console.log('Not Exists.');
		const createdResponses = await Promise.all(
			responses.map((response) => {
				return Response.create({
					userId,
					quiz: quizId,
					attempt: attempt._id,
					questionId: response._id,
					question: {
						title: response.title,
						options: response.options,
						response: response.response,
						correct: response.correct
					}
				});
			})
		);

		return res.status(200).json({
			status: 'success',
			attempt,
			responses: createdResponses
		});
	} else {
		return res.status(200).json({
			status: 'success',
			attempt
		});
	}
});

export const getAttemptsByUser = catchAsync(async (req, res) => {
	const paginationSize = 6;
	const { page } = req.query;
	const userId = req.user.id;
	const attempts = await Attempt.find({ userId })
		.populate({
			path: 'quiz',
			select: '+deleted'
		})
		.limit(paginationSize)
		.skip(paginationSize * ((page || 1) - 1))
		.sort('-createdAt');
	const count = await Attempt.countDocuments({ userId });

	return res.status(200).json({
		status: 'success',
		count,
		attempts
	});
});

export const getAttemptById = catchAsync(async (req, res, next) => {
	const { attemptId } = req.params;
	const userLoggedInId = req.user.id;

	const attempt = await Attempt.findOne({ _id: attemptId }).populate({
		path: 'quiz',
		select: '+deleted'
	});

	if (!attempt) {
		return next(new AppError('Attempt not found', 404));
	}
	// console.log({ userLoggedInId, attemptUserId: attempt.userId, quizAuthor: attempt.quiz.author });
	if (attempt.quiz.author !== userLoggedInId && attempt.userId !== userLoggedInId) {
		return next(new AppError(errorMessages.ACCESS_DENIED, 403));
	}

	const userId = attempt.userId;

	const responses = await Response.find({
		quiz: attempt.quiz._id,
		attempt: attempt._id,
		userId
	}).sort({
		createdAt: 1
	});

	return res.status(200).json({
		status: 'success',
		attempt,
		responses
	});
});
