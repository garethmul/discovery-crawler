/**
 * RSS Feed Extractor
 * 
 * This module extracts RSS feed information from a website including:
 * - RSS feed URLs
 * - Feed titles
 * - Recent items from the feeds
 */

import logger from '../../utils/logger.js';
import * as cheerio from 'cheerio';
import axios from 'axios';
import Parser from 'rss-parser';
import { normalizeUrl } from '../../utils/urlUtils.js';
import { getPool } from '../../database/db.js';

// Increase timeout and add more fields for the RSS parser
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
  },
  timeout: 15000,
  customFields: {
    feed: ['language', 'copyright', 'lastBuildDate', 'ttl', 'image'],
    item: ['enclosure', 'content:encoded', 'media:content', 'media:thumbnail', 'description']
  }
});

/**
 * Extract RSS feeds from a website
 * @param {string} domain The domain being scraped
 * @param {Array} pages Array of page content objects
 * @param {number} domainId Optional domain ID for database storage
 * @returns {Object} RSS feed data
 */
export async function extract(domain, pages, domainId = null) {
  try {
    logger.info(`[RSS] Extracting RSS feeds for ${domain}`);
    
    // Initialize result structure
    const result = {
      feeds: [],
      recentItems: []
    };
    
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      logger.warn(`[RSS] No pages provided for ${domain}`);
      return result;
    }
    
    // Find potential RSS feed links
    const feedUrls = findFeedUrls(domain, pages);
    
    if (feedUrls.length === 0) {
      logger.info(`[RSS] No RSS feeds found for ${domain}`);
      return result;
    }
    
    logger.info(`[RSS] Found ${feedUrls.length} potential RSS feeds for ${domain}`);
    
    // Create a set for tracking processed feeds to avoid duplicates
    const processedFeedUrls = new Set();
    
    // Process each feed URL
    const feedPromises = feedUrls.map(async (feedUrl) => {
      try {
        // Skip if already processed
        if (processedFeedUrls.has(feedUrl)) {
          return null;
        }
        
        const feedData = await parseFeed(feedUrl);
        
        if (feedData) {
          processedFeedUrls.add(feedUrl);
          
          // Add to feeds list
          const feedInfo = {
            url: feedUrl,
            title: feedData.title || 'Untitled Feed',
            description: feedData.description || '',
            link: feedData.link || feedUrl,
            language: feedData.language || null,
            lastUpdated: feedData.lastBuildDate || null,
            generator: feedData.generator || null,
            copyright: feedData.copyright || null,
            feedType: feedData.feedType || 'RSS'
          };
          
          result.feeds.push(feedInfo);
          
          // Save to database if domainId is provided
          if (domainId) {
            await saveFeedToDatabase(domainId, feedInfo);
          }
          
          // Add recent items
          if (feedData.items && feedData.items.length > 0) {
            const items = feedData.items.slice(0, 10).map(item => ({
              title: item.title || 'Untitled Item',
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || null,
              content: item.content || item.contentSnippet || item['content:encoded'] || item.description || '',
              categories: item.categories || [],
              author: item.creator || item.author || item['dc:creator'] || null
            }));
            
            result.recentItems.push(...items);
            
            // Save items to database if domainId is provided
            if (domainId) {
              await saveFeedItemsToDatabase(domainId, feedUrl, items);
            }
          }
          
          return feedInfo;
        }
        return null;
      } catch (feedError) {
        logger.warn(`[RSS] Error parsing feed ${feedUrl}: ${feedError.message}`);
        return null;
      }
    });
    
    // Wait for all feed processing to complete
    await Promise.all(feedPromises);
    
    // Sort recent items by date (newest first)
    result.recentItems.sort((a, b) => {
      if (!a.pubDate) return 1;
      if (!b.pubDate) return -1;
      return new Date(b.pubDate) - new Date(a.pubDate);
    });
    
    // Limit to most recent 20 items
    result.recentItems = result.recentItems.slice(0, 20);
    
    logger.info(`[RSS] Successfully extracted ${result.feeds.length} RSS feeds with ${result.recentItems.length} recent items`);
    
    return result;
  } catch (error) {
    logger.error(`[RSS] Error: ${error.message}`);
    logger.error(error.stack);
    return { feeds: [], recentItems: [] };
  }
}

/**
 * Find all potential RSS feed URLs from the pages
 * @param {string} domain The domain being scraped
 * @param {Array} pages Array of page content objects
 * @returns {Array} List of potential RSS feed URLs
 */
