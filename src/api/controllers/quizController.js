import { Quiz } from '../../models/Quiz.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAllQuizes = catchAsync(async (req, res) => {
    const {userId} = req.query;
    const filters={}
    if(userId) {
       filters.author = userId
    }
    const quizes = await Quiz.find({...filters})

    return res.status(200).json({
        status: 'success',
        quizes,
    })
})

export const createQuiz = catchAsync(async (req, res, next) => {
    const { title, description, tags, status } = req.body;

    const author = req.user.id;

    if (!title || !description || !tags || !author) {
        return next(new AppError('Please send Quiz title, description, tags and author.', 400))
    }

    if(!Array.isArray(tags)) {
        return next(new AppError('Please send tags as array.', 400))   
    }

    if (!(tags.length >= 1)) {
        return next(new AppError('Please send at least 1 tag in array.', 400))
    }

    const quiz = await Quiz.create({ title, description, tags, author, status: status });

    return res.status(200).json({
        status: 'success',
        quiz: quiz,
    })
})

export const getQuiz = catchAsync(async (req, res, next) => {
    const { params } = req
    const quiz = await Quiz.findById(params.id).populate('questions');

    if (!quiz) {
        return next(new AppError('Quiz not found', 404))
    }

    return res.status(200).json({
        status: 'success',
        quiz: quiz,
    })
})

export const updateQuiz = catchAsync(async (req, res, next) => {
    const { title, description, tags, status } = req.body;
    const { id } = req.params;
    const toUpdateData = {};

    if (title) {
        toUpdateData.title = title;
    }

    if (description) {
        toUpdateData.description = description;
    }

    if (tags) {
        if (!(tags.length >= 1)) return next(new AppError('Please send at least 1 tag.'), 400);
        toUpdateData.tags = tags;
    }

    if (status) {
        toUpdateData.status = status;
    }

    const updatedQuiz = await Quiz.findOneAndUpdate({ _id: id }, toUpdateData, { new: true, runValidators: true });

    return res.status(200).json({
        status: 'success',
        quiz: updatedQuiz,
    })
})


export const deleteQuiz = catchAsync(async (req, res,) => {
    const { id } = req.params;

    const quiz = await Quiz.findOneAndDelete({ _id: id });

    if (!quiz) {
        throw new AppError("Quiz you are trying to delete doesn't exist.", 404)
    }

    return res.status(204).json({
        status: 'success',
    })
})