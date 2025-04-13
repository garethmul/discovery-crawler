import logger from '../utils/logger.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { getPool } from '../../config/database.js';
import * as domainDataRepository from '../database/repositories/domainDataRepository.js';
import * as puppeteerService from './puppeteerService.js';

/**
 * Normalize URL to ensure consistent format
 */
const normalizeUrl = (url, base) => {
  try {
    // Handle empty or invalid URLs
    if (!url || url.trim() === '') {
      return null;
    }
    
    // Skip URLs with unsupported protocols
    if (url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('sms:')) {
      return null;
    }
    
    // Handle fragment-only URLs
    if (url.startsWith('#')) {
      return null;
    }
    
    // Add protocol if missing
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      if (normalizedUrl.startsWith('//')) {
        normalizedUrl = 'https:' + normalizedUrl;
      } else if (normalizedUrl.startsWith('/')) {
        normalizedUrl = base + normalizedUrl;
      } else if (normalizedUrl.startsWith('www.')) {
        // Handle URLs that start with www. but don't have a protocol
        normalizedUrl = 'https://' + normalizedUrl;
      } else {
        normalizedUrl = base + '/' + normalizedUrl;
      }
    }
    
    // Parse and normalize URL
    const parsedUrl = new URL(normalizedUrl);
    
    // Remove fragments
    parsedUrl.hash = '';
    
    // Remove query parameters
    parsedUrl.search = '';
    
    // Return normalized URL
    return parsedUrl.toString();
  } catch (error) {
    logger.warn(`Error normalizing URL ${url}: ${error.message}`);
    return null;
  }
};

/**
 * Check if URL is from the same domain
 */
