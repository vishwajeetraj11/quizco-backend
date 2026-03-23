const BLOCKED_TOPIC_PATTERNS = [
	{
		code: 'harmful_topic',
		pattern:
			/\b(suicide|self-harm|massacre|terror|terrorism|rape|porn|pornography|explicit sex|child abuse)\b/i,
		message: 'Avoid harmful, explicit, or traumatic topics for automatically generated quizzes.'
	},
	{
		code: 'breaking_tragedy',
		pattern:
			/\b(death toll|fatalities|plane crash|earthquake|floods?|shooting|war crime|hostage)\b/i,
		message: 'Avoid turning active tragedies or crisis-heavy topics into quiz content.'
	}
];

const LOW_TRUST_SOURCE_DOMAINS = [
	'reddit.com',
	'x.com',
	'twitter.com',
	'tiktok.com',
	'instagram.com',
	'facebook.com',
	'pinterest.com'
];

const getDomainFromUrl = (value = '') => {
	try {
		return new globalThis.URL(value).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

const pushIssue = (issues, issue) => {
	issues.push({
		status: issue.status || 'failed',
		stage: issue.stage || 'validation',
		code: issue.code || 'validation_issue',
		message: issue.message
	});
};

export const validateTopicSafety = ({ topic = '', angle = '', sourceCitations = [] }) => {
	const issues = [];
	const combinedText = `${topic} ${angle}`.trim();

	for (const rule of BLOCKED_TOPIC_PATTERNS) {
		if (rule.pattern.test(combinedText)) {
			pushIssue(issues, {
				code: rule.code,
				message: rule.message
			});
		}
	}

	if (sourceCitations.length > 0) {
		const domains = sourceCitations
			.map((citation) => citation.domain || getDomainFromUrl(citation.url))
			.filter(Boolean);
		const reputableDomains = domains.filter(
			(domain) => !LOW_TRUST_SOURCE_DOMAINS.includes(domain)
		);

		if (!reputableDomains.length) {
			pushIssue(issues, {
				status: 'warning',
				stage: 'sources',
				code: 'low_trust_sources',
				message:
					'Web trend evidence only came from low-trust or social domains. Prefer reputable sources.'
			});
		}
	}

	return issues;
};

export const validateQuizCandidate = ({ quiz, sourceType = 'internal', sourceCitations = [] }) => {
	const issues = [
		...validateTopicSafety({
			topic: quiz.topic,
			angle: quiz.description,
			sourceCitations
		})
	];
	const seenQuestionTitles = new Set();

	if (!quiz.title || quiz.title.trim().length < 8) {
		pushIssue(issues, {
			code: 'weak_title',
			message: 'Quiz title is too short to feel intentional or specific.'
		});
	}

	if (!quiz.description || quiz.description.trim().length < 16) {
		pushIssue(issues, {
			code: 'weak_description',
			message: 'Quiz description is too short to explain the angle clearly.'
		});
	}

	if (!Array.isArray(quiz.questions) || quiz.questions.length !== 5) {
		pushIssue(issues, {
			code: 'invalid_question_count',
			message: 'Quiz must contain exactly 5 questions.'
		});
	}

	for (const [index, question] of (quiz.questions || []).entries()) {
		const titleKey = question.title?.trim().toLowerCase();

		if (!titleKey) {
			pushIssue(issues, {
				code: 'empty_question',
				message: `Question ${index + 1} is missing text.`
			});
			continue;
		}

		if (seenQuestionTitles.has(titleKey)) {
			pushIssue(issues, {
				code: 'duplicate_question',
				message: `Question ${index + 1} repeats another question prompt.`
			});
		}
		seenQuestionTitles.add(titleKey);

		const optionValues = (question.options || [])
			.map((option) => option?.value?.trim())
			.filter(Boolean);
		const uniqueOptionValues = new Set(optionValues.map((option) => option.toLowerCase()));

		if (optionValues.length !== 4 || uniqueOptionValues.size !== 4) {
			pushIssue(issues, {
				code: 'invalid_options',
				message: `Question ${index + 1} must contain 4 distinct answer options.`
			});
		}

		if (!optionValues.some((option) => option === question.correct)) {
			pushIssue(issues, {
				code: 'missing_correct_option',
				message: `Question ${index + 1} is missing the correct answer in its options.`
			});
		}
	}

	if (sourceType !== 'internal' && sourceCitations.length === 0) {
		pushIssue(issues, {
			stage: 'sources',
			code: 'missing_citations',
			message: 'Web-influenced quizzes must retain at least one source citation.'
		});
	}

	return {
		allowed: !issues.some((issue) => issue.status !== 'warning'),
		issues
	};
};

export const summarizeValidationIssues = (issues = []) =>
	issues.map((issue) => `${issue.code}: ${issue.message}`).join(' | ');
