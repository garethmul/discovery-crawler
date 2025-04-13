import logger from '../../utils/logger.js';
import { getPool } from '../../../config/database.js';

/**
 * Helper function to check database connection
 */
function checkDatabaseConnection() {
  if (!global.dbConnected) {
    throw new Error('Database not available');
  }
  return getPool();
}

/**
 * Helper function to safely parse JSON
 */
function safeParseJSON(jsonString, defaultValue = null) {
  if (!jsonString) return defaultValue;
  
  // Handle [object Object] case
  if (typeof jsonString === 'string' && jsonString.includes('[object Object]')) {
    logger.warn(`Error parsing JSON: "[object Object]" is not valid JSON`);
    return defaultValue;
  }
  
  // If it's already an object, return it
  if (typeof jsonString === 'object' && jsonString !== null) {
    return jsonString;
  }
  
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    logger.warn(`Error parsing JSON: ${e.message}`);
    return defaultValue;
  }
}

/**
 * Execute a generic database query
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Array>} - Query results
 */
export const query = async (sql, params = []) => {
  try {
    const db = checkDatabaseConnection();
    return await db.execute(sql, params);
  } catch (error) {
    logger.error(`Error executing query: ${error.message}`);
    logger.error(`SQL: ${sql}`);
    logger.error(`Params: ${JSON.stringify(params)}`);
    throw error;
  }
};

/**
 * Save a new scrape job to the database
 */
export const saveJob = async (job) => {
  try {
    const db = checkDatabaseConnection();
    
    const query = `
      INSERT INTO scrape_jobs (
        id, domain, status, params, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `;
    
    // Stringify the entire job.params object received from the caller
    const paramsString = JSON.stringify(job.params || {}); // Ensure params exists, default to empty object
    
    await db.execute(query, [
      job.jobId,
      job.domain,
      job.status,
      paramsString, // Save the correctly stringified params object
      new Date(job.createdAt)
    ]);
    
    logger.debug(`[DB] Saved job ${job.jobId} with params: ${paramsString}`);
    return true;
  } catch (error) {
    logger.error(`Error saving job to database: ${error.message}`);
    throw error;
  }
};

/**
 * Update job status in the database
 */
export const updateJobStatus = async (jobId, status, startedAt = null, completedAt = null, errorMessage = null) => {
  try {
    const db = checkDatabaseConnection();
    
    let query = 'UPDATE scrape_jobs SET status = ?';
    const params = [status];
    
    if (startedAt) {
      query += ', started_at = ?';
      params.push(new Date(startedAt));
    }
    
    if (completedAt) {
      query += ', completed_at = ?';
      params.push(new Date(completedAt));
    }
    
    if (errorMessage) {
      query += ', error_message = ?';
      params.push(errorMessage);
    }
    
    query += ' WHERE id = ?';
    params.push(jobId);
    
    const result = await db.execute(query, params);
    return result.affectedRows > 0;
  } catch (error) {
    logger.error(`Error updating job status: ${error.message}`);
    throw error;
  }
};

/**
 * Update job progress in the database
 */
export const updateJobProgress = async (jobId, progress, message) => {
  try {
    const pool = checkDatabaseConnection();
    
    // First get the current params
    const [rows] = await pool.execute(
      'SELECT params FROM scrape_jobs WHERE id = ?',
      [jobId]
    );
    
    if (rows.length === 0) {
      return false;
    }
    
    // Parse the params
    let params = {};
    try {
      params = JSON.parse(rows[0].params);
    } catch (e) {
      params = {};
    }
    
    // Update progress and message
    params.progress = progress;
    params.message = message;
    
    // Save back to database
    await pool.execute(
      'UPDATE scrape_jobs SET params = ? WHERE id = ?',
      [JSON.stringify(params), jobId]
    );
    
    return true;
  } catch (error) {
    logger.error(`Error updating job progress: ${error.message}`);
    throw error;
  }
};

/**
 * Get job status from the database
 */
