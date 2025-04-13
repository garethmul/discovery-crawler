import express from 'express';
import { getPool } from '../../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * Get current crawl progress information for a job
 */
router.get('/progress/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // Get overall job status
    const [jobRows] = await db.execute(
      `SELECT * FROM jobs WHERE job_id = ?`,
      [jobId]
    );
    
    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const job = jobRows[0];
    
    // Get detailed crawl progress
    const [progressRows] = await db.execute(
      `SELECT cp.* 
       FROM domain_crawl_progress cp
       JOIN domain_info di ON cp.domain_id = di.id
       WHERE cp.job_id = ?`,
      [jobId]
    );
    
    const progress = progressRows.length > 0 ? progressRows[0] : null;
    
    // Return combined status
    return res.json({
      job,
      progress
    });
  } catch (error) {
    logger.error(`Error fetching crawl progress: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching crawl progress' });
  }
});

/**
 * Get a list of extracted images for a job
 */
router.get('/data/images/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Get extracted images
    const [imageRows] = await db.execute(
      `SELECT * FROM domain_images 
       WHERE domain_id = ? 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [domainId]
    );
    
    return res.json({
      domainId,
      images: imageRows
    });
  } catch (error) {
    logger.error(`Error fetching extracted images: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching extracted images' });
  }
});

/**
 * Get a list of extracted social media links for a job
 */
router.get('/data/social/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Get extracted social media links
    const [socialRows] = await db.execute(
      `SELECT * FROM domain_opengraph 
       WHERE domain_id = ? AND is_social_profile = TRUE
       ORDER BY created_at DESC`,
      [domainId]
    );
    
    return res.json({
      domainId,
      socialLinks: socialRows
    });
  } catch (error) {
    logger.error(`Error fetching social media links: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching social media links' });
  }
});

/**
 * Get a list of extracted RSS feeds for a job
 */
router.get('/data/rss/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Get extracted RSS feeds
    const [rssRows] = await db.execute(
      `SELECT * FROM domain_rss_feeds 
       WHERE domain_id = ?
       ORDER BY created_at DESC`,
      [domainId]
    );
    
    return res.json({
      domainId,
      rssFeeds: rssRows
    });
  } catch (error) {
    logger.error(`Error fetching RSS feeds: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching RSS feeds' });
  }
});

/**
 * Get a list of extracted ISBNs for a job
 */
router.get('/data/isbn/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Get extracted ISBN data
    const [isbnRows] = await db.execute(
      `SELECT * FROM domain_isbn_data 
       WHERE domain_id = ?
       ORDER BY created_at DESC`,
      [domainId]
    );
    
    return res.json({
      domainId,
      isbns: isbnRows
    });
  } catch (error) {
    logger.error(`Error fetching ISBN data: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching ISBN data' });
  }
});

/**
 * Get a list of extracted videos for a job
 */
router.get('/data/videos/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Get extracted videos
    const [videoRows] = await db.execute(
      `SELECT * FROM domain_media_content 
       WHERE domain_id = ? AND media_type = 'video'
       ORDER BY created_at DESC`,
      [domainId]
    );
    
    return res.json({
      domainId,
      videos: videoRows
    });
  } catch (error) {
    logger.error(`Error fetching video data: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching video data' });
  }
});

/**
 * Get a summary of all data types extracted for a job
 */
router.get('/data/summary/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = getPool();
    
    // First get domain_id for this job
    const [domainRows] = await db.execute(
      `SELECT domain_id FROM domain_crawl_progress WHERE job_id = ?`,
      [jobId]
    );
    
    if (domainRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no progress data available' });
    }
    
    const domainId = domainRows[0].domain_id;
    
    // Run all queries in parallel
    const [
      [imageCount], 
      [socialCount], 
      [rssCount], 
      [isbnCount], 
      [videoCount],
      [blogCount],
      [podcastCount]
    ] = await Promise.all([
      db.execute(`SELECT COUNT(*) as count FROM domain_images WHERE domain_id = ?`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_opengraph WHERE domain_id = ? AND is_social_profile = TRUE`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_rss_feeds WHERE domain_id = ?`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_isbn_data WHERE domain_id = ?`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_media_content WHERE domain_id = ? AND media_type = 'video'`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_blog_info WHERE domain_id = ?`, [domainId]),
      db.execute(`SELECT COUNT(*) as count FROM domain_podcast_episodes WHERE domain_id = ?`, [domainId])
    ]);
    
    // Return summary data
    return res.json({
      domainId,
      summary: {
        images: imageCount[0]?.count || 0,
        socialLinks: socialCount[0]?.count || 0,
        rssFeeds: rssCount[0]?.count || 0, 
        isbns: isbnCount[0]?.count || 0,
        videos: videoCount[0]?.count || 0,
        blogArticles: blogCount[0]?.count || 0,
        podcastEpisodes: podcastCount[0]?.count || 0
      }
    });
  } catch (error) {
    logger.error(`Error fetching data summary: ${error.message}`);
    return res.status(500).json({ error: 'Error fetching data summary' });
  }
});

export default router; 