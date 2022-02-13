import { Attempt } from '../../models/Attempted.js';
import { Response } from '../../models/Response.js';
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

	const attempt = await Attempt.create({ userId, quiz: quizId, score });
	const createdResponses = await Promise.all(
		responses.map((response) => {
			return Response.create({
				userId,
				quiz: quizId,
				attempt: attempt._id,
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
});

export const getAttemptsByUser = catchAsync(async (req, res) => {
	const userId = req.user.id;
	const attempts = await Attempt.find({ userId }).populate({
		path: 'quiz',
		select: '+deleted'
	});

	return res.status(200).json({
		status: 'success',
		attempts
	});
});

export const getAttemptById = catchAsync(async (req, res, next) => {
	const { attemptId } = req.params;
	const userId = req.user.id;

	console.log({ attemptId });

	const attempt = await Attempt.findById(attemptId);

	if (!attempt) {
		return next(new AppError('Attempt not found', 404));
	}

	const responses = await Response.find({
		quiz: attempt.quiz,
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
