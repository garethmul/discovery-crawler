import express from 'express';
import { body } from 'express-validator';
import * as slugEvaluationController from '../controllers/slugEvaluationController.js';
import authMiddleware from '../../utils/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Slug evaluation endpoint - validate and process
router.post('/evaluate', [
  body('organisation_name').isString().trim().notEmpty().withMessage('Organisation name is required'),
  body('requested_slug').isString().trim().notEmpty().withMessage('Requested slug is required')
], slugEvaluationController.evaluateSlug);

export default router; 