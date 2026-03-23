import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { AgentRun } from '../models/AgentRun.js';
import { QuizPending } from '../models/QuizPending.js';
import { Recommendation } from '../models/Recommendation.js';
import { AGENT_LIMITS } from './constants.js';

export const isAgentEnabled = () => {
	return {
		allowed: config.agent.enabled === true,
		reason: config.agent.enabled ? 'Agent is enabled' : 'AGENT_ENABLED is not set to true'
	};
};

export const checkDailySpend = async () => {
	const startOfToday = new Date();
	startOfToday.setUTCHours(0, 0, 0, 0);

	const result = await AgentRun.aggregate([
		{ $match: { ranAt: { $gte: startOfToday } } },
		{ $group: { _id: null, totalSpend: { $sum: '$costUSD' } } }
	]);

	const totalSpend = result.length > 0 ? result[0].totalSpend : 0;
	const limit = AGENT_LIMITS.MAX_DAILY_SPEND_USD;
	const allowed = totalSpend < limit;

	return {
		allowed,
		reason: allowed
			? `Daily spend $${totalSpend.toFixed(2)} is under $${limit} limit`
			: `Daily spend $${totalSpend.toFixed(2)} has reached $${limit} limit`,
		currentSpend: totalSpend
	};
};

export const checkQuizzesPerRun = (quizzesGeneratedThisRun) => {
	const limit = AGENT_LIMITS.MAX_QUIZZES_PER_RUN;
	const allowed = quizzesGeneratedThisRun < limit;

	return {
		allowed,
		reason: allowed
			? `${quizzesGeneratedThisRun}/${limit} quizzes generated this run`
			: `Max ${limit} quizzes per run reached`
	};
};

export const checkUserRecommendationLimit = async (userId) => {
	const startOfToday = new Date();
	startOfToday.setUTCHours(0, 0, 0, 0);

	const count = await Recommendation.countDocuments({
		userId,
		generatedAt: { $gte: startOfToday }
	});

	const limit = AGENT_LIMITS.MAX_RECOMMENDATIONS_PER_USER_PER_DAY;
	const allowed = count < limit;

	return {
		allowed,
		reason: allowed
			? `User has ${count}/${limit} recommendations today`
			: `User has reached ${limit} recommendations today`
	};
};

export const checkConfidenceThreshold = (confidence) => {
	const threshold = AGENT_LIMITS.MIN_CONFIDENCE_AUTO_FLAG;
	const allowed = confidence >= threshold;

	return {
		allowed,
		reason: allowed
			? `Confidence ${confidence} meets threshold ${threshold}`
			: `Confidence ${confidence} below threshold ${threshold} - needs review`
	};
};

export const checkDuplicateSimilarity = async (embedding, collectionName = 'quizzes') => {
	try {
		const collection = mongoose.connection.db.collection(collectionName);

		const results = await collection
			.aggregate([
				{
					$vectorSearch: {
						index: 'quiz_vector_index',
						path: 'embedding',
						queryVector: embedding,
						numCandidates: 10,
						limit: 1
					}
				},
				{
					$project: {
						_id: 1,
						title: 1,
						score: { $meta: 'vectorSearchScore' }
					}
				}
			])
			.toArray();

		if (results.length === 0) {
			return {
				allowed: true,
				reason: 'No existing quizzes to compare against',
				similarity: 0
			};
		}

		const topMatch = results[0];
		const similarity = topMatch.score;
		const threshold = AGENT_LIMITS.DUPLICATE_SIMILARITY_THRESHOLD;
		const allowed = similarity < threshold;

		return {
			allowed,
			reason: allowed
				? `Closest match "${topMatch.title}" has similarity ${similarity.toFixed(3)} (under ${threshold})`
				: `DUPLICATE BLOCKED: "${topMatch.title}" has similarity ${similarity.toFixed(3)} (>= ${threshold})`,
			similarity,
			closestMatch: topMatch
		};
	} catch (err) {
		console.warn('[Agent] Vector search unavailable:', err.message);
		return {
			allowed: true,
			reason: 'Vector search unavailable, skipping duplicate check',
			similarity: 0
		};
	}
};

export const checkPendingQueueCap = async () => {
	const count = await QuizPending.countDocuments({ status: 'pending' });
	const cap = AGENT_LIMITS.PENDING_QUEUE_CAP;
	const allowed = count < cap;

	return {
		allowed,
		reason: allowed
			? `Pending queue has ${count}/${cap} quizzes`
			: `Pending queue full: ${count} quizzes (cap: ${cap}). Review before generating more.`
	};
};

export const runPreFlightChecks = async () => {
	const checks = [
		{ name: 'agentEnabled', result: isAgentEnabled() },
		{ name: 'dailySpend', result: await checkDailySpend() },
		{ name: 'pendingQueue', result: await checkPendingQueueCap() }
	];

	const failed = checks.filter((c) => !c.result.allowed);

	return {
		allowed: failed.length === 0,
		checks: checks.map((c) => ({ name: c.name, ...c.result })),
		blockers: failed.map((c) => `${c.name}: ${c.result.reason}`)
	};
};
