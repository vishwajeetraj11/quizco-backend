import { config } from '../config/index.js';
import { getOpenAIClient } from './openaiClient.js';
import { tracer } from './tracer.js';

const MAX_QUESTION_REPORTS = 5;
const MAX_CITATIONS_PER_QUESTION = 4;
const MAX_FOLLOW_UP_ACTIONS = 5;

const VERIFICATION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'overallVerdict',
		'summary',
		'factCheckRequired',
		'questionReports',
		'followUpActions'
	],
	properties: {
		overallVerdict: {
			type: 'string',
			enum: ['verified', 'needs_revision', 'unsupported']
		},
		summary: {
			type: 'string'
		},
		factCheckRequired: {
			type: 'boolean'
		},
		followUpActions: {
			type: 'array',
			maxItems: MAX_FOLLOW_UP_ACTIONS,
			items: {
				type: 'string'
			}
		},
		questionReports: {
			type: 'array',
			maxItems: MAX_QUESTION_REPORTS,
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'questionIndex',
					'claim',
					'verdict',
					'explanation',
					'sourceUrls',
					'sourceTitles'
				],
				properties: {
					questionIndex: {
						type: 'integer',
						minimum: 0,
						maximum: 4
					},
					claim: {
						type: 'string'
					},
					verdict: {
						type: 'string',
						enum: ['supported', 'contradicted', 'unverifiable', 'not_needed']
					},
					explanation: {
						type: 'string'
					},
					sourceUrls: {
						type: 'array',
						maxItems: MAX_CITATIONS_PER_QUESTION,
						items: {
							type: 'string'
						}
					},
					sourceTitles: {
						type: 'array',
						maxItems: MAX_CITATIONS_PER_QUESTION,
						items: {
							type: 'string'
						}
					}
				}
			}
		}
	}
};

