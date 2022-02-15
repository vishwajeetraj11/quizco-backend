import { Router } from 'express';
import {
	createAttempt,
	getAttemptById,
	getAttemptsByUser
} from '../controllers/attemptController.js';
import {
	createQuiz,
	deleteQuiz,
	getAllQuizes,
	getQuiz,
	updateQuiz
} from '../controllers/quizController.js';
import { getStatsByQuiz, getStatsByQuizQuestionId } from '../controllers/statisticsController.js';
import { authorizeMiddleware } from '../middlewares/authMiddleware.js';
import { isAuthorInQuiz } from '../middlewares/isAuthorInQuiz.js';
import { questionRouter } from './questionRouter.js';

export const quizRouter = Router();
quizRouter.use(authorizeMiddleware);

quizRouter.route('/attempts/').get(getAttemptsByUser);
quizRouter.route('/attempts/:attemptId').get(getAttemptById);

quizRouter.route('/statistics/:quizId').get(getStatsByQuiz);
quizRouter.route('/statistics/:quizId/questions/:questionId').get(getStatsByQuizQuestionId);

quizRouter.use('/:quizId/questions', questionRouter);

quizRouter.route('/').get(getAllQuizes).post(createQuiz);
quizRouter.route('/:quizId').get(getQuiz);
quizRouter.route('/:quizId/attempts/save-score').post(createAttempt);

quizRouter.route('/:quizId').patch(isAuthorInQuiz, updateQuiz).delete(isAuthorInQuiz, deleteQuiz);
