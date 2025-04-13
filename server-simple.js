import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { Server } from 'socket.io';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3009;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    timestamp: new Date().toISOString()
  });
});

// Mock API routes
// List all jobs
app.get('/api/scrape/jobs', (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  
  // Generate mock jobs
  const mockJobs = [
    {
      jobId: '123e4567-e89b-12d3-a456-426614174000',
      domain: 'example.com',
      status: 'complete',
      progress: 100,
      message: 'Scrape completed successfully',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      startedAt: new Date(Date.now() - 3500000).toISOString(),
      completedAt: new Date(Date.now() - 3000000).toISOString()
    },
    {
      jobId: '223e4567-e89b-12d3-a456-426614174001',
      domain: 'demo-site.org',
      status: 'complete',
      progress: 100,
      message: 'Scrape completed successfully',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      startedAt: new Date(Date.now() - 7100000).toISOString(),
      completedAt: new Date(Date.now() - 7000000).toISOString()
    }
  ];
  
  // Filter by status if provided
  const filteredJobs = status ? mockJobs.filter(job => job.status === status) : mockJobs;
  
  res.json({
    jobs: filteredJobs,
    count: filteredJobs.length,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
});

// Get job results
app.get('/api/scrape/results/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  res.json({
    domain: 'example.com',
    scrapedAt: new Date().toISOString(),
    general: {
      siteStructure: {
        title: 'Example Website',
        meta: {
          description: 'This is an example website for demonstration purposes',
          keywords: 'example, demo, test'
        }
      }
    }
  });
});

// Submit new job
app.post('/api/scrape', (req, res) => {
  const { domain } = req.body;
  
  const jobId = Math.random().toString(36).substring(2, 15) + 
                Math.random().toString(36).substring(2, 15);
  
  // Emit a job update event after a short delay
  setTimeout(() => {
    io.emit('job-update', {
      jobId,
      domain,
      status: 'processing',
      progress: 25,
      message: 'Discovering pages'
    });
    
    // Complete the job after a few seconds
    setTimeout(() => {
      io.emit('job-update', {
        jobId,
        domain,
        status: 'complete',
        progress: 100,
        message: 'Scrape completed successfully'
      });
    }, 5000);
  }, 2000);
  
  res.status(201).json({
    jobId,
    status: 'queued',
    estimatedTime: '30s'
  });
});

// Serve the dashboard for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
}); 