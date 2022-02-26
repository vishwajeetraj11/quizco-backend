export const emptyResponseMessages = {
	NO_QUESTIONS_IN_QUIZ: 'No Question in this quiz yet.'
};

export const errorMessages = {
	ACCESS_DENIED: 'You do not have enough permission to access this resource.',
	RESOURCE_DOES_NOT_EXIST: (resource) =>
		`${resource || 'Resource'} you are trying to update doesn't exist.`,
	NO_RESPONSE_EXISTS: 'No Responses for this question exists.' //or all responses for this question has been deleted due to recent update in options or correct answer
};
