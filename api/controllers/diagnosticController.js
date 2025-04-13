import logger from '../../utils/logger.js';
import { getPool } from '../../../config/database.js';

/**
 * Get the status of the database connection
 * This helps diagnose issues with database connectivity in production
 */
export const getDatabaseStatus = async (req, res) => {
  try {
    logger.info('Diagnostic: Testing database connection');
    const db = getPool();
    
    // Try to execute a simple query
    logger.info('Diagnostic: Executing test query');
    const [rows] = await db.execute('SHOW TABLES');
    
    // Log table names but limit the output for security
    const tableCount = rows.length;
    const tableSample = rows.slice(0, 5).map(row => Object.values(row)[0]);
    
    logger.info(`Diagnostic: Database connected successfully. Found ${tableCount} tables.`);
    
    return res.status(200).json({
      status: 'connected',
      message: 'Database connection is working',
      details: {
        tableCount,
        tableSample: tableSample.join(', ') + (tableCount > 5 ? '...' : '')
      }
    });
  } catch (error) {
    logger.error(`Diagnostic: Database connection error: ${error.message}`);
    logger.error(`Diagnostic: Error stack: ${error.stack}`);
    
    return res.status(500).json({
      status: 'error',
      message: 'Failed to connect to database',
      error: error.message
    });
  }
}; 