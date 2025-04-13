import { getPool } from '../db.js';
import logger from '../../utils/logger.js';

/**
 * Finds media content by domain ID.
 * @param {number} domainId - The domain_info ID.
 * @returns {Promise<object|null>} - The media content object or null if not found.
 */
export const findByDomainId = async (domainId) => {
  const db = await getPool();
  const mediaData = {
    all_images: [],
    images_by_category: {
      hero: [],
      logo: [],
      team: [],
      other: [],
      banner: [],
      content: [],
      gallery: [],
      product: [],
      background: [],
      social_proof: []
    },
    videos: [],
    _sources: []
  };
  
  let foundData = false;
  
  try {
    // 1. Try to get images from domain_images table
    try {
      const [imageRows] = await db.query('SELECT * FROM domain_images WHERE domain_id = ? ORDER BY category ASC', [domainId]);
      
      if (imageRows && imageRows.length > 0) {
        logger.debug(`Found ${imageRows.length} images in domain_images table for domain ID ${domainId}`);
        foundData = true;
        mediaData._sources.push('domain_images_table');
        
        // Process all images from the domain_images table
        imageRows.forEach(img => {
          const category = (img.category || 'other').toLowerCase();
          
          // Create a standard image object
          const imageObj = {
            url: img.url,
            alt: img.alt_text || '',
            width: img.width || null,
            height: img.height || null,
            type: img.category || 'other',
            src: img.url,
            filename: img.filename || '',
            size: img.size || null,
            mime_type: img.mime_type || '',
            dominant_color: img.dominant_color || null
          };
          
          // Add to all images array
          mediaData.all_images.push(imageObj);
          
          // Add to appropriate category array
          if (mediaData.images_by_category[category]) {
            mediaData.images_by_category[category].push(imageObj);
          } else {
            mediaData.images_by_category.other.push(imageObj);
          }
        });
        
        // Add individual category arrays for backward compatibility
        Object.entries(mediaData.images_by_category).forEach(([category, images]) => {
          mediaData[`${category}_images`] = images;
        });
      }
    } catch (err) {
      logger.warn(`Error checking domain_images table: ${err.message}`);
    }
    
    // 2. Try to get videos from domain_videos table
    try {
      const [videoRows] = await db.query('SELECT * FROM domain_videos WHERE domain_id = ?', [domainId]);
      
      if (videoRows && videoRows.length > 0) {
        logger.debug(`Found ${videoRows.length} videos in domain_videos table for domain ID ${domainId}`);
        foundData = true;
        if (!mediaData._sources.includes('domain_videos_table')) {
          mediaData._sources.push('domain_videos_table');
        }
        
        // Process all videos
        mediaData.videos = videoRows.map(video => ({
          url: video.url,
          title: video.title || '',
          description: video.description || '',
          thumbnail: video.thumbnail_url || '',
          platform: video.platform || 'unknown',
          embed_code: video.embed_code || null,
          duration: video.duration || null,
          width: video.width || null,
          height: video.height || null,
          category: video.category || 'other'
        }));
      }
    } catch (err) {
      logger.warn(`Error checking domain_videos table: ${err.message}`);
    }
    
    // 3. Try the old domain_media_content table as fallback
    try {
      const [rows] = await db.query('SELECT * FROM domain_media_content WHERE domain_id = ?', [domainId]);
      
      if (rows[0]) {
        logger.debug(`Found media content in domain_media_content table for domain ID ${domainId}`);
        foundData = true;
        mediaData._sources.push('domain_media_content_table');
        
        // Only use these if we didn't find images in domain_images
        if (mediaData.all_images.length === 0) {
          // Parse old format hero images
          const heroImages = safeJsonParse(rows[0].hero_images, []);
          const brandImages = safeJsonParse(rows[0].brand_images, []);
          
          // Add to all_images
          if (heroImages.length > 0) {
            heroImages.forEach(img => {
              const imageObj = typeof img === 'string' ? { url: img, type: 'Hero' } : { ...img, type: 'Hero' };
              mediaData.all_images.push(imageObj);
              mediaData.images_by_category.hero.push(imageObj);
            });
            mediaData.hero_images = heroImages;
          }
          
          if (brandImages.length > 0) {
            brandImages.forEach(img => {
              const imageObj = typeof img === 'string' ? { url: img, type: 'Brand' } : { ...img, type: 'Brand' };
              mediaData.all_images.push(imageObj);
              mediaData.images_by_category.logo.push(imageObj);
            });
            mediaData.brand_images = brandImages;
          }
        }
        
        // Only use these if we didn't find videos in domain_videos
        if (mediaData.videos.length === 0) {
          const videos = safeJsonParse(rows[0].videos, []);
          if (videos.length > 0) {
            mediaData.videos = videos;
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') {
        logger.warn(`Error checking domain_media_content table: ${err.message}`);
      }
    }
    
    return foundData ? mediaData : null;
    
  } catch (error) {
    logger.error(`Error fetching media content for domain ID ${domainId}: ${error.message}`, error);
    throw error;
  }
};

// Helper function for JSON parsing
const safeJsonParse = (jsonString, defaultValue = null) => {
  if (jsonString === null || jsonString === undefined) {
    return defaultValue;
  }
  if (typeof jsonString === 'object') {
    return jsonString;
  }
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
};

// Add other necessary functions (create, update) if needed 