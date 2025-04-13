import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import { getPool } from '../../../config/database.js';

/**
 * Extract ISBN numbers from pages
 * @param {Array} pages - Array of page objects with url and content
 * @param {number} domainId - Optional domain ID for saving to database
 * @returns {Promise<Object>} - Extracted ISBN data
 */
export const extract = async (pages, domainId = null) => {
  try {
    logger.info('[ISBN] Extracting ISBN numbers from content');
    
    // Enhanced ISBN detection regex to match more formats:
    // - 978-3-16-148410-0 (hyphenated)
    // - 9783161484100 (no separators)
    // - 978 3 16 148410 0 (space-separated)
    // - 978.3.16.148410.0 (dot-separated)
    // - ISBN: 9783161484100 (with prefix)
    // - ISBN-13: 978-3-16-148410-0 (with type prefix)
    const potentialIsbnRegex = /\b(?:ISBN[-.: ]?(?:1[03])?[-.: ]?)?(?=[0-9X]{10}$|(?=(?:[0-9]+[-\s.]){3})[-\s.0-9X]{13,17}$|97[89][0-9]{10}$|(?=(?:[0-9]+[-\s.]){4})[-\s.0-9]{17,19}$)(?:97[89][-\s.]?)?[0-9]{1,5}[-\s.]?[0-9]+[-\s.]?[0-9]+[-\s.]?[0-9X]\b/gim;
    
    // More strict ISBN patterns for validation
    const isbn10Pattern = /^(?:\d[- .]?){9}[\dX]$/i;
    const isbn13Pattern = /^(?:97[89][- .]?)?(?:\d[- .]?){9}[\dX]$/i;
    
    // Results structure
    const results = {
      isbns: [],
      isbnImages: []
    };
    
    // Process each page
    for (const page of pages) {
      if (!page.content) continue;
      
      const $ = cheerio.load(page.content);
      
      // Get page ID if available (for database saving)
      const pageId = page.pageId || page.id || null;
      
      // 1. Check page URL for ISBNs
      logger.debug(`[ISBN] Checking URL for ISBN: ${page.url}`);
      extractIsbnFromUrl(page.url, results.isbns, page.url, 'page url');
      
      // 2. Look for ISBNs in text content
      logger.debug(`[ISBN] Scanning text content for ISBNs`);
      const textContent = $('body').text();
      const isbnMatches = [...new Set(textContent.match(potentialIsbnRegex) || [])];
      
      // Validate and normalize found ISBNs
      for (const match of isbnMatches) {
        // Clean up the match (remove non-digits and non-X characters)
        const cleaned = match.replace(/[^0-9X]/gi, '');
        
        // Basic validation - ISBN-10 is 10 digits, ISBN-13 is 13 digits
        if ((cleaned.length === 10 && isbn10Pattern.test(match)) || 
            (cleaned.length === 13 && isbn13Pattern.test(match))) {
          
          // Additional validation with checksum
          const isValid = cleaned.length === 10 ? 
            validateIsbn10(cleaned) : 
            validateIsbn13(cleaned);
          
          // Add to results if not already present and valid checksum
          if (isValid && !results.isbns.some(item => item.cleaned === cleaned)) {
            logger.debug(`[ISBN] Found ISBN ${cleaned} in page text`);
            results.isbns.push({
              raw: match,
              cleaned: cleaned,
              type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
              page: page.url,
              validated: true
            });
          } else if (!isValid) {
            logger.debug(`[ISBN] Skipping invalid ISBN ${cleaned} (failed checksum)`);
          }
        }
      }
      
      // 3. Look for ISBN text near specific elements (like book titles, product descriptions)
      const bookSelectors = [
        '.book', '.product', '.publication', 
        '[itemtype*="Book"]', '[itemtype*="Product"]',
        '[itemtype*="CreativeWork"]', '[typeof*="Book"]',
        'article', 'section',
        '.isbn', '#isbn',
        'dl', 'table', '.book-details',
        '.product-details', '.product-info',
        '.details', '.specifications'
      ];
      
      logger.debug(`[ISBN] Checking book-related elements`);
      bookSelectors.forEach(selector => {
        $(selector).each((_, element) => {
          const elementText = $(element).text();
          const elementIsbns = [...new Set(elementText.match(potentialIsbnRegex) || [])];
          
          for (const match of elementIsbns) {
            const cleaned = match.replace(/[^0-9X]/gi, '');
            
            if ((cleaned.length === 10 || cleaned.length === 13) && 
                !results.isbns.some(item => item.cleaned === cleaned)) {
              
              // Validate with checksum
              const isValid = cleaned.length === 10 ? 
                validateIsbn10(cleaned) : 
                validateIsbn13(cleaned);
              
              if (isValid) {
                logger.debug(`[ISBN] Found ISBN ${cleaned} in book element`);
                results.isbns.push({
                  raw: match,
                  cleaned: cleaned,
                  type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: page.url,
                  context: 'book element',
                  validated: true
                });
              }
            }
          }
        });
      });
      
      // 4. Check for explicit ISBN mentions with enhanced context capture
      logger.debug(`[ISBN] Checking for explicit ISBN mentions`);
      $('*:contains("ISBN")').each((_, element) => {
        // Skip script and style elements
        if ($(element).is('script, style, meta')) return;
        
        const text = $(element).text();
        if (text.includes('ISBN')) {
          // Try to capture context by getting parent element text if it's short enough
          let context = text.trim();
          if (context.length > 150) {
            // If too long, try to extract just the part with the ISBN
            const isbnIndex = context.indexOf('ISBN');
            if (isbnIndex >= 0) {
              const start = Math.max(0, isbnIndex - 30);
              const end = Math.min(context.length, isbnIndex + 60);
              context = context.substring(start, end).trim();
            } else {
              context = 'explicit ISBN mention';
            }
          }
          
          const isbnMatches = [...new Set(text.match(potentialIsbnRegex) || [])];
          
          for (const match of isbnMatches) {
            const cleaned = match.replace(/[^0-9X]/gi, '');
            
            if ((cleaned.length === 10 || cleaned.length === 13) && 
                !results.isbns.some(item => item.cleaned === cleaned)) {
              
              // Validate with checksum
              const isValid = cleaned.length === 10 ? 
                validateIsbn10(cleaned) : 
                validateIsbn13(cleaned);
              
              if (isValid) {
                logger.debug(`[ISBN] Found explicit ISBN ${cleaned}`);
                results.isbns.push({
                  raw: match,
                  cleaned: cleaned,
                  type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: page.url,
                  context: context,
                  validated: true
                });
              }
            }
          }
        }
      });
      
      // 5. Look for ISBNs in image sources, alt text, and data attributes
      logger.debug(`[ISBN] Scanning images for ISBNs`);
      $('img').each((_, element) => {
        const $img = $(element);
        const src = $img.attr('src');
        const alt = $img.attr('alt') || '';
        const title = $img.attr('title') || '';
        
        // Check attributes for ISBN-like patterns
        if (src) {
          // Check if the image URL contains ISBN pattern
          const imgUrl = new URL(src, page.url).href;
          extractIsbnFromUrl(imgUrl, results.isbnImages, page.url, 'image source', imgUrl, alt);
          
          // Check alt text and title attributes
          if (alt) {
            const altIsbns = [...new Set(alt.match(potentialIsbnRegex) || [])];
            for (const match of altIsbns) {
              const cleaned = match.replace(/[^0-9X]/gi, '');
              
              if ((cleaned.length === 10 || cleaned.length === 13) && 
                  !results.isbnImages.some(item => item.isbn === cleaned)) {
                
                // Validate with checksum
                const isValid = cleaned.length === 10 ? 
                  validateIsbn10(cleaned) : 
                  validateIsbn13(cleaned);
                
                if (isValid) {
                  logger.debug(`[ISBN] Found ISBN ${cleaned} in image alt text`);
                  results.isbnImages.push({
                    imageUrl: imgUrl,
                    isbn: cleaned,
                    type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                    page: page.url,
                    alt: alt,
                    context: 'alt text',
                    validated: true
                  });
                }
              }
            }
          }
          
          if (title) {
            const titleIsbns = [...new Set(title.match(potentialIsbnRegex) || [])];
            for (const match of titleIsbns) {
              const cleaned = match.replace(/[^0-9X]/gi, '');
              
              if ((cleaned.length === 10 || cleaned.length === 13) && 
                  !results.isbnImages.some(item => item.isbn === cleaned)) {
                
                // Validate with checksum
                const isValid = cleaned.length === 10 ? 
                  validateIsbn10(cleaned) : 
                  validateIsbn13(cleaned);
                
                if (isValid) {
                  logger.debug(`[ISBN] Found ISBN ${cleaned} in image title attribute`);
                  results.isbnImages.push({
                    imageUrl: imgUrl,
                    isbn: cleaned,
                    type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                    page: page.url,
                    alt: alt,
                    context: 'title attribute',
                    validated: true
                  });
                }
              }
            }
          }
        }
        
        // Check nearby figcaption or parent context
        const $figcaption = $img.closest('figure').find('figcaption');
        if ($figcaption.length > 0) {
          const captionText = $figcaption.text();
          const captionIsbns = [...new Set(captionText.match(potentialIsbnRegex) || [])];
          
          for (const match of captionIsbns) {
            const cleaned = match.replace(/[^0-9X]/gi, '');
            
            if ((cleaned.length === 10 || cleaned.length === 13) && src && 
                !results.isbnImages.some(item => item.isbn === cleaned)) {
              
              // Validate with checksum
              const isValid = cleaned.length === 10 ? 
                validateIsbn10(cleaned) : 
                validateIsbn13(cleaned);
              
              if (isValid) {
                const imgUrl = new URL(src, page.url).href;
                logger.debug(`[ISBN] Found ISBN ${cleaned} in image caption`);
                results.isbnImages.push({
                  imageUrl: imgUrl,
                  isbn: cleaned,
                  type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: page.url,
                  alt: alt,
                  context: 'figure caption',
                  validated: true
                });
              }
            }
          }
        }
      });
      
      // 6. Check for ISBNs in metadata
      logger.debug(`[ISBN] Checking metadata for ISBNs`);
      $('meta').each((_, element) => {
        const content = $(element).attr('content') || '';
        
        if (content) {
          const metaIsbns = [...new Set(content.match(potentialIsbnRegex) || [])];
          for (const match of metaIsbns) {
            const cleaned = match.replace(/[^0-9X]/gi, '');
            
            if ((cleaned.length === 10 || cleaned.length === 13) && 
                !results.isbns.some(item => item.cleaned === cleaned)) {
              
              // Validate with checksum
              const isValid = cleaned.length === 10 ? 
                validateIsbn10(cleaned) : 
                validateIsbn13(cleaned);
              
              if (isValid) {
                logger.debug(`[ISBN] Found ISBN ${cleaned} in metadata`);
                results.isbns.push({
                  raw: match,
                  cleaned: cleaned,
                  type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: page.url,
                  context: 'metadata',
                  validated: true
                });
              }
            }
          }
        }
      });
      
      // 7. Check for ISBNs in schema.org markup
      logger.debug(`[ISBN] Checking schema.org markup for ISBNs`);
      $('script[type="application/ld+json"]').each((_, element) => {
        try {
          const json = JSON.parse($(element).html());
          
          // Look for ISBN in schema.org Book type
          if (json['@type'] === 'Book' && json.isbn) {
            const isbn = String(json.isbn).replace(/[^0-9X]/gi, '');
            
            if ((isbn.length === 10 || isbn.length === 13) && 
                !results.isbns.some(item => item.cleaned === isbn)) {
              
              // Validate with checksum
              const isValid = isbn.length === 10 ? 
                validateIsbn10(isbn) : 
                validateIsbn13(isbn);
              
              if (isValid) {
                logger.debug(`[ISBN] Found ISBN ${isbn} in schema.org markup`);
                results.isbns.push({
                  raw: json.isbn,
                  cleaned: isbn,
                  type: isbn.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: page.url,
                  context: 'schema.org markup',
                  validated: true
                });
              }
            }
          }
          
          // Also look for ISBN in Product type with gtin13 property
          if (json['@type'] === 'Product' && json.gtin13) {
            const gtin = String(json.gtin13).replace(/[^0-9]/gi, '');
            
            if (gtin.length === 13 && gtin.startsWith('978') || gtin.startsWith('979')) {
              const isValid = validateIsbn13(gtin);
              
              if (isValid && !results.isbns.some(item => item.cleaned === gtin)) {
                logger.debug(`[ISBN] Found ISBN in schema.org Product.gtin13`);
                results.isbns.push({
                  raw: json.gtin13,
                  cleaned: gtin,
                  type: 'ISBN-13',
                  page: page.url,
                  context: 'schema.org gtin13',
                  validated: true
                });
              }
            }
          }
        } catch (error) {
          // Ignore JSON parsing errors
        }
      });
      
      // 8. Check for ISBNs in RDFa and microdata
      logger.debug(`[ISBN] Checking RDFa and microdata for ISBNs`);
      $('[property="isbn"], [itemprop="isbn"]').each((_, element) => {
        const content = $(element).attr('content') || $(element).text() || '';
        
        if (content) {
          const isbn = content.replace(/[^0-9X]/gi, '');
          
          if ((isbn.length === 10 || isbn.length === 13) && 
              !results.isbns.some(item => item.cleaned === isbn)) {
            
            // Validate with checksum
            const isValid = isbn.length === 10 ? 
              validateIsbn10(isbn) : 
              validateIsbn13(isbn);
            
            if (isValid) {
              logger.debug(`[ISBN] Found ISBN ${isbn} in RDFa/microdata`);
              results.isbns.push({
                raw: content,
                cleaned: isbn,
                type: isbn.length === 10 ? 'ISBN-10' : 'ISBN-13',
                page: page.url,
                context: 'structured data markup',
                validated: true
              });
            }
          }
        }
      });
      
      // 9. Look for ISBNs in <code> elements or specific text formats
      logger.debug(`[ISBN] Checking code elements for ISBNs`);
      $('code, pre, .isbn-display, span[class*="isbn"]').each((_, element) => {
        const text = $(element).text();
        const codeIsbns = [...new Set(text.match(potentialIsbnRegex) || [])];
        
        for (const match of codeIsbns) {
          const cleaned = match.replace(/[^0-9X]/gi, '');
          
          if ((cleaned.length === 10 || cleaned.length === 13) && 
              !results.isbns.some(item => item.cleaned === cleaned)) {
            
            // Validate with checksum
            const isValid = cleaned.length === 10 ? 
              validateIsbn10(cleaned) : 
              validateIsbn13(cleaned);
            
            if (isValid) {
              logger.debug(`[ISBN] Found ISBN ${cleaned} in code element`);
              results.isbns.push({
                raw: match,
                cleaned: cleaned,
                type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                page: page.url,
                context: 'code element',
                validated: true
              });
            }
          }
        }
      });
    }
    
    // After all extraction is done, save to database if we have domainId
    if (domainId) {
      try {
        const db = getPool();
        let savedCount = 0;
        
        // Save regular ISBNs
        for (const isbn of results.isbns) {
          if (!isbn.cleaned) continue;
          
          try {
            // First check if this ISBN already exists for this domain to avoid duplicates
            const [existingRows] = await db.execute(
              `SELECT id FROM domain_isbn_data WHERE domain_id = ? AND isbn = ?`,
              [domainId, isbn.cleaned]
            );
            
            if (existingRows.length === 0) {
              // ISBN doesn't exist yet, insert it
              
              // Check if this is from an image source
              if (isbn.sourceUrl && (isbn.sourceUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i) || isbn.context.includes('image'))) {
                // This is an image ISBN, save to domain_isbn_images
                await db.execute(
                  `INSERT INTO domain_isbn_images 
                   (domain_id, isbn, image_url, page_url, alt_text, created_at) 
                   VALUES (?, ?, ?, ?, ?, NOW())`,
                  [
                    domainId,
                    isbn.cleaned,
                    isbn.sourceUrl || '',
                    isbn.page || '',
                    isbn.alt || ''
                  ]
                );
              } else {
                // Regular ISBN, save to domain_isbn_data
                await db.execute(
                  `INSERT INTO domain_isbn_data 
                   (domain_id, isbn, page_url, context, created_at) 
                   VALUES (?, ?, ?, ?, NOW())`,
                  [
                    domainId,
                    isbn.cleaned,
                    isbn.page || '',
                    isbn.context || ''
                  ]
                );
              }
              savedCount++;
            } else {
              logger.debug(`[ISBN] Skipping duplicate ISBN ${isbn.cleaned} for domain ${domainId}`);
            }
          } catch (innerError) {
            logger.warn(`[ISBN] Error saving individual ISBN ${isbn.cleaned}: ${innerError.message}`);
          }
        }
        
        // Also save image ISBNs
        for (const isbnImage of results.isbnImages) {
          if (!isbnImage.isbn) continue;
          
          try {
            // Check if this ISBN already exists for this domain
            const [existingRows] = await db.execute(
              `SELECT id FROM domain_isbn_images WHERE domain_id = ? AND isbn = ? AND image_url = ?`,
              [domainId, isbnImage.isbn, isbnImage.imageUrl || '']
            );
            
            if (existingRows.length === 0) {
              // Get the page URL from the isbnImage object
              const pageUrl = isbnImage.page || '';
              
              // Insert the new ISBN image
              await db.execute(
                `INSERT INTO domain_isbn_images 
                 (domain_id, isbn, image_url, page_url, alt_text, created_at) 
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                  domainId,
                  isbnImage.isbn,
                  isbnImage.imageUrl || '',
                  pageUrl,
                  isbnImage.alt || ''
                ]
              );
              savedCount++;
            }
          } catch (innerError) {
            logger.warn(`[ISBN] Error saving image ISBN ${isbnImage.isbn} to database: ${innerError.message}`);
          }
        }
        
        if (savedCount > 0) {
          logger.info(`[ISBN] Saved ${savedCount} new ISBNs to database`);
        }
      } catch (dbError) {
        logger.error(`[ISBN] Database error saving ISBNs: ${dbError.message}`);
      }
    }
    
    // Remove duplicates and clean up results
    results.isbns = [...new Map(results.isbns.map(item => [item.cleaned, item])).values()];
    results.isbnImages = [...new Map(results.isbnImages.map(item => [item.isbn, item])).values()];
    
    logger.info(`[ISBN] Found ${results.isbns.length} ISBN numbers and ${results.isbnImages.length} ISBN images`);
    
    // Log some sample ISBNs found
    if (results.isbns.length > 0) {
      const sampleIsbns = results.isbns.slice(0, Math.min(3, results.isbns.length));
      logger.info(`[ISBN] Sample ISBNs: ${sampleIsbns.map(isbn => isbn.cleaned).join(', ')}`);
    }
    
    return results;
    
  } catch (error) {
    logger.error(`[ISBN] Error extracting ISBN data: ${error.message}`);
    logger.error(error.stack);
    return {
      isbns: [],
      isbnImages: []
    };
  }
};

/**
 * Extracts an ISBN from a URL if present
 * @param {string} url - URL to check for ISBN
 * @param {Array} results - Results array to push found ISBNs to
 * @param {string} pageUrl - Original page URL
 * @param {string} context - Context of where ISBN was found
 * @param {string} [imageUrl=null] - Image URL if this is an image-based ISBN
 * @param {string} [alt=''] - Alt text if this is an image
 */
function extractIsbnFromUrl(url, results, pageUrl, context, imageUrl = null, alt = '') {
  try {
    // Clean up URL for easier detection
    const urlString = decodeURIComponent(url).replace(/[+_]/g, '-');
    
    // Look for ISBN-like patterns in URL
    const isbn10Match = urlString.match(/\b\d{9}[\dX]\b/gi);
    const isbn13Match = urlString.match(/\b97[89]\d{10}\b/gi);
    
    // Also look for hyphenated or formatted versions
    const formattedISBN = urlString.match(/\b(?:97[89][-. ]?)?(?:\d[-. ]?){9}[\dX]\b/gi);
    
    const matches = [...new Set([
      ...(isbn10Match || []),
      ...(isbn13Match || []),
      ...(formattedISBN || [])
    ])];
    
    for (const match of matches) {
      const cleaned = match.replace(/[^0-9X]/gi, '');
      
      if ((cleaned.length === 10 || cleaned.length === 13)) {
        // Validate with checksum
        const isValid = cleaned.length === 10 ? 
          validateIsbn10(cleaned) : 
          validateIsbn13(cleaned);
        
        if (isValid) {
          // Add to appropriate results array based on whether this is an image URL
          if (imageUrl) {
            if (!results.some(item => item.isbn === cleaned)) {
              logger.debug(`[ISBN] Found ISBN ${cleaned} in image URL/alt`);
              results.push({
                imageUrl: imageUrl,
                isbn: cleaned,
                type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                page: pageUrl,
                alt: alt,
                context: context,
                validated: true
              });
            }
          } else {
            if (!results.some(item => item.cleaned === cleaned)) {
              logger.debug(`[ISBN] Found ISBN ${cleaned} in URL`);
              results.push({
                raw: match,
                cleaned: cleaned,
                type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                page: pageUrl,
                context: context,
                validated: true
              });
            }
          }
        }
      }
    }
  } catch (error) {
    // Ignore URL parsing errors
    logger.debug(`[ISBN] Error extracting ISBN from URL: ${error.message}`);
  }
}

/**
 * Normalizes an ISBN by removing all non-ISBN characters
 * @param {string} isbn - The ISBN string to normalize
 * @returns {string} - Normalized ISBN
 */
function normalizeIsbn(isbn) {
  return isbn.replace(/[^0-9X]/gi, '');
}

/**
 * Validates an ISBN-10 number using the checksum algorithm
 * @param {string} isbn - The ISBN-10 to validate (normalized format)
 * @returns {boolean} - Whether the ISBN is valid
 */
function validateIsbn10(isbn) {
  if (isbn.length !== 10) return false;
  
  // Convert 'X' to '10' for the check digit
  const digits = isbn.split('').map((char, index) => {
    if (index === 9 && char.toUpperCase() === 'X') return 10;
    return parseInt(char, 10);
  });
  
  // Calculate checksum: sum of digits * position (10 to 1) must be divisible by 11
  const sum = digits.reduce((total, digit, index) => {
    return total + digit * (10 - index);
  }, 0);
  
  return sum % 11 === 0;
}

/**
 * Validates an ISBN-13 number using the checksum algorithm
 * @param {string} isbn - The ISBN-13 to validate (normalized format)
 * @returns {boolean} - Whether the ISBN is valid
 */
function validateIsbn13(isbn) {
  if (isbn.length !== 13) return false;
  
  // Calculate checksum: sum of (digit * (1 or 3 alternating)) must be divisible by 10
  const sum = isbn.split('').reduce((total, char, index) => {
    const digit = parseInt(char, 10);
    // Multiply by 1 for even positions, 3 for odd positions (0-indexed)
    const weight = index % 2 === 0 ? 1 : 3;
    return total + (digit * weight);
  }, 0);
  
  return sum % 10 === 0;
}

/**
 * Extracts ISBNs from all URLs found on a page (links, image sources, etc.)
 * @param {string} pageUrl - The URL of the page
 * @param {string} pageContent - The HTML content of the page
 * @param {number} domainId - The domain ID for database storage
 * @param {number} pageId - The page ID for database storage
 * @returns {Promise<Object>} - Object with extracted ISBNs from URLs
 */
export const extractIsbnFromPageUrls = async (pageUrl, pageContent, domainId, pageId) => {
  try {
    logger.info(`[ISBN] Extracting ISBNs from all URLs on page: ${pageUrl}`);
    
    if (!pageContent) {
      logger.warn(`[ISBN] No content provided for page: ${pageUrl}`);
      return { urlIsbns: [] };
    }
    
    const $ = cheerio.load(pageContent);
    const foundUrls = new Set();
    const foundIsbns = [];
    
    // Extract all links
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        try {
          const absoluteUrl = new URL(href, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    // Extract image sources
    $('img[src]').each((_, element) => {
      const src = $(element).attr('src');
      if (src) {
        try {
          const absoluteUrl = new URL(src, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    // Extract other media sources (video, audio, etc.)
    $('video source[src], audio source[src], iframe[src]').each((_, element) => {
      const src = $(element).attr('src');
      if (src) {
        try {
          const absoluteUrl = new URL(src, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    // Extract from meta tags
    $('meta[content]').each((_, element) => {
      const content = $(element).attr('content');
      if (content && content.startsWith('http')) {
        try {
          foundUrls.add(content);
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    // Extract from data attributes
    $('[data-src], [data-href], [data-url]').each((_, element) => {
      const $el = $(element);
      const dataSrc = $el.attr('data-src');
      const dataHref = $el.attr('data-href');
      const dataUrl = $el.attr('data-url');
      
      if (dataSrc) {
        try {
          const absoluteUrl = new URL(dataSrc, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
      
      if (dataHref) {
        try {
          const absoluteUrl = new URL(dataHref, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
      
      if (dataUrl) {
        try {
          const absoluteUrl = new URL(dataUrl, pageUrl).href;
          foundUrls.add(absoluteUrl);
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    logger.info(`[ISBN] Found ${foundUrls.size} URLs to check for ISBNs on page: ${pageUrl}`);
    
    // Check each URL for ISBN patterns
    for (const url of foundUrls) {
      // Create a temporary array to collect ISBNs from this URL
      const urlIsbnResults = [];
      
      // Extract ISBNs from URL and add to our results array
      extractIsbnFromUrl(url, urlIsbnResults, pageUrl, 'URL on page');
      
      // If we found ISBNs, add them to our collection
      if (urlIsbnResults.length > 0) {
        for (const isbnObj of urlIsbnResults) {
          // Add source URL to each result
          isbnObj.sourceUrl = url;
          foundIsbns.push(isbnObj);
        }
      }
      
      // Also check URL path segments for ISBN-like patterns
      try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        
        for (const segment of pathSegments) {
          if (segment.length >= 10 && segment.length <= 13) {
            // Possible ISBN in path
            const cleaned = segment.replace(/[^0-9X]/gi, '');
            
            if ((cleaned.length === 10 || cleaned.length === 13) && 
                !foundIsbns.some(item => item.cleaned === cleaned)) {
              
              // Validate with checksum
              const isValid = cleaned.length === 10 ? 
                validateIsbn10(cleaned) : 
                validateIsbn13(cleaned);
              
              if (isValid) {
                logger.info(`[ISBN] Found ISBN ${cleaned} in URL path segment of ${url}`);
                foundIsbns.push({
                  raw: segment,
                  cleaned: cleaned,
                  type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                  page: pageUrl,
                  sourceUrl: url,
                  context: 'URL path segment',
                  validated: true
                });
              }
            }
          }
        }
      } catch (error) {
        // Skip URL parsing errors
      }
    }
    
    // Save to database if we have domain ID and page ID
    if (domainId && pageId && foundIsbns.length > 0) {
      try {
        logger.info(`[ISBN] Saving ${foundIsbns.length} ISBNs from URLs to database`);
        
        const db = getPool();
        let savedCount = 0;
        
        for (const isbn of foundIsbns) {
          try {
            // First check if this ISBN already exists for this domain to avoid duplicates
            const [existingRows] = await db.execute(
              `SELECT id FROM domain_isbn_data WHERE domain_id = ? AND isbn = ?`,
              [domainId, isbn.cleaned]
            );
            
            if (existingRows.length === 0) {
              // Insert the new ISBN
              await db.execute(
                `INSERT INTO domain_isbn_data 
                 (domain_id, isbn, page_url, context, created_at) 
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                  domainId,
                  isbn.cleaned,
                  isbn.page || '',
                  isbn.context || ''
                ]
              );
              savedCount++;
            }
          } catch (innerError) {
            logger.warn(`[ISBN] Error saving ISBN ${isbn.cleaned} to database: ${innerError.message}`);
          }
        }
        
        logger.info(`[ISBN] Successfully saved ${savedCount} new ISBNs from URLs to database`);
      } catch (dbError) {
        logger.error(`[ISBN] Error saving ISBNs from URLs to database: ${dbError.message}`);
      }
    }
    
    return { urlIsbns: foundIsbns };
  } catch (error) {
    logger.error(`[ISBN] Error extracting ISBNs from page URLs: ${error.message}`);
    return { urlIsbns: [] };
  }
};