function findFeedUrls(domain, pages) {
  const feedUrls = new Set();
  
  // Check main page first (usually index 0)
  const mainPage = pages.find(page => 
    page.url === `https://${domain}` || 
    page.url === `http://${domain}` ||
    page.url === `https://www.${domain}` ||
    page.url === `http://www.${domain}` ||
    (page.url && page.url.endsWith(domain + '/'))
  ) || pages[0];
  
  if (mainPage && (mainPage.content || mainPage.raw_html)) {
    const $ = cheerio.load(mainPage.content || mainPage.raw_html);
    
    // Look for RSS links in the head
    $('link[type="application/rss+xml"], link[type="application/atom+xml"], link[rel="alternate"][type*="xml"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        feedUrls.add(normalizeUrl(href, mainPage.url));
      }
    });
    
    // Look for common RSS feed paths
    const commonPaths = [
      '/feed',
      '/rss',
      '/feed.xml',
      '/rss.xml',
      '/atom.xml',
      '/feed/atom',
      '/feed/rss',
      '/blog/feed',
      '/blog/rss',
      '/news/feed',
      '/news/rss',
      '/index.xml',
      '/articles.rss',
      '/sitemap.xml',
      '/feed/atom',
      '/feeds/posts/default',
      '/rss.aspx',
      '/rss/feed',
      '/podcast.xml',
      '/podcast.rss',
      '/podcasts'
    ];
    
    for (const path of commonPaths) {
      feedUrls.add(`https://${domain}${path}`);
    }
    
    // Check for web.archive.org links
    if (domain.includes('web.archive.org')) {
      const match = domain.match(/web\.archive\.org\/web\/\d+\/(https?:\/\/)?(.+)/);
      if (match && match[2]) {
        const originalDomain = match[2];
        for (const path of commonPaths) {
          feedUrls.add(`https://web.archive.org/web/*/https://${originalDomain}${path}`);
        }
      }
    }
  }
  
  // Search all pages for RSS links
  for (const page of pages) {
    if (page.content || page.raw_html) {
      const $ = cheerio.load(page.content || page.raw_html);
      
      // Look for RSS links or anchors with various indicators
      $('a[href*="rss"], a[href*="feed"], a[href*="atom"], a[href*="xml"], a:contains("RSS"), a:contains("Feed"), a[href*="podcast"]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().toLowerCase();
        
        // Exclude social media feed links
        if (href && 
            !href.includes('facebook.com/') && 
            !href.includes('twitter.com/') && 
            !href.includes('instagram.com/') &&
            !href.includes('youtube.com/') &&
            !href.includes('pinterest.com/') &&
            !href.includes('linkedin.com/')) {
          
          // Check for additional RSS indicators
          const isLikelyRss = 
            href.includes('.xml') || 
            href.includes('/rss') || 
            href.includes('/feed') || 
            href.includes('/atom') ||
            text.includes('rss') || 
            text.includes('feed') || 
            text.includes('subscribe') ||
            text.includes('podcast');
            
          if (isLikelyRss) {
            feedUrls.add(normalizeUrl(href, page.url));
          }
        }
      });
      
      // Look for RSS icons and adjacent links
      $('img[src*="feed"], img[src*="rss"], img[alt*="RSS"], img[alt*="Feed"], i.fa-rss, span.fa-rss, i.rss, .rss-icon').each((i, el) => {
        const $el = $(el);
        // Check if within an anchor tag
        if ($el.parent('a').length > 0) {
          const href = $el.parent('a').attr('href');
          if (href) {
            feedUrls.add(normalizeUrl(href, page.url));
          }
        }
        // Check adjacent elements
        $el.siblings('a').each((_, adjacent) => {
          const href = $(adjacent).attr('href');
          if (href) {
            feedUrls.add(normalizeUrl(href, page.url));
          }
        });
      });
    }
  }
  
  // Filter out invalid URLs and duplicates
  const filteredUrls = [...feedUrls].filter(url => {
    try {
      new URL(url); // Validate URL format
      return true;
    } catch (e) {
      return false;
    }
  });
  
  return filteredUrls;
}

/**
 * Parse an RSS feed and return its data
 * @param {string} url The feed URL
 * @returns {Object|null} Feed data or null if parsing failed
 */
