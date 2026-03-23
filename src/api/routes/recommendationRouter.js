import { Router } from 'express';
import { getRecommendations } from '../controllers/agentController.js';

export const recommendationRouter = Router();

recommendationRouter.get('/', getRecommendations);
