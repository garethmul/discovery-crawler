import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import urlParser from '../../utils/urlParser.js';

/**
 * Extract general content from pages
 * @param {Array} pages - Array of page objects with url and content
 * @returns {Promise<Object>} - Extracted general content
 */
export const extract = async (pages) => {
  try {
    logger.info('Extracting general content');
    
    // Find the homepage
    const homepage = pages.find(page => {
      const url = new URL(page.url);
      return url.pathname === '/' || url.pathname === '';
    }) || pages[0]; // Fallback to first page if homepage not found
    
    // Extract site structure
    const siteStructure = extractSiteStructure(pages);
    
    // Extract navigation structure
    const navigationStructure = extractNavigationStructure(homepage);
    
    // Extract prominent links
    const prominentLinks = extractProminentLinks(homepage);
    
    // Extract contact information
    const contactInfo = extractContactInfo(pages);
    
    return {
      siteStructure,
      navigationStructure,
      prominentLinks,
      contactInfo
    };
  } catch (error) {
    logger.error(`Error extracting general content: ${error.message}`);
    return {
      siteStructure: {},
      navigationStructure: {},
      prominentLinks: [],
      contactInfo: {}
    };
  }
};

/**
 * Extract site structure from pages
 */
function extractSiteStructure(pages) {
  try {
    const structure = {
      totalPages: pages.length,
      categories: {}
    };
    
    // Group pages by path segments
    pages.forEach(page => {
      try {
        const url = new URL(page.url);
        const pathSegments = url.pathname.split('/').filter(segment => segment.length > 0);
        
        if (pathSegments.length > 0) {
          const firstSegment = pathSegments[0].toLowerCase();
          
          if (!structure.categories[firstSegment]) {
            structure.categories[firstSegment] = {
              count: 0,
              urls: []
            };
          }
          
          structure.categories[firstSegment].count++;
          
          if (structure.categories[firstSegment].urls.length < 5) {
            structure.categories[firstSegment].urls.push(page.url);
          }
        }
      } catch (error) {
        // Skip invalid URLs
      }
    });
    
    return structure;
  } catch (error) {
    logger.error(`Error extracting site structure: ${error.message}`);
    return {};
  }
}

/**
 * Extract navigation structure from homepage
 */
function extractNavigationStructure(homepage) {
  try {
    const $ = cheerio.load(homepage.content);
    const navigationStructure = {};
    
    // Look for common navigation elements
    const navSelectors = [
      'nav', 
      'header nav', 
      '.navigation', 
      '.nav', 
      '.menu', 
      '#menu',
      '.navbar',
      '#navbar'
    ];
    
    // Try each selector until we find a navigation element
    for (const selector of navSelectors) {
      const navElement = $(selector).first();
      
      if (navElement.length > 0) {
        // Extract links from the navigation
        const links = [];
        
        navElement.find('a').each((_, element) => {
          const $link = $(element);
          const text = $link.text().trim();
          const href = $link.attr('href');
          
          if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            links.push({
              text,
              url: href
            });
          }
        });
        
        // Group links by parent element to identify sub-menus
        const menuItems = {};
        
        links.forEach(link => {
          // Simple approach: just use the link text as the key
          menuItems[link.text] = link.url;
        });
        
        if (Object.keys(menuItems).length > 0) {
          navigationStructure.mainMenu = menuItems;
          break;
        }
      }
    }
    
    return navigationStructure;
  } catch (error) {
    logger.error(`Error extracting navigation structure: ${error.message}`);
    return {};
  }
}

/**
 * Extract prominent links from homepage
 */
