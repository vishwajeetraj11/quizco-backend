
import { Router } from 'express';
import { createQuiz, deleteQuiz, getAllQuizes, getQuiz, updateQuiz } from '../controllers/quizController.js';
import { questionRouter } from './questionRouter.js';

export const quizRouter = Router();

quizRouter.use('/:quizId/questions', questionRouter);
quizRouter.route('/').get(getAllQuizes).post(createQuiz);
quizRouter.route('/:id').get(getQuiz).patch(updateQuiz).delete(deleteQuiz);
