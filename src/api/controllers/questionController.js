import { Question } from '../../models/Question.js';
import { Quiz } from '../../models/Quiz.js';
import { Response } from '../../models/Response.js';
import { emptyResponseMessages, errorMessages } from '../../shared/constants.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const createQuestion = catchAsync(async (req, res, next) => {
	const { quizId } = req.params;
	const { title, correct, options } = req.body;

	if ((!title, !correct, !options)) {
		return next(new AppError('Please send Quiz, title, correct, options array', 400));
	}

	options.forEach((option) => {
		if (!option.value) {
			return next(new AppError('Please send all option with a value key in it.'));
		}
	});

	const quiz = await Quiz.findById(quizId).populate('questionsCount');

	if (!quiz) {
		return next(new AppError("Cannot add questions to a quiz that doesn't exist", 404));
	}

	if (quiz.questionsCount > 9) {
		return next(new AppError('A Quiz cannot have more that 10 questions.', 409));
	}

	const question = await Question.create({
		quiz: quizId,
		author: req.user.id,
		title,
		correct,
		options
	});

	return res.status(200).json({
		status: 'success',
		question
	});
});

export const getAllQuestion = catchAsync(async (req, res, next) => {
	const { quizId } = req.params;
	const quiz = await Quiz.findById(quizId);
	const questions = await Question.find({ quiz: quizId }).select('-correct');

	if (!quiz) {
		return next(new AppError('Quiz not found.', 404));
	}

	if (quiz.status !== 'active') {
		const isLoggedInUserAuthor = req.user.id === quiz.author;
		if (!isLoggedInUserAuthor) {
			return next(new AppError('You do not have permission to access this quiz.', 403));
		}
	}

	return res.status(200).json({
		status: 'success',
		questions,
		author: quiz.author
	});
});

export const getAllQuestionsWithCorrectAns = catchAsync(async (req, res, next) => {
	const { quizId } = req.params;
	const questions = await Question.find({ quiz: quizId }).select();

	if (questions.length === 0) {
		return res.status(200).json({
			status: 'success',
			message: 'No Question in this Quiz yet.'
		});
	}

	return res.status(200).json({
		status: 'success',
		questions,
		author: questions[0].author
	});
});

export const getQuestion = catchAsync(async (req, res) => {
	const { quizId, questionId } = req.params;

	const question = await Question.findOne({ _id: questionId, quiz: quizId });

	if (!question) {
		throw new AppError(emptyResponseMessages.NO_QUESTIONS_IN_QUIZ, 404);
	}
	return res.status(200).json({
		status: 'success',
		question
	});
});

export const updateQuestion = catchAsync(async (req, res, next) => {
	const { quizId, questionId } = req.params;
	const { title, correct, options } = req.body;

	const questiontoUpdate = await Question.findOne({ _id: questionId, quiz: quizId });

	if (!questiontoUpdate) {
		return next(new AppError(errorMessages.RESOURCE_DOES_NOT_EXIST('Question'), 404));
	}

	let shouldClearEarlierResponses = false;

	if (title) {
		questiontoUpdate.title = title;
	}

	if (correct) {
		if (questiontoUpdate.correct !== correct) {
			shouldClearEarlierResponses = true;
		}
		questiontoUpdate.correct = correct;
	}

	if (options) {
		if (!(options.length === 4)) return next(new AppError('Please send only 4 options'), 400);
		options.forEach((option, index) => {
			if (!option.value) {
				return next(new AppError('Please send all option with a value key in it.'));
			}
			if (options[index] !== questiontoUpdate.options[index]) {
				shouldClearEarlierResponses = true;
			}
		});
		questiontoUpdate.options = options;
	}

	if (shouldClearEarlierResponses) {
		console.log('delete responses');
		await Response.deleteMany({ questionId: questiontoUpdate._id });
	}

	questiontoUpdate.save();

	return res.status(200).json({
		status: 'success',
		question: questiontoUpdate
	});
});

export const deleteQuestion = catchAsync(async (req, res) => {
	const { quizId, questionId } = req.params;

	const question = await Question.findOneAndDelete({ _id: questionId, quiz: quizId });

	if (!question) {
		throw new AppError("Question you are trying to delete doesn't exist.", 404);
	}

	return res.status(204).json({
		status: 'success'
	});
});