const isSameDomain = (url, domain) => {
  try {
    const parsedUrl = new URL(url);
    const urlHostname = parsedUrl.hostname.toLowerCase();
    const normalizedDomain = domain.toLowerCase();
    
    // Check for exact match
    if (urlHostname === normalizedDomain || urlHostname === 'www.' + normalizedDomain) {
      return true;
    }
    
    // Check for subdomains
    if (urlHostname.endsWith('.' + normalizedDomain)) {
      return true;
    }
    
    // Handle www vs non-www
    if (normalizedDomain.startsWith('www.') && urlHostname === normalizedDomain.substring(4)) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
};

/**
 * Save page HTML to database
 */
const savePageHtml = async (domainId, jobId, url, title, htmlContent, statusCode, contentType) => {
  try {
    const db = getPool();
    
    // Corrected query to use raw_html column
    const query = `
      INSERT INTO domain_pages 
      (domain_id, job_id, url, title, raw_html, status_code, content_type, crawled_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE 
      title = VALUES(title), 
      raw_html = VALUES(raw_html), 
      status_code = VALUES(status_code), 
      content_type = VALUES(content_type), 
      crawled_at = NOW()
    `;
    
    await db.execute(query, [
      domainId,
      jobId,
      url,
      title || null, // Ensure title is handled if null/undefined
      htmlContent,   // Use the passed htmlContent variable for raw_html column
      statusCode,
      contentType
    ]);
    
    logger.info(`[DISCOVERY] Saved page details for ${url} (Status: ${statusCode})`);
    return true;
  } catch (error) {
    // Log the specific error encountered during DB operation
    logger.error(`[DISCOVERY] ❌ Error saving page to database for ${url}: ${error.message}`);
    // Optionally log the specific data that failed
    // logger.debug(`Failed data: domainId=${domainId}, jobId=${jobId}, url=${url}, title=${title}, statusCode=${statusCode}, contentType=${contentType}, htmlContent length=${htmlContent?.length}`);
    return false;
  }
};

/**
 * Generate random user agent to avoid detection
 */
const getRandomUserAgent = () => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

/**
 * Check if response indicates Cloudflare or other protection
 */
const isProtected = (response) => {
  // Check for Cloudflare
  if (
    response.headers['server']?.includes('cloudflare') ||
    response.data?.includes('Checking your browser before accessing') ||
    response.data?.includes('cf-browser-verification')
  ) {
    return 'Cloudflare';
  }
  
  // Check for rate limiting
  if (
    response.status === 429 ||
    response.data?.includes('rate limit') ||
    response.data?.includes('too many requests')
  ) {
    return 'Rate Limited';
  }
  
  return false;
};

/**
 * Fetch with retry logic for better network resilience
 */
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  try {
    logger.info(`[CRAWLER] Fetching content for ${url}`);
    
    // Try to fetch using Puppeteer first for more reliable content extraction
    try {
      const puppeteerService = await import('./puppeteerService.js');
      const { content, metadata } = await puppeteerService.getPageContent(url, { timeout: 30000 });
      
      logger.info(`[CRAWLER] Successfully fetched ${url} using Puppeteer`);
      return { 
        data: content,
        metadata: metadata || {},
        source: 'puppeteer'
      };
    } catch (puppeteerError) {
      logger.warn(`[CRAWLER] Puppeteer fetch failed for ${url}, falling back to Axios: ${puppeteerError.message}`);
      // Fall back to Axios
    }
    
    // Axios fallback
    const axios = (await import('axios')).default;
    const axiosOptions = {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...options.headers
      },
      ...options
    };
    
    const response = await axios.get(url, axiosOptions);
    
    logger.info(`[CRAWLER] Successfully fetched ${url} using Axios`);
    return {
      data: response.data,
      headers: response.headers,
      source: 'axios'
    };
  } catch (error) {
    if (retries > 0) {
      logger.warn(`[CRAWLER] ⚠️ Error fetching ${url}: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2); // Exponential backoff
    } else {
      logger.error(`[CRAWLER] ❌ Failed to fetch ${url} after multiple attempts: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Save or update crawl progress to the database
 */
const saveCrawlProgress = async (domainId, jobId, totalPages, crawledPages, currentUrl, status) => {
  try {
    const db = getPool();
    
    // Check if progress record exists
    const [rows] = await db.execute(
      'SELECT id FROM domain_crawl_progress WHERE domain_id = ? AND job_id = ?',
      [domainId, jobId]
    );
    
    if (rows.length === 0) {
      // Insert new record
      await db.execute(
        `INSERT INTO domain_crawl_progress 
        (domain_id, job_id, pages_total, pages_crawled, current_url, status, last_active) 
        VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [domainId, jobId, totalPages, crawledPages, currentUrl, status]
      );
    } else {
      // Update existing record
      await db.execute(
        `UPDATE domain_crawl_progress 
         SET pages_total = ?, pages_crawled = ?, current_url = ?, status = ?, last_active = NOW(), updated_at = NOW() 
         WHERE domain_id = ? AND job_id = ?`,
        [totalPages, crawledPages, currentUrl, status, domainId, jobId]
      );
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving crawl progress: ${error.message}`);
    return false;
  }
};

/**
 * Check if a crawl can be resumed
 */
const checkResumeableCrawl = async (domainId, jobId) => {
  try {
    const db = getPool();
    
    // Get the latest crawl progress
    const [rows] = await db.execute(
      `SELECT * FROM domain_crawl_progress 
       WHERE domain_id = ? AND job_id = ? AND status IN ('processing', 'interrupted')
       ORDER BY last_active DESC LIMIT 1`,
      [domainId, jobId]
    );
    
    if (rows.length > 0) {
      const progress = rows[0];
      
      // Check if it's recent enough to resume (within last 30 minutes)
      const lastActive = new Date(progress.last_active);
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      
      if (lastActive > thirtyMinutesAgo) {
        logger.info(`[CRAWLER] Found resumable crawl for job ${jobId}, last active at ${lastActive.toISOString()}`);
        return {
          canResume: true,
          progress
        };
      }
    }
    
    return {
      canResume: false
    };
  } catch (error) {
    logger.error(`Error checking resumable crawl: ${error.message}`);
    return {
      canResume: false
    };
  }
};

/**
 * Discover pages for a domain
 */
export const discoverPages = async (domain, depth = 2, jobId = null, options = {}) => {
  logger.info(`[CRAWLER] 🔍 Starting discovery of pages for ${domain} with depth ${depth}`);
  
  // Default options
  const defaultOptions = {
    maxPages: 25, // Maximum number of pages to crawl
    respectCrawlFrequency: true, // Whether to respect the 24-hour crawl frequency
    maxLoopDetectionSize: 1000, // Maximum size of the URL queue before suspecting a loop
    crawlDelay: { min: 1000, max: 3000 }, // Delay between requests in milliseconds
    maxQueueSize: 1000, // Maximum number of URLs to keep in the queue
    priorityUrls: ['/', '/about', '/contact', '/blog', '/news', '/podcasts', '/podcast'] // High priority URLs to crawl first
  };
  
  // Merge options
  const crawlOptions = { ...defaultOptions, ...options };
  
  // Normalize domain
  const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${normalizedDomain}`;
  
  // Get domain ID from database - UPDATED to use domain_info instead of domains
  let domainId = null;
  try {
    const db = getPool();
    const [rows] = await db.execute('SELECT id FROM domain_info WHERE domain = ?', [normalizedDomain]);
    
    if (rows.length > 0) {
      domainId = rows[0].id;
    } else {
      // Insert domain directly into domain_info if not exists
      const [result] = await db.execute(
        'INSERT INTO domain_info (domain, normalized_url, status, created_at) VALUES (?, ?, "pending", NOW())',
        [normalizedDomain, baseUrl]
      );
      domainId = result.insertId;
    }
    
    logger.info(`[CRAWLER] Using domain ID: ${domainId} for ${domain}`);
  } catch (error) {
    logger.error(`[CRAWLER] ❌ Error getting domain ID: ${error.message}`);
  }
  
  // Check if we can resume a previous crawl
  let resumeData = { canResume: false };
  if (domainId && jobId) {
    resumeData = await checkResumeableCrawl(domainId, jobId);
  }
  
  // Set of discovered URLs to avoid duplicates within this crawl session
  const discoveredUrls = new Set();
  // Priority queue of URLs to crawl
  const urlQueue = resumeData.canResume 
    ? [] // Will be populated from database if resuming
    : [{ url: baseUrl, depth: 1, priority: 1 }];
  // Array of discovered pages
  const pages = [];
  // Counter for crawled pages
  let crawledCount = resumeData.canResume ? resumeData.progress.pages_crawled : 0;
  // Counter for priority pages
  let priorityPagesCount = 0;
  // Track start time for loop detection
  const startTime = Date.now();
  // Track last queue size check for loop detection
  let lastQueueSizeCheck = 0;
  let lastQueueSize = 0;
  
  // If resuming, load previously discovered pages and queue
  if (resumeData.canResume) {
    try {
      logger.info(`[CRAWLER] 🔄 Resuming previous crawl for ${domain} (Job ID: ${jobId})`);
      logger.info(`[CRAWLER] Already crawled ${resumeData.progress.pages_crawled} of ${resumeData.progress.pages_total} pages`);
      
      // Get already crawled pages
      const [pageRows] = await db.execute(
        'SELECT url, title, html FROM domain_pages WHERE domain_id = ? AND job_id = ?',
        [domainId, jobId]
      );
      
      // Add to discovered URLs and pages
      for (const pageRow of pageRows) {
        discoveredUrls.add(pageRow.url);
        pages.push({
          url: pageRow.url,
          title: pageRow.title,
          depth: 1 // Assume depth 1 for simplicity
        });
      }
      
      // Set the crawler to continue from where it left off
      if (resumeData.progress.current_url) {
        urlQueue.push({ url: resumeData.progress.current_url, depth: 1, priority: 1 });
      }
      
      // If we don't have a current URL, start from the beginning
      if (urlQueue.length === 0) {
        urlQueue.push({ url: baseUrl, depth: 1, priority: 1 });
      }
      
      // Update the crawl status to processing
      await saveCrawlProgress(
        domainId, 
        jobId, 
        resumeData.progress.pages_total, 
        resumeData.progress.pages_crawled, 
        urlQueue[0].url, 
        'processing'
      );
    } catch (error) {
      logger.error(`[CRAWLER] ❌ Error resuming crawl: ${error.message}`);
      // Fall back to starting a new crawl
      urlQueue.push({ url: baseUrl, depth: 1, priority: 1 });
    }
  } else if (domainId && jobId) {
    // Initialize crawl progress
    await saveCrawlProgress(domainId, jobId, 0, 0, baseUrl, 'processing');
  }
  
  logger.info(`[CRAWLER] Starting crawl with queue of ${urlQueue.length} URLs`);
  
  // Process URLs up to the specified depth
  while (urlQueue.length > 0) {
    // Check if we've reached the maximum number of pages
    if (crawledCount >= crawlOptions.maxPages) {
      // Modified: Only break if there are no priority URLs left in the queue
      const hasPriorityUrls = urlQueue.some(item => item.priority > 0);
      if (!hasPriorityUrls) {
        logger.info(`[CRAWLER] 🎯 Reached maximum number of pages (${crawledCount}/${crawlOptions.maxPages}). Stopping crawl.`);
        break;
      } else {
        logger.info(`[CRAWLER] 🎯 Reached maximum number of pages (${crawledCount}/${crawlOptions.maxPages}) but continuing to process ${urlQueue.filter(u => u.priority > 0).length} priority URLs.`);
      }
    }
    
    // Sort queue by priority and depth
    urlQueue.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.depth - b.depth;
    });
    
    // If queue is too large, trim it while preserving high-priority URLs
    if (urlQueue.length > crawlOptions.maxQueueSize) {
      logger.info(`[CRAWLER] 📊 Queue size (${urlQueue.length}) exceeds maximum (${crawlOptions.maxQueueSize}). Trimming low-priority URLs.`);
      
      // Keep high priority URLs and trim the rest
      const highPriorityUrls = urlQueue.filter(u => u.priority > 0);
      const lowPriorityUrls = urlQueue.filter(u => u.priority === 0);
      
      // Keep all high priority URLs and a portion of low priority ones
      const keepCount = Math.min(
        crawlOptions.maxQueueSize - highPriorityUrls.length,
        lowPriorityUrls.length
      );
      
      urlQueue.length = 0;
      urlQueue.push(...highPriorityUrls);
      urlQueue.push(...lowPriorityUrls.slice(0, keepCount));
      
      logger.info(`[CRAWLER] 📊 Trimmed queue to ${urlQueue.length} URLs (${highPriorityUrls.length} high priority, ${keepCount} low priority)`);
    }
    
    // Loop detection - check if queue size is not decreasing over time
    if (urlQueue.length > 100 && (Date.now() - lastQueueSizeCheck) > 30000) {
      if (urlQueue.length > lastQueueSize * 3) {
        logger.warn(`[CRAWLER] ⚠️ URL queue growing rapidly (${lastQueueSize} -> ${urlQueue.length}). Adjusting priorities.`);
        
        // Increase priority of unvisited high-priority URLs
        urlQueue.forEach(u => {
          if (crawlOptions.priorityUrls.some(p => u.url.endsWith(p))) {
            u.priority = 2;
          }
        });
      }
      lastQueueSize = urlQueue.length;
      lastQueueSizeCheck = Date.now();
    }
    
    const { url, depth: currentDepth, priority } = urlQueue.shift();
    
    // Update crawl progress with current URL
    if (domainId && jobId) {
      await saveCrawlProgress(
        domainId,
        jobId,
        crawlOptions.maxPages,
        crawledCount,
        url,
        'processing'
      );
    }
    
    // Skip if already discovered in this session or beyond max depth
    if (discoveredUrls.has(url) || currentDepth > depth) {
      continue;
    }
    
    // Check if URL has been crawled recently (within the last 24 hours)
    if (crawlOptions.respectCrawlFrequency && domainId) {
      try {
        const recentlyCrawled = await domainDataRepository.hasBeenCrawledRecently(domainId, url);
        if (recentlyCrawled) {
          logger.info(`[CRAWLER] Skipping ${url} - crawled within the last 24 hours`);
          continue;
        }
      } catch (error) {
        logger.error(`[CRAWLER] ❌ Error checking recent crawl status: ${error.message}`);
        // Continue anyway if there's an error
      }
    }
    
    // Mark as discovered in this session
    discoveredUrls.add(url);
    
    logger.info(`[CRAWLER] Processing page ${crawledCount+1}/${crawlOptions.maxPages}: ${url}`);
    
    try {
      // Fetch the page with enhanced retry logic
      const response = await fetchWithRetry(url);
      
      // Parse HTML
      const $ = cheerio.load(response.data);
      const title = $('title').text().trim() || url.split('/').pop() || 'Home Page';
      
      // For reliability, if the HTML seems too minimal, retry with Puppeteer
      if (response.data.length < 1000 || !$('a').length || !$('img').length) {
        logger.warn(`[CRAWLER] Detected potentially incomplete HTML for ${url}, retrying with Puppeteer`);
        try {
          const puppeteerService = await import('./puppeteerService.js');
          const { content, metadata } = await puppeteerService.getPageContent(url, { timeout: 30000 });
          
          // If Puppeteer returns good content, use it instead
          if (content && content.length > response.data.length) {
            logger.info(`[CRAWLER] Using enhanced Puppeteer content for ${url}`);
            response.data = content;
            // Re-parse the HTML
            $ = cheerio.load(content);
          }
        } catch (puppeteerError) {
          logger.warn(`[CRAWLER] Enhanced Puppeteer extraction failed for ${url}: ${puppeteerError.message}`);
          // Continue with original content
        }
      }
      
      // Save page info
      const page = {
        url,
        title,
        depth: currentDepth,
        content: response.data,
        fetchTime: new Date().toISOString(),
        source: response.source || 'unknown'
      };
      pages.push(page);
      
      // Extract and save various data types immediately
      if (domainId) {
        try {
          // First, save page to database and get the page ID
          let pageId = null;
          if (jobId) {
            // Save the page HTML to the database
            await savePageHtml(
              domainId,
              jobId,
              url,
              title,
              response.data,
              200, // Assuming success status code
              'text/html' // Assuming content type
            );
            
            // Get the page ID from the database
            try {
              const db = getPool();
              const [rows] = await db.execute(
                'SELECT id FROM domain_pages WHERE domain_id = ? AND url = ? ORDER BY id DESC LIMIT 1',
                [domainId, url]
              );
              
              if (rows.length > 0) {
                pageId = rows[0].id;
                logger.info(`[CRAWLER] Found page ID ${pageId} for ${url}`);
              }
            } catch (dbError) {
              logger.error(`[CRAWLER] ❌ Error getting page ID: ${dbError.message}`);
            }
          }
          
          // Process images
          const imageExtractor = (await import('./contentExtractors/enhancedImageExtractor.js')).default;
          const imageResults = await imageExtractor.extract([{
            url,
            content: response.data,
            title,
            pageId: pageId  // Pass the page ID to the extractor
          }], domainId);  // Pass the domain ID to the extractor
          logger.info(`[CRAWLER] Extracted ${imageResults.all.length} images from ${url}`);
          
          // Process social media links
          const socialMediaExtractor = (await import('./contentExtractors/socialMediaExtractor.js')).default;
          const socialResults = await socialMediaExtractor.extractSocialMedia(url, response.data, domainId, response.data);
          logger.info(`[CRAWLER] Extracted ${socialResults.links.length} social links from ${url}`);
          
          // Process schema.org structured data
          const schemaExtractor = (await import('./contentExtractors/schemaMarkupExtractor.js')).default;
          
          // Now call the schema extractor with the pageId
          const schemaResults = await schemaExtractor.extractSchemaMarkup(url, response.data, domainId, pageId);
          if (schemaResults.markup.length > 0) {
            logger.info(`[CRAWLER] Extracted ${schemaResults.markup.length} schema.org items from ${url}`);
            
            // Log the most common schema types found
            const schemaTypes = [...new Set(schemaResults.markup.map(item => item.schema_type))];
            logger.info(`[CRAWLER] Schema types found: ${schemaTypes.slice(0, 5).join(', ')}${schemaTypes.length > 5 ? '...' : ''}`);
          }
          
          // Process ISBNs on the page - add ISBN extractor here
          const isbnExtractor = (await import('./contentExtractors/isbnExtractor.js')).default;
          const isbnResults = await isbnExtractor.extract([{
            url,
            content: response.data,
            title,
            pageId: pageId
          }], domainId);
          
          if (isbnResults && isbnResults.isbns.length > 0) {
            logger.info(`[CRAWLER] [ISBN] Extracted ${isbnResults.isbns.length} ISBNs from ${url}`);
            
            // ISBNs are now saved directly in the extract method if domainId is provided
          }
          
          // Also extract ISBNs from all URLs found on the page (links, images, etc.)
          const urlIsbnResults = await isbnExtractor.extractIsbnFromPageUrls(url, response.data, domainId, pageId);
          if (urlIsbnResults && urlIsbnResults.urlIsbns && urlIsbnResults.urlIsbns.length > 0) {
            logger.info(`[CRAWLER] [ISBN] Found ${urlIsbnResults.urlIsbns.length} ISBNs in URLs on page ${url}`);
            
            // ISBNs from URLs are now saved directly inside the extractIsbnFromPageUrls function
          }
          
          // Process podcast content
          const podcastExtractor = (await import('./contentExtractors/podcastExtractor.js')).default;
          // Pass the normalizedDomain to the extractor
          const podcastResults = await podcastExtractor.extractFromUrl(url, response.data, domainId, normalizedDomain);
          
          if (podcastResults && podcastResults.feeds && podcastResults.feeds.length > 0) {
            logger.info(`[CRAWLER] [PODCAST] Found ${podcastResults.feeds.length} podcast feeds on ${url}`);
            
            // Log feed details
            podcastResults.feeds.forEach((feed, index) => {
              logger.info(`[CRAWLER] [PODCAST] Feed ${index+1}: ${feed.title} - ${feed.url} (Validated: ${feed.validated ? 'Yes' : 'No'})`);
            });
          }
          
          if (podcastResults && podcastResults.episodes && podcastResults.episodes.length > 0) {
            logger.info(`[CRAWLER] [PODCAST] Found ${podcastResults.episodes.length} podcast episodes on ${url}`);
          }
          
          // Additional extractors can be added here
        } catch (extractionError) {
          logger.error(`[CRAWLER] ❌ Error during content extraction for ${url}: ${extractionError.message}`);
        }
      }
      
      // Increment crawled count
      crawledCount++;
      
      // Increment priority pages count if this was a priority URL
      if (priority > 0) {
        priorityPagesCount++;
      }
      
      // Track this URL in the crawl_tracking table
      if (domainId) {
        await domainDataRepository.trackCrawledUrl(domainId, url);
      }
      
      // If not at max depth, queue links for crawling
      if (currentDepth < depth) {
        // Extract links
        const newLinks = [];
        $('a[href]').each((_, element) => {
          const href = $(element).attr('href');
          if (href) {
            try {
              const normalizedHref = normalizeUrl(href, baseUrl);
              
              // Check if the URL is valid, on the same domain, not already discovered, and not already in the queue
              if (normalizedHref && 
                  isSameDomain(normalizedHref, normalizedDomain) &&
                  !discoveredUrls.has(normalizedHref) && 
                  !urlQueue.some(item => item.url === normalizedHref)) {
                  
                // Determine priority for new URL
                let newPriority = 0;
                const linkUrl = new URL(normalizedHref);
                const linkPathname = linkUrl.pathname;
                
                // Check for priority URLs using exact path matching
                let matchedPriorityPattern = null;
                if (crawlOptions.priorityUrls.some(p => {
                  if (p === '/') {
                    // Special case for root: only match exactly '/'
                    if (linkPathname === '/') {
                      matchedPriorityPattern = p;
                      return true;
                    }
                    return false;
                  } else {
                    // Match exact path or exact path with trailing slash
                    if (linkPathname === p || linkPathname === p + '/') {
                      matchedPriorityPattern = p;
                      return true;
                    }
                    return false;
                  }
                })) {
                  newPriority = 1;
                  logger.info(`[CRAWLER] Found priority URL: ${normalizedHref} (matched pattern: '${matchedPriorityPattern}')`);
                }
                
                newLinks.push({ 
                  url: normalizedHref, 
                  depth: currentDepth + 1,
                  priority: newPriority
                });
              }
            } catch (urlError) {
              logger.warn(`[CRAWLER] Skipping invalid link found on ${url}: ${href} (${urlError.message})`);
            }
          }
        });
        
        // Add new links to queue with detailed logging
        if (newLinks.length > 0) {
          logger.info(`[CRAWLER] Found ${newLinks.length} new links on page ${url} (${newLinks.filter(l => l.priority > 0).length} high priority)`);
          urlQueue.push(...newLinks);
        }
      }
      
      // Log progress for every page
      logger.info(`[CRAWLER] 📊 Progress: ${crawledCount}/${crawlOptions.maxPages} pages crawled (${(crawledCount/crawlOptions.maxPages*100).toFixed(0)}%). Queue size: ${urlQueue.length}`);
      
    } catch (fetchError) {
      // Handle network errors and mark page as failed
      logger.error(`[CRAWLER] ❌ Failed to process ${url}: ${fetchError.message}`);
      
      if (domainId && jobId) {
        try {
          const db = getPool();
          await db.execute(
            `INSERT INTO domain_crawl_errors (domain_id, job_id, url, error_message, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [domainId, jobId, url, fetchError.message]
          );
        } catch (dbError) {
          logger.error(`[CRAWLER] ❌ Error saving crawl error: ${dbError.message}`);
        }
      }
    }
    
    // Add a small delay to avoid overwhelming the server
    // Use a random delay between min and max values
    const randomDelay = crawlOptions.crawlDelay.min + 
      Math.floor(Math.random() * (crawlOptions.crawlDelay.max - crawlOptions.crawlDelay.min));
    await new Promise(resolve => setTimeout(resolve, randomDelay));
  }
  
  // Get crawl statistics if domain ID is available
  if (domainId) {
    try {
      const stats = await domainDataRepository.getCrawlStats(domainId);
      logger.info(`[CRAWLER] 📊 Crawl statistics for ${domain}:`);
      logger.info(`[CRAWLER] - Total URLs tracked: ${stats.totalUrls}`);
      logger.info(`[CRAWLER] - URLs crawled today: ${stats.crawledToday}`);
      logger.info(`[CRAWLER] - Max crawl count: ${stats.maxCrawlCount}`);
      logger.info(`[CRAWLER] - Average crawl count: ${typeof stats.avgCrawlCount === 'number' ? stats.avgCrawlCount.toFixed(2) : '0.00'}`);
      logger.info(`[CRAWLER] - Priority pages crawled: ${priorityPagesCount}`);
    } catch (error) {
      logger.error(`[CRAWLER] ❌ Error getting crawl statistics: ${error.message}`);
    }
  }
  
  // Mark crawl as complete
  if (domainId && jobId) {
    await saveCrawlProgress(
      domainId,
      jobId,
      crawlOptions.maxPages,
      crawledCount,
      '',
      'complete'
    );
  }
  
  logger.info(`[CRAWLER] ✅ Completed discovery of ${pages.length} pages for ${domain}`);
  
  // Log the discovered URLs
  if (pages.length > 0) {
    logger.info(`[CRAWLER] 📋 Discovered ${pages.length} URLs for ${domain}:`);
    for (let i = 0; i < Math.min(10, pages.length); i++) {
      logger.info(`[CRAWLER]   ${i+1}. ${pages[i].url} (depth: ${pages[i].depth})`);
    }
    if (pages.length > 10) {
      logger.info(`[CRAWLER]   ... and ${pages.length - 10} more URLs`);
    }
  }
  
  return pages;
};

