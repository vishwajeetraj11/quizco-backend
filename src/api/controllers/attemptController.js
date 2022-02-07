import { Attempt } from '../../models/Attempted.js'
import { AppError } from '../../utils/AppError.js'
import { catchAsync } from '../../utils/catchAsync.js'

export const createAttempt = catchAsync(async (req, res, next) => {
    const { score } = req.body
    const { quizId } = req.params
    const userId = req.user.id

    if (!quizId || !score.toString()) {
        return next(new AppError('Please send Quiz Id and score.', 400))
    }

    const attempt = await Attempt.create({ userId, quiz: quizId, score })

    return res.status(200).json({
        status: 'success',
        attempt,
    })
})

export const getAttemptsByUser = catchAsync(async (req, res) => {
    const userId = req.user.id
    const attempts = await Attempt.find({ userId }).populate({path: 'quiz', select: '+deleted'});

    return res.status(200).json({
        status: 'success',
        attempts,
    })
})
