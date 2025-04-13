import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds domain info by ID.
 * @param {number} id - The domain_info ID.
 * @returns {Promise<object|null>} - The domain info object or null if not found.
 */
export const findById = async (id) => {
  const db = await getPool();
  try {
    // Assuming the main table is called 'domain_info' and contains 'id', 'domain_name', 'last_scraped_at', 'status'
    const [rows] = await db.query('SELECT * FROM domain_info WHERE id = ?', [id]);
    return rows[0]; // Return the first row found or undefined
  } catch (error) {
     if (error.code === 'ER_NO_SUCH_TABLE') {
       logger.warn(`domain_info table missing for ID ${id}: ${error.message}`);
       return null; // Return null gracefully if table doesn't exist
     }
    logger.error(`Error fetching domain_info for ID ${id}: ${error.message}`, error);
    throw error;
  }
};

/**
 * Finds domain info by domain name.
 * @param {string} domainName - The domain name.
 * @returns {Promise<object|null>} - The domain info object or null if not found.
 */
export const findByDomainName = async (domainName) => {
  const db = await getPool();
  try {
    const [rows] = await db.query('SELECT * FROM domain_info WHERE domain_name = ?', [domainName]);
    return rows[0];
  } catch (error) {
     if (error.code === 'ER_NO_SUCH_TABLE') {
       logger.warn(`domain_info table missing when searching for ${domainName}: ${error.message}`);
       return null;
     }
    logger.error(`Error fetching domain_info for domain name ${domainName}: ${error.message}`, error);
    throw error;
  }
};

/**
 * Finds all domains in the database.
 * @returns {Promise<Array>} - Array of domain info objects.
 */
export const findAll = async () => {
  const db = await getPool();
  try {
    const [rows] = await db.query('SELECT id, domain_name, last_scraped_at, status FROM domain_info ORDER BY domain_name');
    return rows;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      logger.warn(`domain_info table missing when trying to list all domains: ${error.message}`);
      return []; // Return empty array gracefully if table doesn't exist
    }
    logger.error(`Error fetching all domain_info records: ${error.message}`, error);
    throw error;
  }
};


// Add other necessary functions (create, update status, etc.) 