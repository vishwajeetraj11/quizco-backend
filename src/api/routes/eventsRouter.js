import { Router } from 'express';
import { getEvents } from '../controllers/agentController.js';

export const eventsRouter = Router();

eventsRouter.get('/', getEvents);
