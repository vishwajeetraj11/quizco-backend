import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { Question } from '../models/Question.js';
import { Attempt } from '../models/Attempted.js';
import { Response } from '../models/Response.js';

dotenv.config();

const run = async () => {
	let database_url = process.env.MONGODB_URI;
	database_url = database_url.replace('<password>', process.env.DB_PASSWORD);

	await mongoose.connect(database_url);
	console.log('Connected to DB');

	const quizCount = await Quiz.countDocuments();
	const questionCount = await Question.countDocuments();
	const attemptCount = await Attempt.countDocuments();
	const responseCount = await Response.countDocuments();

	console.log(`Found: ${quizCount} quizzes, ${questionCount} questions, ${attemptCount} attempts, ${responseCount} responses`);

	await Response.deleteMany({});
	console.log('Cleared responses');

	await Attempt.deleteMany({});
	console.log('Cleared attempts');

	await Question.deleteMany({});
	console.log('Cleared questions');

	await Quiz.deleteMany({});
	console.log('Cleared quizzes');

	console.log('All collections cleared.');
	await mongoose.disconnect();
};

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