const getDomainFromUrl = (value = '') => {
	try {
		return new globalThis.URL(value).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

const buildVerifierPrompt = ({
	quiz,
	compactMode = false
}) => `You are a rigorous fact-checking verifier for AI-generated quiz content.

Check the factual accuracy of this quiz using web search when needed.

Rules:
- Focus on factual claims, historical claims, scientific claims, dates, rankings, “first/only/most” claims, and unusual trivia.
- Use web search to verify those claims.
- If a question is opinion-based, wordplay, or otherwise not factual, mark it as "not_needed".
- If you cannot confidently support a claim with reputable sources, mark it "unverifiable".
- If a claim appears false or the answer key looks wrong, mark it "contradicted".
- Be skeptical of weird trivia unless you can verify it.
- Only cite URLs that come from the web search results you used.
- Return at most one report per question index.
- Keep each question to at most ${MAX_CITATIONS_PER_QUESTION} citations (URL/title pairs).
${compactMode ? '- Keep explanations concise (1-2 sentences each).' : ''}

Quiz JSON:
${JSON.stringify(quiz, null, 2)}`;

const normalizeSourceCitations = (responseSources = [], questionReports = []) => {
	const lookup = new Map(
		responseSources.map((source) => [
			source.url,
			{
				url: source.url,
				title: source.title || '',
				domain: source.domain || getDomainFromUrl(source.url)
			}
		])
	);

	return questionReports.map((report) => {
		const citations = Array.from(new Set(report.sourceUrls || []))
			.map((url, index) => {
				const shared = lookup.get(url);

				return {
					url,
					title: report.sourceTitles?.[index] || shared?.title || '',
					domain: shared?.domain || getDomainFromUrl(url)
				};
			})
			.filter((citation) => citation.url);

		return {
			questionIndex: report.questionIndex,
			claim: report.claim,
			verdict: report.verdict,
			explanation: report.explanation,
			citations
		};
	});
};

const extractResponseSources = (response) => {
	const sources = [];

	for (const item of response.output || []) {
		if (item.type !== 'web_search_call') {
			continue;
		}

			for (const source of item.action?.sources || []) {
				sources.push({
					url: source.url,
					title: source.title || '',
					domain: getDomainFromUrl(source.url)
				});
			}
	}

	return Array.from(new Map(sources.map((source) => [source.url, source])).values());
};

const parseVerificationReport = (response) => {
	if (response && typeof response.output_parsed === 'object' && response.output_parsed !== null) {
		return response.output_parsed;
	}

	try {
		return JSON.parse(response?.output_text || '');
	} catch {
		return null;
	}
};

const createVerifierResponse = async ({ quiz, compactMode = false }) =>
	getOpenAIClient().responses.create({
		model: config.agent.verifierModel || config.agent.plannerModel,
		instructions: compactMode
			? 'You are a meticulous fact-checking verifier. Use web search when needed and return concise valid JSON only.'
			: 'You are a meticulous fact-checking verifier. Use web search when a claim requires external confirmation.',
		input: buildVerifierPrompt({ quiz, compactMode }),
		max_output_tokens: compactMode ? 2600 : 2200,
		include: ['web_search_call.action.sources'],
		tools: [
			{
				type: 'web_search',
				search_context_size: config.agent.webSearchContextSize || 'medium',
				user_location:
					config.agent.webSearchLocation?.country ||
					config.agent.webSearchLocation?.city ||
					config.agent.webSearchLocation?.region
						? {
								type: 'approximate',
								...config.agent.webSearchLocation
							}
						: undefined
			}
		],
		text: {
			format: {
				type: 'json_schema',
				name: 'quiz_verification_report',
				schema: VERIFICATION_SCHEMA,
				strict: true
			}
		}
	});

export const verifyQuizDraft = async ({ quiz, traceContext = {} }) => {
	const runTraceId = traceContext?.runId;
	const parentSpanId = traceContext?.parentSpanId;
	const llmSpan = runTraceId
		? await tracer.startSpan(runTraceId, {
				parentSpanId,
				type: 'llm_call',
				name: 'verify_quiz_draft',
				input: {
					model: config.agent.verifierModel || config.agent.plannerModel,
					quiz
				}
			})
		: null;
	let response;
	let rawReport = null;
	let parseRetryCount = 0;

	try {
		response = await createVerifierResponse({ quiz });
		rawReport = parseVerificationReport(response);

		if (!rawReport) {
			parseRetryCount += 1;
			response = await createVerifierResponse({ quiz, compactMode: true });
			rawReport = parseVerificationReport(response);
		}

		if (!rawReport) {
			throw new Error('Verifier returned invalid JSON output after retry.');
		}
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
		outputText: response?.output_text || '',
		parseRetryCount
	});

	for (const item of response.output || []) {
		if (item.type !== 'web_search_call') {
			continue;
		}

		const queries = item.action?.queries || [item.action?.query].filter(Boolean);
		const webSearchSpan = runTraceId
			? await tracer.startSpan(runTraceId, {
					parentSpanId: llmSpan?.id || parentSpanId,
					type: 'tool_call',
					name: 'verify_web_search',
					input: {
						queries
					}
				})
			: null;
		await tracer.endSpan(webSearchSpan?.id, {
			status: item.status || 'completed',
			sourceCount: item.action?.sources?.length || 0,
			sources: item.action?.sources || []
		});
	}

	const responseSources = extractResponseSources(response);
	const questionReports = normalizeSourceCitations(
		responseSources,
		rawReport.questionReports || []
	);
	const failedQuestions = questionReports.filter((report) =>
		['contradicted', 'unverifiable'].includes(report.verdict)
	);

	return {
		overallVerdict: rawReport.overallVerdict,
		summary: rawReport.summary,
		factCheckRequired: rawReport.factCheckRequired,
		followUpActions: rawReport.followUpActions || [],
		questionReports,
		sourceCitations: responseSources,
		passed: rawReport.overallVerdict === 'verified' && failedQuestions.length === 0,
		failedQuestions
	};
};
