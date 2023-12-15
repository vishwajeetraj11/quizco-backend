export const quizTransform = (quiz, author, quizId) => {
	const title = quiz.text;
	const options = quiz.options.option.map((option) => {
		return { value: option.content };
	});
	const correctOptionIndex = quiz.answer.correctOptions.option[0];
	const correctOption = options[correctOptionIndex - 1].value;
	return {
		author,
		quiz: quizId,
		title,
		options,
		correct: correctOption
	};
};
