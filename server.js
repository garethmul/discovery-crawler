import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import setupSocketServer from './src/socket/socketServer.js';
import logger from './src/utils/logger.js';
import * as scrapeManager from './src/services/scrapeManager.js';
import apiRoutes from './src/api/routes.js';
import monitorRoutes from './src/api/routes/monitorRoutes.js';
import domainDataRoutes from './src/routes/domainDataRoutes.js';
import { testConnection as testDbConnection } from './config/database.js';
import { testConnection as testOpenAiConnection } from './config/openai.js';
import { initDatabase } from './src/database/init.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Constants
const PORT = process.env.PORT || 3009;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();
const httpServer = createServer(app);
const io = setupSocketServer(httpServer);

// Make io globally available
global.io = io;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      fontSrc: ["'self'", "https:", "data:"],
    }
  }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io available in route handlers
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log when request starts
  logger.info(`${req.method} ${req.url} started`);
  
  // Override end method to log when response is sent
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} completed with status ${res.statusCode} in ${duration}ms`);
    
    // Call the original end method
    return originalEnd.apply(this, args);
  };
  
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Monitor routes for the real-time UI
app.use('/monitor', monitorRoutes);

// Domain Data routes for viewing crawled data
app.use('/api/domain-data', domainDataRoutes);

// Config endpoint
app.get('/config', (req, res) => {
  res.json({
    scraperApiKey: process.env.API_KEY || 'test-api-key-123'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString()
  });
});

// Serve the new data visualization dashboard at /dashboard path
app.use('/dashboard', express.static(path.join(__dirname, 'crawler-dashboard', 'dist')));
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'crawler-dashboard', 'dist', 'index.html'));
});

// Serve the dashboard for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const start = async () => {
  try {
    // Initialize database first
    await initDatabase();
    
    let dbConnected = false;
    let openAiConnected = false;
    
    try {
      // Test database connection
      dbConnected = await testDbConnection();
      if (!dbConnected) {
        logger.error('Database connection is required. Please check your database configuration.');
        process.exit(1);
      } else {
        logger.info('Database connection established successfully');
      }
    } catch (dbError) {
      logger.error(`Database connection error: ${dbError.message}`);
      logger.error('Database connection is required. Please check your database configuration.');
      process.exit(1);
    }
    
    /* Commented out OpenAI connection testing as it's not needed at the moment
    try {
      // Test OpenAI connection
      openAiConnected = await testOpenAiConnection();
      if (!openAiConnected) {
        logger.warn('Could not connect to OpenAI API, analysis functionality will be limited');
      } else {
        logger.info('OpenAI API connection established successfully');
      }
    } catch (openAiError) {
      logger.error(`OpenAI API connection error: ${openAiError.message}`);
    }
    */
    logger.info('OpenAI API connection testing skipped (commented out)');
    
    try {
      // Initialize the scrape manager
      await scrapeManager.init();
      
      // Start the server
      httpServer.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info(`Dashboard available at http://localhost:${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`Database connected: ${dbConnected ? 'Yes' : 'No'}`);
        logger.info(`OpenAI API connected: No (testing skipped)`);
      });
    } catch (error) {
      logger.error(`Error starting server: ${error.message}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
};

// Start the server
start(); 