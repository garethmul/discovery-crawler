import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds website metadata by domain ID.
 * @param {number} domainId - The domain_info ID.
 * @returns {Promise<object|null>} - The metadata object or null if not found.
 */
export const findByDomainId = async (domainId) => {
  const db = await getPool();
  try {
    const [rows] = await db.query('SELECT * FROM website_metadata WHERE domain_id = ?', [domainId]);
    return rows[0]; // Return the first row found or undefined
  } catch (error) {
     if (error.code === 'ER_NO_SUCH_TABLE') {
       logger.warn(`website_metadata table missing for domain ID ${domainId}: ${error.message}`);
       return null; // Return null gracefully if table doesn't exist
     }
    logger.error(`Error fetching website_metadata for domain ID ${domainId}: ${error.message}`, error);
    throw error;
  }
};

// Add other necessary functions (create, update) if needed 