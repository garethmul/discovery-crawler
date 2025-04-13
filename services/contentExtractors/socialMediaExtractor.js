import * as cheerio from 'cheerio';
import { getPool } from '../../database/db.js';
import logger from '../../utils/logger.js';

// Common social media domains
const SOCIAL_DOMAINS = [
  { domain: 'facebook.com', platform: 'Facebook' },
  { domain: 'twitter.com', platform: 'Twitter' },
  { domain: 'instagram.com', platform: 'Instagram' },
  { domain: 'linkedin.com', platform: 'LinkedIn' },
  { domain: 'youtube.com', platform: 'YouTube' },
  { domain: 'youtu.be', platform: 'YouTube' },
  { domain: 'tiktok.com', platform: 'TikTok' },
  { domain: 'pinterest.com', platform: 'Pinterest' },
  { domain: 'snapchat.com', platform: 'Snapchat' },
  { domain: 'discord.gg', platform: 'Discord' },
  { domain: 'reddit.com', platform: 'Reddit' },
  { domain: 'twitch.tv', platform: 'Twitch' },
  { domain: 'medium.com', platform: 'Medium' },
  { domain: 'telegram.org', platform: 'Telegram' },
  { domain: 't.me', platform: 'Telegram' },
  { domain: 'github.com', platform: 'GitHub' },
  { domain: 'vimeo.com', platform: 'Vimeo' },
  { domain: 'spotify.com', platform: 'Spotify' },
  { domain: 'soundcloud.com', platform: 'SoundCloud' },
  { domain: 'apple.com/music', platform: 'Apple Music' },
  { domain: 'apple.com/podcast', platform: 'Apple Podcasts' },
  { domain: 'tumblr.com', platform: 'Tumblr' },
  { domain: 'threads.net', platform: 'Threads' },
  { domain: 'substack.com', platform: 'Substack' },
];

// Common CSS class names and patterns for social media links
const SOCIAL_SELECTORS = [
  'a[href*="facebook.com"]',
  'a[href*="twitter.com"]',
  'a[href*="instagram.com"]',
  'a[href*="linkedin.com"]',
  'a[href*="youtube.com"]',
  'a[href*="youtu.be"]',
  'a[href*="tiktok.com"]',
  'a[href*="pinterest.com"]',
  'a[href*="snapchat.com"]',
  '.social a',
  '.socials a',
  '.social-links a',
  '.social-media a',
  '.social-icons a',
  '.social-nav a',
  '.footer-social a',
  '.footerSocial a',
  '[class*="social"] a',
  '[class*="Social"] a',
  '.share-buttons a',
  '.follow-us a',
  '.connect a',
  'footer a[target="_blank"]'
];

/**
 * Extract social media links from HTML content
 */
