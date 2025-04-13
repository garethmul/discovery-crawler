import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { Server } from 'socket.io';
import mysql from 'mysql2/promise';
import logger from './src/utils/logger.js';
import * as scrapeManager from './src/services/scrapeManager.js';
import apiRoutes from './src/api/routes.js';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3009;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.MYSQL_SSL_CA ? { ca: process.env.MYSQL_SSL_CA } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool with better error handling
const connectToDatabase = async () => {
  try {
    logger.info(`Attempting to connect to database at ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    
    // Create connection pool
    const pool = mysql.createPool(dbConfig);
    
    // Test the connection
    const connection = await pool.getConnection();
    logger.info('Database connection established successfully');
    
    // Test a simple query
    const [rows] = await connection.query('SHOW TABLES');
    logger.info(`Database tables found: ${rows.length}`);
    
    // Release the connection
    connection.release();
    
    // Make pool globally available
    global.pool = pool;
    global.dbConnected = true;
    
    return true;
  } catch (error) {
    logger.error(`Failed to connect to database: ${error.message}`);
    logger.error(error.stack);
    global.dbConnected = false;
    
    // Schedule a reconnection attempt
    setTimeout(connectToDatabase, 10000); // Try again in 10 seconds
    
    return false;
  }
};

// Initial connection attempt
connectToDatabase();

// Create Express app
const app = express();
const httpServer = createServer(app);

// Set up Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io globally available
global.io = io;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });

  // Join a job room to receive updates for a specific job
  socket.on('join-job', (jobId) => {
    socket.join(`job-${jobId}`);
    console.log(`Socket ${socket.id} joined room for job ${jobId}`);
  });

  // Leave a job room
  socket.on('leave-job', (jobId) => {
    socket.leave(`job-${jobId}`);
    console.log(`Socket ${socket.id} left room for job ${jobId}`);
  });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

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
    timestamp: new Date().toISOString(),
    database: global.dbConnected ? 'connected' : 'disconnected'
  });
});

// API routes
app.use('/api', apiRoutes);

// Block direct access to the root URL - hide the dashboard
app.get('/', (req, res) => {
  res.status(404).send('Not Found');
});

// Handle other routes with the dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// For all other routes, return 404 
app.get('*', (req, res) => {
  res.status(404).send('Not Found');
});

// Test database connection before starting the server
(async () => {
  try {
    // Log database configuration (without sensitive info)
    logger.info(`Database configuration: host=${process.env.DB_HOST}, port=${process.env.DB_PORT}, user=${process.env.DB_USER}, database=${process.env.DB_NAME}`);
    
    // Initialize scrape manager
    await scrapeManager.init();
    
    // Start the server
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Dashboard available at http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Database connected: ${global.dbConnected ? 'Yes' : 'No'}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
})(); 