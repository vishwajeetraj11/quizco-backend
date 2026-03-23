import mongoose from 'mongoose';
import { isAgentRunInProgress, runTrackedAgentCycle } from '../../agent/index.js';
import { runPreFlightChecks } from '../../agent/guards.js';
import { refreshAgentMemory } from '../../agent/memory.js';
import { config } from '../../config/index.js';
import { AgentMemory } from '../../models/AgentMemory.js';
import { AgentRun } from '../../models/AgentRun.js';
import { Question } from '../../models/Question.js';
import { QuizPending } from '../../models/QuizPending.js';
import { Quiz } from '../../models/Quiz.js';
import { Recommendation } from '../../models/Recommendation.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

const CONNECTION_STATES = {
	0: 'disconnected',
	1: 'connected',
	2: 'connecting',
	3: 'disconnecting'
};

const formatPendingQuiz = (quiz) => ({
	...quiz,
	questionCount: quiz?.questions?.length || 0
});

const buildEvent = ({
	id,
	type,
	title,
	message,
	createdAt,
	status,
	entityType,
	entityId,
	metadata = {}
}) => ({
	id,
	type,
	title,
	message,
	createdAt,
	status,
	entityType,
	entityId,
	metadata
});

const getPendingQuizOrThrow = async (pendingId) => {
	const pendingQuiz = await QuizPending.findById(pendingId);

	if (!pendingQuiz) {
		throw new AppError('Pending quiz not found', 404);
	}

	return pendingQuiz;
};

const buildBriefingSummary = ({
	lastRun,
	totalPending,
	totalRecommendations,
	totalSkippedRuns,
	preflight,
	agentEnabled
}) => {
	if (!lastRun) {
		return agentEnabled
			? 'No agent runs have completed yet. The dashboard is ready once the first cycle writes data.'
			: 'The agent is currently disabled. Enable AGENT_ENABLED to start collecting agent activity.';
	}

	if (!preflight.allowed) {
		return `Last run was ${lastRun.ranAt?.toISOString?.() || 'recent'}, and there are ${preflight.blockers.length} active blocker(s) preventing the next full cycle.`;
	}

	return `Last run generated ${lastRun.quizzesGenerated || 0} quizzes, ${totalPending} quizzes are awaiting review, ${totalRecommendations} recommendations are active, and ${totalSkippedRuns} run(s) recorded skips.`;
};

export const getAgentHealth = catchAsync(async (req, res) => {
	const [lastRun] = await AgentRun.find({}).sort({ ranAt: -1 }).limit(1).lean();

	let preflight = {
		allowed: false,
		checks: [],
		blockers: []
	};
	let healthStatus = 'healthy';

	try {
		preflight = await runPreFlightChecks();
		healthStatus = preflight.allowed ? 'healthy' : 'blocked';
	} catch (error) {
		healthStatus = 'degraded';
		preflight = {
			allowed: false,
			checks: [],
			blockers: [error.message]
		};
	}

	const health = {
		status: healthStatus,
		enabled: config.agent.enabled,
		running: isAgentRunInProgress(),
		database: CONNECTION_STATES[mongoose.connection.readyState] || 'unknown',
		lastRunAt: lastRun?.ranAt || null,
		lastRunSummary: lastRun?.summary || '',
		preflight
	};

	return res.status(200).json({
		status: 'success',
		...health,
		data: health
	});
});

export const getAgentRuns = catchAsync(async (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
	const runs = await AgentRun.find({}).sort({ ranAt: -1 }).limit(limit).lean();

	return res.status(200).json({
		status: 'success',
		results: runs.length,
		runs,
		data: { runs }
	});
});

