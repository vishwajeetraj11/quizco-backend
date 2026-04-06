import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { AgentRun } from '../models/AgentRun.js';
import { Attempt } from '../models/Attempted.js';
import { Quiz } from '../models/Quiz.js';
import { QuizPending } from '../models/QuizPending.js';
import { AGENT_LIMITS } from './constants.js';
import { generateQuizEmbedding } from './embeddings.js';
import { checkDuplicateSimilarity, runPreFlightChecks } from './guards.js';
import { getAgentMemorySnapshot, refreshAgentMemory } from './memory.js';
import { getOpenAIClient } from './openaiClient.js';
import { planAgentRun } from './planner.js';
import { tracer } from './tracer.js';
import { summarizeValidationIssues, validateQuizCandidate } from './validation.js';
import { verifyQuizDraft } from './verifier.js';

let activeAgentRunPromise = null;
let anthropicClient = null;

const QUIZ_FORMATS = ['speed_round', 'deep_dive', 'standard', 'streak'];
const RECENT_AGENT_HISTORY_LIMIT = 25;
const RECENT_AGENT_HISTORY_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;
const QUIZ_RESPONSE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'title',
		'description',
		'topic',
		'tags',
		'format',
		'agentConfidence',
		'trendSummary',
		'questions'
	],
	properties: {
		title: { type: 'string' },
		description: { type: 'string' },
		topic: { type: 'string' },
		tags: {
			type: 'array',
			items: { type: 'string' }
		},
		format: {
			type: 'string',
			enum: QUIZ_FORMATS
		},
		agentConfidence: {
			type: 'number'
		},
		trendSummary: {
			type: 'string'
		},
		questions: {
			type: 'array',
			minItems: 5,
			maxItems: 5,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'correct', 'options'],
				properties: {
					title: { type: 'string' },
					correct: { type: 'string' },
					options: {
						type: 'array',
						minItems: 4,
						maxItems: 4,
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['value'],
							properties: {
								value: { type: 'string' }
							}
						}
					}
				}
			}
		}
	}
};

const getAnthropicClient = () => {
	if (!anthropicClient) {
		if (!config.agent.anthropicApiKey) {
			throw new Error('ANTHROPIC_API_KEY is required for agent generation.');
		}

		anthropicClient = new Anthropic({ apiKey: config.agent.anthropicApiKey });
	}

	return anthropicClient;
};

const isOpenAIWriterModel = () => config.agent.model.startsWith('gpt-');

const buildRunSummary = ({ result, error }) => {
	if (result?.summary) {
		return result.summary;
	}

	if (result?.message) {
		return result.message;
	}

	if (Array.isArray(result?.reason)) {
		return result.reason.join(' | ');
	}

	if (result?.reason) {
		return result.reason;
	}

	return error?.message || '';
};

const sanitizePersistPayload = (payload = {}) =>
	Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const persistAgentRun = async (payload) => {
	try {
		if (payload?.traceId) {
			const sanitized = sanitizePersistPayload(payload);
			return await AgentRun.findOneAndUpdate(
				{ traceId: payload.traceId },
				{
					$set: sanitized,
					$setOnInsert: {
						traceId: payload.traceId
					}
				},
				{
					new: true,
					upsert: true,
					runValidators: true
				}
			);
		}

		return await AgentRun.create(payload);
	} catch (error) {
		console.error('[Agent] Failed to persist agent run:', error.message);
		return null;
	}
};

const traceDecision = async ({ runId, parentSpanId, name, input, output, metadata }) => {
	if (!runId) {
		return;
	}

	const decisionSpan = await tracer.startSpan(runId, {
		parentSpanId,
		type: 'decision',
		name,
		input,
		metadata
	});

	await tracer.endSpan(decisionSpan?.id, output);
};

const traceError = async ({ runId, parentSpanId, name, input, error }) => {
	if (!runId) {
		return;
	}

	const errorSpan = await tracer.startSpan(runId, {
		parentSpanId,
		type: 'error',
		name,
		input
	});

	await tracer.endSpan(errorSpan?.id, {
		error: error?.message || String(error),
		stack: error?.stack || undefined
	});
};

export const isAgentRunInProgress = () => activeAgentRunPromise !== null;

const normalizeText = (value = '') =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const getRecentAgentQuizHistory = async () => {
	const cutoff = new Date(Date.now() - RECENT_AGENT_HISTORY_WINDOW_MS);

	return QuizPending.find({ createdAt: { $gte: cutoff } })
		.sort({ createdAt: -1 })
		.limit(RECENT_AGENT_HISTORY_LIMIT)
		.select('title topic tags status rejectionReason createdAt')
		.lean();
};

const buildTopicSelectionSummary = ({
	selectedTopic,
	selectedStats,
	blockedTopics,
	fallbackReason
}) => {
	if (selectedStats.attemptCount > 0) {
		const base = `Generated because "${selectedTopic}" has strong play activity (${selectedStats.attemptCount} attempts across ${selectedStats.activeQuizCount} active quizzes).`;

		if (blockedTopics.length > 0) {
			return `${base} It was chosen after avoiding recently reviewed topics like ${blockedTopics.join(', ')}.`;
		}

		if (fallbackReason) {
			return `${base} ${fallbackReason}`;
		}

		return base;
	}

	if (selectedStats.activeQuizCount > 0) {
		return `Generated because "${selectedTopic}" is an active platform topic (${selectedStats.activeQuizCount} active quizzes).`;
	}

	return 'Generated from the default fallback topic because no tags were available.';
};

