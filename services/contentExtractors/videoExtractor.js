import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import { getPool } from '../../database/db.js';

/**
 * List of domains that should be excluded from video detection
 * These are typically analytics, tag managers, and tracking pixels
 */
const EXCLUDED_DOMAINS = [
  'googletagmanager.com',
  'gtm.js',
  'analytics.google.com',
  'google-analytics.com',
  'stats.g.doubleclick.net',
  'connect.facebook.net',
  'facebook.com/tr',
  'pixel.facebook.com',
  'snap.licdn.com',
  'platform.twitter.com',
  'static.ads-twitter.com',
  'ads.linkedin.com',
  'sentry.io',
  'hotjar.com',
  'pixel.wp.com',
  'bat.bing.com',
  'cdn.amplitude.com',
  'cdn.heapanalytics.com',
  'js.intercomcdn.com',
  'cdn.mouseflow.com'
];

/**
 * Checks if a URL is likely a tracking pixel or analytics tag
 * @param {string} url - The URL to check
 * @param {string|null} width - The width attribute of the element (may be null)
 * @param {string|null} height - The height attribute of the element (may be null)
 * @returns {boolean} True if this is likely a tracking element
 */
function isTrackingElement(url, width, height) {
  // Check against known analytics and tracking domains
  if (url && EXCLUDED_DOMAINS.some(domain => url.includes(domain))) {
    return true;
  }
  
  // Check for tiny dimensions that indicate tracking pixels
  if ((width === '0' || width === '1') && (height === '0' || height === '1')) {
    return true;
  }
  
  // Check for hidden iframes
  if (width === '0' && height === '0') {
    return true;
  }
  
  return false;
}

/**
 * Determines if an iframe is likely to be a real video embed
 * @param {object} $ - Cheerio instance
 * @param {object} element - The iframe element
 * @returns {boolean} True if this is likely a real video
 */
function isLikelyVideo($, element) {
  const $el = $(element);
  const src = $el.attr('src') || '';
  const width = $el.attr('width');
  const height = $el.attr('height');
  
  // First check if it's a tracking element
  if (isTrackingElement(src, width, height)) {
    return false;
  }
  
  // Check context - videos often have video-related classes or containers
  const hasVideoClass = $el.attr('class') && (
    $el.attr('class').toLowerCase().includes('video') ||
    $el.attr('class').toLowerCase().includes('player') ||
    $el.attr('class').toLowerCase().includes('embed')
  );
  
  const parentHasVideoClass = $el.parent().attr('class') && (
    $el.parent().attr('class').toLowerCase().includes('video') ||
    $el.parent().attr('class').toLowerCase().includes('player') ||
    $el.parent().attr('class').toLowerCase().includes('embed')
  );
  
  // Videos typically have reasonable dimensions
  const hasReasonableSize = (width && height && 
    parseInt(width) > 100 && parseInt(height) > 100);
  
  // Look for common video platform domains
  const isCommonVideoDomain = 
    src.includes('youtube.com') || 
    src.includes('youtu.be') ||
    src.includes('vimeo.com') ||
    src.includes('dailymotion.com') || 
    src.includes('facebook.com/plugins/video') ||
    src.includes('player.twitch.tv');
    
  // More likely to be a video if multiple conditions match
  return isCommonVideoDomain || 
         (hasVideoClass && hasReasonableSize) || 
         (parentHasVideoClass && hasReasonableSize);
}

/**
 * Extract video information from pages
 */