export const getEvents = catchAsync(async (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
	const [runs, pending, recommendations] = await Promise.all([
		AgentRun.find({}).sort({ ranAt: -1 }).limit(limit).lean(),
		QuizPending.find({}).sort({ generatedAt: -1 }).limit(limit).lean(),
		Recommendation.find({})
			.sort({ generatedAt: -1 })
			.limit(limit)
			.populate('quizId', 'title')
			.lean()
	]);

	const now = new Date();
	const events = [
		...runs.map((run) =>
			buildEvent({
				id: `agent-run-${run._id}`,
				type: 'agent_run',
				title: `${run.trigger === 'manual' ? 'Manual' : 'Scheduled'} agent run ${run.status}`,
				message:
					run.summary ||
					`${run.quizzesGenerated || 0} quizzes generated, ${run.quizzesSkipped || 0} skipped`,
				createdAt: run.ranAt || run.createdAt,
				status: run.status,
				entityType: 'agentRun',
				entityId: run._id,
				metadata: {
					trigger: run.trigger,
					quizzesGenerated: run.quizzesGenerated,
					quizzesSkipped: run.quizzesSkipped,
					recommendationsSent: run.recommendationsSent,
					costUSD: run.costUSD
				}
			})
		),
		...pending.map((quiz) =>
			buildEvent({
				id: `pending-quiz-${quiz._id}`,
				type: 'pending_quiz',
				title: quiz.title,
				message:
					quiz.trendSummary ||
					`${quiz.questions?.length || 0} questions waiting for ${quiz.status} review`,
				createdAt: quiz.generatedAt || quiz.createdAt,
				status: quiz.status,
				entityType: 'pendingQuiz',
				entityId: quiz._id,
				metadata: {
					topic: quiz.topic,
					format: quiz.format,
					agentConfidence: quiz.agentConfidence,
					questionCount: quiz.questions?.length || 0
				}
			})
		),
		...recommendations.map((recommendation) =>
			buildEvent({
				id: `recommendation-${recommendation._id}`,
				type: 'recommendation',
				title: `Recommendation: ${recommendation.type}`,
				message:
					recommendation.message ||
					`Suggested quiz: ${recommendation.quizId?.title || 'Unknown quiz'}`,
				createdAt: recommendation.generatedAt || recommendation.createdAt,
				status: recommendation.expiresAt > now ? 'active' : 'expired',
				entityType: 'recommendation',
				entityId: recommendation._id,
				metadata: {
					userId: recommendation.userId,
					quizId: recommendation.quizId?._id || recommendation.quizId,
					quizTitle: recommendation.quizId?.title || null,
					clicked: recommendation.clicked,
					expiresAt: recommendation.expiresAt
				}
			})
		)
	]
		.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
		.slice(0, limit);

	return res.status(200).json({
		status: 'success',
		results: events.length,
		events,
		data: { events }
	});
});

export const createAgentRun = catchAsync(async (req, res) => {
	const execution = await runTrackedAgentCycle({
		trigger: 'manual',
		requestedBy: req.auth?.userId
	});

	if (execution.alreadyRunning) {
		return res.status(409).json({
			status: 'fail',
			message: 'Agent run already in progress.',
			running: true
		});
	}

	return res.status(200).json({
		status: 'success',
		message: execution.result?.skipped ? 'Agent run skipped.' : 'Agent run completed.',
		run: execution.run,
		result: execution.result,
		data: {
			run: execution.run,
			result: execution.result
		}
	});
});

export const getAgentBriefing = catchAsync(async (req, res) => {
	const [lastRun, memory, totalPending, totalRecommendations, totalSkippedRuns, recentRuns] =
		await Promise.all([
			AgentRun.findOne({}).sort({ ranAt: -1 }).lean(),
			AgentMemory.findById('singleton').lean(),
			QuizPending.countDocuments({ status: 'pending' }),
			Recommendation.countDocuments({ expiresAt: { $gt: new Date() } }),
			AgentRun.countDocuments({ quizzesSkipped: { $gt: 0 } }),
			AgentRun.find({}).sort({ ranAt: -1 }).limit(10).lean()
		]);

	const totalQuizzesGenerated = recentRuns.reduce(
		(sum, run) => sum + (run.quizzesGenerated || 0),
		0
	);
	const totalQuizzesSkipped = recentRuns.reduce((sum, run) => sum + (run.quizzesSkipped || 0), 0);
	const totalRecommendationsSent = recentRuns.reduce(
		(sum, run) => sum + (run.recommendationsSent || 0),
		0
	);
	const preflight = await runPreFlightChecks();
	const briefing = {
		headline: lastRun ? 'Latest agent briefing' : 'Agent briefing unavailable',
		summary: buildBriefingSummary({
			lastRun,
			totalPending,
			totalRecommendations,
			totalSkippedRuns,
			preflight,
			agentEnabled: config.agent.enabled
		}),
		generatedAt: new Date().toISOString(),
		enabled: config.agent.enabled,
		running: isAgentRunInProgress(),
		lastRun,
		stats: {
			totalQuizzesGenerated,
			totalQuizzesSkipped,
			totalRecommendationsSent,
			totalPending,
			totalRecommendations,
			totalSkippedRuns
		},
		preflight,
		memory: {
			adminPreferences: memory?.adminPreferences || {},
			userInsights: memory?.userInsights || {},
			contentInsights: memory?.contentInsights || {},
			experiments: memory?.experiments || {},
			recentRuns: memory?.recentRuns || []
		}
	};

	return res.status(200).json({
		status: 'success',
		quizzesGenerated: totalQuizzesGenerated,
		quizzesSkipped: totalQuizzesSkipped,
		recommendationsSent: totalRecommendationsSent,
		briefing,
		data: {
			quizzesGenerated: totalQuizzesGenerated,
			quizzesSkipped: totalQuizzesSkipped,
			recommendationsSent: totalRecommendationsSent,
			briefing
		}
	});
});

