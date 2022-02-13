import { Router } from 'express';
import {
	createQuestion,
	deleteQuestion,
	getAllQuestion,
	getAllQuestionsWithCorrectAns,
	getQuestion,
	updateQuestion
} from '../controllers/questionController.js';
import { isAuthorInQuiz } from '../middlewares/isAuthorInQuiz.js';

export const questionRouter = Router({ mergeParams: true });

questionRouter.route('/').get(getAllQuestion).post(createQuestion);
questionRouter.route('/correct').get(getAllQuestionsWithCorrectAns);
questionRouter.route('/:questionId').get(getQuestion);
questionRouter.use(isAuthorInQuiz);
questionRouter.route('/:questionId').patch(updateQuestion).delete(deleteQuestion);
