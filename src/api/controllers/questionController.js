import { Question } from "../../models/Question.js";
import { Quiz } from "../../models/Quiz.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";

export const createQuestion = catchAsync(async (req, res, next) => {
    const { quizId } = req.params;
    const { title, correct, options } = req.body;

    if (!title, !correct, !options) {
        return next(new AppError('Please send Quiz, title, correct, options array', 400));
    }

    options.forEach(option => {
        if (!option.value) {
            return next(new AppError('Please send all option with a value key in it.'));
        }
    });

    const question = await Question.create({
        quiz: quizId,
        author: req.user.id,
        title,
        correct,    
        options,
    })

    return res.status(200).json({
        status: 'success',
        question,
    })
})

export const getAllQuestion = catchAsync(async (req, res,next) => {
    const { quizId } = req.params;
    const quiz = await Quiz.findById(quizId);
    const questions = await Question.find({ quiz: quizId }).select('-correct');
    
    if(quiz.status !== 'active') {
        const isLoggedInUserAuthor = req.user.id === quiz.author;
        if(!isLoggedInUserAuthor) {
            return next(new AppError('You do not have permission to access this quiz.', 403));
        }
    }

    return res.status(200).json({
        status: 'success',
        questions,
        author: quiz.author
    })
})

export const getAllQuestionsWithCorrectAns = catchAsync(async (req,res) => {
    const { quizId } = req.params;
    const questions = await Question.find({ quiz: quizId }).select();

    return res.status(200).json({
        status: 'success',
        questions,
        author: questions[0].author
    })
})

export const getQuestion = catchAsync(async (req, res,) => {
    const { quizId, questionId } = req.params;

    const question = await Question.findOne({ _id: questionId, quiz: quizId });


    if (!question) {
        throw new AppError('Question not found', 404)
    }
    return res.status(200).json({
        status: 'success',
        question,
    })
})

export const updateQuestion = catchAsync(async (req, res, next) => {
    const { quizId, questionId } = req.params;
    const { title, correct, options } = req.body;
    

    const toUpdateData = {};

    if (title) {
        toUpdateData.title = title;
    }

    if (correct) {
        toUpdateData.correct = correct;
    }

    if (options) {
        if (!(options.length === 4)) return next(new AppError('Please send only 4 options'), 400);
        options.forEach(option => {
            if (!option.value) {
                return next(new AppError('Please send all option with a value key in it.'));
            }
        });
        toUpdateData.option = options;
    }

    const updatedQuestion = await Question.findOneAndUpdate({ _id: questionId, quiz: quizId }, toUpdateData, { new: true, runValidators: true });

    if (!updatedQuestion) {
        return next(new AppError("Question you are trying to update doesn't exist.", 404))
    }


    return res.status(200).json({
        status: 'success',
        question: updatedQuestion,
    })
})

export const deleteQuestion = catchAsync(async (req, res,) => {
    const { quizId, questionId } = req.params;

    const question = await Question.findOneAndDelete({ _id: questionId, quiz: quizId });

    if (!question) {
        throw new AppError("Question you are trying to delete doesn't exist.", 404)
    }
    
    return res.status(204).json({
        status: 'success',
    })
})