export const extractSocialMedia = async (url, html, domainId = null, raw_html = '') => {
  try {
    if (!html && !raw_html) {
      logger.warn(`[SOCIAL] No HTML content provided for ${url}`);
      return { links: [] };
    }

    const $ = cheerio.load(html || raw_html);
    
    // Find all links on the page
    const allLinks = $('a[href]');
    logger.info(`[SOCIAL] Found ${allLinks.length} total links on the page to scan`);
    
    // Direct matching against known social domains
    const linkCandidates = [];
    allLinks.each((index, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      
      // Normalize the URL
      let fullUrl = href;
      if (href.startsWith('/')) {
        // Handle relative URLs
        try {
          const urlObj = new URL(url);
          fullUrl = `${urlObj.protocol}//${urlObj.hostname}${href}`;
        } catch (e) {
          fullUrl = href;
        }
      } else if (!href.startsWith('http')) {
        // Handle protocol-relative URLs
        if (href.startsWith('//')) {
          fullUrl = `https:${href}`;
        } else {
          // Some other relative format
          try {
            fullUrl = new URL(href, url).href;
          } catch (e) {
            fullUrl = href;
          }
        }
      }
      
      // Save the link for further inspection
      linkCandidates.push({
        url: fullUrl,
        element: element,
        text: $(element).text().trim(),
        classes: $(element).attr('class') || ''
      });
    });
    
    // Process the link candidates
    const directMatches = [];
    const indirectMatches = [];

    // Check for direct domain matches
    logger.info(`[SOCIAL] Scanning ${SOCIAL_DOMAINS.length} known social media domains`);
    
    // First pass: look for exact matches to known social domains
    linkCandidates.forEach(link => {
      try {
        const urlLower = link.url.toLowerCase();
        
        for (const socialDomain of SOCIAL_DOMAINS) {
          if (urlLower.includes(socialDomain.domain)) {
            // Parse handle from URL if possible
            let handle = null;
            try {
              const urlObj = new URL(link.url);
              const pathParts = urlObj.pathname.split('/').filter(part => part);
              
              if (pathParts.length > 0) {
                // For most social platforms, the handle is the first path segment
                handle = pathParts[0];
                
                // Special case for Twitter/X where @username might be in text
                if (socialDomain.platform === 'Twitter' && link.text.includes('@')) {
                  const twitterHandle = link.text.match(/@([A-Za-z0-9_]+)/);
                  if (twitterHandle && twitterHandle[1]) {
                    handle = twitterHandle[1];
                  }
                }
              }
            } catch (e) {
              // Couldn't parse URL, continue with null handle
            }
            
            directMatches.push({
              platform: socialDomain.platform,
              url: link.url,
              handle: handle,
              text: link.text
            });
            break;
          }
        }
      } catch (e) {
        // Skip this link if there's an error processing it
      }
    });
    
    logger.info(`[SOCIAL] Found ${directMatches.length} direct matches for social media profiles`);
    
    // Second pass: look for indirect matches using CSS selectors
    let selectorMatches = 0;
    
    // Use common selectors to look for social links
    for (const selector of SOCIAL_SELECTORS) {
      try {
        $(selector).each((i, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          
          // Check if this is already in our direct matches
          const isDuplicate = directMatches.some(match => match.url === href);
          if (isDuplicate) return;
          
          // Try to determine platform from classes or link text
          const classList = $(el).attr('class') || '';
          const linkText = $(el).text().trim();
          
          // Improved URL normalization
          let normalizedUrl = href;
          try {
            if (href.startsWith('/')) {
              // Handle relative URLs
              const baseUrl = new URL(url);
              normalizedUrl = `${baseUrl.protocol}//${baseUrl.hostname}${href}`;
            } else if (!href.startsWith('http')) {
              if (href.startsWith('//')) {
                normalizedUrl = `https:${href}`;
              } else {
                // Handle other relative formats
                const baseUrl = new URL(url);
                normalizedUrl = new URL(href, baseUrl.origin).href;
              }
            }
          } catch (e) {
            logger.warn(`[SOCIAL] Could not normalize URL ${href}: ${e.message}`);
            return; // Skip this link if we can't normalize the URL
          }
          
          let platform = null;
          
          // Check class names for platform hints
          if (classList.toLowerCase().includes('facebook')) platform = 'Facebook';
          else if (classList.toLowerCase().includes('twitter')) platform = 'Twitter';
          else if (classList.toLowerCase().includes('instagram')) platform = 'Instagram';
          else if (classList.toLowerCase().includes('linkedin')) platform = 'LinkedIn';
          else if (classList.toLowerCase().includes('youtube')) platform = 'YouTube';
          else if (classList.toLowerCase().includes('pinterest')) platform = 'Pinterest';
          // ...etc for other platforms
          
          // If still unknown, check link text
          if (!platform) {
            if (linkText.toLowerCase().includes('facebook')) platform = 'Facebook';
            else if (linkText.toLowerCase().includes('twitter')) platform = 'Twitter';
            else if (linkText.toLowerCase().includes('instagram')) platform = 'Instagram';
            else if (linkText.toLowerCase().includes('linkedin')) platform = 'LinkedIn';
            else if (linkText.toLowerCase().includes('youtube')) platform = 'YouTube';
            // ...etc for other platforms
          }
          
          // Include links that appear to be social even if we can't determine platform
          if (platform || classList.toLowerCase().includes('social') || href.includes('//t.co/')) {
            indirectMatches.push({
              platform: platform || 'Unknown',
              url: normalizedUrl,
              handle: null,
              text: linkText,
              selector: selector
            });
            selectorMatches++;
          }
        });
      } catch (e) {
        logger.error(`[SOCIAL] Error processing selector ${selector}: ${e.message}`);
      }
    }
    
    logger.info(`[SOCIAL] Found ${selectorMatches} potential social links via CSS selectors`);
    
    // Combine and deduplicate results
    const combinedLinks = [...directMatches];
    
    indirectMatches.forEach(match => {
      // Only add if not already present
      const isDuplicate = combinedLinks.some(existing => existing.url === match.url);
      if (!isDuplicate) {
        combinedLinks.push(match);
      }
    });
    
    // Save to database if domainId is provided
    if (domainId) {
      await saveSocialMediaToOpengraph(domainId, combinedLinks);
    }
    
    return { links: combinedLinks };
  } catch (error) {
    logger.error(`[SOCIAL] Error extracting social media links from ${url}: ${error.message}`);
    logger.error(`[SOCIAL] Error stack: ${error.stack}`);
    return { links: [] };
  }
};

