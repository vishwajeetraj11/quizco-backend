import { clerkClient } from '@clerk/clerk-sdk-node';
import { config } from '../../config/index.js';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

const loadAuthenticatedUser = async (req) => {
	if (req.user?.email) {
		return req.user;
	}

	const userDetails = await clerkClient.users.getUser(req.auth.userId);
	const emails = userDetails.emailAddresses.map((email) => email.emailAddress);
	req.user = {
		id: userDetails.id,
		profileImageUrl: userDetails.profileImageUrl,
		firstName: userDetails.firstName,
		lastName: userDetails.lastName,
		email: emails[0]
	};

	return req.user;
};

export const authorizeMiddleware = catchAsync(async (req, res, next) => {
	await loadAuthenticatedUser(req);

	next();
});

export const requireAgentOperator = catchAsync(async (req, res, next) => {
	const user = await loadAuthenticatedUser(req);
	const allowedEmail = config.agent.allowedUserEmail?.trim().toLowerCase();
	const currentEmail = user.email?.trim().toLowerCase();

	if (!allowedEmail) {
		throw new AppError('Agent operator email is not configured.', 500);
	}

	if (currentEmail !== allowedEmail) {
		throw new AppError('You are not allowed to access agent routes.', 403);
	}

	next();
});