export const getPendingQuizzes = catchAsync(async (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
	const pending = await QuizPending.find({ status: 'pending' })
		.sort({ generatedAt: -1 })
		.limit(limit)
		.lean();
	const totalPending = await QuizPending.countDocuments({ status: 'pending' });

	return res.status(200).json({
		status: 'success',
		results: pending.length,
		totalPending,
		pending: pending.map(formatPendingQuiz),
		data: {
			totalPending,
			pending: pending.map(formatPendingQuiz)
		}
	});
});

export const getPendingQuiz = catchAsync(async (req, res) => {
	const pendingQuiz = await getPendingQuizOrThrow(req.params.pendingId);
	const pending = formatPendingQuiz(pendingQuiz.toObject());

	return res.status(200).json({
		status: 'success',
		pending,
		data: { pending }
	});
});

export const approvePendingQuiz = catchAsync(async (req, res) => {
	const pendingQuiz = await getPendingQuizOrThrow(req.params.pendingId);

	if (pendingQuiz.status !== 'pending') {
		throw new AppError(`Pending quiz has already been ${pendingQuiz.status}.`, 400);
	}

	const session = await mongoose.startSession();
	let approvedQuizId;

	try {
		await session.withTransaction(async () => {
			const tags = pendingQuiz.tags?.length
				? pendingQuiz.tags
				: [pendingQuiz.topic].filter(Boolean);
			const [approvedQuiz] = await Quiz.create(
				[
					{
						title: pendingQuiz.title,
						description: pendingQuiz.description,
						tags,
						status: 'active',
						author: req.auth?.userId || 'agent-reviewer',
						format: pendingQuiz.format,
						generatedBy: 'agent',
						inspiredBy: pendingQuiz.inspiredBy,
						trendSummary: pendingQuiz.trendSummary,
						sourceType: pendingQuiz.sourceType,
						sourceCitations: pendingQuiz.sourceCitations,
						plannerNotes: pendingQuiz.plannerNotes,
						generationSignals: pendingQuiz.generationSignals,
						agentConfidence: pendingQuiz.agentConfidence
					}
				],
				{ session }
			);

			approvedQuizId = approvedQuiz._id;

			if (pendingQuiz.questions?.length) {
				await Question.insertMany(
					pendingQuiz.questions.map((question) => ({
						quiz: approvedQuizId,
						title: question.title,
						correct: question.correct,
						options: question.options,
						author: req.auth?.userId || 'agent-reviewer'
					})),
					{ session }
				);
			}

			pendingQuiz.status = 'approved';
			pendingQuiz.reviewedAt = new Date();
			pendingQuiz.rejectionReason = undefined;
			pendingQuiz.approvedQuizId = approvedQuizId;
			pendingQuiz.reviewedBy = req.auth?.userId || undefined;
			await pendingQuiz.save({ session });
		});
	} finally {
		await session.endSession();
	}

	const [approvedQuiz, updatedPending] = await Promise.all([
		Quiz.findById(approvedQuizId).populate('questionsCount attemptsCount'),
		QuizPending.findById(req.params.pendingId).lean()
	]);

	try {
		await refreshAgentMemory();
	} catch (error) {
		console.error('[Agent] Failed to refresh agent memory after approval:', error.message);
	}

	return res.status(200).json({
		status: 'success',
		message: 'Pending quiz approved successfully.',
		quiz: approvedQuiz,
		pending: formatPendingQuiz(updatedPending),
		data: {
			quiz: approvedQuiz,
			pending: formatPendingQuiz(updatedPending)
		}
	});
});