const getRecentConflict = (quiz, recentHistory) => {
	const generatedTitle = normalizeText(quiz.title);
	const generatedTopic = normalizeText(quiz.topic);
	const generatedWords = new Set(generatedTitle.split(' ').filter(Boolean));

	for (const recentQuiz of recentHistory) {
		const recentTitle = normalizeText(recentQuiz.title);
		const recentTopic = normalizeText(recentQuiz.topic);
		const recentWords = new Set(recentTitle.split(' ').filter(Boolean));
		const sharedWords = [...generatedWords].filter((word) => recentWords.has(word));
		const overlapRatio =
			generatedWords.size === 0
				? 0
				: sharedWords.length / Math.max(generatedWords.size, recentWords.size);

		if (generatedTitle === recentTitle) {
			return {
				title: recentQuiz.title,
				status: recentQuiz.status,
				reason: 'same title'
			};
		}

		if (generatedTopic === recentTopic && overlapRatio >= 0.6) {
			return {
				title: recentQuiz.title,
				status: recentQuiz.status,
				reason: 'very similar title and same topic'
			};
		}
	}

	return null;
};

const getRankedTopics = async () => {
	const [quizzes, recentHistory, currentPendingCount] = await Promise.all([
		Quiz.find({
			deleted: { $ne: true },
			status: 'active'
		})
			.select('tags')
			.lean(),
		getRecentAgentQuizHistory(),
		QuizPending.countDocuments({ status: 'pending' })
	]);

	if (!quizzes.length) {
		return {
			recentHistory,
			currentPendingCount,
			rankedTopics: []
		};
	}

	const quizIds = quizzes.map((quiz) => quiz._id);
	const attemptsByQuiz = await Attempt.aggregate([
		{
			$match: {
				quiz: { $in: quizIds }
			}
		},
		{
			$group: {
				_id: '$quiz',
				attemptCount: { $sum: 1 }
			}
		}
	]);
	const attemptsLookup = new Map(
		attemptsByQuiz.map((entry) => [String(entry._id), entry.attemptCount])
	);
	const tagStats = {};
	const recentHistoryByTopic = new Map();

	for (const recentQuiz of recentHistory) {
		const topics = new Set(
			[recentQuiz.topic, ...(recentQuiz.tags || [])].map(normalizeText).filter(Boolean)
		);

		for (const topicKey of topics) {
			const existing = recentHistoryByTopic.get(topicKey) || [];
			existing.push(recentQuiz);
			recentHistoryByTopic.set(topicKey, existing);
		}
	}

	for (const quiz of quizzes) {
		const attemptCount = attemptsLookup.get(String(quiz._id)) || 0;

		for (const tag of new Set(quiz.tags || [])) {
			if (!tagStats[tag]) {
				tagStats[tag] = {
					activeQuizCount: 0,
					attemptCount: 0
				};
			}

			tagStats[tag].activeQuizCount += 1;
			tagStats[tag].attemptCount += attemptCount;
		}
	}

	const rankedTopics = Object.entries(tagStats)
		.map(([tag, stats]) => {
			const history = recentHistoryByTopic.get(normalizeText(tag)) || [];
			const pendingCount = history.filter((entry) => entry.status === 'pending').length;
			const rejectedCount = history.filter((entry) => entry.status === 'rejected').length;
			const approvedCount = history.filter((entry) => entry.status === 'approved').length;
			const score =
				stats.attemptCount * 100 +
				stats.activeQuizCount * 10 -
				pendingCount * 1000 -
				rejectedCount * 450 -
				approvedCount * 100 -
				history.length * 25;

			return {
				tag,
				stats,
				history,
				pendingCount,
				rejectedCount,
				approvedCount,
				score
			};
		})
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			if (right.stats.attemptCount !== left.stats.attemptCount) {
				return right.stats.attemptCount - left.stats.attemptCount;
			}

			return right.stats.activeQuizCount - left.stats.activeQuizCount;
		});

	const preferredCandidates = rankedTopics.filter(
		(candidate) => candidate.pendingCount === 0 && candidate.rejectedCount === 0
	);
	const fallbackCandidates = rankedTopics.filter((candidate) => candidate.pendingCount === 0);

	return {
		recentHistory,
		currentPendingCount,
		rankedTopics: (preferredCandidates.length > 0
			? preferredCandidates
			: fallbackCandidates
		).map((candidate) => {
			const blockedTopics = rankedTopics
				.filter(
					(otherCandidate) =>
						otherCandidate.tag !== candidate.tag &&
						(otherCandidate.pendingCount > 0 || otherCandidate.rejectedCount > 0)
				)
				.slice(0, 3)
				.map((otherCandidate) => otherCandidate.tag);
			const fallbackReason =
				candidate.rejectedCount > 0 || candidate.pendingCount > 0
					? 'The agent fell back to the best available topic after filtering recent history.'
					: '';

			return {
				...candidate,
				trendSummary: buildTopicSelectionSummary({
					selectedTopic: candidate.tag,
					selectedStats: candidate.stats,
					blockedTopics,
					fallbackReason
				})
			};
		})
	};
};