/**
 * Save social media links to the opengraph table
 */
async function saveSocialMediaToOpengraph(domainId, links) {
  try {
    const db = getPool();
  } catch (error) {
    logger.error(`[SOCIAL] Error getting database connection: ${error.message}`);
    return;
  }
  
  const db = getPool();
  
  for (const link of links) {
    try {
      // First check if this URL already exists for this domain
      const [exists] = await db.execute(
        'SELECT id FROM domain_opengraph WHERE domain_id = ? AND url = ?',
        [domainId, link.url]
      );
      
      if (exists.length === 0) {
        // Insert new record - removed handle column which doesn't exist in the schema
        await db.execute(
          `INSERT INTO domain_opengraph 
           (domain_id, type, title, url, is_social_profile, platform)
           VALUES (?, ?, ?, ?, 1, ?)`,
          [
            domainId,
            'social_profile',
            link.text || link.platform,
            link.url,
            link.platform
          ]
        );
        logger.info(`[SOCIAL] Saved ${link.platform} profile to database: ${link.url}`);
      }
    } catch (error) {
      logger.error(`[SOCIAL] Error saving social media link to database: ${error.message}`);
    }
  }
}

/**
 * Filter for social links that have been saved to opengraph table
 */
export const getSocialMediaLinks = async (domainId) => {
  try {
    const db = getPool();
    
    const [rows] = await db.execute(
      `SELECT * FROM domain_opengraph 
       WHERE domain_id = ? AND is_social_profile = 1`,
      [domainId]
    );
    
    return rows;
  } catch (error) {
    logger.error(`[SOCIAL] Error getting social media links: ${error.message}`);
    return [];
  }
};

/**
 * Extract social media links from a list of pages
 * @param {Array} pages - List of pages to extract from
 * @returns {Promise<Array>} - List of social media links
 */
export const extract = async (pages) => {
  try {
    logger.info(`[SOCIAL] Starting social media extraction from ${pages.length} pages`);
    
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return { links: [] };
    }
    
    // Extract from each page and combine results
    const allLinks = [];
    
    for (const page of pages) {
      if (!page.url || !page.content) continue;
      
      const results = await extractSocialMedia(page.url, page.content);
      if (results && results.links && results.links.length > 0) {
        allLinks.push(...results.links);
      }
    }
    
    // Deduplicate links by URL
    const uniqueLinks = [];
    const seenUrls = new Set();
    
    for (const link of allLinks) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        uniqueLinks.push(link);
      }
    }
    
    logger.info(`[SOCIAL] Found ${uniqueLinks.length} unique social media links from ${pages.length} pages`);
    return { links: uniqueLinks };
  } catch (error) {
    logger.error(`[SOCIAL] Error extracting social media from pages: ${error.message}`);
    return { links: [] };
  }
};

export default {
  extractSocialMedia,
  getSocialMediaLinks,
  extract
}; 