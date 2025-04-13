import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { getPool } from './connection.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create additional tables for incremental data saving
 */
export const createAdditionalTables = async () => {
  try {
    logger.info('Creating additional tables for incremental data saving...');
    
    const pool = getPool();
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'sql', 'additional_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = sql
      .split(';')
      .filter(statement => statement.trim() !== '')
      .map(statement => statement.trim() + ';');
    
    // Execute each statement
    for (const statement of statements) {
      await pool.execute(statement);
    }
    
    logger.info('Additional tables created successfully');
    return true;
  } catch (error) {
    logger.error(`Error creating additional tables: ${error.message}`);
    return false;
  }
};

/**
 * Run the table creation if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  createAdditionalTables()
    .then(() => {
      logger.info('Additional tables creation complete');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Error creating additional tables: ${error.message}`);
      process.exit(1);
    });
} 