const decideTopicsToGenerate = ({ rankedTopics, currentPendingCount }) => {
	const maxPerRun = Math.min(AGENT_LIMITS.MAX_QUIZZES_PER_RUN, 9);
	const availablePendingSlots = Math.max(0, AGENT_LIMITS.PENDING_QUEUE_CAP - currentPendingCount);
	const maxTopicsThisRun = Math.min(maxPerRun, availablePendingSlots);

	if (maxTopicsThisRun <= 0) {
		return {
			topicsToGenerate: [],
			decisionReason:
				'The pending queue is already full, so no new quizzes are needed right now.'
		};
	}

	if (currentPendingCount >= maxPerRun) {
		return {
			topicsToGenerate: [],
			decisionReason: `There are already ${currentPendingCount} pending quizzes awaiting review, so the agent is holding off on generating more.`
		};
	}

	const baseCandidates = rankedTopics.filter(
		(candidate) =>
			candidate.pendingCount === 0 &&
			candidate.rejectedCount < 2 &&
			candidate.score > 0 &&
			(candidate.stats.attemptCount > 0 || candidate.stats.activeQuizCount > 1)
	);
	const fallbackCandidates = rankedTopics.filter(
		(candidate) => candidate.pendingCount === 0 && candidate.score > 0
	);
	const viableCandidates = (
		baseCandidates.length > 0 ? baseCandidates : fallbackCandidates
	).slice(0, maxTopicsThisRun);

	if (!viableCandidates.length) {
		return {
			topicsToGenerate: [],
			decisionReason:
				'No strong unmet topic demand was found, so the agent decided not to create new quizzes this run.'
		};
	}

	const topScore = viableCandidates[0].score;
	const demandThreshold = Math.max(50, Math.floor(topScore * 0.45));
	const topicsToGenerate = viableCandidates
		.filter((candidate) => candidate.score >= demandThreshold)
		.slice(0, maxTopicsThisRun);

	if (!topicsToGenerate.length) {
		return {
			topicsToGenerate: [],
			decisionReason:
				'Current topic demand is too weak relative to recent history, so the agent decided not to generate new quizzes.'
		};
	}

	return {
		topicsToGenerate,
		decisionReason: `Selected ${topicsToGenerate.map((candidate) => candidate.tag).join(', ')} for this run.`
	};
};

