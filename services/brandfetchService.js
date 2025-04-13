import axios from 'axios';
import logger from '../utils/logger.js';
import { getPool } from '../database/db.js';
import { extractDomain } from '../utils/urlUtils.js';

/**
 * Fetches brand information from Brandfetch API
 * @param {string} domain - The domain to fetch brand information for
 * @returns {Promise<Object|null>} - The brand information or null if not found/error
 */
export const fetchBrandInfo = async (domain) => {
  try {
    const apiKey = process.env.BRANDFETCH_API_KEY;
    if (!apiKey) {
      logger.warn('No Brandfetch API key found, skipping brand data fetch');
      return null;
    }

    // Normalize the domain (remove protocol, www, etc.)
    const normalizedDomain = extractDomain(domain);
    
    // Check for cached data first
    const db = getPool();
    const [cachedData] = await db.query(
      'SELECT data, created_at FROM brandfetch_data WHERE domain = ?',
      [normalizedDomain]
    );

    if (cachedData && cachedData.length > 0) {
      const createdAt = new Date(cachedData[0].created_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (createdAt >= thirtyDaysAgo) {
        const brandData = JSON.parse(cachedData[0].data);
        logger.info(`Using cached Brandfetch data for ${normalizedDomain}`);
        return brandData;
      }
    }

    // Clean the domain for Brandfetch API (remove protocol and www)
    const cleanDomain = normalizedDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    logger.info(`Calling Brandfetch API for ${cleanDomain}`);
    
    const response = await axios.get(`https://api.brandfetch.io/v2/brands/${cleanDomain}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 30000 // 30 second timeout
    });

    const brandData = response.data;

    // Store in cache
    const dataToStore = JSON.stringify(brandData);
    if (cachedData && cachedData.length > 0) {
      await db.query(
        'UPDATE brandfetch_data SET data = ?, updated_at = NOW() WHERE domain = ?',
        [dataToStore, normalizedDomain]
      );
    } else {
      await db.query(
        'INSERT INTO brandfetch_data (domain, data, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [normalizedDomain, dataToStore]
      );
    }

    // Store structured data if we have a domain_info ID
    const [domainInfo] = await db.query(
      'SELECT id FROM domain_info WHERE domain = ?',
      [normalizedDomain]
    );

    if (domainInfo && domainInfo.length > 0) {
      const domainInfoId = domainInfo[0].id;
      await storeBrandDataInStructuredTables(domainInfoId, brandData);
    }
    
    return brandData;
  } catch (error) {
    logger.error(`Error fetching brand information for ${domain}: ${error.message}`);
    if (error.response) {
      logger.error(`Brandfetch API response status: ${error.response.status}`);
      if (error.response.data) {
        logger.error(`Brandfetch API response data: ${JSON.stringify(error.response.data)}`);
      }
    }
    return null;
  }
};

/**
 * Store brand data in structured tables for easier querying
 * @param {number} domainId - The domain_info ID to associate the brand data with
 * @param {Object} brandData - The brand data from Brandfetch
 */
export const storeBrandDataInStructuredTables = async (domainId, brandData) => {
  try {
    if (!brandData || !domainId) {
      logger.warn('Missing brand data or domain ID for structured storage');
      return;
    }
    
    logger.info(`Storing structured brand data for domain ID: ${domainId}`);
    const db = getPool();
    
    // Extract and store colors from brand data
    if (brandData.colors && Array.isArray(brandData.colors) && brandData.colors.length > 0) {
      // Use the provided domainId directly instead of querying the domain_info table
      const domainsTableId = domainId;
      
      // Store in domain_colors table
      const primaryColor = brandData.colors.find(c => c.type === 'primary')?.hex;
      const secondaryColors = brandData.colors.filter(c => c.type !== 'primary').map(c => c.hex);
      
      // Check if color entry exists
      const [existingColors] = await db.query(
        'SELECT id FROM domain_colors WHERE domain_id = ?',
        [domainsTableId]
      );
      
      if (existingColors.length > 0) {
        await db.query(
          'UPDATE domain_colors SET primary_color = ?, secondary_colors = ?, palette = ?, updated_at = NOW() WHERE domain_id = ?',
          [primaryColor, JSON.stringify(secondaryColors), JSON.stringify(brandData.colors), domainsTableId]
        );
      } else {
        await db.query(
          'INSERT INTO domain_colors (domain_id, primary_color, secondary_colors, palette, created_at) VALUES (?, ?, ?, ?, NOW())',
          [domainsTableId, primaryColor, JSON.stringify(secondaryColors), JSON.stringify(brandData.colors)]
        );
      }
    }
    
    // Extract and store social links in domain_social_podcast table
    if (brandData.links && Array.isArray(brandData.links) && brandData.links.length > 0) {
      // Use the provided domainId directly instead of querying the domain_info table
      const domainsTableId = domainId;
      
      // Format social links for storage
      const socialLinks = {};
      brandData.links.forEach(link => {
        if (link.type && link.url) {
          socialLinks[link.type] = link.url;
        }
      });
      
      // Check if social entry exists
      const [existingSocial] = await db.query(
        'SELECT id FROM domain_social_podcast WHERE domain_id = ?',
        [domainsTableId]
      );
      
      if (existingSocial.length > 0) {
        await db.query(
          'UPDATE domain_social_podcast SET social_links = ?, updated_at = NOW() WHERE domain_id = ?',
          [JSON.stringify(socialLinks), domainsTableId]
        );
      } else {
        await db.query(
          'INSERT INTO domain_social_podcast (domain_id, social_links, created_at) VALUES (?, ?, NOW())',
          [domainsTableId, JSON.stringify(socialLinks)]
        );
      }
    }

    // Extract and store website metadata
    if (brandData.name || brandData.description || brandData.logos) {
      // Use the provided domainId directly instead of querying the domain_info table
      const domainsTableId = domainId;
      
      // Extract logo URL if available
      let logoUrl = null;
      if (brandData.logos && Array.isArray(brandData.logos) && brandData.logos.length > 0) {
        const primaryLogo = brandData.logos.find(l => l.type === 'logo' && l.theme === 'light');
        if (primaryLogo && primaryLogo.formats && primaryLogo.formats.length > 0) {
          // Prefer PNG format
          const pngFormat = primaryLogo.formats.find(f => f.format === 'png');
          const anyFormat = primaryLogo.formats[0];
          logoUrl = (pngFormat || anyFormat)?.src;
        }
      }
      
      // Get primary color for theme color
      let themeColor = null;
      if (brandData.colors && Array.isArray(brandData.colors) && brandData.colors.length > 0) {
        const primaryColor = brandData.colors.find(c => c.type === 'primary');
        themeColor = primaryColor?.hex;
      }
      
      // Check if metadata entry exists
      const [existingMetadata] = await db.query(
        'SELECT id FROM website_metadata WHERE domain_id = ?',
        [domainsTableId]
      );
      
      if (existingMetadata.length > 0) {
        await db.query(
          'UPDATE website_metadata SET title = ?, description = ?, logo_url = ?, theme_color = ?, updated_at = NOW() WHERE domain_id = ?',
          [brandData.name, brandData.description, logoUrl, themeColor, domainsTableId]
        );
      } else {
        await db.query(
          'INSERT INTO website_metadata (domain_id, title, description, logo_url, theme_color, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
          [domainsTableId, brandData.name, brandData.description, logoUrl, themeColor]
        );
      }
    }
    
    logger.info('Successfully stored structured brand data');
  } catch (error) {
    logger.error(`Error storing structured brand data: ${error.message}`);
    logger.error(error.stack);
    // Don't throw the error so it doesn't break the main flow
  }
};

/**
 * Extract domain from a URL string
 * @param {string} url - URL to extract domain from
 * @returns {string} - Extracted domain
 */
export const extractDomainUtil = (url) => {
  try {
    if (!url) return '';
    
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    logger.error(`Error extracting domain from ${url}: ${error.message}`);
    return url; // Return original if parsing failed
  }
}; 