async function parseFeed(url) {
  try {
    // First, check if the URL returns valid XML
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      timeout: 15000,
      responseType: 'text'
    });
    
    const contentType = response.headers['content-type'] || '';
    const data = response.data || '';
    
    // Skip if clearly not a feed
    if (!contentType.includes('xml') && 
        !contentType.includes('rss') && 
        !contentType.includes('atom') &&
        !contentType.includes('text/html') && // Some feeds are served with text/html
        !data.includes('<rss') &&
        !data.includes('<feed') &&
        !data.includes('<channel')) {
      logger.debug(`[RSS] URL ${url} does not appear to be a feed (content-type: ${contentType})`);
      return null;
    }
    
    // Parse the feed
    const feed = await parser.parseString(data, { baseURL: url });
    
    // Validate that this is actually a feed
    if (!feed.items || feed.items.length === 0) {
      if (!feed.title && !feed.description) {
        logger.debug(`[RSS] URL ${url} parsed but doesn't appear to be a valid feed`);
        return null;
      }
    }
    
    return feed;
  } catch (error) {
    logger.debug(`[RSS] Failed to parse feed ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Save RSS feed information to database
 * @param {number} domainId Domain ID
 * @param {Object} feed Feed information
 */
async function saveFeedToDatabase(domainId, feed) {
  try {
    const db = getPool();
    
    // Check if entry already exists
    const [exists] = await db.execute(
      'SELECT id FROM domain_feeds WHERE domain_id = ? AND feed_url = ?',
      [domainId, feed.url]
    );
    
    if (exists.length === 0) {
      // Insert new record
      await db.execute(
        `INSERT INTO domain_feeds 
         (domain_id, feed_url, title, description, link, language, last_updated, feed_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          domainId,
          feed.url,
          feed.title,
          feed.description,
          feed.link,
          feed.language,
          feed.lastUpdated,
          feed.feedType
        ]
      );
      logger.info(`[RSS] Saved feed ${feed.url} to database`);
    } else {
      // Update existing record
      await db.execute(
        `UPDATE domain_feeds SET 
         title = ?, description = ?, link = ?, language = ?, 
         last_updated = ?, feed_type = ?, updated_at = NOW()
         WHERE domain_id = ? AND feed_url = ?`,
        [
          feed.title,
          feed.description,
          feed.link,
          feed.language,
          feed.lastUpdated,
          feed.feedType,
          domainId,
          feed.url
        ]
      );
      logger.info(`[RSS] Updated feed ${feed.url} in database`);
    }
    
    return true;
  } catch (error) {
    logger.error(`[RSS] Error saving feed to database: ${error.message}`);
    return false;
  }
}

/**
 * Save RSS feed items to database
 * @param {number} domainId Domain ID
 * @param {string} feedUrl Feed URL
 * @param {Array} items Feed items
 */
async function saveFeedItemsToDatabase(domainId, feedUrl, items) {
  try {
    const db = getPool();
    
    // Get feed ID
    const [feedResult] = await db.execute(
      'SELECT id FROM domain_feeds WHERE domain_id = ? AND feed_url = ?',
      [domainId, feedUrl]
    );
    
    if (feedResult.length === 0) {
      logger.warn(`[RSS] Feed ${feedUrl} not found in database, cannot save items`);
      return false;
    }
    
    const feedId = feedResult[0].id;
    
    // Process each item
    for (const item of items) {
      // Check if item already exists (by link or title if link is missing)
      const [exists] = await db.execute(
        'SELECT id FROM domain_feed_items WHERE feed_id = ? AND (link = ? OR (link IS NULL AND title = ?))',
        [feedId, item.link, item.title]
      );
      
      if (exists.length === 0) {
        // Convert pubDate to proper datetime or null
        let pubDate = null;
        if (item.pubDate) {
          try {
            pubDate = new Date(item.pubDate).toISOString().slice(0, 19).replace('T', ' ');
          } catch (e) {
            // Leave as null if date parsing fails
          }
        }
        
        // Insert new item
        await db.execute(
          `INSERT INTO domain_feed_items 
           (feed_id, title, link, pub_date, content, author, categories, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            feedId,
            item.title,
            item.link,
            pubDate,
            item.content ? item.content.substring(0, 16000) : null, // Limit content length
            item.author,
            item.categories ? JSON.stringify(item.categories) : null
          ]
        );
      }
    }
    
    logger.info(`[RSS] Saved ${items.length} items from feed ${feedUrl} to database`);
    return true;
  } catch (error) {
    logger.error(`[RSS] Error saving feed items to database: ${error.message}`);
    return false;
  }
}

export default {
  extract
}; 