const getDomainFromUrl = (value = '') => {
	try {
		return new globalThis.URL(value).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

const createValidationIssue = ({ code, message, stage = 'validation', status = 'failed' }) => ({
	code,
	message,
	stage,
	status
});

const getPlannerPlatformState = async () => {
	const { rankedTopics, currentPendingCount } = await getRankedTopics();

	return {
		generatedAt: new Date().toISOString(),
		pendingQueue: {
			pendingCount: currentPendingCount,
			cap: AGENT_LIMITS.PENDING_QUEUE_CAP
		},
		limits: {
			maxQuizzesPerRun: Math.min(AGENT_LIMITS.MAX_QUIZZES_PER_RUN, 9),
			pendingQueueCap: AGENT_LIMITS.PENDING_QUEUE_CAP
		},
		candidateTopics: rankedTopics.slice(0, 12).map((candidate) => ({
			topic: candidate.tag,
			score: candidate.score,
			activeQuizCount: candidate.stats.activeQuizCount,
			attemptCount: candidate.stats.attemptCount,
			pendingCount: candidate.pendingCount,
			rejectedCount: candidate.rejectedCount,
			approvedCount: candidate.approvedCount,
			trendSummary: candidate.trendSummary
		}))
	};
};

const getPlannerRecentHistory = async ({ limit = 12 } = {}) => {
	const [recentRuns, recentPending] = await Promise.all([
		AgentRun.find({})
			.sort({ ranAt: -1, createdAt: -1 })
			.limit(limit)
			.select(
				'ranAt status summary quizzesGenerated quizzesSkipped plannerAction selectedTopics runErrors'
			)
			.lean(),
		QuizPending.find({})
			.sort({ generatedAt: -1, createdAt: -1 })
			.limit(limit)
			.select(
				'title topic tags status rejectionReason trendSummary sourceType plannerNotes generatedAt reviewedAt'
			)
			.lean()
	]);

	return {
		recentRuns,
		recentPending
	};
};

const buildFallbackPlan = async () => {
	const { rankedTopics, currentPendingCount } = await getRankedTopics();
	const { topicsToGenerate, decisionReason } = decideTopicsToGenerate({
		rankedTopics,
		currentPendingCount
	});

	if (!topicsToGenerate.length) {
		return {
			plan: {
				action: 'stand_down',
				rationale: decisionReason,
				internalSummary: decisionReason,
				webSummary: '',
				safetyNotes: [],
				plannedQuizCount: 0,
				topics: [],
				sourceCitations: []
			},
			toolTrace: [
				{
					name: 'fallback_ranker',
					status: 'completed',
					summary: decisionReason
				}
			]
		};
	}

	return {
		plan: {
			action: 'generate_quizzes',
			rationale: decisionReason,
			internalSummary: decisionReason,
			webSummary: '',
			safetyNotes: [],
			plannedQuizCount: topicsToGenerate.length,
			topics: topicsToGenerate.map((candidate) => ({
				topic: candidate.tag,
				angle: `A fresh, distinctive knowledge angle on ${candidate.tag}`,
				format: 'standard',
				rationale: candidate.trendSummary,
				trendSummary: candidate.trendSummary,
				sourceType: 'internal',
				sourceUrls: [],
				sourceTitles: []
			})),
			sourceCitations: []
		},
		toolTrace: [
			{
				name: 'fallback_ranker',
				status: 'completed',
				summary: decisionReason
			}
		]
	};
};

const getTextContent = (response) =>
	response.content
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n');

const extractJsonPayload = (content) => {
	const cleaned = content
		.replace(/```json/gi, '')
		.replace(/```/g, '')
		.trim();
	const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

	if (!jsonMatch) {
		throw new Error('Failed to extract JSON from Anthropic response.');
	}

	return jsonMatch[0];
};

const sanitizeQuestion = (question, index) => {
	if (!question?.title || !question?.correct || !Array.isArray(question?.options)) {
		throw new Error(`Generated question ${index + 1} is missing required fields.`);
	}

	const options = question.options
		.map((option) => ({
			value: typeof option === 'string' ? option : option?.value
		}))
		.filter((option) => typeof option.value === 'string' && option.value.trim().length > 0)
		.slice(0, 4);

	if (options.length !== 4) {
		throw new Error(`Generated question ${index + 1} must have exactly 4 options.`);
	}

	if (!options.some((option) => option.value === question.correct)) {
		throw new Error(
			`Generated question ${index + 1} does not include the correct answer in options.`
		);
	}

	return {
		title: question.title.trim(),
		correct: question.correct.trim(),
		options
	};
};

const normalizeGeneratedQuiz = (quiz, candidate) => {
	if (!quiz?.title || !quiz?.description || !Array.isArray(quiz?.questions)) {
		throw new Error('Generated quiz is missing required fields.');
	}

	const questions = quiz.questions.slice(0, 5).map(sanitizeQuestion);

	if (!questions.length) {
		throw new Error('Generated quiz returned no questions.');
	}

	const tags = Array.from(new Set([...(quiz.tags || []), candidate.topic].filter(Boolean))).slice(
		0,
		5
	);
	const format = QUIZ_FORMATS.includes(quiz.format)
		? quiz.format
		: candidate.format || 'standard';
	const agentConfidence =
		typeof quiz.agentConfidence === 'number' &&
		quiz.agentConfidence >= 0 &&
		quiz.agentConfidence <= 1
			? quiz.agentConfidence
			: 0.85;

	return {
		title: quiz.title.trim(),
		description: quiz.description.trim(),
		topic: quiz.topic?.trim() || candidate.topic,
		tags,
		format,
		questions,
		agentConfidence,
		trendSummary: quiz.trendSummary?.trim() || candidate.trendSummary || ''
	};
};

const buildCandidateCitations = (candidate, sharedSources = []) => {
	const sharedSourceLookup = new Map(
		sharedSources.map((source) => [
			source.url,
			{
				url: source.url,
				title: source.title || '',
				domain: source.domain || getDomainFromUrl(source.url)
			}
		])
	);

	return Array.from(new Set(candidate.sourceUrls || [])).map((url, index) => {
		const shared = sharedSourceLookup.get(url) || {};

		return {
			url,
			title: candidate.sourceTitles?.[index] || shared.title || '',
			domain: shared.domain || getDomainFromUrl(url)
		};
	});
};

const buildWriterPrompt = ({
	candidate,
	recentHistory = [],
	revisionIssues = [],
	previousQuiz = null
}) => {
	const recentTitles = recentHistory.map((quiz) => `${quiz.title} (${quiz.status})`).slice(0, 5);
	const sourceLines =
		candidate.sourceCitations?.length > 0
			? candidate.sourceCitations
					.map(
						(source) =>
							`- ${source.title || source.domain || 'Source'}${source.url ? ` — ${source.url}` : ''}`
					)
					.join('\n')
			: '- none';
	const revisionBlock =
		revisionIssues.length > 0
			? `You are revising a previous draft. Fix these issues:\n- ${revisionIssues
					.map((issue) => issue.message)
					.join('\n- ')}\n\nPrevious draft:\n${JSON.stringify(previousQuiz, null, 2)}`
			: '';

	return `Generate a fun, engaging quiz for a quiz platform.

Topic: "${candidate.topic}"
Desired angle: "${candidate.angle}"
Planner rationale: "${candidate.rationale}"
Trend summary: "${candidate.trendSummary}"
Preferred format: "${candidate.format}"
Source type: "${candidate.sourceType}"

External context:
${sourceLines}

${revisionBlock}

Return ONLY valid JSON in this exact format:
{
  "title": "Quiz title here",
  "description": "One line description",
  "topic": "${candidate.topic}",
  "tags": ["${candidate.topic}", "other-relevant-tag"],
  "format": "${candidate.format}",
  "agentConfidence": 0.85,
  "trendSummary": "${candidate.trendSummary}",
  "questions": [
    {
      "title": "Question text?",
      "correct": "The correct answer",
      "options": [
        {"value": "Option A"},
        {"value": "Option B"},
        {"value": "Option C"},
        {"value": "Option D"}
      ]
    }
  ]
}

Rules:
- Generate exactly 5 questions.
- Each question must have exactly 4 options.
- The "correct" answer must exactly match one option value.
- Keep the tone surprising, playful, and quiz-friendly.
- "format" must be one of: ${QUIZ_FORMATS.join(', ')}.
- Do not wrap the JSON in markdown.
- Do not reuse titles, angles, or question concepts that feel similar to these recent agent-generated quizzes: ${recentTitles.length > 0 ? recentTitles.join('; ') : 'none'}.
- Keep the angle materially distinct from recently rejected or pending quizzes.
- If using web context, prefer evergreen or educational framing over gossip or tragedy-heavy framing.`;
};

const normalizeDraftWithMetadata = (quiz, candidate, recentHistory) => {
	const recentConflict = getRecentConflict(quiz, recentHistory);

	if (recentConflict) {
		throw new Error(
			`Generated quiz was too similar to recent ${recentConflict.status} quiz "${recentConflict.title}" (${recentConflict.reason})`
		);
	}

	return {
		...quiz,
		sourceType: candidate.sourceType,
		sourceCitations: candidate.sourceCitations || [],
		plannerAction: 'generate_quizzes',
		plannerNotes: candidate.rationale,
		generationSignals: {
			angle: candidate.angle,
			internalSummary: candidate.internalSummary || '',
			webSummary: candidate.webSummary || '',
			sourceType: candidate.sourceType
		}
	};
};

const generateQuizDraftWithAnthropic = async ({
	candidate,
	recentHistory = [],
	revisionIssues = [],
	previousQuiz = null,
	traceContext = {}
}) => {
	let lastParseError = null;
	const runTraceId = traceContext?.runId;
	const parentSpanId = traceContext?.parentSpanId;

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const retryNote =
			attempt === 1
				? ''
				: `\nPrevious response was invalid JSON (${lastParseError?.message || 'parse failed'}). Return strict valid JSON only.`;
		const prompt = `${buildWriterPrompt({
			candidate,
			recentHistory,
			revisionIssues,
			previousQuiz
		})}${retryNote}`;
		const llmSpan = runTraceId
			? await tracer.startSpan(runTraceId, {
					parentSpanId,
					type: 'llm_call',
					name: 'generate_quiz_draft_anthropic',
					input: {
						model: config.agent.model,
						attempt,
						topic: candidate.topic,
						prompt
					}
				})
			: null;
		let response;

		try {
			response = await getAnthropicClient().messages.create({
				model: config.agent.model,
				max_tokens: 2048,
				temperature: 0,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				]
			});
		} catch (error) {
			await tracer.endSpan(
				llmSpan?.id,
				{ error: error.message },
				{
					status: 'failed'
				}
			);
			throw error;
		}

		const content = getTextContent(response);
		await tracer.endSpan(llmSpan?.id, {
			model: config.agent.model,
			attempt,
			content
		});

		try {
			const jsonPayload = extractJsonPayload(content);
			const quiz = normalizeGeneratedQuiz(JSON.parse(jsonPayload), candidate);
			return normalizeDraftWithMetadata(quiz, candidate, recentHistory);
		} catch (error) {
			lastParseError = error;
			console.warn(
				`[Agent] Invalid JSON from Anthropic on attempt ${attempt}: ${error.message}`
			);
		}
	}

	throw new Error(
		`Agent generation failed after 3 attempts: ${lastParseError?.message || 'invalid JSON response'}`
	);
};

