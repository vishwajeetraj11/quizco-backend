import { Router } from 'express';
import {
	getAgentBriefing,
	createAgentRun,
	getEvents,
	getAgentHealth,
	getAgentRuns,
	getPendingQuiz,
	getPendingQuizzes,
	getRecommendations,
	approvePendingQuiz,
	rejectPendingQuiz,
	reviewPendingQuiz,
	getSkippedRuns
} from '../controllers/agentController.js';

export const agentRouter = Router();

agentRouter.get('/briefing', getAgentBriefing);
agentRouter.get('/health', getAgentHealth);
agentRouter.get('/events', getEvents);
agentRouter.get('/pending', getPendingQuizzes);
agentRouter.get('/pending/:pendingId', getPendingQuiz);
agentRouter.post('/pending/:pendingId', reviewPendingQuiz);
agentRouter.patch('/pending/:pendingId', reviewPendingQuiz);
agentRouter.post('/pending/:pendingId/approve', approvePendingQuiz);
agentRouter.patch('/pending/:pendingId/approve', approvePendingQuiz);
agentRouter.post('/pending/:pendingId/reject', rejectPendingQuiz);
agentRouter.patch('/pending/:pendingId/reject', rejectPendingQuiz);
agentRouter.get('/recommendations', getRecommendations);
agentRouter.post('/runs', createAgentRun);
agentRouter.get('/runs', getAgentRuns);
agentRouter.get('/skipped', getSkippedRuns);