export const extract = async (pages) => {
  try {
    logger.info('[VIDEO] Starting video extraction');
    
    const videos = [];
    const seenUrls = new Set();
    
    for (const page of pages) {
      if (!page.content) {
        logger.debug(`[VIDEO] Skipping page with no content: ${page.url || 'unknown'}`);
        continue;
      }
      
      let extractedCount = 0;
      
      const $ = cheerio.load(page.content);
      
      // Extract iframe embedded videos
      const videoEmbeds = {
        'youtube.com/embed': 'YouTube',
        'youtu.be': 'YouTube',
        'player.vimeo.com': 'Vimeo',
        'dailymotion.com/embed': 'Dailymotion',
        'facebook.com/plugins/video': 'Facebook',
        'wistia.com': 'Wistia',
        'vidyard.com': 'Vidyard',
        'loom.com/embed': 'Loom',
        'player.twitch.tv': 'Twitch',
        'streamable.com': 'Streamable',
        'tiktok.com/embed': 'TikTok'
      };
      
      $('iframe[src]').each((_, element) => {
        const src = $(element).attr('src');
        if (!src) return;
        
        try {
          const videoUrl = new URL(src, page.url).href;
          
          // Skip if already seen
          if (seenUrls.has(videoUrl)) return;
          
          // Skip tracking pixels and analytics iframes
          if (isTrackingElement(videoUrl, $(element).attr('width'), $(element).attr('height'))) {
            logger.debug(`[VIDEO] Skipping tracking iframe: ${videoUrl}`);
            return;
          }
          
          // Additional check to filter non-video iframes
          if (!isLikelyVideo($, element)) {
            logger.debug(`[VIDEO] Skipping unlikely video iframe: ${videoUrl}`);
            return;
          }
          
          // Check which platform this is from
          let platform = 'Unknown';
          for (const [domain, platformName] of Object.entries(videoEmbeds)) {
            if (videoUrl.includes(domain)) {
              platform = platformName;
              break;
            }
          }
          
          // Find a title if possible
          let title = '';
          const $heading = $(element).prev('h1, h2, h3, h4, h5, h6');
          if ($heading.length > 0) {
            title = $heading.text().trim();
          } else {
            title = 'Video';
          }
          
          seenUrls.add(videoUrl);
          videos.push({
            type: 'embed',
            url: videoUrl,
            platform,
            title,
            width: $(element).attr('width') || null,
            height: $(element).attr('height') || null,
            sourceUrl: page.url
          });
          extractedCount++;
        } catch (error) {
          // Skip invalid URLs
          logger.debug(`[VIDEO] Error processing iframe URL: ${error.message}`);
        }
      });
      
      // Extract HTML5 video elements
      $('video').each((_, element) => {
        const $video = $(element);
        let videoUrl = '';
        
        // Check for source elements
        const $source = $video.find('source[src]').first();
        if ($source.length > 0) {
          videoUrl = $source.attr('src');
        } else {
          // Check for src attribute on video element
          videoUrl = $video.attr('src');
        }
        
        if (!videoUrl) return;
        
        try {
          const fullVideoUrl = new URL(videoUrl, page.url).href;
          
          // Skip if already seen
          if (seenUrls.has(fullVideoUrl)) return;
          seenUrls.add(fullVideoUrl);
          
          // Find a title if possible
          let title = $video.attr('title') || '';
          if (!title) {
            const $heading = $video.prev('h1, h2, h3, h4, h5, h6');
            if ($heading.length > 0) {
              title = $heading.text().trim();
            } else {
              title = 'Video';
            }
          }
          
          videos.push({
            type: 'html5',
            url: fullVideoUrl,
            platform: 'HTML5',
            title,
            width: $video.attr('width') || null,
            height: $video.attr('height') || null,
            poster: $video.attr('poster') || null,
            sourceUrl: page.url
          });
          extractedCount++;
        } catch (error) {
          // Skip invalid URLs
          logger.debug(`[VIDEO] Error processing HTML5 video URL: ${error.message}`);
        }
      });
      
      // Extract links to video platforms
      const videoLinks = {
        'youtube.com/watch': 'YouTube',
        'vimeo.com': 'Vimeo',
        'dailymotion.com/video': 'Dailymotion',
        'facebook.com/watch': 'Facebook',
        'twitch.tv': 'Twitch',
        'tiktok.com': 'TikTok'
      };
      
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;
        
        try {
          const linkUrl = new URL(href, page.url).href;
          
          // Skip if already seen
          if (seenUrls.has(linkUrl)) return;
          
          // Check if it's a video platform link
          let isPlatformLink = false;
          let platform = 'Unknown';
          
          for (const [domain, platformName] of Object.entries(videoLinks)) {
            if (linkUrl.includes(domain)) {
              isPlatformLink = true;
              platform = platformName;
              break;
            }
          }
          
          if (isPlatformLink) {
            seenUrls.add(linkUrl);
            videos.push({
              type: 'link',
              url: linkUrl,
              platform,
              title: $(element).text().trim() || 'Video Link',
              sourceUrl: page.url
            });
            extractedCount++;
          }
        } catch (error) {
          // Skip invalid URLs
          logger.debug(`[VIDEO] Error processing video link URL: ${error.message}`);
        }
      });
      
      logger.info(`[VIDEO] Extracted ${extractedCount} videos from ${page.url}`);
    }
    
    logger.info(`[VIDEO] Total extracted videos: ${videos.length}`);
    return videos;
  } catch (error) {
    logger.error(`[VIDEO] Error extracting videos: ${error.message}`);
    logger.error(error.stack);
    return [];
  }
};

/**
 * Save videos to domain_media_content table
 */
export const saveVideos = async (domainId, videos) => {
  try {
    if (!videos || videos.length === 0) {
      return false;
    }
    
    const db = getPool();
    
    // Check if entry exists
    const [existingRows] = await db.execute(
      'SELECT id, videos FROM domain_media_content WHERE domain_id = ?',
      [domainId]
    );
    
    const processedVideos = videos.map(video => ({
      url: video.url,
      title: video.title,
      platform: video.platform,
      type: video.type,
      width: video.width,
      height: video.height,
      poster: video.poster,
      sourceUrl: video.sourceUrl
    }));
    
    if (existingRows.length === 0) {
      // Insert new record
      await db.execute(
        `INSERT INTO domain_media_content 
        (domain_id, videos, created_at, updated_at) 
        VALUES (?, ?, NOW(), NOW())`,
        [
          domainId,
          JSON.stringify(processedVideos)
        ]
      );
      
      logger.info(`Saved ${videos.length} videos to domain_media_content`);
    } else {
      // Update existing record
      let existingVideos = [];
      try {
        if (existingRows[0].videos) {
          existingVideos = JSON.parse(existingRows[0].videos);
        }
      } catch (e) {
        logger.error(`Error parsing existing videos: ${e.message}`);
      }
      
      // Combine existing and new videos, avoiding duplicates
      const existingUrls = new Set(existingVideos.map(v => v.url));
      const newVideos = processedVideos.filter(v => !existingUrls.has(v.url));
      const combinedVideos = [...existingVideos, ...newVideos];
      
      await db.execute(
        `UPDATE domain_media_content 
         SET videos = ?, updated_at = NOW() 
         WHERE domain_id = ?`,
        [
          JSON.stringify(combinedVideos),
          domainId
        ]
      );
      
      logger.info(`Updated domain_media_content with ${newVideos.length} new videos`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving videos: ${error.message}`);
    return false;
  }
};

export default {
  extract,
  saveVideos
}; 