const generateQuizDraftWithOpenAI = async ({
	candidate,
	recentHistory = [],
	revisionIssues = [],
	previousQuiz = null,
	traceContext = {}
}) => {
	const prompt = buildWriterPrompt({
		candidate,
		recentHistory,
		revisionIssues,
		previousQuiz
	});
	const runTraceId = traceContext?.runId;
	const parentSpanId = traceContext?.parentSpanId;
	const llmSpan = runTraceId
		? await tracer.startSpan(runTraceId, {
				parentSpanId,
				type: 'llm_call',
				name: 'generate_quiz_draft_openai',
				input: {
					model: config.agent.model,
					topic: candidate.topic,
					prompt
				}
			})
		: null;
	let response;

	try {
		response = await getOpenAIClient().responses.create({
			model: config.agent.model,
			instructions:
				'You are a meticulous quiz writer. Return only the structured quiz draft and follow the schema exactly.',
			input: prompt,
			max_output_tokens: 2400,
			text: {
				format: {
					type: 'json_schema',
					name: 'quiz_draft',
					schema: QUIZ_RESPONSE_SCHEMA,
					strict: true
				}
			}
		});
	} catch (error) {
		await tracer.endSpan(
			llmSpan?.id,
			{ error: error.message },
			{
				status: 'failed'
			}
		);
		throw error;
	}

	await tracer.endSpan(llmSpan?.id, {
		responseId: response?.id || null,
		model: response?.model || null,
		outputText: response?.output_text || ''
	});
	const quiz = normalizeGeneratedQuiz(JSON.parse(response.output_text), candidate);

	return normalizeDraftWithMetadata(quiz, candidate, recentHistory);
};

const generateQuizDraft = async ({
	candidate,
	recentHistory = [],
	revisionIssues = [],
	previousQuiz = null,
	traceContext = {}
}) => {
	if (isOpenAIWriterModel()) {
		return generateQuizDraftWithOpenAI({
			candidate,
			recentHistory,
			revisionIssues,
			previousQuiz,
			traceContext
		});
	}

	return generateQuizDraftWithAnthropic({
		candidate,
		recentHistory,
		revisionIssues,
		previousQuiz,
		traceContext
	});
};

