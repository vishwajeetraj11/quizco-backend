import { getOpenAIClient } from './openaiClient.js';
import { tracer } from './tracer.js';

const MAX_TOOL_ROUNDS = 8;
const MAX_TOPICS_PER_PLAN = 9;

const PLAN_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'action',
		'rationale',
		'plannedQuizCount',
		'internalSummary',
		'webSummary',
		'safetyNotes',
		'topics'
	],
	properties: {
		action: {
			type: 'string',
			enum: ['generate_quizzes', 'stand_down', 'observe']
		},
		rationale: {
			type: 'string'
		},
		plannedQuizCount: {
			type: 'integer',
			minimum: 0,
			maximum: MAX_TOPICS_PER_PLAN
		},
		internalSummary: {
			type: 'string'
		},
		webSummary: {
			type: 'string'
		},
		safetyNotes: {
			type: 'array',
			items: {
				type: 'string'
			}
		},
		topics: {
			type: 'array',
			maxItems: MAX_TOPICS_PER_PLAN,
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'topic',
					'angle',
					'format',
					'rationale',
					'trendSummary',
					'sourceType',
					'sourceUrls',
					'sourceTitles'
				],
				properties: {
					topic: {
						type: 'string'
					},
					angle: {
						type: 'string'
					},
					format: {
						type: 'string',
						enum: ['speed_round', 'deep_dive', 'standard', 'streak']
					},
					rationale: {
						type: 'string'
					},
					trendSummary: {
						type: 'string'
					},
					sourceType: {
						type: 'string',
						enum: ['internal', 'web', 'blended']
					},
					sourceUrls: {
						type: 'array',
						items: {
							type: 'string'
						}
					},
					sourceTitles: {
						type: 'array',
						items: {
							type: 'string'
						}
					}
				}
			}
		}
	}
};

const TOOL_DEFINITIONS = [
	{
		type: 'function',
		name: 'get_platform_state',
		description:
			'Read current internal platform demand, queue health, topic performance, and topic review signals before deciding what the agent should do.',
		strict: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: [],
			properties: {}
		}
	},
	{
		type: 'function',
		name: 'get_recent_agent_history',
		description:
			'Read recent agent runs, pending quizzes, approvals, and rejections to avoid repetition and learn from reviewer feedback.',
		strict: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['limit'],
			properties: {
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 25
				}
			}
		}
	},
	{
		type: 'function',
		name: 'get_agent_memory',
		description:
			'Read durable agent memory including topic performance and review insights learned from previous runs.',
		strict: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: [],
			properties: {}
		}
	}
];

