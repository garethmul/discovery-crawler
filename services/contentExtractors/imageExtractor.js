import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import path from 'path';
import { URL } from 'url';

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
 * Extract image information from pages
 */
export const extract = async (pages) => {
  try {
    logger.info('[IMAGES] 🖼️ Starting image extraction from ' + pages.length + ' pages');
    
    // Find the homepage
    const homepage = pages.find(page => {
      try {
        const url = new URL(page.url);
        return url.pathname === '/' || url.pathname === '';
      } catch (error) {
        return false;
      }
    }) || pages[0]; // Fallback to first page if homepage not found
    
    logger.info(`[IMAGES] Homepage identified as: ${homepage.url}`);
    
    // Extract all images with categorization
    const allImages = [];
    
    // Process homepage first (for hero images, logos, etc.)
    logger.info(`[IMAGES] Processing homepage for hero images, logos, and other important visuals`);
    const homepageImages = extractImagesFromPage(homepage, true);
    logger.info(`[IMAGES] Found ${homepageImages.length} images on homepage`);
    allImages.push(...homepageImages);
    
    // Process other pages
    let pagesProcessed = 0;
    for (const page of pages) {
      if (page.url === homepage.url) continue; // Skip homepage as it's already processed
      
      logger.info(`[IMAGES] Processing page: ${page.url}`);
      const pageImages = extractImagesFromPage(page, false);
      logger.info(`[IMAGES] Found ${pageImages.length} images on ${page.url}`);
      allImages.push(...pageImages);
      pagesProcessed++;
      
      // Log progress every 5 pages
      if (pagesProcessed % 5 === 0) {
        logger.info(`[IMAGES] Processed ${pagesProcessed}/${pages.length-1} pages (excluding homepage), found ${allImages.length} total images so far`);
      }
    }
    
    // Deduplicate images by URL
    logger.info(`[IMAGES] Deduplicating ${allImages.length} total images found`);
    const uniqueImages = deduplicateImages(allImages);
    logger.info(`[IMAGES] After deduplication: ${uniqueImages.length} unique images`);
    
    // Categorize all images
    logger.info(`[IMAGES] Categorizing images by type`);
    const categorizedImages = categorizeImages(uniqueImages);
    
    // Log image counts by category
    for (const category in categorizedImages) {
      logger.info(`[IMAGES] ${category} images: ${categorizedImages[category].length}`);
    }
    
    // Create the structured result
    logger.info(`[IMAGES] ✅ Image extraction complete, found ${uniqueImages.length} unique images`);
    
    return {
      all: uniqueImages,
      byCategory: categorizedImages,
      heroImages: categorizedImages[IMAGE_CATEGORIES.HERO] || [],
      brandImages: categorizedImages[IMAGE_CATEGORIES.LOGO] || [],
      productImages: categorizedImages[IMAGE_CATEGORIES.PRODUCT] || [],
      contentImages: categorizedImages[IMAGE_CATEGORIES.CONTENT] || [],
      backgroundImages: categorizedImages[IMAGE_CATEGORIES.BACKGROUND] || [],
      bannerImages: categorizedImages[IMAGE_CATEGORIES.BANNER] || [],
      galleryImages: categorizedImages[IMAGE_CATEGORIES.GALLERY] || [],
      socialProofImages: categorizedImages[IMAGE_CATEGORIES.SOCIAL_PROOF] || [],
      teamImages: categorizedImages[IMAGE_CATEGORIES.TEAM] || [],
      otherImages: categorizedImages[IMAGE_CATEGORIES.OTHER] || []
    };
  } catch (error) {
    logger.error(`[IMAGES] ❌ Error extracting image information: ${error.message}`);
    logger.error(error.stack);
    return {
      all: [],
      byCategory: {},
      heroImages: [],
      brandImages: []
    };
  }
};

/**
 * Extract and categorize images from a single page
 */
function extractImagesFromPage(page, isHomepage) {
  try {
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
        addPreliminaryCategorization(image, $, $img, page);
        
        // Add to images array
        images.push(image);
      } catch (error) {
        // Skip invalid URLs
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
            addPreliminaryCategorization(image, $, $element, page);
            
            // Add to images array
            images.push(image);
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    return images;
    
  } catch (error) {
    logger.error(`Error extracting images from page ${page.url}: ${error.message}`);
    logger.error(error.stack);
    return [];
  }
}

/**
 * Add preliminary categorization to image based on various signals
 */
function addPreliminaryCategorization(image, $, $element, page) {
  const { url, alt, selector, context, isBackground } = image;
  const urlLower = url.toLowerCase();
  const altLower = alt ? alt.toLowerCase() : '';
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
  
  // Logo detection - enhanced with additional checks
  if (
    urlLower.includes('logo') ||
    altLower.includes('logo') ||
    altLower.includes('brand') ||
    selectorLower.includes('logo') ||
    selectorLower.includes('brand') ||
    contextLower.includes('logo') ||
    contextLower.includes('brand') ||
    // Additional checks for logo detection
    (image.fileFormat === 'svg') || // SVG images are commonly used for logos
    ($element.closest('header').length > 0 && (!image.width || image.width < 300)) || // Small images in header
    (!alt && $element.closest('header').length > 0) || // Images with no alt text in header
    $element.parent('a[href="/"], a[href="./"], a[href="index.html"]').length > 0 || // Images linked to homepage
    $element.parent(`a[href="${image.pageUrl}"]`).length > 0 || // Images linked to current page
    contextLower.includes('navbar') || // Images in navbar
    contextLower.includes('nav-') || // Images in nav components
    (image.position < 3 && image.isHomepage && !image.width) // Early images on homepage without specified width
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

export default {
  extract
}; 