const finalizeCandidateDraft = async ({
	candidate,
	recentHistory,
	sharedSources = [],
	traceContext = {}
}) => {
	const sourceCitations = buildCandidateCitations(candidate, sharedSources);
	let revisionCount = 0;
	let validationIssues = [];
	let quiz = await generateQuizDraft({
		candidate: {
			...candidate,
			sourceCitations
		},
		recentHistory,
		traceContext
	});

	while (revisionCount <= config.agent.maxRevisionAttempts) {
		const issues = [];
		let verificationReport = null;
		const validationResult = validateQuizCandidate({
			quiz,
			sourceType: candidate.sourceType,
			sourceCitations
		});
		issues.push(...validationResult.issues);

		if (validationResult.allowed) {
			verificationReport = await verifyQuizDraft({ quiz, traceContext });

			if (!verificationReport.passed) {
				issues.push(
					...verificationReport.failedQuestions.map((questionReport) =>
						createValidationIssue({
							stage: 'verification',
							code: `fact_check_${questionReport.verdict}`,
							message: `Question ${questionReport.questionIndex + 1}: ${questionReport.explanation}`
						})
					)
				);
			}
		}

		if (validationResult.allowed && verificationReport?.passed) {
			const embedding = await generateQuizEmbedding({
				title: quiz.title,
				description: quiz.description,
				tags: quiz.tags
			});
			const duplicateCheck = await checkDuplicateSimilarity(embedding);

			if (!duplicateCheck.allowed) {
				issues.push(
					createValidationIssue({
						stage: 'duplicate_check',
						code: 'duplicate_similarity',
						message: duplicateCheck.reason
					})
				);
			} else {
				return {
					quiz: {
						...quiz,
						embedding,
						sourceType: candidate.sourceType,
						sourceCitations,
						plannerAction: 'generate_quizzes',
						plannerNotes: candidate.rationale,
						generationSignals: {
							angle: candidate.angle,
							internalSummary: candidate.internalSummary || '',
							webSummary: candidate.webSummary || '',
							sourceType: candidate.sourceType,
							sourceUrls: candidate.sourceUrls || []
						},
						verificationReport,
						validationIssues: issues,
						revisionCount
					},
					verificationReport,
					validationIssues: issues,
					revisionCount
				};
			}
		}

		validationIssues = issues;

		if (revisionCount >= config.agent.maxRevisionAttempts) {
			return {
				quiz: null,
				validationIssues,
				revisionCount,
				skippedReason: summarizeValidationIssues(validationIssues)
			};
		}

		revisionCount += 1;
		quiz = await generateQuizDraft({
			candidate: {
				...candidate,
				sourceCitations
			},
			recentHistory,
			revisionIssues: validationIssues,
			previousQuiz: quiz,
			traceContext
		});
	}

	return {
		quiz: null,
		validationIssues,
		revisionCount,
		skippedReason: summarizeValidationIssues(validationIssues)
	};
};

