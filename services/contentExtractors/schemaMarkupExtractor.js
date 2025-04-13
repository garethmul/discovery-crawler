import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import { getPool } from '../../../config/database.js';

/**
 * Schema.org markup extractor
 * Extracts structured data in JSON-LD, Microdata, and RDFa formats
 */
const schemaMarkupExtractor = {
  /**
   * Extract schema.org markup from a list of pages
   * @param {Array} pages - List of pages with URL and content
   * @returns {Object} Object containing extracted markup
   */
  async extract(pages) {
    logger.info(`[SCHEMA] Extracting schema.org markup from ${pages.length} pages`);
    const allMarkup = [];

    for (const page of pages) {
      if (!page.content) continue;

      try {
        const markup = await this.extractSchemaMarkup(page.url, page.content);
        if (markup && markup.markup && markup.markup.length > 0) {
          allMarkup.push(...markup.markup);
        }
      } catch (error) {
        logger.error(`[SCHEMA] Error extracting schema markup from ${page.url}: ${error.message}`);
      }
    }

    return { markup: allMarkup };
  },

  /**
   * Extract schema.org markup from a single page
   * @param {string} url - URL of the page
   * @param {string} content - HTML content of the page
   * @param {number} domainId - ID of the domain in the database
   * @param {number} pageId - ID of the page in the database
   * @returns {Object} Object containing extracted markup
   */
  async extractSchemaMarkup(url, content, domainId = null, pageId = null) {
    try {
      logger.info(`[SCHEMA] Processing schema markup for ${url}`);
      
      const $ = cheerio.load(content);
      const markupItems = [];

      // Extract JSON-LD
      const jsonLdItems = this.extractJsonLd($);
      if (jsonLdItems.length > 0) {
        markupItems.push(...jsonLdItems.map(item => ({
          url,
          schema_type: item['@type'] || 'Unknown',
          format: 'json-ld',
          data: JSON.stringify(item),
          properties: this.extractKeyProperties(item)
        })));
      }

      // Extract Microdata
      const microdataItems = this.extractMicrodata($);
      if (microdataItems.length > 0) {
        markupItems.push(...microdataItems.map(item => ({
          url,
          schema_type: item.type || 'Unknown',
          format: 'microdata',
          data: JSON.stringify(item),
          properties: this.extractKeyProperties(item)
        })));
      }

      // Extract RDFa
      const rdfaItems = this.extractRdfa($);
      if (rdfaItems.length > 0) {
        markupItems.push(...rdfaItems.map(item => ({
          url,
          schema_type: item.type || 'Unknown',
          format: 'rdfa',
          data: JSON.stringify(item),
          properties: this.extractKeyProperties(item)
        })));
      }

      logger.info(`[SCHEMA] Found ${markupItems.length} schema.org items on ${url}`);

      // Save to database if we have a domain ID and page ID
      if (domainId && pageId && markupItems.length > 0) {
        await this.saveToDatabase(domainId, pageId, markupItems);
      }

      return { markup: markupItems };
    } catch (error) {
      logger.error(`[SCHEMA] Error processing schema markup for ${url}: ${error.message}`);
      return { markup: [] };
    }
  },

  /**
   * Extract JSON-LD schema markup
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Array of JSON-LD items
   */
  extractJsonLd($) {
    const items = [];
    
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const json = JSON.parse($(element).html());
        
        // Handle both single items and arrays (@graph)
        if (json['@graph']) {
          items.push(...json['@graph']);
        } else if (json['@type']) {
          items.push(json);
        } else if (Array.isArray(json)) {
          items.push(...json);
        }
      } catch (error) {
        logger.warn(`[SCHEMA] Error parsing JSON-LD: ${error.message}`);
      }
    });
    
    return items;
  },

  /**
   * Extract Microdata schema markup
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Array of microdata items
   */
  extractMicrodata($) {
    const items = [];
    
    $('[itemscope]').each((_, element) => {
      try {
        const $element = $(element);
        const type = $element.attr('itemtype') || '';
        
        // Only process schema.org types
        if (!type.includes('schema.org')) return;
        
        const item = {
          type: type.split('/').pop(),
          properties: {}
        };
        
        $element.find('[itemprop]').each((_, propElement) => {
          const $prop = $(propElement);
          const propName = $prop.attr('itemprop');
          let propValue = $prop.attr('content') || $prop.text().trim();
          
          // Handle different property types
          if ($prop.attr('datetime')) {
            propValue = $prop.attr('datetime');
          } else if ($prop.attr('src')) {
            propValue = $prop.attr('src');
          } else if ($prop.attr('href')) {
            propValue = $prop.attr('href');
          }
          
          item.properties[propName] = propValue;
        });
        
        items.push(item);
      } catch (error) {
        logger.warn(`[SCHEMA] Error parsing Microdata: ${error.message}`);
      }
    });
    
    return items;
  },

  /**
   * Extract RDFa schema markup
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Array of RDFa items
   */
  extractRdfa($) {
    const items = [];
    
    $('[typeof]').each((_, element) => {
      try {
        const $element = $(element);
        const type = $element.attr('typeof') || '';
        
        // Only process schema.org types
        if (!type.includes('schema.org') && !type.startsWith('http://schema.org')) return;
        
        const item = {
          type: type.includes('/') ? type.split('/').pop() : type,
          properties: {}
        };
        
        $element.find('[property]').each((_, propElement) => {
          const $prop = $(propElement);
          const fullProperty = $prop.attr('property');
          
          // Only process schema.org properties
          if (!fullProperty.includes('schema.org') && !fullProperty.startsWith('http://schema.org')) return;
          
          // Extract property name
          const propName = fullProperty.includes(':') 
            ? fullProperty.split(':')[1] 
            : fullProperty.includes('/') 
              ? fullProperty.split('/').pop() 
              : fullProperty;
          
          let propValue = $prop.attr('content') || $prop.text().trim();
          
          // Handle different property types
          if ($prop.attr('datetime')) {
            propValue = $prop.attr('datetime');
          } else if ($prop.attr('src')) {
            propValue = $prop.attr('src');
          } else if ($prop.attr('href')) {
            propValue = $prop.attr('href');
          }
          
          item.properties[propName] = propValue;
        });
        
        items.push(item);
      } catch (error) {
        logger.warn(`[SCHEMA] Error parsing RDFa: ${error.message}`);
      }
    });
    
    return items;
  },

  /**
   * Extract key properties from schema item
   * @param {Object} item - Schema.org item
   * @returns {Object} Object with key properties
   */
  extractKeyProperties(item) {
    const properties = {};
    
    // Extract common properties from different formats
    const dataObj = item.properties || item;
    
    // Standard properties to extract
    const keyProps = [
      'name', 'description', 'url', 'image', 'logo', 'email', 'telephone', 
      'streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry',
      'priceRange', 'openingHours', 'author', 'publisher', 'datePublished', 'dateModified'
    ];
    
    for (const prop of keyProps) {
      if (dataObj[prop]) {
        properties[prop] = typeof dataObj[prop] === 'object' 
          ? JSON.stringify(dataObj[prop]) 
          : dataObj[prop];
      }
    }
    
    return properties;
  },

  /**
   * Save extracted schema markup to database
   * @param {number} domainId - Domain ID
   * @param {number} pageId - Page ID
   * @param {Array} items - Schema markup items
   */
  async saveToDatabase(domainId, pageId, items) {
    try {
      const db = getPool();
      
      for (const item of items) {
        const query = `
          INSERT INTO domain_schema_markup 
          (domain_id, page_id, schema_type, markup_format, markup_data, schema_context, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;
        
        await db.execute(query, [
          domainId,
          pageId,
          item.schema_type,
          item.format,
          item.data,
          JSON.stringify(item.properties)
        ]);
      }
      
      logger.info(`[SCHEMA] Saved ${items.length} schema markup items to database`);
      return true;
    } catch (error) {
      logger.error(`[SCHEMA] Error saving schema markup to database: ${error.message}`);
      return false;
    }
  },

  /**
   * Process a single page for schema markup
   */
  async processPage({ url, content, domainId, pageId }) {
    if (!domainId || !pageId) {
      logger.warn(`[SCHEMA] Cannot process page without domain and page IDs`);
      return { success: false, message: 'Missing domain or page ID' };
    }

    try {
      const result = await this.extractSchemaMarkup(url, content, domainId, pageId);
      return { 
        success: true, 
        message: `Processed ${result.markup.length} schema items`, 
        count: result.markup.length 
      };
    } catch (error) {
      logger.error(`[SCHEMA] Error processing page ${url}: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
};

export default schemaMarkupExtractor; 