function extractProminentLinks(homepage) {
  try {
    const $ = cheerio.load(homepage.content);
    const prominentLinks = [];
    
    // Look for links in prominent positions (hero section, main content area)
    const heroSelectors = [
      '.hero', 
      '.banner', 
      '.jumbotron', 
      '.header-content',
      'header .container',
      'main > section:first-child'
    ];
    
    // Try each selector
    for (const selector of heroSelectors) {
      const heroElement = $(selector).first();
      
      if (heroElement.length > 0) {
        heroElement.find('a').each((_, element) => {
          const $link = $(element);
          const text = $link.text().trim();
          const href = $link.attr('href');
          
          if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            // Check if the link has prominent styling
            const hasProminentStyling = 
              $link.hasClass('btn') || 
              $link.hasClass('button') || 
              $link.parent().hasClass('btn') || 
              $link.parent().hasClass('button') ||
              $link.css('display') === 'block' ||
              parseInt($link.css('font-size') || '0') > 16;
            
            if (hasProminentStyling || text.length > 10) {
              prominentLinks.push({
                text,
                url: href,
                location: selector
              });
            }
          }
        });
      }
    }
    
    // Also look for call-to-action buttons
    $('a.btn, a.button, button a, .cta a').each((_, element) => {
      const $link = $(element);
      const text = $link.text().trim();
      const href = $link.attr('href');
      
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        prominentLinks.push({
          text,
          url: href,
          location: 'call-to-action'
        });
      }
    });
    
    // Deduplicate links
    const uniqueLinks = [];
    const seenUrls = new Set();
    
    prominentLinks.forEach(link => {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        uniqueLinks.push(link);
      }
    });
    
    return uniqueLinks.slice(0, 10); // Limit to top 10 links
  } catch (error) {
    logger.error(`Error extracting prominent links: ${error.message}`);
    return [];
  }
}

/**
 * Extract contact information from pages
 */
function extractContactInfo(pages) {
  try {
    const contactInfo = {
      email: null,
      phone: null,
      address: null,
      socialLinks: {}
    };
    
    // Look for contact page first
    const contactPage = pages.find(page => {
      const url = page.url.toLowerCase();
      return url.includes('/contact') || url.includes('/about');
    });
    
    const pagesToCheck = contactPage ? [contactPage, ...pages] : pages;
    
    // Regular expressions for contact information
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(\+\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}/g;
    const socialPatterns = {
      facebook: /facebook\.com\/([^\/\?"']+)/i,
      twitter: /twitter\.com\/([^\/\?"']+)/i,
      instagram: /instagram\.com\/([^\/\?"']+)/i,
      linkedin: /linkedin\.com\/([^\/\?"']+)/i,
      youtube: /youtube\.com\/([^\/\?"']+)/i
    };
    
    // Check each page for contact information
    for (const page of pagesToCheck) {
      const $ = cheerio.load(page.content);
      
      // Extract email addresses
      if (!contactInfo.email) {
        const emailMatches = page.content.match(emailRegex);
        if (emailMatches && emailMatches.length > 0) {
          contactInfo.email = emailMatches[0];
        }
        
        // Also look for mailto links
        const mailtoLink = $('a[href^="mailto:"]').first();
        if (mailtoLink.length > 0) {
          const href = mailtoLink.attr('href');
          contactInfo.email = href.replace('mailto:', '').split('?')[0];
        }
      }
      
      // Extract phone numbers
      if (!contactInfo.phone) {
        const phoneMatches = page.content.match(phoneRegex);
        if (phoneMatches && phoneMatches.length > 0) {
          contactInfo.phone = phoneMatches[0];
        }
        
        // Also look for tel links
        const telLink = $('a[href^="tel:"]').first();
        if (telLink.length > 0) {
          const href = telLink.attr('href');
          contactInfo.phone = href.replace('tel:', '');
        }
      }
      
      // Extract address
      if (!contactInfo.address) {
        // Look for address in elements with specific classes or IDs
        const addressSelectors = [
          '.address', 
          '#address', 
          '.contact-address',
          'address'
        ];
        
        for (const selector of addressSelectors) {
          const addressElement = $(selector).first();
          if (addressElement.length > 0) {
            contactInfo.address = addressElement.text().trim().replace(/\s+/g, ' ');
            break;
          }
        }
      }
      
      // Extract social links
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        
        if (href) {
          for (const [platform, pattern] of Object.entries(socialPatterns)) {
            if (!contactInfo.socialLinks[platform] && pattern.test(href)) {
              const match = href.match(pattern);
              if (match && match[1]) {
                contactInfo.socialLinks[platform] = href;
              }
            }
          }
        }
      });
      
      // If we've found all types of contact info, break early
      if (
        contactInfo.email && 
        contactInfo.phone && 
        contactInfo.address && 
        Object.keys(contactInfo.socialLinks).length > 0
      ) {
        break;
      }
    }
    
    return contactInfo;
  } catch (error) {
    logger.error(`Error extracting contact info: ${error.message}`);
    return {
      email: null,
      phone: null,
      address: null,
      socialLinks: {}
    };
  }
}

export default {
  extract
}; 