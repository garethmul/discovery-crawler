/**
 * Extract domain from a URL
 * @param {string} url - URL to extract domain from
 * @returns {string} - Extracted domain
 */
export const extractDomain = (url) => {
  try {
    if (!url) return '';
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    console.error(`Error extracting domain from ${url}: ${error.message}`);
    return url; // Return original if parsing failed
  }
};

/**
 * Normalize URL by ensuring it has a protocol and resolving relative paths
 * @param {string} url - URL to normalize
 * @param {string} baseUrl - Base URL to resolve relative URLs against
 * @returns {string} - Normalized URL
 */
export const normalizeUrl = (url, baseUrl) => {
  try {
    // Handle empty or undefined URLs
    if (!url) return null;
    
    // Parse URL with base URL to resolve relative paths
    try {
      return new URL(url, baseUrl).toString();
    } catch (e) {
      // If URL with base fails, try direct parsing
    }
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Parse and normalize URL
    const parsedUrl = new URL(url);
    
    // Remove trailing slash for consistency
    if (parsedUrl.pathname === '/') {
      return parsedUrl.origin;
    }
    
    // Return normalized URL
    return parsedUrl.toString();
  } catch (error) {
    console.error(`Error normalizing URL ${url}: ${error.message}`);
    return url; // Return original if parsing failed
  }
};

/**
 * Check if a URL is from the same domain
 * @param {string} url - URL to check
 * @param {string} domain - Domain to compare against
 * @returns {boolean} - True if URL is from the same domain
 */
export const isSameDomain = (url, domain) => {
  try {
    const urlDomain = extractDomain(url);
    const normalizedDomain = domain.toLowerCase();
    const normalizedUrlDomain = urlDomain.toLowerCase();
    
    // Check for exact match
    if (normalizedUrlDomain === normalizedDomain) {
      return true;
    }
    
    // Check for www subdomain
    if (normalizedUrlDomain === 'www.' + normalizedDomain || 
        normalizedDomain === 'www.' + normalizedUrlDomain) {
      return true;
    }
    
    // Check for other subdomains
    if (normalizedUrlDomain.endsWith('.' + normalizedDomain)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking if URL is from same domain: ${error.message}`);
    return false;
  }
}; 