export const rejectPendingQuiz = catchAsync(async (req, res) => {
	const pendingQuiz = await getPendingQuizOrThrow(req.params.pendingId);

	if (pendingQuiz.status !== 'pending') {
		throw new AppError(`Pending quiz has already been ${pendingQuiz.status}.`, 400);
	}

	pendingQuiz.status = 'rejected';
	pendingQuiz.reviewedAt = new Date();
	pendingQuiz.rejectionReason =
		req.body?.rejectionReason || req.body?.reason || 'Rejected by reviewer';
	pendingQuiz.reviewedBy = req.auth?.userId || undefined;
	await pendingQuiz.save();

	try {
		await refreshAgentMemory();
	} catch (error) {
		console.error('[Agent] Failed to refresh agent memory after rejection:', error.message);
	}

	const pending = formatPendingQuiz(pendingQuiz.toObject());

	return res.status(200).json({
		status: 'success',
		message: 'Pending quiz rejected successfully.',
		pending,
		data: { pending }
	});
});

export const reviewPendingQuiz = (req, res, next) => {
	const action =
		req.body?.action ||
		req.body?.status ||
		(req.body?.approved === true ? 'approve' : undefined) ||
		(req.body?.rejected === true ? 'reject' : undefined);

	if (['approve', 'approved'].includes(action)) {
		return approvePendingQuiz(req, res, next);
	}

	if (['reject', 'rejected'].includes(action)) {
		return rejectPendingQuiz(req, res, next);
	}

	return next(new AppError('Please provide a valid review action.', 400));
};

export const getRecommendations = catchAsync(async (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
	const filters = {};

	if (req.query.userId) {
		filters.userId = req.query.userId;
	}

	const recommendations = await Recommendation.find(filters)
		.sort({ generatedAt: -1 })
		.limit(limit)
		.populate('quizId', 'title format tags status')
		.lean();

	const activeFilters = {
		...filters,
		expiresAt: { $gt: new Date() }
	};
	const [totalRecommendations, activeRecommendations, clickedRecommendations] = await Promise.all(
		[
			Recommendation.countDocuments(filters),
			Recommendation.countDocuments(activeFilters),
			Recommendation.countDocuments({ ...filters, clicked: true })
		]
	);

	return res.status(200).json({
		status: 'success',
		results: recommendations.length,
		summary: {
			totalRecommendations,
			activeRecommendations,
			clickedRecommendations
		},
		recommendations: recommendations.map((recommendation) => ({
			...recommendation,
			quizTitle: recommendation.quizId?.title || null
		})),
		data: {
			summary: {
				totalRecommendations,
				activeRecommendations,
				clickedRecommendations
			},
			recommendations: recommendations.map((recommendation) => ({
				...recommendation,
				quizTitle: recommendation.quizId?.title || null
			}))
		}
	});
});

export const getSkippedRuns = catchAsync(async (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
	const skippedRuns = await AgentRun.find({
		$or: [{ status: 'skipped' }, { quizzesSkipped: { $gt: 0 } }]
	})
		.sort({ ranAt: -1 })
		.limit(limit)
		.lean();

	return res.status(200).json({
		status: 'success',
		results: skippedRuns.length,
		skipped: skippedRuns.map((run) => ({
			...run,
			reason:
				run.summary ||
				run.runErrors?.[0] ||
				`${run.quizzesSkipped} quizzes skipped during this run`
		})),
		data: {
			skipped: skippedRuns.map((run) => ({
				...run,
				reason:
					run.summary ||
					run.runErrors?.[0] ||
					`${run.quizzesSkipped} quizzes skipped during this run`
			}))
		}
	});
});
