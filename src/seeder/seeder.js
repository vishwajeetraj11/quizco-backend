/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { connectDB } from '../loaders/initDB.js';
import { Attempt } from '../models/Attempted.js';
import { Question } from '../models/Question.js';
import { Quiz } from '../models/Quiz.js';
import { Response } from '../models/Response.js';

const __dirname = path.resolve();
connectDB();

// Read JSON File
const data = JSON.parse(fs.readFileSync(`${__dirname}/src/seeder/data.json`, 'utf-8'));
// Import data into DB
const importData = async () => {
	try {
		for (let i = 0; i < data.data.length; i++) {
			const quiz = await Quiz.create({ ...data.data[i].quiz, deleted: false });
			const questionsWithQuizId = data.data[i].questions.map((q) => {
				q.quiz = quiz.id;
				q.author = quiz.author;
				return q;
			});
			await Question.insertMany(questionsWithQuizId);
		}

		console.log('Data Successfully Loaded');
	} catch (err) {
		console.log(err);
	}
	process.exit();
};

const deleteData = async () => {
	try {
		await Quiz.deleteMany();
		await Question.deleteMany();
		await Attempt.deleteMany();
		await Response.deleteMany();
		console.log('Data Deleted Successfully');
	} catch (err) {
		console.log(err);
	}
	process.exit();
};

if (process.argv[2] === '--import') {
	importData();
} else if (process.argv[2] === '--delete') {
	deleteData();
}

// How to use
// node ./src/seeder/seeder.js --delete
// node ./src/seeder/seeder.js --import