const getDomainFromUrl = (value = '') => {
	try {
		return new globalThis.URL(value).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

const safeJsonParse = (value, fallback = null) => {
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
};

const buildPlannerInstructions = () => `You are the planning brain for an AI quiz agent.

Your job is to decide whether the platform needs new quizzes right now, and if so, which topics and angles are best.

Rules:
- Always inspect internal platform state before deciding.
- Use web search when current trend freshness would materially improve the decision or break ties.
- Prefer topics with real internal demand, good review outcomes, and room in the pending queue.
- Avoid topics that were recently rejected or are already heavily pending unless you have a materially different angle.
- Never force generation. It is valid to choose "stand_down" with 0 quizzes.
- Keep plans focused. Generate at most ${MAX_TOPICS_PER_PLAN} topics and usually fewer.
- Avoid harmful, explicit, tragedy-heavy, or low-quality clickbait topics.
- If web search influences a topic, include the exact source URLs and short source titles.
- If internal demand is strong enough on its own, you may skip web search.
- Use "observe" only when the right action is to gather or preserve signals without creating quizzes.
- Return only the structured plan requested by the schema.`;

const buildInitialPlannerInput = ({ maxQuizzesPerRun, pendingQueueCap }) =>
	`Decide the next best action for the quiz agent.

Operational constraints:
- max quizzes per run: ${maxQuizzesPerRun}
- pending queue cap: ${pendingQueueCap}

Choose between:
- generate_quizzes
- stand_down
- observe

If you generate quizzes, choose concrete topics and distinct angles.`;

const normalizePlan = ({ rawPlan, webSources = [], maxQuizzesPerRun }) => {
	const action = ['generate_quizzes', 'stand_down', 'observe'].includes(rawPlan?.action)
		? rawPlan.action
		: 'stand_down';
	const plannedQuizCount = Math.min(
		Math.max(rawPlan?.plannedQuizCount || 0, 0),
		Math.min(maxQuizzesPerRun, MAX_TOPICS_PER_PLAN)
	);
	const normalizedTopics =
		action === 'generate_quizzes'
			? (rawPlan?.topics || [])
					.filter((topic) => topic?.topic && topic?.angle)
					.slice(0, plannedQuizCount || maxQuizzesPerRun)
					.map((topic) => ({
						topic: topic.topic.trim(),
						angle: topic.angle.trim(),
						format: ['speed_round', 'deep_dive', 'standard', 'streak'].includes(
							topic.format
						)
							? topic.format
							: 'standard',
						rationale: topic.rationale?.trim() || rawPlan?.rationale || '',
						trendSummary: topic.trendSummary?.trim() || '',
						sourceType: ['internal', 'web', 'blended'].includes(topic.sourceType)
							? topic.sourceType
							: 'internal',
						sourceUrls: Array.from(new Set((topic.sourceUrls || []).filter(Boolean))),
						sourceTitles: Array.from(
							new Set((topic.sourceTitles || []).filter(Boolean))
						)
					}))
			: [];

	const citations = Array.from(
		new Map(
			webSources.map((source) => [
				source.url,
				{
					url: source.url,
					title: source.title || '',
					domain: source.domain || getDomainFromUrl(source.url)
				}
			])
		).values()
	);

	return {
		action,
		rationale: rawPlan?.rationale?.trim() || 'No planner rationale returned.',
		internalSummary: rawPlan?.internalSummary?.trim() || '',
		webSummary: rawPlan?.webSummary?.trim() || '',
		safetyNotes: Array.isArray(rawPlan?.safetyNotes) ? rawPlan.safetyNotes : [],
		plannedQuizCount: normalizedTopics.length,
		topics: normalizedTopics,
		sourceCitations: citations
	};
};

const summarizeToolResult = (name, result) => {
	if (name === 'get_platform_state') {
		return `pending=${result?.pendingQueue?.pendingCount || 0}, candidates=${result?.candidateTopics?.length || 0}`;
	}

	if (name === 'get_recent_agent_history') {
		return `pending=${result?.recentPending?.length || 0}, runs=${result?.recentRuns?.length || 0}`;
	}

	if (name === 'get_agent_memory') {
		return `topicPerformance=${Object.keys(result?.contentInsights?.topicPerformance || {}).length}`;
	}

	return 'tool executed';
};

const extractWebSources = (response) => {
	const sources = [];
	const toolTrace = [];

	for (const item of response.output || []) {
		if (item.type === 'web_search_call') {
			const queries = item.action?.queries || [item.action?.query].filter(Boolean);
			toolTrace.push({
				name: 'web_search',
				status: item.status || 'completed',
				summary: queries.length > 0 ? queries.join(' | ') : 'web search executed'
			});

				for (const source of item.action?.sources || []) {
					sources.push({
						url: source.url,
						title: source.title || '',
						domain: getDomainFromUrl(source.url)
					});
				}
			}
	}

	return { sources, toolTrace };
};

const summarizeLlmResponse = (response) => ({
	responseId: response?.id || null,
	model: response?.model || null,
	outputText: response?.output_text || '',
	outputCount: Array.isArray(response?.output) ? response.output.length : 0
});

const runPlannerLlmCall = async ({ runTraceId, parentSpanId, name, input, createResponse }) => {
	const llmSpan = runTraceId
		? await tracer.startSpan(runTraceId, {
				parentSpanId,
				type: 'llm_call',
				name,
				input
			})
		: null;

	try {
		const response = await createResponse();
		await tracer.endSpan(llmSpan?.id, summarizeLlmResponse(response));
		return response;
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
};

export const planAgentRun = async ({
	maxQuizzesPerRun,
	pendingQueueCap,
	webSearch = {},
	toolHandlers,
	traceContext = {}
}) => {
	const runTraceId = traceContext?.runId;
	const parentSpanId = traceContext?.parentSpanId;
	const tools = [
		...TOOL_DEFINITIONS,
		{
			type: 'web_search',
			search_context_size: webSearch.searchContextSize || 'medium',
			user_location: webSearch.userLocation || undefined
		}
	];
	const instructions = buildPlannerInstructions();
	const include = ['web_search_call.action.sources'];
	const toolTrace = [];
	const collectedSources = new Map();
	let response = await runPlannerLlmCall({
		runTraceId,
		parentSpanId,
		name: 'planner_round_initial',
		input: {
			model: webSearch.model,
			maxQuizzesPerRun,
			pendingQueueCap
		},
		createResponse: () =>
			getOpenAIClient().responses.create({
				model: webSearch.model,
				instructions,
				input: buildInitialPlannerInput({ maxQuizzesPerRun, pendingQueueCap }),
				parallel_tool_calls: false,
				include,
				max_output_tokens: 2400,
				tools,
				text: {
					format: {
						type: 'json_schema',
						name: 'agent_generation_plan',
						schema: PLAN_SCHEMA,
						strict: true
					}
				}
			})
	});

	for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
		for (const item of response.output || []) {
			if (item.type !== 'web_search_call') {
				continue;
			}

			const queries = item.action?.queries || [item.action?.query].filter(Boolean);
			const searchSpan = runTraceId
				? await tracer.startSpan(runTraceId, {
						parentSpanId,
						type: 'tool_call',
						name: 'web_search',
						input: {
							queries
						}
					})
				: null;
			await tracer.endSpan(searchSpan?.id, {
				status: item.status || 'completed',
				sourceCount: item.action?.sources?.length || 0,
				sources: item.action?.sources || []
			});
		}

		const { sources, toolTrace: webTrace } = extractWebSources(response);

		for (const source of sources) {
			collectedSources.set(source.url, source);
		}

		toolTrace.push(...webTrace);

		const functionCalls = (response.output || []).filter(
			(item) => item.type === 'function_call'
		);

		if (!functionCalls.length) {
			const rawPlan = safeJsonParse(response.output_text, {
				action: 'stand_down',
				rationale: 'Planner returned invalid JSON.',
				plannedQuizCount: 0,
				topics: [],
				safetyNotes: ['planner_invalid_json']
			});

			return {
				plan: normalizePlan({
					rawPlan,
					webSources: [...collectedSources.values()],
					maxQuizzesPerRun
				}),
				toolTrace
			};
		}

		const functionCallOutputs = [];

		for (const call of functionCalls) {
			const args = safeJsonParse(call.arguments, {}) || {};
			const toolSpan = runTraceId
				? await tracer.startSpan(runTraceId, {
						parentSpanId,
						type: 'tool_call',
						name: call.name,
						input: args
					})
				: null;
			const handler =
				call.name === 'get_platform_state'
					? toolHandlers.getPlatformState
					: call.name === 'get_recent_agent_history'
						? toolHandlers.getRecentAgentHistory
						: toolHandlers.getAgentMemory;

			let result;

			try {
				result = await handler(args);
			} catch (error) {
				await tracer.endSpan(
					toolSpan?.id,
					{ error: error.message },
					{
						status: 'failed'
					}
				);
				throw error;
			}

			await tracer.endSpan(toolSpan?.id, {
				summary: summarizeToolResult(call.name, result),
				result
			});
			toolTrace.push({
				name: call.name,
				status: 'completed',
				summary: summarizeToolResult(call.name, result)
			});
			functionCallOutputs.push({
				type: 'function_call_output',
				call_id: call.call_id,
				output: JSON.stringify(result)
			});
		}

		response = await runPlannerLlmCall({
			runTraceId,
			parentSpanId,
			name: `planner_round_${round + 2}`,
			input: {
				model: webSearch.model,
				previousResponseId: response.id,
				functionCallOutputs: functionCallOutputs.length
			},
			createResponse: () =>
				getOpenAIClient().responses.create({
					model: webSearch.model,
					instructions,
					previous_response_id: response.id,
					input: functionCallOutputs,
					parallel_tool_calls: false,
					include,
					max_output_tokens: 2400,
					tools,
					text: {
						format: {
							type: 'json_schema',
							name: 'agent_generation_plan',
							schema: PLAN_SCHEMA,
							strict: true
						}
					}
				})
		});
	}

	throw new Error('Planner exceeded the maximum tool-calling rounds.');
};
