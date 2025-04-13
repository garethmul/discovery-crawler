/**
 * Database Connection Module
 * 
 * Handles MySQL database connection setup and provides query utilities
 */

import mysql from 'mysql2/promise';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.MYSQL_SSL_CA ? {
    ca: process.env.MYSQL_SSL_CA
  } : undefined
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Export getPool function for compatibility
export const getPool = () => pool;

// Test database connection
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    logger.info('Database connection successful');
    connection.release();
    return true;
  } catch (error) {
    logger.error(`Database connection error: ${error.message}`);
    return false;
  }
};

/**
 * Execute a SQL query with parameters
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
export const query = async (sql, params = []) => {
  try {
    const [results] = await pool.query(sql, params);
    return results;
  } catch (error) {
    logger.error(`Database query error: ${error.message}`);
    logger.error(`SQL: ${sql}`);
    logger.error(`Params: ${JSON.stringify(params)}`);
    throw error;
  }
};

/**
 * Execute a SQL transaction with multiple queries
 * @param {Function} callback - Transaction callback
 * @returns {Promise<any>} Transaction result
 */
export const transaction = async (callback) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    logger.error(`Transaction error: ${error.message}`);
    throw error;
  } finally {
    connection.release();
  }
};

// Initialize database connection
export const init = async () => {
  try {
    await testConnection();
    return true;
  } catch (error) {
    logger.error(`Database initialization error: ${error.message}`);
    return false;
  }
};

// Export pool for direct access if needed
export default pool; 