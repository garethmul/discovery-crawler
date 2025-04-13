import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds all related AI analysis data by domain ID.
 * @param {number} domainId - The domain_info ID.
 * @returns {Promise<object|null>} - An object containing all AI analysis parts, or null if none found.
 */
export const findByDomainId = async (domainId) => {
  const db = await getPool();
  try {
    // First check if AI data might be in domain_info table as a JSON field
    const [domainInfoRows] = await db.query('SELECT ai_analysis FROM domain_info WHERE id = ?', [domainId]);
    
    if (domainInfoRows.length > 0 && domainInfoRows[0].ai_analysis) {
      logger.debug(`Found AI data in domain_info table for domain ID ${domainId}`);
      return {
        // Return the data directly - it will be parsed by the controller
        ai_analysis: domainInfoRows[0].ai_analysis,
        // Add a flag to indicate where the data came from
        _source: 'domain_info_table'
      };
    }
    
    logger.debug(`No AI data found in domain_info table for domain ID ${domainId}, checking specialized tables...`);
    
    // Check for the brandfetch_data table
    try {
      const [brandfetchRows] = await db.query('SELECT * FROM brandfetch_data WHERE domain_id = ?', [domainId]);
      if (brandfetchRows.length > 0) {
        logger.debug(`Found brandfetch data for domain ID ${domainId}`);
        return {
          brandfetch_data: brandfetchRows[0],
          _source: 'brandfetch_data_table'
        };
      }
    } catch (err) {
      logger.warn(`Error checking brandfetch_data: ${err.message}`);
    }
    
    // Try to fetch from AI tables (with ai_ prefix instead of domain_)
    try {
      // Fetch from each AI-related table
      const [appColorSchemesRows] = await db.query('SELECT * FROM ai_app_color_schemes WHERE domain_id = ?', [domainId]);
      const [appFeaturesRows] = await db.query('SELECT * FROM ai_app_features WHERE domain_id = ?', [domainId]);
      const [appSuggestionsRows] = await db.query('SELECT * FROM ai_app_suggestions WHERE domain_id = ?', [domainId]);
      const [contentCategoriesRows] = await db.query('SELECT * FROM ai_content_categories WHERE domain_id = ?', [domainId]);
      const [marketingTipsRows] = await db.query('SELECT * FROM ai_marketing_tips WHERE domain_id = ?', [domainId]);

      // Check if we found any data at all
      if (!appColorSchemesRows.length && !appFeaturesRows.length && !appSuggestionsRows.length &&
          !contentCategoriesRows.length && !marketingTipsRows.length) {
        logger.debug(`No AI data found in specialized tables for domain ID ${domainId}`);
        
        // Last attempt - check for any other potential AI data tables
        try {
          const [tables] = await db.query("SHOW TABLES LIKE 'ai\\_%'");
          const aiTables = tables.map(t => Object.values(t)[0]);
          
          if (aiTables.length > 0) {
            logger.debug(`Found potential AI tables to check: ${aiTables.join(', ')}`);
            
            // Try to find data in each of these tables
            for (const table of aiTables) {
              try {
                const [aiRows] = await db.query(`SELECT * FROM ${table} WHERE domain_id = ?`, [domainId]);
                if (aiRows.length > 0) {
                  logger.debug(`Found AI data in ${table} for domain ID ${domainId}`);
                  return {
                    [table.replace('ai_', '')]: aiRows[0],
                    _source: `discovered_table_${table}`
                  };
                }
              } catch (err) {
                logger.warn(`Error checking ${table} for AI data: ${err.message}`);
              }
            }
          }
        } catch (err) {
          logger.warn(`Error listing potential AI tables: ${err.message}`);
        }
        
        return null;
      }

      // Combine results into a single object
      const aiData = {
        appColorSchemes: appColorSchemesRows[0] || null,
        appFeatures: appFeaturesRows[0] || null,
        appSuggestions: appSuggestionsRows[0] || null,
        contentCategories: contentCategoriesRows[0] || null,
        marketingTips: marketingTipsRows[0] || null,
        _source: 'ai_prefixed_tables'
      };

      // Clean up null values
      Object.keys(aiData).forEach(key => {
        if (aiData[key] === null && key !== '_source') {
          delete aiData[key];
        }
      });

      return Object.keys(aiData).length > 1 ? aiData : null; // > 1 because we always have _source

    } catch (error) {
      // If we get table doesn't exist, it might be that the schema is different
      if (error.code === 'ER_NO_SUCH_TABLE') {
        logger.warn(`AI Analysis tables missing for domain ID ${domainId}: ${error.message}`);
        return null;
      }
      throw error; // Rethrow other errors
    }
    
  } catch (error) {
    logger.error(`Error fetching domain_ai_analysis for domain ID ${domainId}: ${error.message}`, error);
    throw error;
  }
};

// Add other necessary functions like create, update etc. if needed elsewhere 