import logger from '../utils/logger.js';
import { createAdditionalTables } from './createTables.js';

/**
 * Initialize the database with all required tables
 */
export const initDatabase = async () => {
  try {
    logger.info('Initializing database...');
    
    // Create additional tables for incremental data saving
    await createAdditionalTables();
    
    logger.info('Database initialization complete');
    return true;
  } catch (error) {
    logger.error(`Error initializing database: ${error.message}`);
    return false;
  }
};

/**
 * Run the database initialization if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase()
    .then(() => {
      logger.info('Database initialization complete');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Error initializing database: ${error.message}`);
      process.exit(1);
    });
} 