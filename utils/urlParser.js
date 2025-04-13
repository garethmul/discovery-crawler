/**
 * Parse a URL to extract the domain
 * @param {string} url - The URL to parse
 * @returns {string} - The domain name
 */
export const parseDomain = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    return null;
  }
};

/**
 * Normalize a URL by removing trailing slashes, query parameters, and fragments
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL
 */
export const normalizeUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    let normalized = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`;
    
    // Remove trailing slash if present
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized;
  } catch (error) {
    return url;
  }
};

/**
 * Check if a URL is from the same domain as the base URL
 * @param {string} url - The URL to check
 * @param {string} baseDomain - The base domain to compare against
 * @returns {boolean} - True if the URL is from the same domain
 */
export const isSameDomain = (url, baseDomain) => {
  try {
    const domain = parseDomain(url);
    return domain === baseDomain;
  } catch (error) {
    return false;
  }
};

/**
 * Get the path segments of a URL
 * @param {string} url - The URL to parse
 * @returns {Array<string>} - Array of path segments
 */
export const getPathSegments = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.split('/').filter(segment => segment.length > 0);
  } catch (error) {
    return [];
  }
};

/**
 * Check if a URL is likely a blog post
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is likely a blog post
 */
export const isBlogPost = (url) => {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.toLowerCase();
    const pathSegments = getPathSegments(url);
    
    // Enhanced blog URL patterns
    const blogPatterns = {
      // Direct blog keywords
      directPaths: [
        'blog', 'news', 'articles', 'insights', 'posts', 'updates',
        'press', 'journal', 'diary', 'digest', 'chronicles', 'thoughts',
        'editorial', 'column', 'commentary', 'newsletter',
        'publication', 'releases', 'announcements', 'media', 'stories'
      ],
      
      // Blog subpaths
      subpaths: [
        'category', 'tag', 'author', 'archive', 'topic',
        'page', 'entry', 'article', 'post', 'read'
      ],
      
      // Date patterns that suggest blog posts
      datePatterns: [
        /\/\d{4}\/\d{2}\//, // Year/month format: /2023/05/
        /\/\d{4}\/\d{2}\/\d{2}\//, // Year/month/day format: /2023/05/15/
        /\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/, // Month name
        /\/\d{4}-(0[1-9]|1[0-2])/ // ISO-like date: /2023-05/
      ]
    };
    
    // 1. Check for direct blog paths
    if (pathSegments.some(segment => blogPatterns.directPaths.includes(segment))) {
      return true;
    }
    
    // 2. Check for date patterns (strong indicator of a blog post)
    if (blogPatterns.datePatterns.some(pattern => pattern.test(path))) {
      return true;
    }
    
    // 3. Check blog subpaths
    if (pathSegments.some(segment => blogPatterns.subpaths.includes(segment))) {
      return true;
    }
    
    // 4. Check for WordPress-style permalinks
    if (path.includes('?p=') || path.match(/\/p\/\d+/)) {
      return true;
    }
    
    // 5. Check for likely blog post URL structure: /blog/[lengthy-slug]
    if (pathSegments.length >= 2 && 
        blogPatterns.directPaths.includes(pathSegments[0]) && 
        pathSegments[pathSegments.length - 1].length > 10) {
      return true;
    }
    
    // 6. Check for URL structure that looks like a dated post
    if (pathSegments.length >= 3 && /^\d{4}$/.test(pathSegments[0])) {
      return true;
    }
    
    // 7. Check for query parameters common in blog systems
    const searchParams = parsedUrl.searchParams;
    if (searchParams.has('post') || 
        searchParams.has('article') || 
        searchParams.has('entry') || 
        searchParams.has('id')) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
};

/**
 * Check if a URL is likely a product page
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is likely a product page
 */
export const isProductPage = (url) => {
  try {
    const pathSegments = getPathSegments(url);
    
    // Common product URL patterns
    const productPatterns = [
      'product',
      'item',
      'shop',
      'store'
    ];
    
    // Check if any segment matches a product pattern
    return pathSegments.some(segment => 
      productPatterns.some(pattern => segment.toLowerCase().includes(pattern))
    );
  } catch (error) {
    return false;
  }
};

export default {
  parseDomain,
  normalizeUrl,
  isSameDomain,
  getPathSegments,
  isBlogPost,
  isProductPage
}; 