export const runAgentCycle = async ({ traceContext = {} } = {}) => {
	const runTraceId = traceContext?.runId;
	console.log('[Agent] Starting agent cycle...');

	const preflight = await runPreFlightChecks();

	if (!preflight.allowed) {
		console.log('[Agent] Pre-flight checks failed:', preflight.blockers);
		await traceDecision({
			runId: runTraceId,
			name: 'preflight_blocked',
			input: {
				checks: preflight.checks || []
			},
			output: {
				allowed: false,
				blockers: preflight.blockers || []
			}
		});
		return {
			skipped: true,
			quizzesGenerated: 0,
			quizzesSkipped: 0,
			recommendationsSent: 0,
			plannerAction: 'stand_down',
			plannedQuizCount: 0,
			selectedTopics: [],
			pendingQuizIds: [],
			sourceCitations: [],
			toolTrace: [],
			plannerRationale: preflight.blockers.join(' | '),
			reason: preflight.blockers,
			summary: preflight.blockers.join(' | ')
		};
	}

	const maxPerRun = Math.min(AGENT_LIMITS.MAX_QUIZZES_PER_RUN, 9);
	let planningResult;
	const planningSpan = runTraceId
		? await tracer.startSpan(runTraceId, {
				type: 'decision',
				name: 'plan_agent_run',
				input: {
					maxQuizzesPerRun: maxPerRun,
					pendingQueueCap: AGENT_LIMITS.PENDING_QUEUE_CAP
				}
			})
		: null;

	try {
		planningResult = await planAgentRun({
			maxQuizzesPerRun: maxPerRun,
			pendingQueueCap: AGENT_LIMITS.PENDING_QUEUE_CAP,
			webSearch: {
				model: config.agent.plannerModel,
				searchContextSize: config.agent.webSearchContextSize,
				userLocation:
					config.agent.webSearchLocation?.country ||
					config.agent.webSearchLocation?.city ||
					config.agent.webSearchLocation?.region
						? {
								type: 'approximate',
								...config.agent.webSearchLocation
							}
						: undefined
			},
			toolHandlers: {
				getPlatformState: getPlannerPlatformState,
				getRecentAgentHistory: getPlannerRecentHistory,
				getAgentMemory: getAgentMemorySnapshot
			},
			traceContext: {
				runId: runTraceId,
				parentSpanId: planningSpan?.id
			}
		});
		await tracer.endSpan(planningSpan?.id, {
			action: planningResult?.plan?.action || null,
			plannedQuizCount: planningResult?.plan?.plannedQuizCount || 0
		});
	} catch (error) {
		console.warn(`[Agent] Planner failed, using fallback ranking: ${error.message}`);
		await tracer.endSpan(
			planningSpan?.id,
			{
				error: error.message
			},
			{
				status: 'failed'
			}
		);
		await traceError({
			runId: runTraceId,
			name: 'planner_failed',
			input: {
				stage: 'planning'
			},
			error
		});
		planningResult = await buildFallbackPlan();
		planningResult.toolTrace.push({
			name: 'planner_fallback',
			status: 'warning',
			summary: error.message
		});
	}

	const { plan, toolTrace } = planningResult;

	if (plan.action !== 'generate_quizzes' || !plan.topics.length) {
		const summary =
			plan.action === 'observe'
				? `Planner chose to observe only. ${plan.rationale}`
				: plan.rationale;

		console.log('[Agent] Planner chose not to generate quizzes:', summary);
		await traceDecision({
			runId: runTraceId,
			name: 'planner_no_generation',
			input: {
				action: plan.action,
				rationale: plan.rationale
			},
			output: {
				summary
			}
		});

		return {
			skipped: true,
			quizzesGenerated: 0,
			quizzesSkipped: 0,
			recommendationsSent: 0,
			costUSD: 0,
			plannerAction: plan.action,
			plannedQuizCount: plan.plannedQuizCount || 0,
			selectedTopics: [],
			pendingQuizIds: [],
			sourceCitations: plan.sourceCitations || [],
			toolTrace,
			plannerRationale: plan.rationale,
			reason: summary,
			summary
		};
	}

	const mutableRecentHistory = await getRecentAgentQuizHistory();
	const selectedTopics = plan.topics.map((candidate) => candidate.topic);
	const createdPendingQuizzes = [];
	const skippedReasons = [];
	const runErrors = [];

	console.log(
		`[Agent] Planner selected ${selectedTopics.length}/${maxPerRun} topics: ${selectedTopics.join(', ')}`
	);

	for (const candidate of plan.topics.slice(0, maxPerRun)) {
		console.log(`[Agent] Generating quiz for topic: ${candidate.topic}`);
		const candidateSpan = runTraceId
			? await tracer.startSpan(runTraceId, {
					type: 'decision',
					name: 'process_candidate_topic',
					input: {
						topic: candidate.topic,
						angle: candidate.angle,
						sourceType: candidate.sourceType
					}
				})
			: null;

		try {
			const finalized = await finalizeCandidateDraft({
				candidate: {
					...candidate,
					internalSummary: plan.internalSummary,
					webSummary: plan.webSummary
				},
				recentHistory: mutableRecentHistory,
				sharedSources: plan.sourceCitations,
				traceContext: {
					runId: runTraceId,
					parentSpanId: candidateSpan?.id
				}
			});

			if (!finalized.quiz) {
				const reason = `Skipped "${candidate.topic}" because ${finalized.skippedReason}`;
				console.log('[Agent] Candidate skipped:', reason);
				skippedReasons.push(reason);
				await tracer.endSpan(candidateSpan?.id, {
					status: 'skipped',
					reason
				});
				continue;
			}

			const pendingQuiz = await QuizPending.create({
				...finalized.quiz,
				status: 'pending'
			});

			createdPendingQuizzes.push({
				id: pendingQuiz._id.toString(),
				title: pendingQuiz.title,
				topic: pendingQuiz.topic
			});
			mutableRecentHistory.unshift({
				title: pendingQuiz.title,
				topic: pendingQuiz.topic,
				tags: pendingQuiz.tags,
				status: 'pending',
				createdAt: pendingQuiz.createdAt
			});
			mutableRecentHistory.splice(RECENT_AGENT_HISTORY_LIMIT);

			console.log('[Agent] Pending quiz created:', pendingQuiz._id.toString());
			await tracer.endSpan(candidateSpan?.id, {
				status: 'created',
				pendingQuizId: pendingQuiz._id.toString(),
				title: pendingQuiz.title,
				topic: pendingQuiz.topic
			});
		} catch (error) {
			const message = `Topic "${candidate.topic}" failed: ${error.message}`;
			console.warn(`[Agent] ${message}`);
			runErrors.push(message);
			await tracer.endSpan(candidateSpan?.id, {
				status: 'failed',
				error: message
			});
			await traceError({
				runId: runTraceId,
				parentSpanId: candidateSpan?.id,
				name: 'candidate_generation_failed',
				input: {
					topic: candidate.topic
				},
				error
			});
		}
	}

	if (!createdPendingQuizzes.length && runErrors.length > 0) {
		throw new Error(runErrors.join(' | '));
	}

	if (!createdPendingQuizzes.length) {
		const summary =
			skippedReasons[0] ||
			'The agent decided not to create any new quizzes after reviewing current demand.';
		await traceDecision({
			runId: runTraceId,
			name: 'no_pending_quizzes_created',
			input: {
				skippedReasons,
				runErrors
			},
			output: {
				summary
			}
		});

		return {
			skipped: true,
			quizzesGenerated: 0,
			quizzesSkipped: skippedReasons.length,
			recommendationsSent: 0,
			costUSD: 0,
			plannerAction: plan.action,
			plannedQuizCount: plan.plannedQuizCount || plan.topics.length,
			selectedTopics,
			pendingQuizIds: [],
			sourceCitations: plan.sourceCitations || [],
			toolTrace,
			plannerRationale: plan.rationale,
			reason: skippedReasons,
			runErrors,
			summary
		};
	}

	const createdTitles = createdPendingQuizzes.map((quiz) => `"${quiz.title}"`);
	const createdTopics = Array.from(new Set(createdPendingQuizzes.map((quiz) => quiz.topic)));
	const summaryParts = [
		`Created ${createdPendingQuizzes.length} pending ${createdPendingQuizzes.length === 1 ? 'quiz' : 'quizzes'} for ${createdTopics.join(', ')}.`
	];

	if (skippedReasons.length > 0) {
		summaryParts.push(
			`Skipped ${skippedReasons.length} candidate${skippedReasons.length === 1 ? '' : 's'} during the run.`
		);
	}

	if (runErrors.length > 0) {
		summaryParts.push(
			`Encountered ${runErrors.length} recoverable error${runErrors.length === 1 ? '' : 's'}.`
		);
	}

	await traceDecision({
		runId: runTraceId,
		name: 'run_cycle_completed',
		input: {
			selectedTopics,
			skippedReasonsCount: skippedReasons.length,
			runErrorsCount: runErrors.length
		},
		output: {
			createdPendingQuizzes
		}
	});

	return {
		skipped: false,
		quizzesGenerated: createdPendingQuizzes.length,
		quizzesSkipped: skippedReasons.length,
		recommendationsSent: 0,
		costUSD: 0,
		plannerAction: plan.action,
		plannedQuizCount: plan.plannedQuizCount || plan.topics.length,
		selectedTopics,
		summary: `${summaryParts.join(' ')} Created: ${createdTitles.join(', ')}.`,
		pendingQuizId: createdPendingQuizzes[0]?.id,
		pendingQuizIds: createdPendingQuizzes.map((quiz) => quiz.id),
		sourceCitations: plan.sourceCitations || [],
		toolTrace,
		plannerRationale: plan.rationale,
		runErrors
	};
};

