import { AgentMemory } from '../models/AgentMemory.js';
import { AgentRun } from '../models/AgentRun.js';
import { Attempt } from '../models/Attempted.js';
import { Quiz } from '../models/Quiz.js';
import { QuizPending } from '../models/QuizPending.js';

const DEFAULT_MEMORY = {
	adminPreferences: {},
	userInsights: {},
	contentInsights: {},
	experiments: {},
	recentRuns: []
};

const normalizeTopic = (value = '') =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const buildTopicReviewInsights = (recentPending = []) => {
	const topicMap = new Map();

	for (const item of recentPending) {
		const key = normalizeTopic(item.topic || item.tags?.[0] || '');

		if (!key) {
			continue;
		}

		const current = topicMap.get(key) || {
			topic: item.topic || key,
			approvedCount: 0,
			rejectedCount: 0,
			pendingCount: 0,
			recentTitles: [],
			rejectionReasons: []
		};

		if (item.status === 'approved') {
			current.approvedCount += 1;
		} else if (item.status === 'rejected') {
			current.rejectedCount += 1;
		} else if (item.status === 'pending') {
			current.pendingCount += 1;
		}

		if (item.title && current.recentTitles.length < 5) {
			current.recentTitles.push(item.title);
		}

		if (item.rejectionReason) {
			current.rejectionReasons.push(item.rejectionReason);
		}

		topicMap.set(key, current);
	}

	return Object.fromEntries(
		[...topicMap.entries()].map(([key, value]) => [
			key,
			{
				...value,
				rejectionReasons: value.rejectionReasons.slice(0, 5)
			}
		])
	);
};

const buildTopicPerformanceInsights = async () => {
	const agentQuizzes = await Quiz.find({ generatedBy: 'agent' })
		.select('tags title status createdAt')
		.lean();

	if (!agentQuizzes.length) {
		return {};
	}

	const quizIds = agentQuizzes.map((quiz) => quiz._id);
	const recentCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
	const attemptStats = await Attempt.aggregate([
		{
			$match: {
				quiz: { $in: quizIds }
			}
		},
		{
			$group: {
				_id: '$quiz',
				attemptCount: { $sum: 1 },
				recentAttemptCount: {
					$sum: {
						$cond: [{ $gte: ['$createdAt', recentCutoff] }, 1, 0]
					}
				},
				averageScore: { $avg: '$score' }
			}
		}
	]);
	const attemptLookup = new Map(
		attemptStats.map((stat) => [
			String(stat._id),
			{
				attemptCount: stat.attemptCount || 0,
				recentAttemptCount: stat.recentAttemptCount || 0,
				averageScore: stat.averageScore || 0
			}
		])
	);
	const topicMap = new Map();

	for (const quiz of agentQuizzes) {
		const stats = attemptLookup.get(String(quiz._id)) || {
			attemptCount: 0,
			recentAttemptCount: 0,
			averageScore: 0
		};

		for (const tag of quiz.tags || []) {
			const key = normalizeTopic(tag);

			if (!key) {
				continue;
			}

			const current = topicMap.get(key) || {
				topic: tag,
				publishedQuizCount: 0,
				attemptCount: 0,
				recentAttemptCount: 0,
				totalScore: 0,
				scoredQuizCount: 0
			};

			current.publishedQuizCount += 1;
			current.attemptCount += stats.attemptCount;
			current.recentAttemptCount += stats.recentAttemptCount;

			if (stats.attemptCount > 0) {
				current.totalScore += stats.averageScore;
				current.scoredQuizCount += 1;
			}

			topicMap.set(key, current);
		}
	}

	return Object.fromEntries(
		[...topicMap.entries()].map(([key, value]) => [
			key,
			{
				topic: value.topic,
				publishedQuizCount: value.publishedQuizCount,
				attemptCount: value.attemptCount,
				recentAttemptCount: value.recentAttemptCount,
				averageScore:
					value.scoredQuizCount > 0 ? value.totalScore / value.scoredQuizCount : 0
			}
		])
	);
};

export const getAgentMemorySnapshot = async () => {
	const memory = await AgentMemory.findById('singleton').lean();

	return (
		memory || {
			_id: 'singleton',
			...DEFAULT_MEMORY
		}
	);
};

export const refreshAgentMemory = async () => {
	const [existingMemory, recentPending, recentRuns, topicPerformance] = await Promise.all([
		getAgentMemorySnapshot(),
		QuizPending.find({})
			.sort({ generatedAt: -1, createdAt: -1 })
			.limit(200)
			.select(
				'title topic tags status rejectionReason reviewedAt generatedAt plannerAction sourceType'
			)
			.lean(),
		AgentRun.find({})
			.sort({ ranAt: -1, createdAt: -1 })
			.limit(10)
			.select(
				'ranAt summary quizzesGenerated quizzesSkipped plannerAction selectedTopics sourceCitations'
			)
			.lean(),
		buildTopicPerformanceInsights()
	]);

	const reviewInsights = buildTopicReviewInsights(recentPending);

	const contentInsights = {
		...(existingMemory.contentInsights || {}),
		lastUpdatedAt: new Date().toISOString(),
		topicPerformance,
		reviewInsights
	};

	const recentRunsSummary = recentRuns.map((run) => ({
		ranAt: run.ranAt,
		summary: run.summary,
		quizzesGenerated: run.quizzesGenerated || 0,
		quizzesSkipped: run.quizzesSkipped || 0,
		plannerAction: run.plannerAction,
		selectedTopics: run.selectedTopics || [],
		citationsCount: run.sourceCitations?.length || 0
	}));

	return AgentMemory.findByIdAndUpdate(
		'singleton',
		{
			$set: {
				adminPreferences: existingMemory.adminPreferences || {},
				userInsights: existingMemory.userInsights || {},
				contentInsights,
				experiments: existingMemory.experiments || {},
				recentRuns: recentRunsSummary
			}
		},
		{
			new: true,
			upsert: true,
			setDefaultsOnInsert: true
		}
	).lean();
};
