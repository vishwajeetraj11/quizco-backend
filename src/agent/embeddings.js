import { EMBEDDING_CONFIG } from './constants.js';
import { getOpenAIClient } from './openaiClient.js';

export const generateQuizEmbedding = async ({ title, description = '', tags = [] }) => {
	const text = [title, description, ...tags].filter(Boolean).join(' | ');

	const response = await getOpenAIClient().embeddings.create({
		model: EMBEDDING_CONFIG.MODEL,
		input: text,
		dimensions: EMBEDDING_CONFIG.DIMENSIONS
	});

	return response.data[0].embedding;
};
