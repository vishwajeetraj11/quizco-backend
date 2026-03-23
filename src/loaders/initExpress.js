import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { globalErrorHandler } from '../api/controllers/errorController.js';
import { getStat } from '../api/controllers/publicController.js';
import { quizRouter } from '../api/routes/quizRouter.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

export const initExpress = ({ app }) => {
	const corsOptions =
		process.env.NODE_ENV === 'production'
			? {
				origin: 'https://quizco.vishwajeet.co',
				credentials: true
			}
			: {
				origin: 'http://localhost:3000',
				credentials: true
			};

	app.use(helmet());
	// Useful if you're behind a reverse proxy (Heroku, Bluemix, AWS ELB, Nginx, etc)
	// It shows the real origin IP in the heroku or Cloudwatch logs
	app.enable('trust proxy');
	// The magic package that prevents frontend developers going nuts
	// Alternate description:
	// Enable Cross Origin Resource Sharing to all origins by default
	app.use(cors(corsOptions));

	// Development Logging
	if (process.env.NODE_ENV === 'development') {
		app.use(morgan('dev'));
	}

	// Middleware that transforms the raw string of req.body into json
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	app.get('/', (req, res) => res.send('API is running'));
	app.get(`${config.api.prefix}/stats`, getStat);
	app.use(ClerkExpressRequireAuth());
	// Load API routes
	app.use(`${config.api.prefix}/quizes`, quizRouter);

	// all runs for all http methods
	app.use((req, res, next) => {
		next(new AppError(`Can't find ${req.originalUrl} on the server!`, 404));
	});

	app.use((err, req, res, next) => {
		if (err?.message === 'Unauthenticated') {
			return next(new AppError('Please login to continue.', 401));
		}

		return next(err);
	});

	app.use(globalErrorHandler);
};
