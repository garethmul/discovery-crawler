import logger from './logger.js';

/**
 * Authentication middleware for API routes
 * Enhanced to accept API keys from multiple sources:
 * - Authorization header (Bearer token)
 * - Request body (api_key field)
 * - URL query parameter (api_key)
 */
export default function authMiddleware(req, res, next) {
  // Get the full original URL path for logging
  const fullPath = req.originalUrl || req.url;
  // Get the API-specific path (without /api prefix)
  const apiPath = req.path;
  
  logger.debug(`Auth middleware processing: ${fullPath} (API path: ${apiPath})`);
  
  // Skip authentication for health check and config endpoints
  if (apiPath === '/health' || apiPath === '/config') {
    logger.debug(`Skipping auth for exempt endpoint: ${apiPath}`);
    return next();
  }
  
  // Get API keys from environment - support multiple keys separated by commas
  const apiKeysStr = process.env.API_KEY || 'test-api-key-123';
  
  // Handle multiple API keys (comma-separated) or a single key
  let apiKeys = [];
  if (apiKeysStr.includes(',')) {
    apiKeys = apiKeysStr.split(',').map(key => key.trim());
  } else {
    apiKeys = [apiKeysStr.trim()];
  }
  
  logger.debug(`Available API keys count: ${apiKeys.length}`);
  
  // Initialize apiKey variable
  let apiKey = null;
  
  // 1. Check Authorization header (current implementation)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
    logger.debug('API key found in Authorization header');
  }
  
  // 2. Check for api_key in request body
  if (!apiKey && req.body && req.body.api_key) {
    apiKey = req.body.api_key;
    logger.debug('API key found in request body');
  }
  
  // 3. Check for api_key in query parameters
  if (!apiKey && req.query && req.query.api_key) {
    apiKey = req.query.api_key;
    logger.debug('API key found in query parameters');
  }
  
  // If no API key found in any location, use the default test key for certain endpoints
  if (!apiKey) {
    if (apiPath === '/scrape/jobs' || apiPath.startsWith('/scrape/status/')) {
      // For listing jobs or checking status, use the default key
      apiKey = 'test-api-key-123';
      logger.debug('No API key provided, using default key for jobs listing');
    } else {
      logger.warn(`Authentication failed: No API key provided for ${fullPath}`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No API key provided. Include it in Authorization header, request body, or query parameter'
      });
    }
  }
  
  logger.debug(`Checking provided API key: ${apiKey.substring(0, 5)}... against ${apiKeys.length} valid keys`);

  // Validate the API key against all available API keys
  const keyIsValid = apiKeys.some(validKey => validKey === apiKey);
  
  if (!keyIsValid) {
    logger.warn(`Authentication failed: Invalid API key (${apiKey.substring(0, 5)}...) for ${fullPath}`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }
  
  // Authentication successful
  logger.info(`Successful authentication for ${fullPath} using valid API key (${apiKey.substring(0, 5)}...)`);
  next();
} 