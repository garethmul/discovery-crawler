import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import axios from 'axios';
import { getPool } from '../../../config/database.js';

/**
 * Enhanced podcast extractor
 * Capable of following links to validate podcast RSS feeds
 */
const podcastExtractor = {
/**
 * Extract podcast information from pages
 */
  async extract(pages) {
  try {
      logger.info('[PODCAST] Extracting podcast information from ' + pages.length + ' pages');
    
    // First filter for podcast-related pages only
    const podcastPages = this.findPodcastPages(pages);
    
    if (podcastPages.length === 0) {
        logger.info('[PODCAST] No podcast pages found');
      return {
        feeds: [],
        episodes: []
      };
    }
      
      logger.info(`[PODCAST] Found ${podcastPages.length} potential podcast pages`);
    
    // Extract podcast feeds
      const feeds = await this.extractPodcastFeeds(podcastPages);
    
    // Extract podcast episodes
      const episodes = this.extractPodcastEpisodes(podcastPages);
    
    return {
      feeds,
      episodes
    };
  } catch (error) {
      logger.error(`[PODCAST] Error extracting podcast information: ${error.message}`);
    return {
      feeds: [],
      episodes: []
    };
  }
  },

  /**
   * Extract podcast content from a URL
   * @param {string} url - URL to extract podcast from
   * @param {string} html - HTML content (optional)
   * @param {number} domainId - Domain ID for saving to database
   * @param {string} domain - The normalized domain name being crawled
   * @returns {Object} Extracted podcast data
   */
  async extractFromUrl(url, html, domainId, domain) {
    try {
      logger.info(`[PODCAST] Extracting podcast content from ${url} for domain ${domain}`);

      // Get HTML content if not provided
      let content = html;
      if (!content) {
        try {
          const response = await axios.get(url, {
            timeout: 10000,
            maxContentLength: 10 * 1024 * 1024, // 10MB max
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          content = response.data;
        } catch (fetchError) {
          logger.error(`[PODCAST] Error fetching URL ${url}: ${fetchError.message}`);
          // Continue even if fetch fails, Eden API might still find something
        }
      }

      // --- Check if URL is direct feed ---
      let isDirectFeed = false;
      if (!content || (typeof content === 'string' && !content.trim().startsWith('<!DOCTYPE html') && !content.trim().startsWith('<html'))) {
         try {
           isDirectFeed = await this.validatePodcastFeed(url);
         } catch (validationError) {
             logger.warn(`[PODCAST] Error validating direct feed ${url}: ${validationError.message}`);
         }
      }

      if (isDirectFeed) {
        logger.info(`[PODCAST] URL is a direct podcast feed: ${url}`);
        try {
          const feedData = await this.parsePodcastFeed(url);
          if (feedData) {
             feedData.sourceUrl = url;
             feedData.discoverySource = 'direct_url';
             feedData.validated = true;
             // Save feed and episodes to database if domain ID provided
             let feedId = null;
             if (domainId) {
               feedId = await this.saveFeedToDatabase(feedData, domainId);
               if (feedId && feedData.episodes && feedData.episodes.length > 0) {
                 await this.saveEpisodesToDatabase(feedData.episodes, domainId, feedId);
               }
             }
             return { feeds: [feedData], episodes: feedData.episodes || [] };
          }
        } catch (parseError) {
          logger.error(`[PODCAST] Error parsing direct feed ${url}: ${parseError.message}`);
          // Fall through to other methods
        }
      }

      // --- Initialize feed collection ---
      const potentialFeedUrls = new Map(); // Map<string, { title: string, source: string }>

      // --- Call Eden API ---
      if (domain) {
          const edenApiUrl = `https://www.eden.co.uk/api/podcasts?search_type=domain&search_value=${domain}`;
          logger.info(`[PODCAST] Querying Eden API: ${edenApiUrl}`);
          try {
              const apiResponse = await axios.get(edenApiUrl, { timeout: 5000 });
              if (apiResponse.data && apiResponse.data.data && Array.isArray(apiResponse.data.data)) {
                  logger.info(`[PODCAST] Received ${apiResponse.data.data.length} potential feeds from Eden API for ${domain}`);
                  apiResponse.data.data.forEach(item => {
                      const feedUrl = item.url || item['2'];
                      const feedTitle = item.title || item['3'] || 'Untitled Feed';
                      if (feedUrl && typeof feedUrl === 'string' && feedUrl.startsWith('http')) {
                          if (!potentialFeedUrls.has(feedUrl)) {
                              potentialFeedUrls.set(feedUrl, { title: feedTitle, source: 'eden_api' });
                              logger.debug(`[PODCAST] Added potential feed from Eden: ${feedUrl} (${feedTitle})`);
                          }
                      }
                  });
              }
          } catch (apiError) {
              logger.error(`[PODCAST] Error calling Eden API for ${domain}: ${apiError.message}`);
          }
      } else {
          logger.warn(`[PODCAST] Domain not provided, skipping Eden API call for ${url}`);
      }

      // --- Extract from HTML Page (if content exists) ---
      let mp3Episodes = [];
      if (content) {
          const $ = cheerio.load(content);

          // Check if this page has podcast indicators (optional, we can still process API results)
          // const isRelevantPage = this.isPodcastPage($, url);
          // logger.info(`[PODCAST] isPodcastPage check for ${url}: ${isRelevantPage}`);

          // Find MP3 episodes on the page
          mp3Episodes = this.extractMP3Episodes($, url);
          logger.info(`[PODCAST] Found ${mp3Episodes.length} MP3 episodes on page ${url}`);

          // Extract feed URLs from the page
          const pageFeedUrls = this.extractFeedUrlsFromPage($, url);
          logger.info(`[PODCAST] Found ${pageFeedUrls.length} potential feed links on page ${url}`);
          pageFeedUrls.forEach(feedInfo => {
              if (feedInfo.url && typeof feedInfo.url === 'string' && feedInfo.url.startsWith('http')) {
                  if (!potentialFeedUrls.has(feedInfo.url)) {
                      potentialFeedUrls.set(feedInfo.url, { title: feedInfo.title || 'Untitled Feed', source: 'page' });
                      logger.debug(`[PODCAST] Added potential feed from page: ${feedInfo.url} (${feedInfo.title})`);
                  }
              }
          });
      } else {
          logger.info(`[PODCAST] No HTML content for ${url}, skipping page-based extraction.`);
      }


      // --- Process all potential feeds ---
      const processedFeeds = [];
      if (potentialFeedUrls.size > 0) {
          logger.info(`[PODCAST] Processing ${potentialFeedUrls.size} unique potential feed URLs...`);
          for (const [feedUrl, feedInfo] of potentialFeedUrls.entries()) {
              logger.debug(`[PODCAST] Processing potential feed: ${feedUrl} (Source: ${feedInfo.source})`);
              try {
                  const isValid = await this.validatePodcastFeed(feedUrl);
                  if (isValid) {
                      const feedData = await this.parsePodcastFeed(feedUrl);
                      if (feedData) {
                          feedData.url = feedUrl;
                          feedData.sourceUrl = url; // Page where this check was initiated
                          feedData.discoverySource = feedInfo.source;
                          feedData.validated = true;
                          processedFeeds.push(feedData);

                          // Save feed and episodes to database if domain ID provided
                          let feedId = null;
                          if (domainId) {
                              feedId = await this.saveFeedToDatabase(feedData, domainId);
                              if (feedId && feedData.episodes && feedData.episodes.length > 0) {
                                  await this.saveEpisodesToDatabase(feedData.episodes, domainId, feedId);
                              }
                          }
                      } else {
                           logger.warn(`[PODCAST] Feed validation passed but parsing failed for ${feedUrl}`);
                           processedFeeds.push({ url: feedUrl, title: feedInfo.title, sourceUrl: url, validated: false, discoverySource: feedInfo.source, error: 'Parsing failed' });
                      }
                  } else {
                      logger.debug(`[PODCAST] Feed URL failed validation: ${feedUrl}`);
                      processedFeeds.push({ url: feedUrl, title: feedInfo.title, sourceUrl: url, validated: false, discoverySource: feedInfo.source });
                  }
              } catch (feedError) {
                  logger.error(`[PODCAST] Error processing potential feed ${feedUrl}: ${feedError.message}`);
                   processedFeeds.push({ url: feedUrl, title: feedInfo.title, sourceUrl: url, validated: false, discoverySource: feedInfo.source, error: feedError.message });
              }
          }
      } else {
          logger.info(`[PODCAST] No potential feed URLs found from API or page for ${url}`);
      }

      // Save MP3 episodes found on the page to database if domain ID provided
      if (domainId && mp3Episodes.length > 0) {
        // Ensure episodes have discoverySource
        mp3Episodes.forEach(ep => ep.discoverySource = 'page_mp3');
        await this.saveEpisodesToDatabase(mp3Episodes, domainId);
      }

      // Return all discovered podcast content
      logger.info(`[PODCAST] Extraction for ${url} complete. Found ${processedFeeds.length} feeds and ${mp3Episodes.length} page episodes.`);
      return {
        feeds: processedFeeds,
        episodes: mp3Episodes // Only includes MP3s found directly on page, feed episodes are saved separately
      };

    } catch (error) {
      logger.error(`[PODCAST] Unexpected error extracting podcast from ${url}: ${error.message}`);
      logger.error(error.stack); // Log stack for detailed debugging
      return { feeds: [], episodes: [] };
    }
  },

  /**
   * Check if this is a podcast page
   */
  isPodcastPage($, url) {
    // Special diagnostic log to track each call and identify potential issues
    console.log(`📢 [PODCAST-DEBUG] Checking isPodcastPage for: ${url}`);
    console.log(`📢 [PODCAST-DEBUG] Using enhanced logging - implementation timestamp: ${new Date().toISOString()}`);
    
    // Keywords that often appear in podcast content
    const podcastKeywords = ['podcast', 'episodes', 'listen', 'audio', 'show', 'radio', 'subscribe', 'stream'];
    console.log(`📢 [PODCAST-DEBUG] Keywords being checked: ${podcastKeywords.join(', ')}`);
    
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.toLowerCase().split('/').filter(Boolean);
      console.log(`📢 [PODCAST-DEBUG] URL path segments: ${pathSegments.join(', ')}`);
      
      // Check if URL contains podcast keywords
      if (pathSegments.some(segment => podcastKeywords.includes(segment))) {
        const matchedKeyword = pathSegments.find(segment => podcastKeywords.includes(segment));
        console.log(`📢 [PODCAST-DEBUG] MATCH: URL path includes podcast keyword '${matchedKeyword}'`);
        logger.info(`[PODCAST] URL path includes podcast keyword '${matchedKeyword}': ${url}`);
        return true;
      } else {
        console.log(`📢 [PODCAST-DEBUG] No podcast keywords found in URL path segments`);
      }
      
      // Check page title and content for podcast indicators
      const title = $('title').text().toLowerCase();
      console.log(`📢 [PODCAST-DEBUG] Page title: "${title}"`);
      
      // Check if title contains podcast keywords
      if (podcastKeywords.some(keyword => title.includes(keyword))) {
        const matchedKeyword = podcastKeywords.find(keyword => title.includes(keyword));
        console.log(`📢 [PODCAST-DEBUG] MATCH: Page title includes podcast keyword '${matchedKeyword}'`);
        logger.info(`[PODCAST] Page title includes podcast keyword '${matchedKeyword}': ${title}`);
        return true;
      } else {
        console.log(`📢 [PODCAST-DEBUG] No podcast keywords found in page title`);
      }
      
      // Look for podcast-related headings (with expanded keyword set)
      const headings = $('h1, h2, h3, h4, h5').text().toLowerCase();
      console.log(`📢 [PODCAST-DEBUG] Page headings text: "${headings.substring(0, 100)}..." (truncated)`);
      
      if (podcastKeywords.some(keyword => headings.includes(keyword))) {
        const matchedKeyword = podcastKeywords.find(keyword => headings.includes(keyword));
        console.log(`📢 [PODCAST-DEBUG] MATCH: Page headings include podcast keyword '${matchedKeyword}'`);
        logger.info(`[PODCAST] Page headings include podcast keyword '${matchedKeyword}'`);
        return true;
      } else {
        console.log(`📢 [PODCAST-DEBUG] No podcast keywords found in page headings`);
      }
      
      // Check for MP3 links which could indicate a podcast episode listing
      let hasMP3Links = false;
      console.log(`📢 [PODCAST-DEBUG] Checking for MP3 links`);
      $('a[href$=".mp3"]').each((_, element) => {
        hasMP3Links = true;
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found MP3 link: ${$(element).attr('href')}`);
        logger.info(`[PODCAST] Found MP3 link on page: ${$(element).attr('href')}`);
        return false; // Break loop after first match
      });
      
      if (hasMP3Links) {
        return true;
      }
      
      // Log all checks for multimedia elements
      console.log(`📢 [PODCAST-DEBUG] Checking for audio elements: ${$('audio').length}`);
      console.log(`📢 [PODCAST-DEBUG] Checking for Spotify iframes: ${$('iframe[src*="spotify.com"]').length}`);
      console.log(`📢 [PODCAST-DEBUG] Checking for Apple Podcasts iframes: ${$('iframe[src*="apple.com/podcast"]').length}`);
      console.log(`📢 [PODCAST-DEBUG] Checking for XML links: ${$('a[href*=".xml"]').length}`);
      
      // Look for podcast players or feed links
      if ($('audio').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found audio element(s)`);
        logger.info(`[PODCAST] Found audio element(s) on page: ${url}`);
        return true;
      }
      if ($('iframe[src*="spotify.com"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Spotify iframe`);
        logger.info(`[PODCAST] Found Spotify iframe on page: ${url}`);
        return true;
      }
      if ($('iframe[src*="apple.com/podcast"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Apple Podcasts iframe`);
        logger.info(`[PODCAST] Found Apple Podcasts iframe on page: ${url}`);
        return true;
      }
      if ($('iframe[src*="google.com/podcast"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Google Podcasts iframe`);
        logger.info(`[PODCAST] Found Google Podcasts iframe on page: ${url}`);
        return true;
      }
      if ($('a[href*=".xml"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found XML feed link`);
        logger.info(`[PODCAST] Found XML feed link on page: ${url}`);
        return true;
      }
      if ($('a[href*="itunes.apple.com"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found iTunes link`);
        logger.info(`[PODCAST] Found iTunes link on page: ${url}`);
        return true;
      }
      if ($('a[href*="podcasts.apple.com"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Apple Podcasts link`);
        logger.info(`[PODCAST] Found Apple Podcasts link on page: ${url}`);
        return true;
      }
      if ($('a[href*="spotify.com/show"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Spotify show link`);
        logger.info(`[PODCAST] Found Spotify show link on page: ${url}`);
        return true;
      }
      if ($('a[href*="google.com/podcast"]').length > 0) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found Google Podcasts link`);
        logger.info(`[PODCAST] Found Google Podcasts link on page: ${url}`);
        return true;
      }
      
      // Check for podcast platform buttons/links (expanded set)
      console.log(`📢 [PODCAST-DEBUG] Checking for podcast platform links`);
      const platformPatterns = [
        'spotify.com', 'apple.com/podcast', 'podcasts.apple.com', 'itunes.apple.com',
        'google.com/podcast', 'stitcher.com', 'iheart.com', 'tunein.com', 'podbean.com',
        'soundcloud.com', 'castro.fm', 'overcast.fm', 'pocketcasts.com', 'breaker.audio',
        'radiopublic.com', 'anchor.fm', 'buzzsprout.com', 'transistor.fm', 'captivate.fm',
        'fireside.fm', 'libsyn.com', 'blubrry.com', 'simplecast.com', 'acast.com',
        'spreaker.com', 'audioboom.com', 'podtrac.com', 'megaphone.fm', 'rss',
        'podcast.apple.com', 'podcaster'
      ];
      
      let platformFound = false;
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const matchedPlatform = platformPatterns.find(pattern => href.includes(pattern));
        if (matchedPlatform) {
          console.log(`📢 [PODCAST-DEBUG] MATCH: Found link to podcast platform '${matchedPlatform}': ${href}`);
          logger.info(`[PODCAST] Found link to podcast platform '${matchedPlatform}' on page: ${url}`);
          platformFound = true;
          return false; // Break the loop
        }
      });
      
      if (platformFound) {
        return true;
      }
      
      // Check for common podcast-related elements and classes
      console.log(`📢 [PODCAST-DEBUG] Checking for podcast-related CSS classes`);
      const podcastClasses = [
        '.podcast', '.episode', '.player', '.audio-player', '.subscribe-buttons',
        '.listen', '.podcast-player', '.podcast-episode', '.episode-player', 
        '.podcast-subscribe', '.podcast-platforms', '.podcast-links', '.rss-icon'
      ];
      
      const matchedClass = podcastClasses.find(selector => $(selector).length > 0);
      if (matchedClass) {
        console.log(`📢 [PODCAST-DEBUG] MATCH: Found podcast-related CSS class '${matchedClass}'`);
        logger.info(`[PODCAST] Found podcast-related CSS class '${matchedClass}' on page: ${url}`);
        return true;
      }
      
      // Check for podcast metadata (Open Graph or Twitter cards)
      console.log(`📢 [PODCAST-DEBUG] Checking for podcast keywords in metadata`);
      let metadataFound = false;
      $('meta').each((_, el) => {
        const content = $(el).attr('content') || '';
        const matchedKeyword = podcastKeywords.find(keyword => content.toLowerCase().includes(keyword));
        if (matchedKeyword) {
          console.log(`📢 [PODCAST-DEBUG] MATCH: Found podcast keyword '${matchedKeyword}' in metadata`);
          logger.info(`[PODCAST] Found podcast keyword '${matchedKeyword}' in page metadata: ${url}`);
          metadataFound = true;
          return false; // Break the loop
        }
      });
      
      if (metadataFound) {
        return true;
      }
      
      // Check for subscribe text with podcast context
      console.log(`📢 [PODCAST-DEBUG] Checking for "Subscribe" links in podcast context`);
      const subscribeLinks = $('a:contains("Subscribe")').toArray();
      console.log(`📢 [PODCAST-DEBUG] Found ${subscribeLinks.length} subscribe links`);
      
      if (subscribeLinks.length > 0) {
        // Check if any subscribe link is close to podcast keywords
        for (const link of subscribeLinks) {
          const $parent = $(link).parent();
          const parentText = $parent.text().toLowerCase();
          const matchedKeyword = podcastKeywords.find(keyword => parentText.includes(keyword));
          if (matchedKeyword) {
            console.log(`📢 [PODCAST-DEBUG] MATCH: Found "Subscribe" link near podcast keyword '${matchedKeyword}'`);
            logger.info(`[PODCAST] Found "Subscribe" link near podcast keyword '${matchedKeyword}': ${url}`);
            return true;
          }
        }
      }
      
      // Reaching this point means all checks failed
      console.log(`📢 [PODCAST-DEBUG] No podcast indicators found for ${url}`);
      logger.info(`[PODCAST] URL doesn't contain podcast indicators, skipping: ${url}`);
      return false;
    } catch (error) {
      console.log(`📢 [PODCAST-DEBUG] ERROR in isPodcastPage: ${error.message}`);
      logger.error(`[PODCAST] Error checking if page is podcast related: ${error.message}`);
      return false;
    }
  },

/**
 * Find podcast pages from all pages
 */
  findPodcastPages(pages) {
  try {
    // Keywords that often appear in podcast URLs or titles
    const podcastKeywords = ['podcast', 'episodes', 'listen', 'audio', 'show', 'radio'];
    
    // Filter pages that are likely podcast pages
    return pages.filter(page => {
      if (!page.url) return false;
      
      try {
        const url = new URL(page.url);
        const pathSegments = url.pathname.toLowerCase().split('/').filter(Boolean);
        
        // Check if URL contains podcast keywords
        if (pathSegments.some(segment => podcastKeywords.includes(segment))) {
          return true;
        }
        
        // Check page title and content for podcast indicators
        if (page.content) {
          const $ = cheerio.load(page.content);
          const title = $('title').text().toLowerCase();
          
          // Check if title contains podcast keywords
          if (podcastKeywords.some(keyword => title.includes(keyword))) {
            return true;
          }
          
          // Look for podcast-related headings
          const headings = $('h1, h2, h3').text().toLowerCase();
          if (podcastKeywords.some(keyword => headings.includes(keyword))) {
            return true;
          }
          
          // Look for podcast players or feed links
          if (
            $('audio').length > 0 ||
            $('iframe[src*="spotify.com"]').length > 0 ||
            $('iframe[src*="apple.com/podcast"]').length > 0 ||
            $('iframe[src*="google.com/podcast"]').length > 0 ||
            $('a[href*=".xml"]').length > 0 ||
            $('a[href*="itunes.apple.com"]').length > 0 ||
            $('a[href*="podcasts.apple.com"]').length > 0 ||
            $('a[href*="spotify.com/show"]').length > 0 ||
            $('a[href*="google.com/podcast"]').length > 0
          ) {
            return true;
          }
        }
        
        return false;
      } catch (error) {
        return false;
      }
    });
  } catch (error) {
      logger.error(`[PODCAST] Error finding podcast pages: ${error.message}`);
    return [];
  }
  },

  /**
   * Extract feed URLs from a page
   */
  extractFeedUrlsFromPage($, baseUrl) {
    const feeds = [];
    const seenUrls = new Set();
    
    // Common non-feed extensions to ignore
    const ignoreExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', // Images
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', // Documents
      '.zip', '.rar', '.tar', '.gz', // Archives
      '.mp3', '.mp4', '.wav', '.ogg', '.aac', // Media files (MP3 handled later, but good to be explicit)
      '.js', '.css' // Scripts/Styles
    ];

    // Additional RSS feed selectors - extended for podcasts
const rssFeedSelectors = [
  'link[type="application/rss+xml"]',
  'link[type="application/atom+xml"]',
      'link[rel="alternate"][type="application/rss+xml"]',
      'link[rel="alternate"][type="application/atom+xml"]',
  'a[href$=".rss"]',
  'a[href$=".xml"]',
  'a[href*="feed"]',
  'a[href*="rss"]',
  'a[href*="atom"]',
      'a[href*="podcast"]',
      'a:contains("RSS")',
      'a:contains("Feed")',
      'a:contains("Subscribe")',
      'a:contains("Podcast Feed")'
    ];
      
      // Look for all potential RSS feeds
      $(rssFeedSelectors.join(', ')).each((_, element) => {
        let href = $(element).attr('href');
        if (!href) return;
        
        // Ignore links with common non-feed extensions
        const lowerHref = href.toLowerCase();
        if (ignoreExtensions.some(ext => lowerHref.endsWith(ext))) {
          return; 
        }
        
        try {
        // Skip MP3 files - these are episodes, not feeds
        if (href.toLowerCase().endsWith('.mp3')) return;
        
          // Normalize URL
        const feedUrl = new URL(href, baseUrl).href;
          
          // Skip if already seen
          if (seenUrls.has(feedUrl)) return;
          seenUrls.add(feedUrl);
          
          // Get title
          let title = $(element).attr('title') || '';
          if (!title) {
            title = $(element).text().trim() || 'RSS Feed';
          }
          
          // Determine if it's likely a podcast (vs. just an RSS feed)
          let isPodcast = false;
          if (
            feedUrl.toLowerCase().includes('podcast') ||
            title.toLowerCase().includes('podcast') ||
            feedUrl.includes('itunes') ||
            feedUrl.includes('spotify')
          ) {
            isPodcast = true;
          }
          
          feeds.push({
            url: feedUrl,
            title: title,
            isPodcast: isPodcast,
            sourceUrl: baseUrl,
            validated: false
          });
        } catch (error) {
          // Log invalid URLs with error details
          logger.warn(`[PODCAST] Error processing feed URL from ${baseUrl}: ${error.message}`);
        }
      });
      
      // Look for podcast platform links
      const platformPatterns = [
        { pattern: 'apple.com/podcast', platform: 'Apple Podcasts' },
        { pattern: 'podcasts.apple.com', platform: 'Apple Podcasts' },
        { pattern: 'itunes.apple.com', platform: 'Apple Podcasts' },
        { pattern: 'spotify.com/show', platform: 'Spotify' },
        { pattern: 'google.com/podcast', platform: 'Google Podcasts' },
        { pattern: 'stitcher.com', platform: 'Stitcher' },
        { pattern: 'iheart.com', platform: 'iHeartRadio' },
        { pattern: 'tunein.com', platform: 'TuneIn' },
        { pattern: 'podbean.com', platform: 'Podbean' },
        { pattern: 'soundcloud.com', platform: 'SoundCloud' },
        { pattern: 'castro.fm', platform: 'Castro' },
        { pattern: 'overcast.fm', platform: 'Overcast' },
        { pattern: 'pocketcasts.com', platform: 'Pocket Casts' },
        { pattern: 'breaker.audio', platform: 'Breaker' },
        { pattern: 'radiopublic.com', platform: 'RadioPublic' },
        { pattern: 'anchor.fm', platform: 'Anchor' },
        { pattern: 'buzzsprout.com', platform: 'Buzzsprout' },
        { pattern: 'transistor.fm', platform: 'Transistor' },
        { pattern: 'captivate.fm', platform: 'Captivate' },
      { pattern: 'fireside.fm', platform: 'Fireside' },
      { pattern: 'libsyn.com', platform: 'Libsyn' },
      { pattern: 'blubrry.com', platform: 'Blubrry' },
      { pattern: 'simplecast.com', platform: 'Simplecast' },
      { pattern: 'acast.com', platform: 'Acast' },
      { pattern: 'spreaker.com', platform: 'Spreaker' },
      { pattern: 'audioboom.com', platform: 'Audioboom' },
      { pattern: 'podtrac.com', platform: 'Podtrac' },
      { pattern: 'megaphone.fm', platform: 'Megaphone' }
      ];
      
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;
        
        // Ignore links with common non-feed extensions
        const lowerHref = href.toLowerCase();
        if (ignoreExtensions.some(ext => lowerHref.endsWith(ext))) {
          return; 
        }

        try {
        // Skip MP3 files - add them as episodes, not feeds
        if (href.toLowerCase().endsWith('.mp3')) return;
        
          for (const { pattern, platform } of platformPatterns) {
            if (href.includes(pattern)) {
            const feedUrl = new URL(href, baseUrl).href;
            
            // Skip if already seen
            if (seenUrls.has(feedUrl)) return;
            seenUrls.add(feedUrl);
            
                feeds.push({
                  url: feedUrl,
                  title: $(element).text().trim() || platform,
                  platform: platform,
                  sourceUrl: baseUrl,
                  validated: false
                });
              
              break;
            }
          }
        } catch (error) {
          // Log invalid URLs with error details
          logger.warn(`[PODCAST] Error processing platform link from ${baseUrl}: ${error.message}`);
        }
      });
    
    return feeds;
  },

  /**
   * Extract podcast feeds from pages
   */
  async extractPodcastFeeds(pages) {
    try {
      const feeds = [];
    const seenUrls = new Set();
    
    for (const page of pages) {
      if (!page.content) continue;
      
      const $ = cheerio.load(page.content);
        
        // Extract feed URLs from this page
        const pageFeeds = this.extractFeedUrlsFromPage($, page.url);
        
        for (const feed of pageFeeds) {
          // Skip if already seen
          if (seenUrls.has(feed.url)) continue;
          seenUrls.add(feed.url);
          
          // Check if feed.url is a valid string
          if (typeof feed.url !== 'string') {
            logger.warn(`[PODCAST] Invalid feed URL: [${JSON.stringify(feed.url)}]`);
            feed.validated = false;
            feeds.push(feed);
            continue;
          }
          
          // Try to validate as podcast feed
          try {
            logger.info(`[PODCAST] Validating feed: ${feed.url}`);
            const isValid = await this.validatePodcastFeed(feed.url);
            
            if (isValid) {
              feed.validated = true;
              feed.items = isValid.items || [];
              feed.isPodcast = true;
              
              // Found a valid podcast feed
              logger.info(`[PODCAST] Valid podcast feed: ${feed.url}`);
            }
          } catch (validationError) {
            logger.warn(`[PODCAST] Failed to validate feed ${feed.url}: ${validationError.message}`);
            feed.validated = false;
          }
          
          feeds.push(feed);
        }
      }
      
      return feeds;
    } catch (error) {
      logger.error(`[PODCAST] Error extracting podcast feeds: ${error.message}`);
      return [];
    }
  },

  /**
   * Validate if a URL is a podcast RSS feed
   */
  async validatePodcastFeed(url) {
    try {
      // Check if url is a string
      if (typeof url !== 'string') {
        logger.warn(`[PODCAST] Error validating podcast feed [${JSON.stringify(url)}]: url is not a string`);
        return false;
      }
      
      // If this is an MP3 file, it's an episode not a feed
      if (url.toLowerCase().endsWith('.mp3')) {
        logger.info(`[PODCAST] URL is an MP3 file, not a feed: ${url}`);
        return false;
      }
      
      // Skip validation for common podcast platform URLs that we know aren't direct feeds
      // but should be considered valid podcast links
      const knownPlatformPatterns = [
        // Apple Podcasts
        { pattern: 'podcasts.apple.com/podcast', platform: 'Apple Podcasts' },
        { pattern: 'podcasts.apple.com/us/podcast', platform: 'Apple Podcasts' },
        { pattern: 'itunes.apple.com/podcast', platform: 'Apple Podcasts' },
        { pattern: 'itunes.apple.com/us/podcast', platform: 'Apple Podcasts' },
        
        // Spotify
        { pattern: 'open.spotify.com/show', platform: 'Spotify' },
        { pattern: 'spotify.com/show', platform: 'Spotify' },
        
        // Google Podcasts
        { pattern: 'podcasts.google.com', platform: 'Google Podcasts' },
        
        // Others
        { pattern: 'iheart.com/podcast', platform: 'iHeartRadio' },
        { pattern: 'stitcher.com/podcast', platform: 'Stitcher' },
        { pattern: 'player.fm', platform: 'Player FM' }
      ];
      
      // Check if this is a known platform URL
      for (const { pattern, platform } of knownPlatformPatterns) {
        if (url.includes(pattern)) {
          logger.info(`[PODCAST] URL is a ${platform} page, not a direct feed: ${url}`);
          // Return true for platform URLs - we'll extract the actual feed elsewhere
          return true;
        }
      }
      
      // First make a HEAD request to check content-type before downloading the full file
      try {
        const headResponse = await axios.head(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        const contentType = headResponse.headers['content-type'] || '';
        
        // If this is an audio file, it's an episode not a feed
        const audioMimeTypes = [
          'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 
          'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'
        ];
        
        if (audioMimeTypes.some(mimeType => contentType.includes(mimeType))) {
          logger.info(`[PODCAST] URL has audio content-type (${contentType}), not a feed: ${url}`);
          return false;
        }
        
        // Check for very large files (>10MB) that are likely not XML feeds
        // Only if content-length header is available
        if (headResponse.headers['content-length']) {
          const contentLength = parseInt(headResponse.headers['content-length'], 10);
          // If file is larger than 10MB, it's probably not an RSS feed
          if (contentLength > 10 * 1024 * 1024) {
            logger.info(`[PODCAST] URL points to a large file (${Math.round(contentLength/1024/1024)}MB), not a feed: ${url}`);
            return false;
          }
        }
      } catch (headError) {
        // If the HEAD request fails, log and potentially return false
        logger.warn(`[PODCAST] HEAD request failed for ${url}: ${headError.message}`);
        
        // If the error is a 403 Forbidden, log but don't return false immediately
        if (headError.response && headError.response.status === 403) {
          logger.warn(`[PODCAST] Feed validation failed due to 403 Forbidden on HEAD request, will attempt GET: ${url}`);
        }
        // For other HEAD errors, we might still try a GET request later
      }
      
      // Now proceed with the full request
      const response = await axios.get(url, {
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024, // 10MB max to avoid huge downloads
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      // Process the response
      const data = response.data;
      const contentType = response.headers['content-type'] || '';
      
      // Check if this is a podcast feed based on content
      if (
        // XML content type
        (contentType.includes('xml') || contentType.includes('rss')) ||
        // XML declaration in content
        (typeof data === 'string' && data.includes('<?xml')) ||
        // Common podcast feed elements
        (typeof data === 'string' && (
          data.includes('<rss') ||
          data.includes('<channel') ||
          data.includes('<itunes:') ||
          data.includes('<podcast:') ||
          data.includes('<enclosure')
        ))
      ) {
        // Parse the XML to confirm it's a valid podcast feed
        const $ = cheerio.load(data, { xmlMode: true });
        
        // Check for podcast-specific elements
        const hasChannel = $('channel').length > 0;
        const hasItems = $('item').length > 0;
        const hasEnclosures = $('enclosure[url]').length > 0;
        const hasItunesNamespace = $('rss[xmlns\\:itunes]').length > 0 || data.includes('xmlns:itunes');
        
        // Detect podcast feed by checking for audio enclosures or iTunes namespace
        if (
          (hasChannel && hasItems && hasEnclosures) ||
          (hasChannel && hasItems && hasItunesNamespace)
        ) {
          logger.info(`[PODCAST] Valid podcast feed found: ${url}`);
          return true;
        }
      }
      
      logger.info(`[PODCAST] URL is not a valid podcast feed: ${url}`);
      return false;
    } catch (error) {
      logger.warn(`[PODCAST] Error validating podcast feed ${url}: ${error.message}`);
      return false;
    }
  },

  /**
   * Extract podcast episodes from a page
   */
  extractEpisodesFromPage($, baseUrl) {
    const episodes = [];
    const seenUrls = new Set();
      
      // Look for audio elements
      $('audio[src]').each((_, element) => {
        const src = $(element).attr('src');
        if (!src) return;
        
        try {
        const audioUrl = new URL(src, baseUrl).href;
          
          // Skip if we've already seen this URL
          if (seenUrls.has(audioUrl)) return;
          seenUrls.add(audioUrl);
          
          // Find the closest title
          let title = '';
          const $parent = $(element).parent();
          const $heading = $parent.prev('h1, h2, h3, h4, h5, h6');
          
          if ($heading.length > 0) {
            title = $heading.text().trim();
          } else {
            // Try to find a title in the parent container
            const $parentHeading = $parent.find('h1, h2, h3, h4, h5, h6').first();
            if ($parentHeading.length > 0) {
              title = $parentHeading.text().trim();
            } else {
              // Use the audio element's title attribute or a default title
              title = $(element).attr('title') || 'Podcast Episode';
            }
          }
          
          episodes.push({
            title: title,
            audioUrl: audioUrl,
          sourceUrl: baseUrl
          });
        } catch (error) {
          // Skip invalid URLs
        }
      });
      
      // Look for embedded podcast players
      const embedSelectors = [
        'iframe[src*="spotify.com"]',
        'iframe[src*="apple.com/podcast"]',
        'iframe[src*="google.com/podcast"]',
        'iframe[src*="soundcloud.com"]',
        'iframe[src*="megaphone.fm"]',
        'iframe[src*="simplecast.com"]',
        'iframe[src*="podbean.com"]',
        'iframe[src*="libsyn.com"]',
        'iframe[src*="blubrry.com"]',
        'iframe[src*="anchor.fm"]'
      ];
      
      $(embedSelectors.join(', ')).each((_, element) => {
        const src = $(element).attr('src');
        if (!src) return;
        
        try {
        const embedUrl = new URL(src, baseUrl).href;
          
          // Skip if we've already seen this URL
          if (seenUrls.has(embedUrl)) return;
          seenUrls.add(embedUrl);
          
          // Find the closest title
          let title = '';
          const $parent = $(element).parent();
          const $heading = $parent.prev('h1, h2, h3, h4, h5, h6');
          
          if ($heading.length > 0) {
            title = $heading.text().trim();
          } else {
            // Try to find a title in the parent container
            const $parentHeading = $parent.find('h1, h2, h3, h4, h5, h6').first();
            if ($parentHeading.length > 0) {
              title = $parentHeading.text().trim();
            } else {
              // Use a default title
              title = 'Podcast Episode';
            }
          }
          
          // Determine the platform
          let platform = 'Unknown';
          if (src.includes('spotify.com')) {
            platform = 'Spotify';
          } else if (src.includes('apple.com')) {
            platform = 'Apple Podcasts';
          } else if (src.includes('google.com')) {
            platform = 'Google Podcasts';
          } else if (src.includes('soundcloud.com')) {
            platform = 'SoundCloud';
          } else if (src.includes('megaphone.fm')) {
            platform = 'Megaphone';
          } else if (src.includes('simplecast.com')) {
            platform = 'Simplecast';
          } else if (src.includes('podbean.com')) {
            platform = 'Podbean';
          } else if (src.includes('libsyn.com')) {
            platform = 'Libsyn';
          } else if (src.includes('blubrry.com')) {
            platform = 'Blubrry';
          } else if (src.includes('anchor.fm')) {
            platform = 'Anchor';
          }
          
          episodes.push({
            title: title,
            embedUrl: embedUrl,
            platform: platform,
          sourceUrl: baseUrl
          });
        } catch (error) {
          // Skip invalid URLs
        }
      });
      
    // Extract MP3 episodes from direct links
    const mp3Episodes = this.extractMP3Episodes($, baseUrl);
    episodes.push(...mp3Episodes);
    
    return episodes;
  },

  /**
   * Extract podcast episodes from pages
   */
  extractPodcastEpisodes(pages) {
    try {
      const episodes = [];
      const seenUrls = new Set();
      
      for (const page of pages) {
        if (!page.content) continue;
        
        const $ = cheerio.load(page.content);
        
        // Extract episodes from this page
        const pageEpisodes = this.extractEpisodesFromPage($, page.url);
        
        for (const episode of pageEpisodes) {
          // Skip if already seen by URL
          const episodeUrl = episode.audioUrl || episode.embedUrl;
          if (episodeUrl && seenUrls.has(episodeUrl)) continue;
          
          if (episodeUrl) {
            seenUrls.add(episodeUrl);
          }
          
          episodes.push(episode);
        }
      }
      
      return episodes;
    } catch (error) {
      logger.error(`[PODCAST] Error extracting podcast episodes: ${error.message}`);
      return [];
    }
  },

  /**
   * Save podcast feed to database
   * @param {Object} feedData - Feed data object
   * @param {number} domainId - Domain ID
   * @returns {number|null} Feed ID if successful, null otherwise
   */
  async saveFeedToDatabase(feedData, domainId) {
    if (!feedData) {
      return null;
    }
    
    try {
      logger.info(`[PODCAST] Saving podcast feed to database: ${feedData.title}`);
      
      // Check if database pool is available
      if (!getPool) {
        logger.error('[PODCAST] Cannot save feed to database: getPool is not defined');
        return null;
      }
      
      const db = getPool();
      
      // Normalize the feed data
      const normalizedFeedData = {
        domain_id: domainId,
        feed_url: feedData.url || feedData.feedUrl || '',
        title: feedData.title || 'Untitled Podcast',
        description: feedData.description || '',
        image_url: feedData.imageUrl || feedData.image || '',
        author: feedData.author || '',
        link_url: feedData.link || feedData.websiteUrl || '',
        feed_type: feedData.type || 'rss',
        episode_count: feedData.episodeCount || 0
      };
      
      // Check if we already have this feed
      const [existingRows] = await db.execute(
        'SELECT id FROM domain_podcast_feeds WHERE domain_id = ? AND feed_url = ?',
        [domainId, normalizedFeedData.feed_url]
      );
      
      let feedId = null;
      
      if (existingRows.length > 0) {
        // Update existing feed
        feedId = existingRows[0].id;
        
        await db.execute(
          `UPDATE domain_podcast_feeds 
           SET title = ?, description = ?, image_url = ?, author = ?, 
               link_url = ?, feed_type = ?, episode_count = ?, updated_at = NOW() 
           WHERE id = ?`,
          [
            normalizedFeedData.title,
            normalizedFeedData.description,
            normalizedFeedData.image_url,
            normalizedFeedData.author,
            normalizedFeedData.link_url,
            normalizedFeedData.feed_type,
            normalizedFeedData.episode_count,
            feedId
          ]
        );
        
        logger.info(`[PODCAST] Updated existing podcast feed: ${normalizedFeedData.title} (ID: ${feedId})`);
      } else {
        // Insert new feed
        const [result] = await db.execute(
          `INSERT INTO domain_podcast_feeds 
           (domain_id, feed_url, title, description, image_url, author, 
            link_url, feed_type, episode_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            normalizedFeedData.domain_id,
            normalizedFeedData.feed_url,
            normalizedFeedData.title,
            normalizedFeedData.description,
            normalizedFeedData.image_url,
            normalizedFeedData.author,
            normalizedFeedData.link_url,
            normalizedFeedData.feed_type,
            normalizedFeedData.episode_count
          ]
        );
        
        feedId = result.insertId;
        logger.info(`[PODCAST] Saved new podcast feed: ${normalizedFeedData.title} (ID: ${feedId})`);
      }
      
      return feedId;
    } catch (error) {
      logger.error(`[PODCAST] Error saving podcast feed to database: ${error.message}`);
      return null;
    }
  },

  /**
   * Deep discovery of podcast feeds by following podcast-related links
   */
  async deepDiscoverPodcastFeeds(baseUrl, baseContent, domainId) {
    try {
      logger.info(`[PODCAST] Starting deep podcast discovery from ${baseUrl}`);
      
      // Parse base page content
      const $ = cheerio.load(baseContent);
      
      // Get all links on the page
      const links = new Set();
      
      // Podcast-related keywords to look for in links
      const podcastKeywords = ['podcast', 'episodes', 'listen', 'audio', 'show', 'radio', 'subscribe', 'stream', 'feed', 'rss'];
      const podcastFilesExtensions = ['.rss', '.xml', '.atom', '.mp3', '.m4a', '.mp4', '.m4v', '.mov', '.wav'];
      const podcastPlatformPatterns = [
        'spotify.com', 'apple.com/podcast', 'podcasts.apple.com', 'itunes.apple.com',
        'google.com/podcast', 'stitcher.com', 'iheart.com', 'tunein.com', 'podbean.com',
        'soundcloud.com', 'castro.fm', 'overcast.fm', 'pocketcasts.com', 'breaker.audio',
        'radiopublic.com', 'anchor.fm', 'buzzsprout.com', 'transistor.fm', 'captivate.fm',
        'fireside.fm', 'libsyn.com', 'blubrry.com', 'simplecast.com', 'acast.com'
      ];
      
      // Only collect links that have podcast-related indicators
      $('a').each(function() {
        const href = $(this).attr('href');
        if (!href) return;
        
        try {
          // Normalize the URL
          const resolvedUrl = new URL(href, baseUrl).href;
          
          // Skip if same as base URL to avoid loops
          if (resolvedUrl === baseUrl) return;
          
          const linkText = $(this).text().toLowerCase();
          
          // Only follow links that:
          // 1. Have podcast-related text
          // 2. Link to known podcast platforms
          // 3. Have podcast-related file extensions
          // 4. Have podcast-specific URL patterns
          
          const hasKeyword = podcastKeywords.some(keyword => 
            linkText.includes(keyword) || resolvedUrl.toLowerCase().includes(keyword)
          );
          
          const hasPodcastExtension = podcastFilesExtensions.some(ext => 
            resolvedUrl.toLowerCase().endsWith(ext)
          );
          
          const isPodcastPlatform = podcastPlatformPatterns.some(platform => 
            resolvedUrl.toLowerCase().includes(platform)
          );
          
          // Check if this link is likely related to podcasts
          if (hasKeyword || hasPodcastExtension || isPodcastPlatform) {
            links.add(resolvedUrl);
          }
        } catch (urlError) {
          // Skip invalid URLs
        }
      });
      
      if (links.size === 0) {
        logger.info(`[PODCAST] No podcast-related links found for deeper discovery`);
        return { feeds: [], episodes: [] };
      }
      
      logger.info(`[PODCAST] Found ${links.size} potential podcast-related links for deeper discovery`);
      
      // Limit the number of links to follow to avoid excessive requests
      const maxLinksToFollow = 5;
      const linksToFollow = Array.from(links).slice(0, maxLinksToFollow);
      
      // Process each potential podcast link
      const allFeeds = [];
      const allEpisodes = [];
      
      for (const link of linksToFollow) {
        try {
          logger.info(`[PODCAST] Deep discovery - following link: ${link}`);
          
          // Skip if this is the same as our base URL to avoid loops
          if (link === baseUrl) continue;
          
          // Check if this is potentially a direct podcast feed
          const isDirectFeed = await this.validatePodcastFeed(link);
          
          if (isDirectFeed) {
            logger.info(`[PODCAST] Found podcast feed through deep discovery: ${link}`);
            
            // Parse the feed
            const feedData = await this.parsePodcastFeed(link);
            if (feedData) {
              feedData.url = link;
              feedData.sourceUrl = baseUrl;
              feedData.validated = true;
              allFeeds.push(feedData);
              
              // Save feed to database if domain ID provided
              if (domainId) {
                const feedId = await this.saveFeedToDatabase(feedData, domainId);
                
                // Save episodes to database if feed ID is available
                if (feedId && feedData.episodes && feedData.episodes.length > 0) {
                  await this.saveEpisodesToDatabase(feedData.episodes, domainId, feedId);
                  
                  // Add episodes to the results
                  allEpisodes.push(...feedData.episodes);
                }
              }
            }
          } else {
            // Not a direct feed, maybe it's a podcast page
            try {
              // Fetch the page content
              const response = await axios.get(link, {
                timeout: 8000,
                maxContentLength: 5 * 1024 * 1024, // 5MB max to avoid huge downloads
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
              });
              
              const pageContent = response.data;
              
              // Skip obvious non-HTML responses
              if (typeof pageContent !== 'string' || pageContent.length < 50) continue;
              
              // Parse the page
              const page$ = cheerio.load(pageContent);
              
              // Only process if this page has podcast indicators
              if (!this.isPodcastPage(page$, link)) {
                logger.info(`[PODCAST] Followed link doesn't contain podcast indicators, skipping: ${link}`);
                continue;
              }
              
              // Extract MP3 episodes
              const deepEpisodes = this.extractMP3Episodes(page$, link);
              if (deepEpisodes.length > 0) {
                logger.info(`[PODCAST] Found ${deepEpisodes.length} episodes through deep discovery`);
                
                // Save episodes to database if domain ID provided
                if (domainId) {
                  await this.saveEpisodesToDatabase(deepEpisodes, domainId);
                }
                
                // Add to the results
                allEpisodes.push(...deepEpisodes);
              }
              
              // Extract feed URLs
              const deepFeedUrls = this.extractFeedUrlsFromPage(page$, link);
              
              // Process each feed URL
              for (const feedInfo of deepFeedUrls) {
                try {
                  // Validate the feed
                  const isValid = await this.validatePodcastFeed(feedInfo.url);
                  
                  if (isValid) {
                    // Parse the feed
                    const feedData = await this.parsePodcastFeed(feedInfo.url);
                    
                    if (feedData) {
                      feedData.url = feedInfo.url;
                      feedData.sourceUrl = link;
                      feedData.validated = true;
                      allFeeds.push(feedData);
                      
                      // Save feed to database if domain ID provided
                      if (domainId) {
                        const feedId = await this.saveFeedToDatabase(feedData, domainId);
                        
                        // Save episodes to database if feed ID is available
                        if (feedId && feedData.episodes && feedData.episodes.length > 0) {
                          await this.saveEpisodesToDatabase(feedData.episodes, domainId, feedId);
                          
                          // Add episodes to the results
                          allEpisodes.push(...feedData.episodes);
                        }
                      }
                    }
                  }
                } catch (feedError) {
                  logger.error(`[PODCAST] Error processing feed ${feedInfo.url} in deep discovery: ${feedError.message}`);
                }
              }
              
            } catch (pageError) {
              logger.error(`[PODCAST] Error following link ${link} in deep discovery: ${pageError.message}`);
            }
          }
        } catch (linkError) {
          logger.error(`[PODCAST] Error processing link ${link} in deep discovery: ${linkError.message}`);
        }
      }
      
      logger.info(`[PODCAST] Deep discovery complete. Found ${allFeeds.length} feeds and ${allEpisodes.length} episodes`);
      
      return {
        feeds: allFeeds,
        episodes: allEpisodes
      };
      
    } catch (error) {
      logger.error(`[PODCAST] Error in deep podcast discovery: ${error.message}`);
      return { feeds: [], episodes: [] };
    }
  },

  /**
   * Extract platform-specific podcast IDs and try to find RSS feeds
   * @param {string} url - Platform-specific podcast URL
   * @returns {Array} Array of potential RSS feed URLs
   */
  extractPlatformFeeds(url) {
    try {
      const feedCandidates = [];
      
      // Apple Podcasts
      // Example: https://podcasts.apple.com/us/podcast/your-podcast/id1234567890
      if (url.includes('podcasts.apple.com') || url.includes('itunes.apple.com')) {
        const idMatch = url.match(/\/id(\d+)/);
        if (idMatch && idMatch[1]) {
          const podcastId = idMatch[1];
          
          // Apple Podcasts doesn't expose the RSS feed directly, but we can try common feed providers
          // that use the Apple ID in their URLs
          feedCandidates.push(`https://feeds.buzzsprout.com/${podcastId}.rss`);
          feedCandidates.push(`https://feeds.transistor.fm/${podcastId}`);
          feedCandidates.push(`https://www.omnycontent.com/d/playlist/${podcastId}/podcast.rss`);
          feedCandidates.push(`https://feeds.simplecast.com/${podcastId}`);
          feedCandidates.push(`https://feeds.libsyn.com/${podcastId}/rss`);
          feedCandidates.push(`https://feeds.captivate.fm/${podcastId}`);
        }
      }
      
      // Spotify
      // Example: https://open.spotify.com/show/abcdef123456
      if (url.includes('open.spotify.com/show/') || url.includes('spotify.com/show/')) {
        const idMatch = url.match(/show\/([a-zA-Z0-9]+)/);
        if (idMatch && idMatch[1]) {
          const showId = idMatch[1];
          
          // Spotify doesn't expose RSS feeds, but we can try checking if the podcast is on common platforms
          // We add some generic feed URLs to try based on common patterns
          feedCandidates.push(`https://feeds.transistor.fm/spotify-${showId}`);
          feedCandidates.push(`https://feeds.buzzsprout.com/spotify-${showId}.rss`);
        }
      }
      
      // Stitcher
      // Example: https://www.stitcher.com/show/123456
      if (url.includes('stitcher.com/show/')) {
        const idMatch = url.match(/show\/(\d+)/);
        if (idMatch && idMatch[1]) {
          const showId = idMatch[1];
          feedCandidates.push(`https://www.stitcher.com/feed/${showId}`);
        }
      }
      
      // iHeartRadio
      // Example: https://www.iheart.com/podcast/123-name-45678/
      if (url.includes('iheart.com/podcast/')) {
        const idMatch = url.match(/podcast\/(\d+)-/);
        if (idMatch && idMatch[1]) {
          const showId = idMatch[1];
          feedCandidates.push(`https://feeds.megaphone.fm/iheart-${showId}`);
        }
      }
      
      // Log discovered candidates
      if (feedCandidates.length > 0) {
        logger.info(`[PODCAST] Generated ${feedCandidates.length} potential feed URLs from platform link: ${url}`);
      }
      
      return feedCandidates;
  } catch (error) {
      logger.error(`[PODCAST] Error extracting platform-specific feeds from ${url}: ${error.message}`);
    return [];
    }
  },

  /**
   * Extract MP3 files from page as potential podcast episodes
   * @param {Object} $ - Cheerio instance
   * @param {string} baseUrl - Base URL of the page
   * @returns {Array} Array of MP3 episodes
   */
  extractMP3Episodes($, baseUrl) {
    const episodes = [];
    const seenUrls = new Set();
    
    // Common audio file extensions
    const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac'];
    
    // Find all links that might be audio files
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      
      // Check if this is an audio file by extension
      const isAudioFile = audioExtensions.some(ext => href.toLowerCase().endsWith(ext));
      
      // Additional checks for URLs that might be audio but don't have the extension
      // e.g., streaming URLs with query parameters
      const isPotentialAudioUrl = !isAudioFile && (
        href.includes('/download/') ||
        href.includes('/stream/') ||
        href.includes('/audio/') ||
        href.includes('/episode/') ||
        href.includes('/media/') ||
        href.includes('audio=true') ||
        href.includes('stream=true')
      );
      
      if (!isAudioFile && !isPotentialAudioUrl) return;
      
      try {
        const audioUrl = new URL(href, baseUrl).href;
        
        // Skip if already seen
        if (seenUrls.has(audioUrl)) return;
        seenUrls.add(audioUrl);
        
        // Find a title for this episode
        let title = '';
        const $element = $(element);
        
        // Try to get title from the link text
        const linkText = $element.text().trim();
        if (linkText && linkText.length > 3 && !linkText.includes('http')) {
          title = linkText;
        }
        
        // If no title from link text, try nearby elements
        if (!title) {
          // Look for nearby headings
          const $heading = $element.closest('div, li, article').find('h1, h2, h3, h4, h5, h6').first();
          if ($heading.length > 0) {
            title = $heading.text().trim();
          }
        }
        
        // If still no title, try to extract from filename
        if (!title) {
          const filename = audioUrl.split('/').pop().split('?')[0];
          title = filename
            .replace(/\.(mp3|m4a|wav|ogg|aac|flac)$/i, '')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase()); // Title case
        }
        
        // Find any durations mentioned nearby
        let duration = '';
        const durationRegex = /(\d+:\d+:\d+|\d+:\d+)/;
        const parentText = $element.closest('div, li, article').text();
        const durationMatch = parentText.match(durationRegex);
        if (durationMatch) {
          duration = durationMatch[1];
        }
        
        // Find any dates mentioned nearby
        let publishedDate = null;
        
        // Look for nearby time elements
        const $time = $element.closest('div, li, article').find('time[datetime]');
        if ($time.length > 0) {
          publishedDate = $time.attr('datetime');
        }
        
        // If no datetime attribute, try common date formats
        if (!publishedDate) {
          const dateRegex = /(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}|\w+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/;
          const dateMatch = parentText.match(dateRegex);
          if (dateMatch) {
            publishedDate = dateMatch[1];
          }
        }
        
        // Use the page's title tag as fallback for podcast name
        const podcastTitle = $('title').text().trim();
        
        // Try to find an image near the audio link
        let imageUrl = '';
        const $nearbyImage = $element.closest('div, li, article').find('img[src]').first();
        if ($nearbyImage.length > 0) {
          const imgSrc = $nearbyImage.attr('src');
          if (imgSrc) {
            imageUrl = new URL(imgSrc, baseUrl).href;
          }
        }
        
        episodes.push({
          title: title || 'Untitled Episode',
          audio_url: audioUrl,
          page_url: baseUrl,
          image_url: imageUrl || '',
          duration: duration || '',
          published_date: publishedDate || null,
          podcast_title: podcastTitle || '',
          isDirectMP3: true
        });
        
        logger.info(`[PODCAST] Found MP3 episode: ${title || 'Untitled'} - ${audioUrl}`);
      } catch (error) {
        logger.warn(`[PODCAST] Error processing MP3 link: ${error.message}`);
      }
    });
    
    // Also check for HTML5 audio elements
    $('audio[src]').each((_, element) => {
      try {
        const src = $(element).attr('src');
        if (!src) return;
        
        const audioUrl = new URL(src, baseUrl).href;
        
        // Skip if already seen
        if (seenUrls.has(audioUrl)) return;
        seenUrls.add(audioUrl);
        
        // Try to extract title
        let title = '';
        
        // Check for title in attributes
        title = $(element).attr('title') || $(element).attr('aria-label') || '';
        
        // Check for nearby headings if no title attribute
        if (!title) {
          const $heading = $(element).closest('div, article, section').find('h1, h2, h3, h4, h5, h6').first();
          if ($heading.length > 0) {
            title = $heading.text().trim();
          }
        }
        
        // Try to find an image near the audio element
        let imageUrl = '';
        const $nearbyImage = $(element).closest('div, article, section').find('img[src]').first();
        if ($nearbyImage.length > 0) {
          const imgSrc = $nearbyImage.attr('src');
          if (imgSrc) {
            imageUrl = new URL(imgSrc, baseUrl).href;
          }
        }
        
        episodes.push({
          title: title || 'Untitled Episode',
          audio_url: audioUrl,
          page_url: baseUrl,
          image_url: imageUrl || '',
          duration: $(element).attr('duration') || '',
          published_date: null,
          podcast_title: $('title').text().trim() || '',
          isDirectMP3: true
        });
        
        logger.info(`[PODCAST] Found HTML5 audio element: ${title || 'Untitled'} - ${audioUrl}`);
      } catch (error) {
        logger.warn(`[PODCAST] Error processing audio element: ${error.message}`);
      }
    });
    
    return episodes;
  },

  /**
   * Save podcast episodes to the database
   * @param {Array} episodes - Array of episode objects
   * @param {number} domainId - Domain ID
   * @param {number} feedId - Feed ID (optional)
   */
  async saveEpisodesToDatabase(episodes, domainId, feedId = null) {
    if (!episodes || episodes.length === 0) {
      return;
    }
    
    try {
      logger.info(`[PODCAST] Saving ${episodes.length} podcast episodes to database`);
      
      // Check if database pool is available
      if (!getPool) {
        logger.error('[PODCAST] Cannot save episodes to database: getPool is not defined');
        return;
      }
      
      const db = getPool();
      
      for (const episode of episodes) {
        try {
          // Normalize the episode object to match database schema
          const episodeData = {
            domain_id: domainId,
            feed_id: feedId,
            title: episode.title || 'Untitled Episode',
            description: episode.description || '',
            audio_url: episode.audio_url || episode.audioUrl || '',
            page_url: episode.page_url || episode.sourceUrl || '',
            image_url: episode.image_url || episode.imageUrl || '',
            published_date: episode.published_date || episode.pubDate || null,
            duration: episode.duration || ''
          };
          
          // Check if we already have this episode by audio_url to avoid duplicates
          const [existingRows] = await db.execute(
            'SELECT id FROM domain_podcast_episodes WHERE domain_id = ? AND audio_url = ?',
            [domainId, episodeData.audio_url]
          );
          
          if (existingRows.length > 0) {
            // Update existing episode
            await db.execute(
              `UPDATE domain_podcast_episodes 
               SET feed_id = ?, title = ?, description = ?, page_url = ?, 
                   image_url = ?, published_date = ?, duration = ?, updated_at = NOW() 
               WHERE id = ?`,
              [
                episodeData.feed_id, 
                episodeData.title, 
                episodeData.description,
                episodeData.page_url,
                episodeData.image_url,
                episodeData.published_date,
                episodeData.duration,
                existingRows[0].id
              ]
            );
            
            logger.info(`[PODCAST] Updated existing episode: ${episodeData.title}`);
          } else {
            // Insert new episode
            await db.execute(
              `INSERT INTO domain_podcast_episodes 
               (domain_id, feed_id, title, description, audio_url, page_url, image_url, 
                published_date, duration, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
              [
                episodeData.domain_id,
                episodeData.feed_id,
                episodeData.title,
                episodeData.description,
                episodeData.audio_url,
                episodeData.page_url,
                episodeData.image_url,
                episodeData.published_date,
                episodeData.duration
              ]
            );
            
            logger.info(`[PODCAST] Saved new episode: ${episodeData.title}`);
          }
        } catch (episodeError) {
          logger.error(`[PODCAST] Error saving episode ${episode.title}: ${episodeError.message}`);
          // Continue with next episode
        }
      }
      
      logger.info(`[PODCAST] Successfully saved podcast episodes to database`);
    } catch (error) {
      logger.error(`[PODCAST] Error saving podcast episodes to database: ${error.message}`);
    }
  },

  /**
   * Parse podcast feed and extract data
   * @param {string} url - Feed URL
   * @returns {Object|null} Parsed feed data or null if invalid
   */
  async parsePodcastFeed(url) {
    try {
      logger.info(`[PODCAST] Parsing podcast feed: ${url}`);
      
      // Fetch the feed content
      const response = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024, // 10MB max
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        }
      });
      
      // Parse the XML
      const $ = cheerio.load(response.data, { xmlMode: true });
      
      // Check if this is a valid feed
      const hasChannel = $('channel').length > 0;
      const hasFeed = $('feed').length > 0; // For Atom feeds
      
      if (!hasChannel && !hasFeed) {
        logger.warn(`[PODCAST] Not a valid RSS/Atom feed: ${url}`);
        return null;
      }
      
      // Extract feed data
      let feedData = {
        url: url,
        title: '',
        description: '',
        author: '',
        image: '',
        link: '',
        episodeCount: 0,
        episodes: []
      };
      
      if (hasChannel) {
        // RSS format
        feedData.title = $('channel > title').text().trim();
        feedData.description = $('channel > description').text().trim();
        feedData.author = $('channel > itunes\\:author').text().trim() || 
                         $('channel > author').text().trim() || 
                         $('channel > managingEditor').text().trim();
        feedData.link = $('channel > link').text().trim();
        
        // Get image
        if ($('channel > itunes\\:image').length > 0) {
          feedData.image = $('channel > itunes\\:image').attr('href');
        } else if ($('channel > image > url').length > 0) {
          feedData.image = $('channel > image > url').text().trim();
        }
        
        // Get episodes
        const items = $('item');
        feedData.episodeCount = items.length;
        
        items.each((index, element) => {
          if (index >= 20) return false; // Limit to 20 episodes
          
          const $item = $(element);
          
          const episode = {
            title: $item.find('title').text().trim(),
            description: $item.find('description').text().trim() || 
                        $item.find('itunes\\:summary').text().trim(),
            published_date: $item.find('pubDate').text().trim(),
            guid: $item.find('guid').text().trim()
          };
          
          // Get audio URL
          const $enclosure = $item.find('enclosure[type^="audio"]');
          if ($enclosure.length > 0) {
            episode.audio_url = $enclosure.attr('url');
            episode.duration = $item.find('itunes\\:duration').text().trim();
          }
          
          // Get episode image
          if ($item.find('itunes\\:image').length > 0) {
            episode.image_url = $item.find('itunes\\:image').attr('href');
          }
          
          // Get episode link
          episode.page_url = $item.find('link').text().trim();
          
          // Add to episodes array
          feedData.episodes.push(episode);
        });
      } else if (hasFeed) {
        // Atom format
        feedData.title = $('feed > title').text().trim();
        feedData.description = $('feed > subtitle').text().trim();
        feedData.author = $('feed > author > name').text().trim();
        
        // Get link
        $('feed > link').each((_, element) => {
          const rel = $(element).attr('rel');
          if (!rel || rel === 'alternate') {
            feedData.link = $(element).attr('href');
          }
        });
        
        // Get image
        if ($('feed > logo').length > 0) {
          feedData.image = $('feed > logo').text().trim();
        }
        
        // Get episodes
        const entries = $('entry');
        feedData.episodeCount = entries.length;
        
        entries.each((index, element) => {
          if (index >= 20) return false; // Limit to 20 episodes
          
          const $entry = $(element);
          
          const episode = {
            title: $entry.find('title').text().trim(),
            description: $entry.find('summary').text().trim() || 
                        $entry.find('content').text().trim(),
            published_date: $entry.find('published').text().trim() || 
                          $entry.find('updated').text().trim(),
            guid: $entry.find('id').text().trim()
          };
          
          // Get link
          $entry.find('link').each((_, linkElement) => {
            const rel = $(linkElement).attr('rel');
            const type = $(linkElement).attr('type');
            
            if (type && type.startsWith('audio/')) {
              episode.audio_url = $(linkElement).attr('href');
            } else if (!rel || rel === 'alternate') {
              episode.page_url = $(linkElement).attr('href');
            }
          });
          
          // Add to episodes array
          feedData.episodes.push(episode);
        });
      }
      
      logger.info(`[PODCAST] Successfully parsed podcast feed: ${feedData.title} with ${feedData.episodeCount} episodes`);
      return feedData;
    } catch (error) {
      logger.error(`[PODCAST] Error parsing podcast feed ${url}: ${error.message}`);
      return null;
    }
  }
};

export default podcastExtractor; 