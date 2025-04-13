import puppeteer from 'puppeteer';
import logger from '../utils/logger.js';
import * as cheerio from 'cheerio';

// Store a browser instance to reuse
let browserInstance = null;

/**
 * Get or create a Puppeteer browser instance
 */
export const getBrowser = async () => {
  if (!browserInstance) {
    logger.info('Launching new Puppeteer browser instance with enhanced settings');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-features=IsolateOrigins,site-per-process', // Helps with some Cloudflare checks
        '--disable-web-security', // May help with cross-origin issues
        '--disable-features=site-per-process',
        '--disable-blink-features=AutomationControlled', // Hide automation
      ],
      defaultViewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });
    
    // Handle browser disconnection
    browserInstance.on('disconnected', () => {
      logger.info('Puppeteer browser disconnected');
      browserInstance = null;
    });
  }
  
  return browserInstance;
};

/**
 * Closes the browser instance if it exists
 */
export const closeBrowser = async () => {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    logger.info('Puppeteer browser closed');
  }
};

/**
 * Fetch a URL using Puppeteer to bypass Cloudflare protection
 * @param {string} url - URL to fetch
 * @param {object} options - Additional options
 * @returns {Promise<{content: string, html: string}>} - Page content and HTML
 */
export const fetchWithPuppeteer = async (url, options = {}) => {
  logger.info(`[PUPPETEER] Fetching ${url} with enhanced browser settings`);
  
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    logger.info(`[PUPPETEER] Setting up browser fingerprint for ${url}`);
    
    // More realistic user agent
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.128';
    await page.setUserAgent(userAgent);
    
    // Set more realistic browser features and permissions
    await page.evaluateOnNewDocument(() => {
      // Override navigator properties to make fingerprinting harder
      const newProto = navigator.__proto__;
      delete newProto.webdriver;
      
      // Add language strings
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'es'],
      });
      
      // Set platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
      });
      
      // Fake plugins
      const originalPlugins = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
      if (originalPlugins) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            return {
              length: 5,
              item: () => { return {}; },
              namedItem: () => { return {}; },
              refresh: () => {},
              [Symbol.iterator]: function* () { yield {}; }
            };
          },
        });
      }
    });
    
    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Microsoft Edge";v="121", "Not A(Brand";v="24", "Chromium";v="121"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1'
    });
    
    // Set cookie handling and cache
    await page.setCacheEnabled(true);
    
    // Set default timeout (30 seconds)
    page.setDefaultNavigationTimeout(60000); // Increased timeout for Cloudflare
    
    logger.info(`[PUPPETEER] Starting navigation to ${url}`);
    
    // Navigate to URL
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    logger.info(`[PUPPETEER] Page loaded, checking for Cloudflare protection at ${url}`);
    
    // Check if Cloudflare is present
    const cloudflareDetected = await page.evaluate(() => {
      return document.body.textContent.includes('Checking your browser') || 
             document.body.textContent.includes('cf-browser-verification') ||
             document.body.textContent.includes('Just a moment') ||
             document.body.textContent.includes('security check');
    });
    
    // If Cloudflare protection detected, wait longer for it to resolve
    if (cloudflareDetected) {
      logger.info(`[PUPPETEER] ⚠️ Cloudflare protection detected on ${url}, waiting for resolution...`);
      
      // Perform some scrolling to simulate human behavior
      await page.evaluate(() => {
        window.scrollBy(0, 200);
        setTimeout(() => window.scrollBy(0, 400), 500);
        setTimeout(() => window.scrollBy(0, -200), 1000);
      });
      
      await page.waitForFunction(
        () => !document.body.textContent.includes('Checking your browser') && 
              !document.body.textContent.includes('cf-browser-verification') &&
              !document.body.textContent.includes('Just a moment') &&
              !document.body.textContent.includes('security check'),
        { timeout: 60000 } // 60 second timeout
      );
      logger.info(`[PUPPETEER] ✅ Cloudflare challenge appears to be solved for ${url}`);
    }
    
    // Wait a bit more to ensure page is fully loaded
    // Using setTimeout instead of waitForTimeout which isn't available in some Puppeteer versions
    logger.info(`[PUPPETEER] Waiting for page to fully settle at ${url}`);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 2000 to 3000ms
    
    // Get the page content
    logger.info(`[PUPPETEER] Extracting content from ${url}`);
    const html = await page.content();
    const title = await page.title();
    
    // Extract useful information using Cheerio
    const $ = cheerio.load(html);
    
    logger.info(`[PUPPETEER] Page title: "${title}"`);
    logger.info(`[PUPPETEER] HTML size: ${Math.round(html.length / 1024)}KB`);
    
    // Create a structured result
    const result = {
      title,
      html,
      text: await page.evaluate(() => document.body.innerText),
      links: [],
      images: []
    };
    
    // Extract links
    logger.info(`[PUPPETEER] Extracting links from ${url}`);
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        result.links.push({
          url: href,
          text: text || href
        });
      }
    });
    logger.info(`[PUPPETEER] Extracted ${result.links.length} links from ${url}`);
    
    // Extract images
    logger.info(`[PUPPETEER] Extracting images from ${url}`);
    $('img[src]').each((_, element) => {
      const src = $(element).attr('src');
      const alt = $(element).attr('alt') || '';
      if (src) {
        result.images.push({
          url: src,
          alt
        });
      }
    });
    logger.info(`[PUPPETEER] Extracted ${result.images.length} images from ${url}`);
    
    logger.info(`[PUPPETEER] ✅ Successfully fetched ${url} with Puppeteer`);
    return result;
  } catch (error) {
    logger.error(`[PUPPETEER] ❌ Error fetching ${url} with Puppeteer: ${error.message}`);
    throw error;
  } finally {
    // Close the page to free resources
    await page.close();
  }
};

