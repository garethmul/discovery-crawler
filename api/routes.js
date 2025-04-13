import express from 'express';
import { body } from 'express-validator';
import * as scrapeController from './controllers/scrapeController.js';
import * as statusController from './controllers/statusController.js';
import * as diagnosticController from './controllers/diagnosticController.js';
import * as domainDataController from '../controllers/domainDataController.js';
import authMiddleware from '../utils/authMiddleware.js';
import slugEvaluationRoutes from './routes/slugEvaluationRoutes.js';

const router = express.Router();

// Public endpoints for domain viewer - NO AUTH required
router.get('/domains', domainDataController.getAllDomains);
router.get('/domain-data/:domainId', domainDataController.getDomainDataById);

// Apply authentication middleware to all other routes
router.use(authMiddleware);

// Scrape endpoint - validate and process
router.post('/scrape', [
  body('domain').isString().trim().notEmpty().withMessage('Domain is required'),
  body('depth').optional().isInt({ min: 1, max: 3 }).withMessage('Depth must be between 1 and 3'),
  body('priority').optional().isIn(['low', 'normal', 'high']).withMessage('Priority must be low, normal, or high'),
  body('extractors').optional().isArray().withMessage('Extractors must be an array'),
  body('callbackUrl').optional().isURL().withMessage('Callback URL must be valid')
], scrapeController.initiateScrape);

// Status endpoints
router.get('/scrape/status/:jobId', statusController.getJobStatus);
router.get('/scrape/results/:jobId', statusController.getJobResults);

// Domain data endpoint
router.get('/domain/:domain', statusController.getDomainData);

// List all jobs (admin only)
router.get('/scrape/jobs', statusController.listJobs);

// Cancel job
router.delete('/scrape/jobs/:jobId', scrapeController.cancelJob);

// Diagnostic routes
router.get('/diagnostic/db-status', diagnosticController.getDatabaseStatus);

// Add slug evaluation routes
router.use('/slug', slugEvaluationRoutes);

export default router; 