export const getJobStatus = async (jobId) => {
  try {
    const db = checkDatabaseConnection();
    
    const [rows] = await db.execute(
      'SELECT id, domain, status, started_at, completed_at, error_message, params, created_at FROM scrape_jobs WHERE id = ?',
      [jobId]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const job = rows[0];
    let params = {};
    
    try {
      params = JSON.parse(job.params);
    } catch (e) {
      params = {};
    }
    
    return {
      jobId: job.id,
      domain: job.domain,
      status: job.status,
      progress: params.progress || 0,
      message: params.message || '',
      error: job.error_message,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at
    };
  } catch (error) {
    logger.error(`Error getting job status: ${error.message}`);
    throw error;
  }
};

/**
 * Get pending jobs from the database (queued or processing)
 */
export const getPendingJobs = async () => {
  try {
    const pool = checkDatabaseConnection();
    
    // Use a direct string for the IN clause instead of placeholders
    const query = "SELECT id, domain, status, started_at, params, created_at FROM scrape_jobs WHERE status IN ('queued', 'processing') ORDER BY FIELD(status, 'processing', 'queued'), created_at ASC"; // Order to process active first, then by time
    
    const [rows] = await pool.execute(query);
    
    return rows.map(job => {
      let params = {};
      try {
        // Parse the params string from the database
        params = job.params ? JSON.parse(job.params) : {}; 
      } catch (e) {
        logger.error(`[DB] Error parsing params for job ${job.id}: ${e.message}`);
        params = {}; // Default to empty if parsing fails
      }
      
      // Construct the job object, including the parsed params object
      return {
        jobId: job.id,
        domain: job.domain,
        status: job.status,
        params: params, // Include the full parsed params object
        // Set top-level properties for convenience/compatibility, ensuring they come from params
        priority: params.priority || 'normal',
        depth: params.depth || 1, 
        extractors: params.extractors || ['general'],
        callbackUrl: params.callbackUrl,
        createdAt: job.created_at,
        startedAt: job.started_at,
        // Ensure progress/message are accessible if needed, though likely set during processing
        progress: params.progress || 0,
        message: params.message || ''
      };
    });
  } catch (error) {
    logger.error(`Error getting pending jobs: ${error.message}`);
    // Return empty array on error to prevent crash
    return []; 
    // throw error; // Or re-throw if startup should halt
  }
};

/**
 * List jobs with optional filtering
 */
export const listJobs = async (status, limit, offset) => {
  try {
    const db = checkDatabaseConnection();
    
    // Ensure limit and offset are valid numbers
    const safeLimit = Number(limit) || 20; // Default to 20 if not a valid number
    const safeOffset = Number(offset) || 0; // Default to 0 if not a valid number
    
    let query = 'SELECT id, domain, status, started_at, completed_at, error_message, params, created_at FROM scrape_jobs';
    const params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    // Append LIMIT and OFFSET
    query += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    
    const [rows] = await db.execute(query, params);
    
    return rows.map(job => {
      let jobParams = {};
      try {
        jobParams = job.params ? JSON.parse(job.params) : {};
      } catch (e) {
        jobParams = {};
      }
      
      return {
        jobId: job.id,
        domain: job.domain,
        status: job.status,
        progress: jobParams.progress || 0,
        message: jobParams.message || '',
        error: job.error_message,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at
      };
    });
  } catch (error) {
    logger.error(`Error listing jobs: ${error.message}`);
    throw error;
  }
};

/**
 * Save scrape results to the database
 */
export const saveResults = async (jobId, results) => {
  try {
    const db = checkDatabaseConnection();
    const normalizedDomain = results.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    // Get the domain_id directly from domain_info table
    const [domainInfoRows] = await db.execute(
      'SELECT id FROM domain_info WHERE domain = ?',
      [normalizedDomain]
    );
    
    let domainId;
    
    if (domainInfoRows.length === 0) {
      // Insert the domain into domain_info
      const [insertResult] = await db.execute(
        'INSERT INTO domain_info (domain, status, created_at) VALUES (?, "processing", NOW())',
        [normalizedDomain]
      );
      
      domainId = insertResult.insertId;
    } else {
      domainId = domainInfoRows[0].id;
    }
    
    // Save the results to the appropriate tables
    
    // 1. Site structure
    if (results.general) {
      await saveOrUpdateTable(
        db,
        'domain_site_structure',
        {
          domain_id: domainId,
          site_map: JSON.stringify(results.general.siteStructure || {}),
          prominent_links: JSON.stringify(results.general.prominentLinks || []),
          navigation_structure: JSON.stringify(results.general.navigationStructure || {})
        },
        'domain_id',
        domainId
      );
    }
    
    // 2. Blog content
    if (results.blog) {
      await saveOrUpdateTable(
        db,
        'domain_blog_content',
        {
          domain_id: domainId,
          blog_url: results.blog.blogUrl || null,
          articles: JSON.stringify(results.blog.articles || []),
          has_blog: results.blog.hasBlog ? 1 : 0
        },
        'domain_id',
        domainId
      );
    }
    
    // 3. Media content
    if (results.images || results.videos) {
      await saveOrUpdateTable(
        db,
        'domain_media_content',
        {
          domain_id: domainId,
          hero_images: JSON.stringify(results.images?.heroImages || []),
          brand_images: JSON.stringify(results.images?.brandImages || []),
          videos: JSON.stringify(results.videos || [])
        },
        'domain_id',
        domainId
      );
    }
    
    // 4. Social and podcast
    if (results.socialMedia || results.podcast) {
      await saveOrUpdateTable(
        db,
        'domain_social_podcast',
        {
          domain_id: domainId,
          social_links: JSON.stringify(results.socialMedia?.links || {}),
          social_content: JSON.stringify(results.socialMedia?.content || {}),
          podcast_feeds: JSON.stringify(results.podcast?.feeds || []),
          podcast_episodes: JSON.stringify(results.podcast?.episodes || [])
        },
        'domain_id',
        domainId
      );
    }
    
    // 5. Colors
    if (results.colors) {
      await saveOrUpdateTable(
        db,
        'domain_colors',
        {
          domain_id: domainId,
          primary_color: results.colors.primaryColor || null,
          secondary_colors: JSON.stringify(results.colors.secondaryColors || []),
          palette: JSON.stringify(results.colors.palette || [])
        },
        'domain_id',
        domainId
      );
    }
    
    // 6. Domain analysis
    if (results.analysis) {
      await saveOrUpdateTable(
        db,
        'domain_analysis',
        {
          domain_id: domainId,
          website_type: results.analysis.websiteType?.primaryType || null,
          website_type_confidence: results.analysis.websiteType?.confidence || 0,
          secondary_types: JSON.stringify(results.analysis.websiteType?.secondaryTypes || []),
          relevant_topics: JSON.stringify(results.analysis.contentRelevance?.relevantTopics || []),
          content_quality: results.analysis.contentRelevance?.contentQuality || null,
          summary: results.analysis.summary || null,
          analyzed_at: new Date()
        },
        'domain_id',
        domainId
      );
    }
    
    // 7. ISBN data
    if (results.isbn) {
      // Save ISBN numbers
      if (results.isbn.isbns && results.isbn.isbns.length > 0) {
        await saveIsbnData(domainId, results.isbn);
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving results: ${error.message}`);
    throw error;
  }
};

/**
 * Helper function to save or update a record in a table
 */
export const saveOrUpdateTable = async (db, tableName, data, keyField, keyValue) => {
  try {
    // Check if record exists
    const [rows] = await db.execute(
      `SELECT * FROM ${tableName} WHERE ${keyField} = ?`,
      [keyValue]
    );
    
    // Get table columns to ensure we only insert/update existing columns
    const [columnsResult] = await db.execute(`SHOW COLUMNS FROM ${tableName}`);
    const tableColumns = columnsResult.map(col => col.Field);
    
    // Filter data to only include existing columns
    const filteredData = {};
    for (const [key, value] of Object.entries(data)) {
      if (tableColumns.includes(key)) {
        filteredData[key] = value;
      } else {
        logger.warn(`Column '${key}' does not exist in table '${tableName}', skipping`);
      }
    }
    
    if (rows.length === 0) {
      // Insert new record
      // Add created_at field for new records if it exists
      const dataWithTimestamp = {
        ...filteredData
      };
      
      if (tableColumns.includes('created_at')) {
        dataWithTimestamp.created_at = new Date();
      }
      
      if (Object.keys(dataWithTimestamp).length === 0) {
        logger.warn(`No valid columns to insert into ${tableName}`);
        return;
      }
      
      const fields = Object.keys(dataWithTimestamp).join(', ');
      const placeholders = Object.keys(dataWithTimestamp).map(() => '?').join(', ');
      
      const query = `INSERT INTO ${tableName} (${fields}) VALUES (${placeholders})`;
      
      await db.execute(query, Object.values(dataWithTimestamp));
    } else {
      // Update existing record
      // Add updated_at field for updates if it exists
      const dataWithTimestamp = {
        ...filteredData
      };
      
      if (tableColumns.includes('updated_at')) {
        dataWithTimestamp.updated_at = new Date();
      }
      
      if (Object.keys(dataWithTimestamp).length === 0 || 
          (Object.keys(dataWithTimestamp).length === 1 && dataWithTimestamp.updated_at)) {
        logger.warn(`No valid columns to update in ${tableName}`);
        return;
      }
      
      const setClause = Object.keys(dataWithTimestamp)
        .filter(key => key !== keyField) // Don't update the key field
        .map(key => `${key} = ?`)
        .join(', ');
      
      if (!setClause) {
        logger.warn(`No valid columns to update in ${tableName}`);
        return;
      }
      
      const query = `UPDATE ${tableName} SET ${setClause} WHERE ${keyField} = ?`;
      
      const params = [
        ...Object.entries(dataWithTimestamp)
          .filter(([key]) => key !== keyField)
          .map(([, value]) => value),
        keyValue
      ];
      
      await db.execute(query, params);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in saveOrUpdateTable for ${tableName}: ${error.message}`);
    return false;
  }
};

/**
 * Get job results from the database
 */
export const getJobResults = async (jobId) => {
  try {
    logger.info(`Starting getJobResults for jobId: ${jobId}`);
    const db = checkDatabaseConnection();
    logger.info('Database connection checked');
    
    // First get the job to find the domain
    logger.info(`Fetching job domain information for jobId: ${jobId}`);
    const [jobRows] = await db.execute(
      'SELECT domain FROM scrape_jobs WHERE id = ?',
      [jobId]
    );
    
    logger.info(`Job rows found: ${jobRows.length} for jobId: ${jobId}`);
    if (jobRows.length === 0) {
      logger.warn(`No job found with jobId: ${jobId}`);
      return null;
    }
    
    const domain = jobRows[0].domain;
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    logger.info(`Found domain: ${domain}, normalized to: ${normalizedDomain}`);
    
    // Get the domain data directly from domain_info
    logger.info(`Looking up domain data for: ${normalizedDomain}`);
    const [domainInfoRows] = await db.execute(
      'SELECT id, data, ai_analysis FROM domain_info WHERE domain = ?',
      [normalizedDomain]
    );
    
    logger.info(`Domain rows found: ${domainInfoRows.length} for domain: ${normalizedDomain}`);
    if (domainInfoRows.length === 0) {
      logger.warn(`No domain info found for domain: ${normalizedDomain}`);
      return {
        domain: normalizedDomain,
        noDataFound: true
      };
    }
    
    // Use the JSON data stored in domain_info if available
    if (domainInfoRows[0].data) {
      try {
        const data = JSON.parse(domainInfoRows[0].data);
        
        // Add AI analysis if available
        if (domainInfoRows[0].ai_analysis) {
          data.aiAnalysis = JSON.parse(domainInfoRows[0].ai_analysis);
        }
        
        return data;
      } catch (error) {
        logger.error(`Error parsing JSON data: ${error.message}`);
      }
    }
    
    // If no data in domain_info, gather from individual tables using domain_info.id
    const domainId = domainInfoRows[0].id;
    
    const results = {
      domain: normalizedDomain,
      lastUpdated: new Date().toISOString()
    };
    
    // Get data from all related tables using domainId
    // ... (legacy table queries would go here if needed)
    
    return results;
  } catch (error) {
    logger.error(`Error getting job results: ${error.message}`);
    throw error;
  }
};

/**
 * Get domain data by domain name
 */
export const getDomainData = async (domain) => {
  try {
    const db = checkDatabaseConnection();
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    // Get the domain_id directly from domain_info 
    const [domainInfoRows] = await db.execute(
      'SELECT id, data, ai_analysis FROM domain_info WHERE domain = ?',
      [normalizedDomain]
    );
    
    if (domainInfoRows.length === 0) {
      return null;
    }
    
    const domainId = domainInfoRows[0].id;
    
    // First check if we have pre-stored JSON data
    if (domainInfoRows[0].data) {
      try {
        const data = JSON.parse(domainInfoRows[0].data);
        // Add AI analysis if available
        if (domainInfoRows[0].ai_analysis) {
          data.aiAnalysis = JSON.parse(domainInfoRows[0].ai_analysis);
        }
        return data;
      } catch (e) {
        logger.warn(`Error parsing stored domain data: ${e.message}`);
        // Continue to legacy approach if JSON parsing fails
      }
    }
    
    // Legacy approach: get all the data for this domain from separate tables
    const results = {
      domain: normalizedDomain,
      lastUpdated: new Date().toISOString()
    };
    
    // 1. Site structure
    const [structureRows] = await db.execute(
      'SELECT site_map, prominent_links, navigation_structure FROM domain_site_structure WHERE domain_id = ?',
      [domainId]
    );
    
    if (structureRows.length > 0) {
      results.siteStructure = {
        siteMap: safeParseJSON(structureRows[0].site_map, {}),
        prominentLinks: safeParseJSON(structureRows[0].prominent_links, []),
        navigationStructure: safeParseJSON(structureRows[0].navigation_structure, {})
      };
    }
    
    // Continue with other tables...
    
    return results;
  } catch (error) {
    logger.error(`Error getting domain data: ${error.message}`);
    return null;
  }
};

/**
 * Check if a URL has been crawled recently (within the last 24 hours)
 */
export const hasBeenCrawledRecently = async (domainId, url) => {
  try {
    const db = checkDatabaseConnection();
    
    // Check if URL has been crawled in the last 24 hours - domainId now references domain_info.id
    const [rows] = await db.execute(
      'SELECT id, last_crawled_at, crawl_count FROM crawl_tracking WHERE domain_id = ? AND url = ? AND last_crawled_at > DATE_SUB(NOW(), INTERVAL 1 DAY)',
      [domainId, url]
    );
    
    return rows.length > 0;
  } catch (error) {
    logger.error(`Error checking if URL has been crawled recently: ${error.message}`);
    return false; // If there's an error, assume it hasn't been crawled recently
  }
};

/**
 * Track a crawled URL
 */
export const trackCrawledUrl = async (domainId, url) => {
  try {
    const db = checkDatabaseConnection();
    
    // Insert or update crawl tracking record - domainId now references domain_info.id
    await db.execute(
      `INSERT INTO crawl_tracking (domain_id, url, last_crawled_at, crawl_count) 
       VALUES (?, ?, NOW(), 1)
       ON DUPLICATE KEY UPDATE 
       last_crawled_at = NOW(),
       crawl_count = crawl_count + 1`,
      [domainId, url]
    );
    
    return true;
  } catch (error) {
    logger.error(`Error tracking crawled URL: ${error.message}`);
    return false;
  }
};

/**
 * Get crawl statistics for a domain
 */
export const getCrawlStats = async (domainId) => {
  try {
    const db = checkDatabaseConnection();
    
    // Get crawl statistics - domainId now references domain_info.id
    const [rows] = await db.execute(
      `SELECT 
        COUNT(*) as total_urls,
        SUM(CASE WHEN last_crawled_at > DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as crawled_today,
        MAX(crawl_count) as max_crawl_count,
        AVG(crawl_count) as avg_crawl_count
       FROM crawl_tracking 
       WHERE domain_id = ?`,
      [domainId]
    );
    
    if (rows.length > 0) {
      return {
        totalUrls: rows[0].total_urls,
        crawledToday: rows[0].crawled_today,
        maxCrawlCount: rows[0].max_crawl_count,
        avgCrawlCount: rows[0].avg_crawl_count
      };
    }
    
    return {
      totalUrls: 0,
      crawledToday: 0,
      maxCrawlCount: 0,
      avgCrawlCount: 0
    };
  } catch (error) {
    logger.error(`Error getting crawl statistics: ${error.message}`);
    return {
      totalUrls: 0,
      crawledToday: 0,
      maxCrawlCount: 0,
      avgCrawlCount: 0
    };
  }
};

/**
 * Get analysis data for a domain
 */
export const getAnalysisData = async (domainId) => {
  try {
    const db = checkDatabaseConnection();
    
    // Check if domain_analysis table exists and has the required columns
    let hasSecondaryTypes = true;
    try {
      await db.execute('SELECT secondary_types FROM domain_analysis LIMIT 1');
    } catch (columnError) {
      hasSecondaryTypes = false;
      logger.warn('Column secondary_types does not exist in domain_analysis table');
    }
    
    // Adjust query based on available columns
    let query = 'SELECT website_type, relevant_topics, content_quality, summary, analyzed_at FROM domain_analysis WHERE domain_id = ?';
    if (hasSecondaryTypes) {
      query = 'SELECT website_type, secondary_types, relevant_topics, content_quality, summary, analyzed_at FROM domain_analysis WHERE domain_id = ?';
    }
    
    const [analysisRows] = await db.execute(query, [domainId]);
    
    if (analysisRows.length > 0) {
      return {
        websiteType: analysisRows[0].website_type,
        secondaryTypes: hasSecondaryTypes ? safeParseJSON(analysisRows[0].secondary_types, []) : [],
        relevantTopics: safeParseJSON(analysisRows[0].relevant_topics, []),
        contentQuality: analysisRows[0].content_quality,
        summary: analysisRows[0].summary,
        analyzedAt: analysisRows[0].analyzed_at
      };
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error getting analysis data: ${error.message}`);
    return null;
  }
};

/**
 * Save ISBN data to the database
 */
export const saveIsbnData = async (domainId, isbnData) => {
  try {
    const db = checkDatabaseConnection();
    
    // Save ISBN numbers
    if (isbnData.isbns && isbnData.isbns.length > 0) {
      for (const isbn of isbnData.isbns) {
        try {
          await db.execute(
            `INSERT INTO domain_isbn_data 
            (domain_id, isbn, isbn_type, page_url, context) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            updated_at = CURRENT_TIMESTAMP`,
            [
              domainId,
              isbn.cleaned,
              isbn.type,
              isbn.page,
              isbn.context || null
            ]
          );
        } catch (error) {
          logger.error(`Error saving ISBN data: ${error.message}`);
          // Continue with other ISBNs
        }
      }
    }
    
    // Save ISBN images
    if (isbnData.isbnImages && isbnData.isbnImages.length > 0) {
      for (const img of isbnData.isbnImages) {
        try {
          await db.execute(
            `INSERT INTO domain_isbn_images 
            (domain_id, isbn, image_url, page_url, alt_text) 
            VALUES (?, ?, ?, ?, ?)`,
            [
              domainId,
              img.isbn,
              img.imageUrl,
              img.page,
              img.alt || null
            ]
          );
        } catch (error) {
          logger.error(`Error saving ISBN image data: ${error.message}`);
          // Continue with other images
        }
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving ISBN data: ${error.message}`);
    return false;
  }
};

/**
 * Get ISBN data for a domain
 */
export const getIsbnData = async (domainId) => {
  try {
    const db = checkDatabaseConnection();
    
    // Get ISBN numbers
    const [isbnRows] = await db.execute(
      'SELECT isbn, isbn_type, page_url, context FROM domain_isbn_data WHERE domain_id = ?',
      [domainId]
    );
    
    // Get ISBN images
    const [imageRows] = await db.execute(
      'SELECT isbn, image_url, page_url, alt_text FROM domain_isbn_images WHERE domain_id = ?',
      [domainId]
    );
    
    return {
      isbns: isbnRows.map(row => ({
        isbn: row.isbn,
        type: row.isbn_type,
        page: row.page_url,
        context: row.context
      })),
      isbnImages: imageRows.map(row => ({
        isbn: row.isbn,
        imageUrl: row.image_url,
        page: row.page_url,
        alt: row.alt_text
      }))
    };
  } catch (error) {
    logger.error(`Error getting ISBN data: ${error.message}`);
    return {
      isbns: [],
      isbnImages: []
    };
  }
};

/**
 * Check if a job can be resumed
 */
export const canResumeJob = async (jobId) => {
  try {
    const db = checkDatabaseConnection();
    
    // Get the latest crawl progress for this job
    const [rows] = await db.execute(
      `SELECT * FROM domain_crawl_progress 
       WHERE job_id = ? AND status IN ('processing', 'interrupted')
       ORDER BY last_active DESC LIMIT 1`,
      [jobId]
    );
    
    if (rows.length === 0) {
      return false;
    }
    
    const progress = rows[0];
    
    // Check if it's recent enough to resume (within last 30 minutes)
    const lastActive = new Date(progress.last_active);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    return lastActive > thirtyMinutesAgo;
  } catch (error) {
    logger.error(`Error checking job resume status: ${error.message}`);
    return false;
  }
}; 