/**
 * Extract content from a page
 */
export const extractPageContent = async (url) => {
  logger.info(`Extracting content from ${url}`);
  
  try {
    // Fetch the page with retry logic
    const response = await fetchWithRetry(url);
    
    // Check if we have puppeteer results
    if (response.puppeteerResult) {
      return {
        url,
        title: response.puppeteerResult.title,
        content: response.puppeteerResult.text,
        links: response.puppeteerResult.links,
        images: response.puppeteerResult.images
      };
    }
    
    // Parse HTML
    const $ = cheerio.load(response.data);
    const title = $('title').text().trim() || url.split('/').pop() || 'Home Page';
    
    // Extract links
    const links = [];
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        links.push({
          url: href,
          text: text || href
        });
      }
    });
    
    // Extract main content
    const content = $('body').text().trim();
    
    // Extract images using the enhanced image extractor
    const imageExtractor = (await import('./contentExtractors/enhancedImageExtractor.js')).default;
    const imageResults = await imageExtractor.extract([{
      url,
      content: response.data,
      title
    }]);
    
    logger.info(`[CONTENT] Extracted ${imageResults.all.length} images from ${url}`);
    
    return {
      url,
      title,
      content,
      links,
      images: imageResults.all // Use the enhanced image results
    };
  } catch (error) {
    logger.error(`Error extracting content from ${url}: ${error.message}`);
    
    // Return minimal data on error
    return {
      url,
      title: url.split('/').pop() || 'Unknown',
      content: '',
      links: [],
      images: []
    };
  }
};