export const runTrackedAgentCycle = async ({ trigger = 'manual', requestedBy } = {}) => {
	if (activeAgentRunPromise) {
		return {
			alreadyRunning: true,
			run: null,
			result: null
		};
	}

	activeAgentRunPromise = (async () => {
		const startedAt = new Date();
		const traceRun = await tracer.startRun('Quizco Agent Cycle', {
			trigger,
			requestedBy
		});
		const traceRunId = traceRun?.id || null;

		try {
			const result = await runAgentCycle({
				traceContext: {
					runId: traceRunId
				}
			});
			const endedAt = new Date();
			const run = await persistAgentRun({
				traceId: traceRunId || undefined,
				name: 'Quizco Agent Cycle',
				ranAt: startedAt,
				startedAt,
				endedAt,
				trigger,
				requestedBy,
				status: result?.skipped ? 'skipped' : 'completed',
				durationMs: Date.now() - startedAt.getTime(),
				quizzesGenerated: result?.quizzesGenerated ?? 0,
				quizzesSkipped: result?.quizzesSkipped ?? (result?.skipped ? 1 : 0),
				recommendationsSent: result?.recommendationsSent ?? 0,
				plannerAction: result?.plannerAction,
				plannedQuizCount: result?.plannedQuizCount ?? 0,
				selectedTopics: result?.selectedTopics || [],
				pendingQuizIds: result?.pendingQuizIds || [],
				sourceCitations: result?.sourceCitations || [],
				toolTrace: result?.toolTrace || [],
				costUSD: result?.costUSD ?? 0,
				summary: buildRunSummary({ result }),
				plannerRationale: result?.plannerRationale || '',
				runErrors: result?.runErrors || [],
				metadata: {
					trigger,
					requestedBy,
					traceRunId
				}
			});
			const persistedRun = run?.toObject?.() || run;
			await tracer.endRun(traceRunId, result?.skipped ? 'skipped' : 'completed', {
				persistedRunId: persistedRun?._id?.toString?.() || null,
				summary: buildRunSummary({ result })
			});

			try {
				await refreshAgentMemory();
			} catch (memoryError) {
				console.error('[Agent] Failed to refresh agent memory:', memoryError.message);
			}

			return {
				alreadyRunning: false,
				run: persistedRun,
				result
			};
		} catch (error) {
			console.error('[Agent] Run failed:', error);
			await traceError({
				runId: traceRunId,
				name: 'run_tracked_cycle_failed',
				input: {
					trigger,
					requestedBy
				},
				error
			});
			const endedAt = new Date();
			const run = await persistAgentRun({
				traceId: traceRunId || undefined,
				name: 'Quizco Agent Cycle',
				ranAt: startedAt,
				startedAt,
				endedAt,
				trigger,
				requestedBy,
				status: 'failed',
				durationMs: Date.now() - startedAt.getTime(),
				summary: buildRunSummary({ error }),
				runErrors: [error.message],
				metadata: {
					trigger,
					requestedBy,
					traceRunId
				}
			});
			await tracer.endRun(traceRunId, 'failed', {
				persistedRunId: run?._id?.toString?.() || null,
				error: error.message
			});
			try {
				await refreshAgentMemory();
			} catch (memoryError) {
				console.error('[Agent] Failed to refresh agent memory:', memoryError.message);
			}

			error.agentRun = run?.toObject?.() || run;
			throw error;
		} finally {
			activeAgentRunPromise = null;
		}
	})();

	return activeAgentRunPromise;
};
