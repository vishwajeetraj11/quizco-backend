import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Quiz } from '../models/Quiz.js';
import { Attempt } from '../models/Attempted.js';
import { QuizPending } from '../models/QuizPending.js';
import { generateQuizEmbedding } from './embeddings.js';
import { checkDuplicateSimilarity } from './guards.js';

const connectDB = async () => {
	let url = config.databaseURL;
	url = url.replace('<password>', config.databasePassword);
	await mongoose.connect(url);
	console.log('Connected to DB');
};

const run = async () => {
	await connectDB();

	// Step 1: Observe — find trending tags from existing quizzes
	console.log('\n--- Step 1: Observe ---');
	const quizzes = await Quiz.find({ deleted: { $ne: true }, status: 'active' });
	const tagCounts = {};
	quizzes.forEach((q) => {
		q.tags.forEach((tag) => {
			tagCounts[tag] = (tagCounts[tag] || 0) + 1;
		});
	});
	console.log('Tags in platform:', tagCounts);

	// Pick the most common tag as the "trending" topic
	const trendingTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0][0];
	console.log('Trending topic:', trendingTag);

	// Step 2: Generate quiz via Claude
	console.log('\n--- Step 2: Generate quiz via Claude ---');
	const client = new Anthropic({ apiKey: config.agent.anthropicApiKey });

	const response = await client.messages.create({
		model: 'claude-sonnet-4-6',
		max_tokens: 2048,
		messages: [
			{
				role: 'user',
				content: `Generate a fun, engaging quiz about "${trendingTag}" for a quiz platform.
The quiz should be entertaining, not boring textbook stuff.

Return ONLY valid JSON in this exact format:
{
  "title": "Quiz title here",
  "description": "One line description",
  "topic": "${trendingTag}",
  "tags": ["${trendingTag}", "other-relevant-tag"],
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

Generate exactly 5 questions, each with exactly 4 options. Make it fun and surprising.`
			}
		]
	});

	const content = response.content[0].text;
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		console.error('Failed to extract JSON from Claude response');
		process.exit(1);
	}

	const quiz = JSON.parse(jsonMatch[0]);
	console.log('Generated quiz:', quiz.title);
	console.log('Questions:', quiz.questions.length);
	quiz.questions.forEach((q, i) => {
		console.log(`  ${i + 1}. ${q.title}`);
		console.log(`     Answer: ${q.correct}`);
	});

	// Step 3: Generate embedding and check for duplicates
	console.log('\n--- Step 3: Deduplication check ---');
	const embedding = await generateQuizEmbedding({
		title: quiz.title,
		description: quiz.description,
		tags: quiz.tags
	});
	console.log('Embedding generated:', embedding.length, 'dimensions');

	const dupCheck = await checkDuplicateSimilarity(embedding);
	console.log('Duplicate check:', dupCheck.reason);

	if (!dupCheck.allowed) {
		console.log('BLOCKED: Too similar to existing quiz. Skipping.');
		process.exit(0);
	}

	// Step 4: Save to quizzes_pending
	console.log('\n--- Step 4: Save to quizzes_pending ---');
	const pending = await QuizPending.create({
		title: quiz.title,
		description: quiz.description,
		topic: quiz.topic,
		tags: quiz.tags,
		questions: quiz.questions,
		embedding,
		agentConfidence: 0.85,
		trendSummary: `Generated because "${trendingTag}" is the most common tag on the platform`,
		status: 'pending'
	});

	console.log('Saved pending quiz:', pending._id);
	console.log('Status:', pending.status);

	// Verify it's in the DB
	const count = await QuizPending.countDocuments({ status: 'pending' });
	console.log(`Total pending quizzes: ${count}`);

	console.log('\nFull generation pipeline works!');
	await mongoose.disconnect();
};

run().catch((err) => {
	console.error('Test failed:', err);
	process.exit(1);
});