/**
 * Scan a single URL for ISBN patterns
 * @param {string} url - The URL to scan
 * @returns {Promise<Object>} - Object with extracted ISBN if found
 */
export const scanUrlForIsbn = async (url) => {
  try {
    const extractedIsbns = extractIsbnFromUrl(url, [], '', 'direct URL scan');
    
    if (extractedIsbns && extractedIsbns.length > 0) {
      return { found: true, isbns: extractedIsbns };
    }
    
    // Check URL path segments for ISBN-like patterns
    try {
      const foundIsbns = [];
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      
      for (const segment of pathSegments) {
        if (segment.length >= 10 && segment.length <= 13) {
          // Possible ISBN in path
          const cleaned = segment.replace(/[^0-9X]/gi, '');
          
          if (cleaned.length === 10 || cleaned.length === 13) {
            // Validate with checksum
            const isValid = cleaned.length === 10 ? 
              validateIsbn10(cleaned) : 
              validateIsbn13(cleaned);
            
            if (isValid) {
              logger.info(`[ISBN] Found ISBN ${cleaned} in URL path segment of ${url}`);
              foundIsbns.push({
                raw: segment,
                cleaned: cleaned,
                type: cleaned.length === 10 ? 'ISBN-10' : 'ISBN-13',
                context: 'URL path segment',
                validated: true
              });
            }
          }
        }
      }
      
      if (foundIsbns.length > 0) {
        return { found: true, isbns: foundIsbns };
      }
    } catch (error) {
      // Skip URL parsing errors
    }
    
    return { found: false, isbns: [] };
  } catch (error) {
    logger.error(`[ISBN] Error scanning URL for ISBN: ${error.message}`);
    return { found: false, isbns: [] };
  }
};

export default {
  extract,
  extractIsbnFromPageUrls,
  scanUrlForIsbn
}; 