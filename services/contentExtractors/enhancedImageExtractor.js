import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import path from 'path';
import { URL } from 'url';
import { getPool } from '../../../config/database.js';

/**
 * Image Categories
 */
const IMAGE_CATEGORIES = {
  HERO: 'hero',
  LOGO: 'logo',
  PRODUCT: 'product',
  CONTENT: 'content',
  BACKGROUND: 'background',
  BANNER: 'banner',
  GALLERY: 'gallery',
  SOCIAL_PROOF: 'social_proof',
  TEAM: 'team',
  OTHER: 'other'
};

/**
 * Save an image to the domain_images table
 */
async function saveImageToDatabase(image, domainId) {
  try {
    if (!domainId) {
      logger.debug('[IMAGES] No domain ID provided for image saving');
      return false;
    }

    const db = getPool();
    
    // Check if this image already exists
    const [existingRows] = await db.execute(
      'SELECT id FROM domain_images WHERE domain_id = ? AND url = ?',
      [domainId, image.url]
    );
    
    if (existingRows.length > 0) {
      // Update existing image
      const id = existingRows[0].id;
      await db.execute(
        `UPDATE domain_images SET 
          alt_text = ?, 
          width = ?, 
          height = ?, 
          file_size = ?, 
          file_format = ?, 
          category = ?, 
          prominence_score = ?
        WHERE id = ?`,
        [
          image.alt || '',
          image.width || null,
          image.height || null,
          image.fileSize || null,
          image.fileFormat || '',
          image.potentialCategories[0] || 'other',
          image.score || 0,
          id
        ]
      );
      logger.debug(`[IMAGES] Updated existing image in database: ${image.url}`);
    } else {
      // Insert new image
      await db.execute(
        `INSERT INTO domain_images 
         (domain_id, url, alt_text, width, height, 
          page_url, category, context, prominence_score,
          file_name, file_format, file_size, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          domainId,
          image.url,
          image.alt || '',
          image.width || 0,
          image.height || 0,
          image.sourceUrl || '',
          image.categories[0] || 'other',
          image.context || '',
          image.score || 0,
          image.fileName || '',
          image.fileType || '',
          image.fileSize || null
        ]
      );
      logger.debug(`[IMAGES] Saved new image to database: ${image.url}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`[IMAGES] Error saving image to database: ${error.message}`);
    return false;
  }
}

/**
 * Get domain ID for a URL
 */
async function getDomainIdForUrl(url) {
  try {
    if (!url) return null;
    
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    const db = getPool();
    const [rows] = await db.execute(
      'SELECT id FROM domain_info WHERE domain = ?',
      [domain]
    );
    
    if (rows.length > 0) {
      return rows[0].id;
    }
    
    return null;
  } catch (error) {
    logger.error(`[IMAGES] Error getting domain ID for URL: ${error.message}`);
    return null;
  }
}

/**
 * Calculate image dimensions from element attributes or CSS
 * @param {Object} element - The image element
 * @param {Object} $ - Cheerio instance
 * @returns {Object} - Object with width and height
 */
function calculateDimensions(element, $) {
  const $element = $(element);
  let width = 0;
  let height = 0;
  
  // Try to get dimensions from attributes first
  const attrWidth = $element.attr('width');
  const attrHeight = $element.attr('height');
  
  if (attrWidth) {
    width = parseInt(attrWidth, 10);
  }
  
  if (attrHeight) {
    height = parseInt(attrHeight, 10);
  }
  
  // If no dimensions from attributes, try CSS
  if (!width || !height) {
    const style = $element.attr('style') || '';
    
    // Extract width from inline style
    const widthMatch = style.match(/width:\s*(\d+)px/i);
    if (widthMatch && widthMatch[1]) {
      width = parseInt(widthMatch[1], 10);
    }
    
    // Extract height from inline style
    const heightMatch = style.match(/height:\s*(\d+)px/i);
    if (heightMatch && heightMatch[1]) {
      height = parseInt(heightMatch[1], 10);
    }
  }
  
  return { width, height };
}

/**
 * Analyze the context of an image element to determine its role on the page
 * @param {Object} element - The image element or its container (for background images)
 * @param {Object} $ - Cheerio instance
 * @returns {Object} - Context information including location and description
 */
function analyzeImageContext(element, $) {
  const $element = $(element);
  const context = {
    inHeader: false,
    inFooter: false,
    inSidebar: false,
    inHero: false,
    inContent: false,
    inNavigation: false,
    description: ''
  };
  
  // Check if element is inside specific page sections
  let parent = $element;
  let maxDepth = 5; // Don't traverse too far up
  let depthCounter = 0;
  let contextParts = [];
  
  while (parent.length && depthCounter < maxDepth) {
    const tagName = parent.prop('tagName')?.toLowerCase() || '';
    const id = parent.attr('id') || '';
    const classes = parent.attr('class') || '';
    
    // Add relevant parent information to context description
    if (tagName && (id || classes)) {
      contextParts.push(`${tagName}${id ? '#' + id : ''}${classes ? '.' + classes.replace(/\s+/g, '.') : ''}`);
    }
    
    // Check for header
    if (
      tagName === 'header' || 
      id.includes('header') || 
      classes.includes('header') ||
      classes.includes('nav')
    ) {
      context.inHeader = true;
    }
    
    // Check for footer
    if (
      tagName === 'footer' || 
      id.includes('footer') || 
      classes.includes('footer')
    ) {
      context.inFooter = true;
    }
    
    // Check for sidebar
    if (
      id.includes('sidebar') || 
      classes.includes('sidebar') ||
      classes.includes('side-bar') ||
      classes.includes('side')
    ) {
      context.inSidebar = true;
    }
    
    // Check for hero section
    if (
      id.includes('hero') || 
      classes.includes('hero') ||
      classes.includes('banner') ||
      classes.includes('jumbotron') ||
      classes.includes('cover')
    ) {
      context.inHero = true;
    }
    
    // Check for main content
    if (
      tagName === 'main' ||
      tagName === 'article' ||
      id.includes('content') ||
      classes.includes('content') ||
      classes.includes('main')
    ) {
      context.inContent = true;
    }
    
    // Check for navigation
    if (
      tagName === 'nav' ||
      id.includes('nav') ||
      classes.includes('nav') ||
      classes.includes('menu')
    ) {
      context.inNavigation = true;
    }
    
    parent = parent.parent();
    depthCounter++;
  }
  
  // Create a description from the context parts (limited to most relevant)
  context.description = contextParts.slice(0, 3).join(' > ');
  
  return context;
}

/**
 * Determine potential categories for an image based on context and URL
 * @param {Object} element - The image element
 * @param {Object} $ - Cheerio instance
 * @param {Object} context - Context information from analyzeImageContext
 * @param {string} url - The image URL
 * @param {Object} dimensions - Image dimensions
 * @param {string} pageUrl - The URL of the page containing the image
 * @returns {string[]} - Array of potential categories
 */
function categorizeImage(element, $, context, url, dimensions, pageUrl) {
  const categories = [];
  const $element = $(element);
  
  // Extract useful information for categorization
  const tagName = $element.prop('tagName')?.toLowerCase() || '';
  const alt = $element.attr('alt') || '';
  const classes = $element.attr('class') || '';
  const id = $element.attr('id') || '';
  const urlLower = url.toLowerCase();
  const altLower = alt.toLowerCase();
  
  // Check for logo indicators
  if (
    urlLower.includes('logo') ||
    altLower.includes('logo') ||
    id.includes('logo') ||
    classes.includes('logo') ||
    context.description.toLowerCase().includes('logo')
  ) {
    categories.push(IMAGE_CATEGORIES.LOGO);
  }
  
  // Check for hero indicators
  if (
    context.inHero ||
    id.includes('hero') ||
    classes.includes('hero') ||
    classes.includes('banner') ||
    classes.includes('jumbotron') ||
    (dimensions.width > 800 && context.inHeader)
  ) {
    categories.push(IMAGE_CATEGORIES.HERO);
  }
  
  // Check for product indicators
  if (
    urlLower.includes('product') ||
    altLower.includes('product') ||
    id.includes('product') ||
    classes.includes('product') ||
    context.description.toLowerCase().includes('product')
  ) {
    categories.push(IMAGE_CATEGORIES.PRODUCT);
  }
  
  // Check for background indicators
  if (
    $element.css && $element.css('background-image') || 
    (tagName !== 'img' && context.description.toLowerCase().includes('background'))
  ) {
    categories.push(IMAGE_CATEGORIES.BACKGROUND);
  }
  
  // Check for banner indicators
  if (
    id.includes('banner') ||
    classes.includes('banner') ||
    urlLower.includes('banner') ||
    altLower.includes('banner')
  ) {
    categories.push(IMAGE_CATEGORIES.BANNER);
  }
  
  // Check for team/people indicators
  if (
    urlLower.includes('team') ||
    urlLower.includes('staff') ||
    urlLower.includes('employee') ||
    altLower.includes('team') ||
    altLower.includes('staff') ||
    altLower.includes('employee') ||
    context.description.toLowerCase().includes('team')
  ) {
    categories.push(IMAGE_CATEGORIES.TEAM);
  }
  
  // Check for gallery indicators
  if (
    id.includes('gallery') ||
    classes.includes('gallery') ||
    context.description.toLowerCase().includes('gallery') ||
    context.description.toLowerCase().includes('slider') ||
    context.description.toLowerCase().includes('carousel')
  ) {
    categories.push(IMAGE_CATEGORIES.GALLERY);
  }
  
  // Check for social proof indicators
  if (
    id.includes('testimonial') ||
    classes.includes('testimonial') ||
    altLower.includes('testimonial') ||
    urlLower.includes('testimonial') ||
    context.description.toLowerCase().includes('testimonial')
  ) {
    categories.push(IMAGE_CATEGORIES.SOCIAL_PROOF);
  }
  
  // If no categories detected yet, use default content category
  if (categories.length === 0) {
    if (context.inContent) {
      categories.push(IMAGE_CATEGORIES.CONTENT);
    } else {
      categories.push(IMAGE_CATEGORIES.OTHER);
    }
  }
  
  return categories;
}

/**
 * Extract images from page content
 * @param {Array} pages - Array of pages with url and content
 * @param {number} domainId - Optional domain ID for saving to database 
 * @returns {Object} - Object with all images and categorized images
 */
export const extract = async (pages, domainId = null) => {
  try {
    logger.info('[IMAGE] Extracting images from content');
    
    // Store extracted images
    const images = [];
    const imagesByCategory = {};
    
    // Track unique image URLs to avoid duplicates
    const uniqueImageUrls = new Set();
    
    // Process each page
    for (const page of pages) {
      if (!page.content) continue;
      
      // Get page ID if available (for database saving)
      const pageId = page.pageId || page.id || null;
      
      logger.info(`[IMAGE] Processing images on page: ${page.url}`);
      
      try {
        // Load HTML with cheerio
        const $ = cheerio.load(page.content);
        
        // Initial extraction of all img tags
        $('img[src]').each((_, element) => {
          try {
            const src = $(element).attr('src');
            if (!src) return;
            
            // Skip data URIs which are too large and not useful for discovery
            if (src.startsWith('data:')) return;
            
            // Skip blank.gif and other tiny placeholder images
            if (src.includes('blank.gif') || src.includes('spacer.gif') || src.includes('transparent.gif')) return;
            
            // Normalize URL
            let imageUrl;
            try {
              imageUrl = new URL(src, page.url).href;
            } catch (urlError) {
              return; // Skip invalid URLs
            }
            
            // Skip if we've already processed this exact URL
            if (uniqueImageUrls.has(imageUrl)) return;
            uniqueImageUrls.add(imageUrl);
            
            // Get alt text and other attributes
            const alt = $(element).attr('alt') || '';
            const title = $(element).attr('title') || '';
            const width = parseInt($(element).attr('width'), 10) || 0;
            const height = parseInt($(element).attr('height'), 10) || 0;
            
            // Calculate image dimensions
            const dimensions = calculateDimensions(element, $);
            
            // Analyze context for better categorization
            const context = analyzeImageContext(element, $);
            
            // Determine categories
            const categories = categorizeImage(element, $, context, imageUrl, dimensions, page.url);
            
            // Create image object
            const image = {
              url: imageUrl,
              alt: alt,
              title: title,
              width: dimensions.width || width,
              height: dimensions.height || height,
              sourceUrl: page.url,
              categories: categories,
              context: context.description || '',
              inHeader: context.inHeader,
              inFooter: context.inFooter,
              inSidebar: context.inSidebar,
              isLogo: categories.includes('logo'),
              isIcon: categories.includes('icon'),
              isBanner: categories.includes('banner'),
              isProduct: categories.includes('product'),
              isPerson: categories.includes('person'),
              isBookCover: categories.includes('book_cover'),
              isHero: categories.includes('hero'),
              fileType: getFileExtension(imageUrl)
            };
            
            // Save image
            images.push(image);
            
            // Categorize image
            categories.forEach(category => {
              if (!imagesByCategory[category]) {
                imagesByCategory[category] = [];
              }
              imagesByCategory[category].push(image);
            });
            
          } catch (elementError) {
            logger.warn(`[IMAGE] Error processing image element: ${elementError.message}`);
          }
        });
        
        // Additional extraction from background images
        $('[style*="background"], [style*="background-image"]').each((_, element) => {
          try {
            const style = $(element).attr('style');
            if (!style) return;
            
            // Extract URL from background-image
            const bgMatch = style.match(/background(-image)?:\s*url\(['"]?([^'")]+)['"]?\)/i);
            if (!bgMatch) return;
            
            const bgUrl = bgMatch[2];
            if (!bgUrl || bgUrl.startsWith('data:')) return;
            
            // Normalize URL
            let imageUrl;
            try {
              imageUrl = new URL(bgUrl, page.url).href;
            } catch (urlError) {
              return; // Skip invalid URLs
            }
            
            // Skip if we've already processed this exact URL
            if (uniqueImageUrls.has(imageUrl)) return;
            uniqueImageUrls.add(imageUrl);
            
            // Analyze context
            const context = analyzeImageContext(element, $);
            
            // Determine dimensions
            const dimensions = { width: 0, height: 0 };
            
            // Determine categories
            const categories = categorizeImage(element, $, context, imageUrl, dimensions, page.url);
            
            // Create image object
            const image = {
              url: imageUrl,
              alt: '',
              title: '',
              width: dimensions.width,
              height: dimensions.height,
              sourceUrl: page.url,
              categories: categories,
              context: context.description || '',
              inHeader: context.inHeader,
              inFooter: context.inFooter,
              inSidebar: context.inSidebar,
              isBackground: true,
              isLogo: categories.includes('logo'),
              isIcon: categories.includes('icon'),
              isBanner: categories.includes('banner'),
              isProduct: categories.includes('product'),
              isPerson: categories.includes('person'),
              isBookCover: categories.includes('book_cover'),
              isHero: categories.includes('hero'),
              fileType: getFileExtension(imageUrl)
            };
            
            // Save image
            images.push(image);
            
            // Categorize image
            categories.forEach(category => {
              if (!imagesByCategory[category]) {
                imagesByCategory[category] = [];
              }
              imagesByCategory[category].push(image);
            });
            
          } catch (bgError) {
            logger.warn(`[IMAGE] Error processing background image: ${bgError.message}`);
          }
        });
        
        // Extract from picture tags
        $('picture source[srcset]').each((_, element) => {
          try {
            const srcset = $(element).attr('srcset');
            if (!srcset) return;
            
            // Parse srcset to get URLs
            const srcsetParts = srcset.split(',');
            for (const part of srcsetParts) {
              const urlMatch = part.trim().split(/\s+/)[0];
              if (!urlMatch || urlMatch.startsWith('data:')) continue;
              
              // Normalize URL
              let imageUrl;
              try {
                imageUrl = new URL(urlMatch, page.url).href;
              } catch (urlError) {
                continue; // Skip invalid URLs
              }
              
              // Skip if we've already processed this exact URL
              if (uniqueImageUrls.has(imageUrl)) continue;
              uniqueImageUrls.add(imageUrl);
              
              // Get context
              const context = analyzeImageContext(element, $);
              
              // Determine categories
              const categories = categorizeImage(element, $, context, imageUrl, { width: 0, height: 0 }, page.url);
              
              // Create image object
              const image = {
                url: imageUrl,
                alt: $(element).parent().find('img').attr('alt') || '',
                title: $(element).parent().find('img').attr('title') || '',
                width: 0,
                height: 0,
                sourceUrl: page.url,
                categories: categories,
                context: context.description || '',
                inHeader: context.inHeader,
                inFooter: context.inFooter,
                inSidebar: context.inSidebar,
                isLogo: categories.includes('logo'),
                isIcon: categories.includes('icon'),
                isBanner: categories.includes('banner'),
                isProduct: categories.includes('product'),
                isPerson: categories.includes('person'),
                isBookCover: categories.includes('book_cover'),
                isHero: categories.includes('hero'),
                fileType: getFileExtension(imageUrl)
              };
              
              // Save image
              images.push(image);
              
              // Categorize image
              categories.forEach(category => {
                if (!imagesByCategory[category]) {
                  imagesByCategory[category] = [];
                }
                imagesByCategory[category].push(image);
              });
            }
          } catch (sourceError) {
            logger.warn(`[IMAGE] Error processing picture source: ${sourceError.message}`);
          }
        });
        
        // Save images to database if we have a domainId
        if (domainId) {
          try {
            // Check if database pool is available
            if (!getPool) {
              logger.error('[IMAGE] Cannot save images to database: getPool is not defined');
            } else {
              const db = getPool();
              let savedCount = 0;
              
              // Extract just the current page's images
              const currentPageImages = images.filter(img => img.sourceUrl === page.url);
              
              // Process each image found on this page
              for (const image of currentPageImages) {
                try {
                  // Check if this image already exists for this domain
                  const [existingRows] = await db.execute(
                    `SELECT id FROM domain_images WHERE domain_id = ? AND url = ?`,
                    [domainId, image.url]
                  );
                  
                  if (existingRows.length === 0) {
                    // Format categories as comma-separated string
                    const categoriesStr = image.categories.join(',');
                    
                    // Insert new image
                    await db.execute(
                      `INSERT INTO domain_images 
                       (domain_id, url, alt_text, width, height, 
                        page_url, category, context, prominence_score,
                        file_name, file_format, file_size, created_at) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                      [
                        domainId,
                        image.url,
                        image.alt || '',
                        image.width || 0,
                        image.height || 0,
                        image.sourceUrl || '',
                        image.categories[0] || 'other',
                        image.context || '',
                        image.score || 0,
                        image.fileName || '',
                        image.fileType || '',
                        image.fileSize || null
                      ]
                    );
                    savedCount++;
                  }
                } catch (imageError) {
                  logger.warn(`[IMAGE] Error saving individual image to database: ${imageError.message}`);
                }
              }
              
              if (savedCount > 0) {
                logger.info(`[IMAGE] Saved ${savedCount} new images to database for page: ${page.url}`);
              }
            }
          } catch (dbError) {
            logger.error(`[IMAGE] Database error saving images: ${dbError.message}`);
          }
        }
        
      } catch (pageError) {
        logger.error(`[IMAGE] Error processing page ${page.url}: ${pageError.message}`);
      }
    }
    
    // Remove duplicate images by URL and cleanup
    const uniqueImages = [...new Map(images.map(item => [item.url, item])).values()];
    
    logger.info(`[IMAGE] Extracted ${uniqueImages.length} unique images across ${pages.length} pages`);
    
    // Log number of images in each category
    const categoryStats = {};
    Object.keys(imagesByCategory).forEach(category => {
      categoryStats[category] = imagesByCategory[category].length;
    });
    logger.info(`[IMAGE] Image categories: ${JSON.stringify(categoryStats)}`);
    
    return {
      all: uniqueImages,
      byCategory: imagesByCategory
    };
    
  } catch (error) {
    logger.error(`[IMAGE] Error extracting images: ${error.message}`);
    logger.error(error.stack);
    return {
      all: [],
      byCategory: {}
    };
  }
};

/**
 * Extract and categorize images from a single page
 */
function extractImagesFromPage(page, isHomepage) {
  try {
    // Validate page input
    if (!page || !page.content || !page.url) {
      logger.warn('[IMAGES] ⚠️ Invalid page object provided to extractImagesFromPage');
      return [];
    }
    
    const $ = cheerio.load(page.content);
    const images = [];
    const seenUrls = new Set();
    
    // Get all images, including those in srcset
    $('img').each((_, element) => {
      const $img = $(element);
      const src = $img.attr('src');
      
      if (!src) return;
      
      try {
        // Normalize URL
        const imageUrl = new URL(src, page.url).href;
        
        // Skip if already seen
        if (seenUrls.has(imageUrl)) return;
        seenUrls.add(imageUrl);
        
        // Extract metadata
        const width = $img.attr('width') ? parseInt($img.attr('width'), 10) : null;
        const height = $img.attr('height') ? parseInt($img.attr('height'), 10) : null;
        const alt = $img.attr('alt') || '';
        const fileSize = null; // Can't determine this from HTML alone
        const fileName = getFileNameFromUrl(imageUrl);
        const fileFormat = getFileFormatFromUrl(imageUrl);
        
        // Calculate position in document
        const position = $('img').index($img);
        
        // Determine parent context
        const parentElement = $img.parent();
        const parentTag = parentElement.prop('tagName')?.toLowerCase() || '';
        const parentClass = parentElement.attr('class') || '';
        const context = `${parentTag}${parentClass ? '.' + parentClass.replace(/\s+/g, '.') : ''}`;
        
        // Get selector path for specificity
        const selector = getSpecificSelector($, $img);
        
        // Calculate a base score for this image
        const score = calculateImageScore($, $img, isHomepage);
        
        // Create image object with all metadata
        const image = {
          url: imageUrl,
          fileName,
          fileFormat,
          fileSize,
          alt,
          width,
          height,
          pageUrl: page.url,
          position,
          context,
          selector,
          score,
          isHomepage,
          potentialCategories: [] // Will be filled in by categorization logic
        };
        
        // Add preliminary categorization hints based on selector, alt text, etc.
        addPreliminaryCategorization(image, $, $img);
        
        // Add to images array
        images.push(image);
      } catch (error) {
        // Skip invalid URLs
        logger.debug(`[IMAGES] Error processing image URL ${src}: ${error.message}`);
      }
    });
    
    // Also extract background images
    $('*').each((_, element) => {
      const $element = $(element);
      const style = $element.attr('style');
      
      if (style && style.includes('background-image')) {
        try {
          // Extract URL from background-image: url('...')
          const match = /background-image:\s*url\(['"]?([^'"]+)['"]?\)/i.exec(style);
          if (match && match[1]) {
            const imageUrl = new URL(match[1], page.url).href;
            
            // Skip if already seen
            if (seenUrls.has(imageUrl)) return;
            seenUrls.add(imageUrl);
            
            // Get element tag and classes
            const tag = $element.prop('tagName')?.toLowerCase() || '';
            const className = $element.attr('class') || '';
            
            // Extract metadata
            const width = $element.width() || null;
            const height = $element.height() || null;
            const fileName = getFileNameFromUrl(imageUrl);
            const fileFormat = getFileFormatFromUrl(imageUrl);
            
            // Create image object
            const image = {
              url: imageUrl,
              fileName,
              fileFormat,
              fileSize: null,
              alt: 'Background Image',
              width,
              height,
              pageUrl: page.url,
              position: $('*').index($element),
              context: `${tag}${className ? '.' + className.replace(/\s+/g, '.') : ''}`,
              selector: getSpecificSelector($, $element),
              score: calculateBackgroundImageScore($, $element, isHomepage),
              isHomepage,
              isBackground: true,
              potentialCategories: [IMAGE_CATEGORIES.BACKGROUND] // Start with background category
            };
            
            // Additional categorization based on context
            addPreliminaryCategorization(image, $, $element);
            
            // Add to images array
            images.push(image);
          }
        } catch (error) {
          // Skip invalid URLs
          logger.debug(`[IMAGES] Error processing background image: ${error.message}`);
        }
      }
    });
    
    return images;
    
  } catch (error) {
    logger.error(`[IMAGES] ❌ Error extracting images from page ${page?.url || 'unknown'}: ${error.message}`);
    logger.error(error.stack);
    return [];
  }
}

/**
 * Add preliminary categorization to image based on various signals
 */
function addPreliminaryCategorization(image, $, $element) {
  const { url, alt, selector, context, isBackground } = image;
  const urlLower = url.toLowerCase();
  const altLower = alt.toLowerCase();
  const selectorLower = selector.toLowerCase();
  const contextLower = context.toLowerCase();
  
  // Hero image detection
  if (
    selectorLower.includes('hero') ||
    selectorLower.includes('banner') ||
    selectorLower.includes('jumbotron') ||
    selectorLower.includes('cover') ||
    contextLower.includes('hero') ||
    contextLower.includes('banner') ||
    (image.isHomepage && image.position < 5 && image.score > 7)
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.HERO);
  }
  
  // Logo detection
  if (
    urlLower.includes('logo') ||
    altLower.includes('logo') ||
    selectorLower.includes('logo') ||
    selectorLower.includes('brand') ||
    contextLower.includes('logo') ||
    contextLower.includes('brand')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.LOGO);
  }
  
  // Product image detection
  if (
    urlLower.includes('product') ||
    altLower.includes('product') ||
    selectorLower.includes('product') ||
    contextLower.includes('product') ||
    selectorLower.includes('item') ||
    contextLower.includes('shop') ||
    contextLower.includes('store')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.PRODUCT);
  }
  
  // Gallery image detection
  if (
    selectorLower.includes('gallery') ||
    contextLower.includes('gallery') ||
    selectorLower.includes('slideshow') ||
    contextLower.includes('slideshow') ||
    contextLower.includes('carousel')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.GALLERY);
  }
  
  // Team image detection
  if (
    urlLower.includes('team') ||
    altLower.includes('team') ||
    altLower.includes('staff') ||
    altLower.includes('employee') ||
    altLower.includes('founder') ||
    selectorLower.includes('team') ||
    contextLower.includes('team') ||
    contextLower.includes('staff') ||
    contextLower.includes('about-us')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.TEAM);
  }
  
  // Banner/Promotional image detection
  if (
    urlLower.includes('banner') ||
    urlLower.includes('promo') ||
    urlLower.includes('ad') ||
    altLower.includes('promotion') ||
    altLower.includes('offer') ||
    altLower.includes('discount') ||
    selectorLower.includes('promotion') ||
    contextLower.includes('promotion')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.BANNER);
  }
  
  // Social proof image detection
  if (
    urlLower.includes('testimonial') ||
    urlLower.includes('review') ||
    urlLower.includes('partner') ||
    urlLower.includes('client') ||
    altLower.includes('testimonial') ||
    altLower.includes('review') ||
    altLower.includes('partner') ||
    altLower.includes('client') ||
    selectorLower.includes('testimonial') ||
    contextLower.includes('testimonial') ||
    contextLower.includes('review')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.SOCIAL_PROOF);
  }
  
  // Content image detection (fallback if not more specific and in content area)
  if (
    (contextLower.includes('content') || 
     contextLower.includes('article') || 
     contextLower.includes('post') ||
     selectorLower.includes('content') ||
     selectorLower.includes('article')) &&
    image.potentialCategories.length === 0
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.CONTENT);
  }
  
  // Background image detection is handled during extraction
  
  // If still no category, add OTHER
  if (image.potentialCategories.length === 0) {
    image.potentialCategories.push(IMAGE_CATEGORIES.OTHER);
  }
}

/**
 * Calculate a score for an image based on various factors
 */
function calculateImageScore($, $img, isHomepage) {
  let score = 0;
  
  // Size factors
  const width = $img.attr('width') ? parseInt($img.attr('width'), 10) : null;
  const height = $img.attr('height') ? parseInt($img.attr('height'), 10) : null;
  
  if (width && height) {
    // Large images score higher
    if (width >= 800) score += 3;
    else if (width >= 400) score += 2;
    else if (width >= 200) score += 1;
    else score -= 1; // Small images score lower
    
    // Image aspect ratio (typical hero images are wider than tall)
    const ratio = width / height;
    if (ratio > 1.5) score += 2; // Wide images (likely hero or banner)
    else if (ratio < 0.7) score -= 1; // Tall images (likely not hero)
  }
  
  // Position factors
  const position = $('img').index($img);
  if (position < 3) score += 3; // Very early images
  else if (position < 10) score += 1; // Early images
  
  // Homepage gets a boost
  if (isHomepage) score += 2;
  
  // Alt text factors
  const alt = $img.attr('alt') || '';
  if (alt && alt.length > 0) score += 1; // Has alt text
  
  // Parent element factors
  const parentElement = $img.parent();
  const parentTag = parentElement.prop('tagName')?.toLowerCase();
  
  if (parentTag === 'a') score += 1; // Image is a link (likely important)
  if (parentTag === 'figure') score += 1; // Image is in a figure (likely content)
  
  // Surrounding context factors
  const grandParent = parentElement.parent();
  const grandParentTag = grandParent.prop('tagName')?.toLowerCase();
  
  if (grandParentTag === 'header') score += 2; // In header (likely important)
  if (grandParentTag === 'main') score += 1; // In main content
  
  return score;
}

/**
 * Calculate a score for a background image
 */
function calculateBackgroundImageScore($, $element, isHomepage) {
  let score = 0;
  
  // Element dimensions
  const width = $element.width() || null;
  const height = $element.height() || null;
  
  if (width && height) {
    if (width >= 800) score += 3;
    else if (width >= 400) score += 2;
    else if (width >= 200) score += 1;
    
    // Large area elements are more important
    const area = width * height;
    if (area > 250000) score += 3; // Very large area (likely full-width banner)
    else if (area > 100000) score += 2; // Large area
  }
  
  // Position factors
  const position = $('*').index($element);
  const allElements = $('*').length;
  
  // Position relative to total elements (higher score if earlier in the page)
  if (position < allElements * 0.1) score += 3; // First 10% of elements
  else if (position < allElements * 0.3) score += 1; // First 30% of elements
  
  // Element type factors
  const tag = $element.prop('tagName')?.toLowerCase();
  if (tag === 'div' || tag === 'section') score += 1; // Common container elements
  if (tag === 'header') score += 3; // Header elements are important
  
  // Class factors
  const className = $element.attr('class') || '';
  if (className.includes('hero') || className.includes('banner')) score += 3;
  if (className.includes('background') || className.includes('bg-')) score += 2;
  
  // Homepage gets a boost
  if (isHomepage) score += 2;
  
  return score;
}

/**
 * Get a specific selector for an element
 */
function getSpecificSelector($, $element) {
  const tag = $element.prop('tagName')?.toLowerCase() || '';
  const id = $element.attr('id');
  const className = $element.attr('class');
  
  if (id) {
    return `${tag}#${id}`;
  } else if (className) {
    const firstClass = className.split(/\s+/)[0];
    return `${tag}.${firstClass}`;
  } else {
    // If no ID or class, try to include parent information
    const parent = $element.parent();
    const parentTag = parent.prop('tagName')?.toLowerCase() || '';
    const parentId = parent.attr('id');
    const parentClass = parent.attr('class');
    
    if (parentId) {
      return `${parentTag}#${parentId} > ${tag}`;
    } else if (parentClass) {
      const parentFirstClass = parentClass.split(/\s+/)[0];
      return `${parentTag}.${parentFirstClass} > ${tag}`;
    } else {
      return tag;
    }
  }
}

/**
 * Extract file name from URL
 */
function getFileNameFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const fileName = path.basename(pathname);
    return fileName;
  } catch (error) {
    return '';
  }
}

/**
 * Extract file format from URL
 */
function getFileFormatFromUrl(url) {
  try {
    const fileName = getFileNameFromUrl(url);
    const extension = path.extname(fileName).toLowerCase();
    
    if (extension === '.jpg' || extension === '.jpeg') {
      return 'jpeg';
    } else if (extension === '.png') {
      return 'png';
    } else if (extension === '.gif') {
      return 'gif';
    } else if (extension === '.webp') {
      return 'webp';
    } else if (extension === '.svg') {
      return 'svg';
    } else {
      return extension.replace('.', ''); // Return without leading dot
    }
  } catch (error) {
    return '';
  }
}

/**
 * Extract file extension from URL
 * @param {string} url - The image URL
 * @returns {string} - The file extension
 */
function getFileExtension(url) {
  try {
    if (!url) return '';
    
    // Get the filename from the URL
    const fileName = getFileNameFromUrl(url);
    if (!fileName) return '';
    
    // Extract extension
    const extension = path.extname(fileName).toLowerCase();
    
    // Return without the leading dot
    return extension ? extension.substring(1) : '';
  } catch (error) {
    return '';
  }
}

/**
 * Deduplicate images by URL
 */
function deduplicateImages(images) {
  const uniqueImages = [];
  const seenUrls = new Set();
  
  for (const image of images) {
    if (!seenUrls.has(image.url)) {
      seenUrls.add(image.url);
      uniqueImages.push(image);
    }
  }
  
  return uniqueImages;
}

/**
 * Categorize images based on their detected properties
 */
function categorizeImages(images) {
  const categorized = {};
  
  // Initialize categories
  Object.values(IMAGE_CATEGORIES).forEach(category => {
    categorized[category] = [];
  });
  
  // First pass: Add images to their potential categories
  for (const image of images) {
    // Skip very small images unless they're logos
    const isTooSmall = image.width && image.height && image.width < 100 && image.height < 100;
    if (isTooSmall && !image.potentialCategories.includes(IMAGE_CATEGORIES.LOGO)) {
      continue;
    }
    
    // Add image to each of its potential categories
    for (const category of image.potentialCategories) {
      categorized[category].push({...image});
    }
  }
  
  // Second pass: If an image appears in multiple categories, keep it only in the highest priority category
  const priorityOrder = [
    IMAGE_CATEGORIES.HERO,
    IMAGE_CATEGORIES.LOGO,
    IMAGE_CATEGORIES.PRODUCT,
    IMAGE_CATEGORIES.BANNER,
    IMAGE_CATEGORIES.GALLERY,
    IMAGE_CATEGORIES.TEAM,
    IMAGE_CATEGORIES.SOCIAL_PROOF,
    IMAGE_CATEGORIES.CONTENT,
    IMAGE_CATEGORIES.BACKGROUND,
    IMAGE_CATEGORIES.OTHER
  ];
  
  const finalCategorized = {};
  Object.values(IMAGE_CATEGORIES).forEach(category => {
    finalCategorized[category] = [];
  });
  
  const assignedImages = new Set();
  
  // Go through categories in priority order
  for (const category of priorityOrder) {
    for (const image of categorized[category]) {
      // If not already assigned to a higher priority category
      if (!assignedImages.has(image.url)) {
        finalCategorized[category].push(image);
        assignedImages.add(image.url);
      }
    }
  }
  
  // Sort each category by score (higher first)
  Object.keys(finalCategorized).forEach(category => {
    finalCategorized[category].sort((a, b) => b.score - a.score);
  });
  
  return finalCategorized;
}

// Add this at the end of the file
export default {
  extract
}; 