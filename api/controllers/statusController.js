import logger from '../../utils/logger.js';
import * as scrapeManager from '../../services/scrapeManager.js';
import * as domainDataRepository from '../../database/repositories/domainDataRepository.js';

/**
 * Get the status of a specific job
 */
export const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    try {
      const jobStatus = await scrapeManager.getJobStatus(jobId);
      
      if (!jobStatus) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Job not found'
        });
      }
      
      return res.status(200).json(jobStatus);
    } catch (error) {
      logger.error(`Error getting job status from database: ${error.message}`);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get job status from database'
      });
    }
  } catch (error) {
    logger.error(`Error getting job status: ${error.message}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get job status'
    });
  }
};

/**
 * Get the results of a completed job
 */
export const getJobResults = async (req, res) => {
  try {
    const { jobId } = req.params;
    logger.info(`Fetching job results for jobId: ${jobId}`);
    
    try {
      // First check if the job exists and is completed
      logger.info(`Checking job status for jobId: ${jobId}`);
      const jobStatus = await scrapeManager.getJobStatus(jobId);
      
      if (!jobStatus) {
        logger.warn(`Job not found: ${jobId}`);
        return res.status(404).json({
          error: 'Not Found',
          message: 'Job not found'
        });
      }
      
      logger.info(`Job status: ${jobStatus.status} for jobId: ${jobId}`);
      if (jobStatus.status !== 'complete') {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Job is not complete (current status: ${jobStatus.status})`
        });
      }
      
      // Get the results
      logger.info(`Getting job results from repository for jobId: ${jobId}`);
      const results = await domainDataRepository.getJobResults(jobId);
      
      if (!results) {
        logger.warn(`Results not found for jobId: ${jobId}`);
        return res.status(404).json({
          error: 'Not Found',
          message: 'Results not found'
        });
      }
      
      logger.info(`Successfully retrieved results for jobId: ${jobId}`);
      return res.status(200).json(results);
    } catch (error) {
      logger.error(`Error getting job results from database: ${error.message}`);
      logger.error(`Stack trace: ${error.stack}`);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get job results from database'
      });
    }
  } catch (error) {
    logger.error(`Error getting job results: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get job results'
    });
  }
};

/**
 * List all jobs with optional filtering
 */
export const listJobs = async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    
    // Ensure limit and offset are valid numbers
    const safeLimit = parseInt(limit) || 20;
    const safeOffset = parseInt(offset) || 0;
    
    try {
      const jobs = await scrapeManager.listJobs(status, safeLimit, safeOffset);
      
      return res.status(200).json({
        jobs,
        count: jobs.length,
        limit: safeLimit,
        offset: safeOffset
      });
    } catch (error) {
      logger.error(`Error listing jobs from database: ${error.message}`);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list jobs from database'
      });
    }
  } catch (error) {
    logger.error(`Error listing jobs: ${error.message}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list jobs'
    });
  }
};

/**
 * Get domain data for third-party access
 */
export const getDomainData = async (req, res) => {
  try {
    const { domain } = req.params;
    
    if (!domain) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Domain parameter is required'
      });
    }
    
    // Normalize the domain
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    try {
      // Get the domain data
      const domainData = await domainDataRepository.getDomainData(normalizedDomain);
      
      if (!domainData) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Domain data not found'
        });
      }
      
      return res.status(200).json(domainData);
    } catch (error) {
      logger.error(`Error getting domain data from database: ${error.message}`);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get domain data from database'
      });
    }
  } catch (error) {
    logger.error(`Error getting domain data: ${error.message}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get domain data'
    });
  }
}; 