/**
 * Test if a URL needs Puppeteer to bypass protection
 * @param {string} url - URL to test
 * @returns {Promise<boolean>} - True if URL needs Puppeteer
 */
export const testIfUrlNeedsPuppeteer = async (url) => {
  try {
    logger.info(`[PUPPETEER] Testing if ${url} needs protection bypass`);
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    // Set up more realistic browser fingerprint
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.128');
    
    // Set a short timeout since we just want to check quickly
    page.setDefaultNavigationTimeout(15000); // Increased from 10000
    
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // Check if Cloudflare or other protection is detected
    const protectionDetected = await page.evaluate(() => {
      const bodyText = document.body.textContent;
      return bodyText.includes('Checking your browser') || 
             bodyText.includes('cf-browser-verification') ||
             bodyText.includes('Just a moment') ||
             bodyText.includes('ddos') ||
             bodyText.includes('DDoS') ||
             bodyText.includes('security check') ||
             bodyText.includes('Please Wait') ||
             bodyText.includes('protected by');
    });
    
    await page.close();
    
    if (protectionDetected) {
      logger.info(`[PUPPETEER] ⚠️ Protection detected for ${url}, will use Puppeteer`);
    } else {
      logger.info(`[PUPPETEER] No protection detected for ${url}`);
    }
    
    return protectionDetected;
  } catch (error) {
    logger.error(`[PUPPETEER] Error testing if URL needs Puppeteer: ${error.message}`);
    // If there's an error, assume we need Puppeteer to be safe
    logger.info(`[PUPPETEER] Assuming ${url} needs protection bypass due to test error`);
    return true;
  }
};

/**
 * Get a page's content using Puppeteer
 * @param {string} url - URL to fetch
 * @param {object} options - Additional options
 * @returns {Promise<{content: string, metadata: object}>} - Page content and metadata
 */
export async function getPageContent(url, options = {}) {
  const browser = await getBrowser();
  let page = null;
  
  try {
    page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Enable JavaScript execution
    await page.setJavaScriptEnabled(true);
    
    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    });
    
    // Block certain resource types to speed up page load
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Set timeout for navigation
    const timeout = options.timeout || 30000;
    
    // Navigate to URL with improved wait options
    await page.goto(url, {
      waitUntil: ['domcontentloaded', 'load'],
      timeout: timeout
    });
    
    // Wait for common content selectors to ensure page is fully loaded
    await Promise.race([
      page.waitForSelector('main, #content, .main-content, article, .article', { timeout: 5000 })
        .catch(() => console.log('[PUPPETEER] Main content selector not found, continuing anyway')),
      page.waitForSelector('footer, .footer', { timeout: 5000 })
        .catch(() => console.log('[PUPPETEER] Footer selector not found, continuing anyway')),
      page.waitForSelector('a[href*="facebook"], a[href*="twitter"], a[href*="instagram"]', { timeout: 5000 })
        .catch(() => console.log('[PUPPETEER] Social link selectors not found, continuing anyway')),
      new Promise(resolve => setTimeout(resolve, 5000)) // Fallback timeout
    ]);
    
    // Additional wait to ensure dynamic content is loaded
    // Using setTimeout instead of waitForTimeout for compatibility
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get the page content
    const content = await page.content();
    
    // Extract any relevant metadata
    const metadata = await page.evaluate(() => {
      return {
        title: document.title,
        metaTags: Array.from(document.querySelectorAll('meta')).map(meta => ({
          name: meta.getAttribute('name'),
          property: meta.getAttribute('property'),
          content: meta.getAttribute('content')
        })),
        rawHtml: document.documentElement.outerHTML
      };
    });
    
    return { content, metadata };
  } catch (error) {
    logger.error(`[PUPPETEER] Error getting page content for ${url}: ${error.message}`);
    throw error;
  } finally {
    if (page) await page.close();
    // Don't close the browser instance, just the page
  }
} 