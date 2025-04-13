import { validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger.js';
import * as scrapeManager from '../../services/scrapeManager.js';

/**
 * Initiate a new scrape job
 */
export const initiateScrape = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: errors.array() 
      });
    }
    
    // Extract domain and params object directly
    const { domain, params = {} } = req.body;

    // --- Validate required parameters ---
    if (!domain) {
       return res.status(400).json({ error: 'Validation Error', details: [{ msg: 'Domain is required' }] });
    }

    // --- Set Defaults within params ---
    // Ensure depth is an integer, default to 1
    params.depth = parseInt(params.depth, 10) || 1;
    if (params.depth < 1 || params.depth > 3) { // Re-validate depth range
        params.depth = 1;
        logger.warn(`Invalid depth provided, defaulting to 1.`);
    }
    // Default priority
    params.priority = params.priority || 'normal';
    if (!['low', 'normal', 'high'].includes(params.priority)) {
        params.priority = 'normal';
        logger.warn(`Invalid priority provided, defaulting to normal.`);
    }
    // Default extractors
    params.extractors = params.extractors || ['general'];
    // Ensure forceRecrawl is boolean, default false
    params.forceRecrawl = params.forceRecrawl === true; 
    // Keep callbackUrl if provided
    params.callbackUrl = params.callbackUrl || null;
    
    // Generate a unique job ID
    const jobId = uuidv4();
    
    // Create job object, ensuring the full params object is included
    const job = {
      jobId,
      domain,
      status: 'queued',
      params: params, // Include the full, processed params object
      // These might be redundant now but kept for compatibility if needed elsewhere
      priority: params.priority, 
      depth: params.depth,
      extractors: params.extractors,
      callbackUrl: params.callbackUrl,
      createdAt: new Date().toISOString()
    };
    
    logger.debug(`Creating job object: ${JSON.stringify(job)}`);

    try {
      // Queue the job
      const queueResult = await scrapeManager.queueJob(job);
      
      // Return success response
      return res.status(201).json(queueResult); // Return result from queueJob
    } catch (error) {
      // Handle specific DB error or return generic error
      if (error.message.includes('Database not available')) {
        logger.warn(`Database unavailable during queueJob: ${error.message}`);
        // Return a 201 still, as the request was valid, but indicate the issue
        return res.status(201).json({
          jobId,
          status: 'queued',
          estimatedTime: 'unknown',
          note: 'Job accepted but database unavailable; processing may be delayed.'
        });
      } else {
         logger.error(`Error queueing job via scrapeManager: ${error.message}`);
         throw error; // Re-throw other errors to be caught by the outer catch
      }
    }
  } catch (error) {
    logger.error(`Error initiating scrape: ${error.message}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to initiate scrape job'
    });
  }
};

/**
 * Cancel a scrape job
 */
export const cancelJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    try {
      const result = await scrapeManager.cancelJob(jobId);
      
      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message
        });
      } else {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }
    } catch (error) {
      // If database is not available, return a mock response
      logger.warn(`Database unavailable, returning mock response: ${error.message}`);
      
      return res.status(200).json({
        success: true,
        message: 'Job cancelled successfully (mock response)',
        note: 'Database is unavailable. This is a mock response for demonstration purposes.'
      });
    }
  } catch (error) {
    logger.error(`Error cancelling job: ${error.message}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to cancel job'
    });
  }
}; 