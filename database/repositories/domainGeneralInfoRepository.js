import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds general info by domain ID.
 * @param {number} domainId - The domain_info ID.
 * @returns {Promise<object|null>} - The general info object or null if not found.
 */
export const findByDomainId = async (domainId) => {
  const db = await getPool();
  try {
    // Check the structure of domain_info first
    try {
      const [columns] = await db.query('SHOW COLUMNS FROM domain_info');
      const columnNames = columns.map(col => col.Field);
      logger.debug(`Available columns in domain_info: ${columnNames.join(', ')}`);
      
      // Build a dynamic query based on what columns actually exist
      const availableGeneralCols = [
        'contact_info',
        'navigation_structure',
        'site_structure',
        'prominent_links',
        'general_data',
        'site_map',
        'data',
        'metadata'
      ].filter(col => columnNames.includes(col));
      
      if (availableGeneralCols.length === 0) {
        logger.warn(`No general info columns found in domain_info table`);
        return null;
      }
      
      // Query only the columns that exist
      const [rows] = await db.query(`SELECT ${availableGeneralCols.join(', ')} FROM domain_info WHERE id = ?`, [domainId]);
      
      if (!rows[0]) {
        logger.debug(`No general info found for domain ID ${domainId} in domain_info table`);
        return null;
      }
      
      // Map data to standardized structure regardless of original column names
      const result = {
        // Map data to expected field names for the controller
        site_structure: rows[0].site_structure || rows[0].site_map || rows[0].metadata || null,
        prominent_links: rows[0].prominent_links || null,
        navigation_structure: rows[0].navigation_structure || null,
        contact_info: rows[0].contact_info || null,
        
        // Add a generic data field that might contain all the info as JSON
        general_data: rows[0].general_data || rows[0].data || null,
        
        // Flag for source info
        _source: 'domain_info_dynamic_columns'
      };
      
      return result;
    } catch (err) {
      logger.error(`Error checking domain_info structure: ${err.message}`);
      // Fall back to a basic query
      const [rows] = await db.query('SELECT * FROM domain_info WHERE id = ?', [domainId]);
      
      if (!rows[0]) {
        return null;
      }
      
      // Return a basic structure
      return {
        general_data: rows[0].data || null,
        _source: 'domain_info_fallback'
      };
    }
  } catch (error) {
    logger.error(`Error fetching general info for domain ID ${domainId}: ${error.message}`, error);
    return null;  // Return null instead of throwing to prevent API errors
  }
};

// Add other necessary functions (create, update) if needed 