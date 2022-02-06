
import { Router } from 'express';
import { createAttempt, getAttemptsByUser } from '../controllers/attemptController.js';
import { createQuiz, deleteQuiz, getAllQuizes, getQuiz, updateQuiz } from '../controllers/quizController.js';
import { authorizeMiddleware } from '../middlewares/authMiddleware.js';
import { isAuthorInQuiz } from '../middlewares/isAuthorInQuiz.js';
import { questionRouter } from './questionRouter.js';

export const quizRouter = Router();
quizRouter.use(authorizeMiddleware);
quizRouter.route('/attempts/').get(getAttemptsByUser);
quizRouter.use('/:quizId/questions', questionRouter);
quizRouter.route('/').get(getAllQuizes).post(createQuiz);
quizRouter.route('/:quizId').get(getQuiz);
quizRouter.route('/:quizId/attempts/save-score').post(createAttempt);

quizRouter.route('/:quizId').patch(isAuthorInQuiz,updateQuiz).delete(isAuthorInQuiz,deleteQuiz);


