import Clerk from '@clerk/clerk-sdk-node';
import { catchAsync } from '../../utils/catchAsync.js';

export const authorizeMiddleware = catchAsync(async (req, res, next) => {
	const userDetails = await Clerk.users.getUser(req.session.userId);
	const emails = userDetails.emailAddresses.map((email) => email.emailAddress);
	const user = {
		id: userDetails.id,
		profileImageUrl: userDetails.profileImageUrl,
		firstName: userDetails.firstName,
		lastName: userDetails.lastName,
		email: emails[0]
	};

	req.user = user;
	next();
});
