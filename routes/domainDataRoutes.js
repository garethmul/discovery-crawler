// src/routes/domainDataRoutes.js

import express from 'express';
import * as domainDataController from '../controllers/domainDataController.js';
// Add authentication middleware if needed
// import { authenticateApiKey } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/domain-data/:domainId - Fetches comprehensive data for a domain
// Add authentication middleware if this endpoint should be protected
// router.get('/:domainId', authenticateApiKey, domainDataController.getDomainDataById);
router.get('/:domainId', domainDataController.getDomainDataById);

// GET /api/domain-data - Fetches a list of all domains (simplified info)
// Add authentication middleware if this endpoint should be protected
// router.get('/', authenticateApiKey, domainDataController.getAllDomains);
router.get('/', domainDataController.getAllDomains);

export default router; 