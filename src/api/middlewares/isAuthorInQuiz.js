import { Quiz } from "../../models/Quiz.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";

export const isAuthorInQuiz = catchAsync(async (req, res, next) => {

    const userId = req.user.id;
    const quiz = await Quiz.findById(req.params.quizId);

    if(!(quiz.author === userId)) {
        return next(new AppError('You are not the author of this quiz.', 403))
    }

    next();
});
