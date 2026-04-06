import OpenAI from 'openai';

let client = null;

export const getOpenAIClient = () => {
	if (!client) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				'OPENAI_API_KEY is required for agent planning, generation, and embeddings.'
			);
		}

		client = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY
		});
	}

	return client;
};
