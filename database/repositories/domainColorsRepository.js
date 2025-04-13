import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds color data by domain ID.
 * @param {number} domainId - The domain_info ID.
 * @returns {Promise<object|null>} - The color data object or null if not found.
 */
export const findByDomainId = async (domainId) => {
  const db = await getPool();
  try {
    const [rows] = await db.query('SELECT * FROM domain_colors WHERE domain_id = ?', [domainId]);
    return rows[0]; // Return the first row found or undefined
  } catch (error) {
     if (error.code === 'ER_NO_SUCH_TABLE') {
       logger.warn(`domain_colors table missing for domain ID ${domainId}: ${error.message}`);
       return null; // Return null gracefully if table doesn't exist
     }
    logger.error(`Error fetching domain_colors for domain ID ${domainId}: ${error.message}`, error);
    throw error;
  }
};

// Add other necessary functions (create, update) if needed 