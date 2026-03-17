import OpenAI from 'openai';

const getClient = () => {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error('OPENAI_API_KEY is required to generate AI quiz content.');
	}

	return new OpenAI({
		apiKey: process.env.OPENAI_API_KEY
	});
};

export const getQuestions = async (title, questionCount) => {
	const data = await getClient().chat.completions.create({
		model: 'gpt-3.5-turbo',
		max_tokens: 2048,
		temperature: 1,
		messages: [
			{
				role: 'system',
				content:
					'You are a helpful AI assistant that can generate questions based on a given title.'
			},
			{
				role: 'user',
				content: `Generate ${
					questionCount || 10
				} questions in JSON format related to the title: ${title} which has the JSON structure: [{ text: 'text',  answer: {correctOptions : {option[4]}}, options: {option:[{id:1,content:'content'},{id:2,content:'content'},{id:3,content:'content'},{id:4,content:'content'}]}},...,... n questions]`
			}
		]
	});
	let quiz = data.choices[0].message.content;
	try {
		quiz = JSON.parse(quiz);
	} catch {
		quiz = data.choices[0].message.content;
	}
	return { quiz };
};