async function processSiteData(domainId, jobId, pages, options = {}) {
  try {
    logger.info(`[DISCOVERY] Processing ${pages.length} pages for domain ID ${domainId}`);
    
    // Extract domain name from first page URL
    const domainName = pages[0]?.url ? new URL(pages[0].url).hostname : '';
    logger.info(`[DISCOVERY] Domain name: ${domainName}`);
    
    // Save pages to database
    await savePagesToDatabase(domainId, pages);
    
    // Run all extraction tasks in parallel for efficiency
    const [images, videos, socialMedia, rss, blog, content, schemaMarkup] = await Promise.allSettled([
      // Extract images with enhanced extractor
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting images`);
          const imageExtractor = (await import('./contentExtractors/enhancedImageExtractor.js')).default;
          const imageResults = await imageExtractor.extract(pages);
          logger.info(`[DISCOVERY] Found ${imageResults.all.length} unique images`);
          return imageResults;
        } catch (error) {
          logger.error(`[DISCOVERY] Image extraction failed: ${error.message}`);
          return { all: [], byCategory: {} };
        }
      })(),
      
      // Extract videos
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting videos`);
          const videoExtractor = (await import('./contentExtractors/videoExtractor.js')).default;
          const videoResults = await videoExtractor.extract(pages);
          logger.info(`[DISCOVERY] Found ${videoResults.all.length} videos`);
          return videoResults;
        } catch (error) {
          logger.error(`[DISCOVERY] Video extraction failed: ${error.message}`);
          return { all: [], byCategory: {} };
        }
      })(),
      
      // Extract social media links with improved extractor
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting social media profiles`);
          const socialMediaExtractor = (await import('./contentExtractors/socialMediaExtractor.js')).default;
          
          // Use both HTML and raw_html for better extraction
          // Try each page, as social links might be in footers on different pages
          let allSocialLinks = [];
          
          for (const page of pages) {
            if (!page.content) continue;
            
            // Check if this is a likely page to have social links (homepage, about, contact)
            const isLikelySocialPage = 
              page.url.endsWith(domainName) || 
              page.url.endsWith(domainName + '/') ||
              page.url.includes('/about') || 
              page.url.includes('/contact') ||
              page.url.includes('/connect') ||
              page.url.includes('/follow');
            
            // Prioritize these pages for deeper scanning
            if (isLikelySocialPage) {
              logger.info(`[DISCOVERY] Scanning likely social media page: ${page.url}`);
              const socialResults = await socialMediaExtractor.extractSocialMedia(page.url, page.content, domainId, page.content);
              if (socialResults.links && socialResults.links.length > 0) {
                allSocialLinks.push(...socialResults.links);
                logger.info(`[DISCOVERY] Found ${socialResults.links.length} social links on ${page.url}`);
              }
            } else {
              // Quick scan for other pages
              const socialResults = await socialMediaExtractor.extractSocialMedia(page.url, page.content, domainId);
              if (socialResults.links && socialResults.links.length > 0) {
                allSocialLinks.push(...socialResults.links);
              }
            }
          }
          
          // Deduplicate by URL
          const seen = new Set();
          allSocialLinks = allSocialLinks.filter(link => {
            if (seen.has(link.url)) return false;
            seen.add(link.url);
            return true;
          });
          
          logger.info(`[DISCOVERY] Found ${allSocialLinks.length} unique social media profiles`);
          return { links: allSocialLinks };
        } catch (error) {
          logger.error(`[DISCOVERY] Social media extraction failed: ${error.message}`);
          return { links: [] };
        }
      })(),
      
      // Extract RSS feeds with improved extractor
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting RSS feeds`);
          const rssExtractor = (await import('./contentExtractors/rssExtractor.js')).default;
          const rssResults = await rssExtractor.extract(domainName, pages, domainId);
          logger.info(`[DISCOVERY] Found ${rssResults.feeds.length} RSS feeds with ${rssResults.recentItems.length} items`);
          return rssResults;
        } catch (error) {
          logger.error(`[DISCOVERY] RSS extraction failed: ${error.message}`);
          return { feeds: [], recentItems: [] };
        }
      })(),
      
      // Extract blog info with enhanced blog extractor
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting blog content with enhanced detection`);
          const blogExtractor = (await import('./contentExtractors/blogExtractor.js')).default;
          const blogResults = await blogExtractor.extract(pages);
          
          if (blogResults.hasBlog) {
            logger.info(`[DISCOVERY] Found blog at ${blogResults.blogUrl} with ${blogResults.articles.length} articles`);
            // Save blog information to database
            if (domainId) {
              await blogExtractor.saveBlogInfo(domainId, blogResults);
              logger.info(`[DISCOVERY] Saved blog information to database`);
            }
          } else {
            logger.info(`[DISCOVERY] No blog found on website`);
          }
          
          // Log RSS feeds found during blog detection if any
          if (blogResults.rssFeeds && blogResults.rssFeeds.length > 0) {
            logger.info(`[DISCOVERY] Blog extractor found ${blogResults.rssFeeds.length} potential RSS feeds`);
          }
          
          return blogResults;
        } catch (error) {
          logger.error(`[DISCOVERY] Blog extraction failed: ${error.message}`);
          return { hasBlog: false, blogUrl: null, articles: [] };
        }
      })(),
      
      // Extract text content
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting text content`);
          const contentExtractor = (await import('./contentExtractors/contentExtractor.js')).default;
          const contentResults = await contentExtractor.extract(pages, domainId);
          logger.info(`[DISCOVERY] Extracted text content for ${contentResults.length} pages`);
          return contentResults;
        } catch (error) {
          logger.error(`[DISCOVERY] Content extraction failed: ${error.message}`);
          return [];
        }
      })(),
      
      // Extract schema.org structured data
      (async () => {
        try {
          logger.info(`[DISCOVERY] Extracting schema.org structured data`);
          const schemaExtractor = (await import('./contentExtractors/schemaMarkupExtractor.js')).default;
          const schemaResults = await schemaExtractor.extract(pages);
          
          // Process extracted schema data for database storage
          if (domainId && schemaResults.markup && schemaResults.markup.length > 0) {
            logger.info(`[DISCOVERY] Found ${schemaResults.markup.length} schema.org items`);
            
            // Count schema types for logging
            const schemaTypes = {};
            schemaResults.markup.forEach(item => {
              schemaTypes[item.schema_type] = (schemaTypes[item.schema_type] || 0) + 1;
            });
            
            // Log the most common schema types
            const topSchemaTypes = Object.entries(schemaTypes)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([type, count]) => `${type} (${count})`)
              .join(', ');
            
            logger.info(`[DISCOVERY] Top schema.org types: ${topSchemaTypes}`);
            
            // Store schema data for each page
            for (const page of pages) {
              if (!page.pageId) continue;
              
              const pageSchemaItems = schemaResults.markup.filter(item => item.url === page.url);
              if (pageSchemaItems.length > 0) {
                try {
                  await schemaExtractor.processPage({
                    url: page.url,
                    content: page.content,
                    domainId: domainId,
                    pageId: page.pageId
                  });
                  logger.info(`[DISCOVERY] Saved ${pageSchemaItems.length} schema items for ${page.url}`);
                } catch (error) {
                  logger.error(`[DISCOVERY] Error saving schema data for ${page.url}: ${error.message}`);
                }
              }
            }
          } else {
            logger.info(`[DISCOVERY] No schema.org markup found`);
          }
          
          return schemaResults;
        } catch (error) {
          logger.error(`[DISCOVERY] Schema.org extraction failed: ${error.message}`);
          return { markup: [] };
        }
      })()
    ]);
    
    // Process extraction results
    const processedData = {
      domainId,
      jobId,
      images: images.status === 'fulfilled' ? images.value : { all: [], byCategory: {} },
      videos: videos.status === 'fulfilled' ? videos.value : { all: [], byCategory: {} },
      socialMedia: socialMedia.status === 'fulfilled' ? socialMedia.value : { links: [] },
      rss: rss.status === 'fulfilled' ? rss.value : { feeds: [], recentItems: [] },
      blog: blog.status === 'fulfilled' ? blog.value : { hasBlog: false, blogUrl: null, articles: [] },
      content: content.status === 'fulfilled' ? content.value : [],
      schemaMarkup: schemaMarkup.status === 'fulfilled' ? schemaMarkup.value : { markup: [] }
    };
    
    // Save extraction results to database
    await saveSiteDataToDatabase(processedData);
    
    // Additional extraction for all discovered URLs (not just crawled pages)
    try {
      logger.info(`[DISCOVERY] Extracting additional data from all discovered URLs`);
      
      // Extract ISBNs from all discovered URLs
      const isbnExtractor = await import('./contentExtractors/isbnExtractor.js');
      const urlIsbnResults = await isbnExtractor.extractFromDiscoveredUrls(domainId, jobId);
      logger.info(`[DISCOVERY] Found ${urlIsbnResults.length} additional ISBNs from all discovered URLs`);
      
      // Add these to the processedData (for reporting purposes)
      if (urlIsbnResults.length > 0) {
        if (!processedData.additionalData) {
          processedData.additionalData = {};
        }
        processedData.additionalData.urlIsbns = urlIsbnResults;
      }
    } catch (additionalError) {
      logger.error(`[DISCOVERY] Error during additional data extraction: ${additionalError.message}`);
    }
    
    logger.info(`[DISCOVERY] Processed site data for domain ID ${domainId}`);
    return processedData;
  } catch (error) {
    logger.error(`[DISCOVERY] Error processing site data: ${error.message}`);
    logger.error(error.stack);
    throw error;
  }
}

/**
 * Helper to get domain name from URL
 */
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return '';
  }
}

export async function discover(url, options = {}) {
  try {
    // ... existing code for crawling and validation ...
    
    // After pages have been crawled, call processSiteData
    
    // Extract content and metadata from crawled pages
    const results = await processSiteData(domainId, jobId, pages, options);
    
    // If direct output is requested, return results right away
    if (options.returnResults) {
      return { 
        success: true, 
        message: 'Discovery completed successfully',
        crawlId: jobId,
        domainId: domainId,
        url: url,
        pages: pages.length,
        results
      };
    }
    
    // Otherwise, just return the job and domain IDs
    return {
      success: true,
      message: 'Discovery job started successfully',
      crawlId: jobId,
      domainId: domainId
    };
  } catch (error) {
    logger.error(`[DISCOVERY] Error during discovery process: ${error.message}`);
    logger.error(error.stack);
    
    return {
      success: false,
      message: `Discovery failed: ${error.message}`,
      error: error.message
    };
  }
} 