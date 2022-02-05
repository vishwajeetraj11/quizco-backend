
import { Router } from 'express';
import { createQuestion, deleteQuestion, getAllQuestion, getQuestion, updateQuestion } from '../controllers/questionController.js';

export const questionRouter = Router({ mergeParams: true });

questionRouter.route('/').get(getAllQuestion).post(createQuestion);
questionRouter.route('/:id').get(getQuestion).patch(updateQuestion).delete(deleteQuestion);