import { Server } from 'socket.io';
import logger from '../utils/logger.js';

/**
 * Set up Socket.IO server
 * @param {Object} httpServer - HTTP server instance
 * @returns {Object} Socket.IO server instance
 */
export default function setupSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://requirements.edeninteractive.com']
        : ['http://localhost:3009', 'http://127.0.0.1:3009'],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Connection event
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });

    // Join a job room to receive updates for a specific job
    socket.on('join-job', (jobId) => {
      socket.join(`job-${jobId}`);
      logger.info(`Socket ${socket.id} joined room for job ${jobId}`);
    });

    // Leave a job room
    socket.on('leave-job', (jobId) => {
      socket.leave(`job-${jobId}`);
      logger.info(`Socket ${socket.id} left room for job ${jobId}`);
    });
  });

  return io;
}

/**
 * Emit a job update event to all clients watching a specific job
 * @param {Object} io - Socket.IO server instance
 * @param {string} jobId - Job ID
 * @param {Object} data - Job data to emit
 */
export function emitJobUpdate(io, jobId, data) {
  if (!io) return;
  
  io.to(`job-${jobId}`).emit('job-update', {
    jobId,
    ...data
  });
  
  // Also emit to the general job updates channel
  io.emit('jobs-update');
}

/**
 * Emit a general notification to all connected clients
 * @param {Object} io - Socket.IO server instance
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 */
export function emitNotification(io, type, data) {
  if (!io) return;
  
  io.emit('notification', {
    type,
    ...data
  });
} 