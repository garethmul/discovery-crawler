import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import { getPool } from '../../database/db.js';

/**
 * Extract mobile app links from pages
 */
export const extract = async (pages) => {
  try {
    logger.info('Extracting mobile app links');
    
    const appLinks = [];
    const seenUrls = new Set();
    
    for (const page of pages) {
      if (!page.content) continue;
      
      const $ = cheerio.load(page.content);
      
      // Common app store link patterns
      const appStorePatterns = [
        { pattern: 'apps.apple.com', store: 'iOS App Store' },
        { pattern: 'itunes.apple.com/app/', store: 'iOS App Store' },
        { pattern: 'play.google.com/store/apps', store: 'Google Play Store' },
        { pattern: 'microsoft.com/store/apps', store: 'Microsoft Store' },
        { pattern: 'amazon.com/gp/product', store: 'Amazon Appstore' },
        { pattern: 'appgallery.huawei.com', store: 'Huawei AppGallery' }
      ];
      
      // Check meta tags for app links
      $('meta[name="apple-itunes-app"]').each((_, element) => {
        const content = $(element).attr('content') || '';
        const match = content.match(/app-id=(\d+)/);
        if (match && match[1]) {
          const appId = match[1];
          const appUrl = `https://apps.apple.com/app/id${appId}`;
          
          if (!seenUrls.has(appUrl)) {
            seenUrls.add(appUrl);
            appLinks.push({
              url: appUrl,
              store: 'iOS App Store',
              appId: appId,
              title: '',
              sourceUrl: page.url
            });
          }
        }
      });
      
      // Look for app store links in anchor tags
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;
        
        try {
          const fullUrl = new URL(href, page.url).href;
          
          // Skip if already seen
          if (seenUrls.has(fullUrl)) return;
          
          // Check if it's an app store link
          for (const { pattern, store } of appStorePatterns) {
            if (fullUrl.includes(pattern)) {
              seenUrls.add(fullUrl);
              
              // Extract app ID if possible
              let appId = '';
              if (store === 'iOS App Store') {
                const match = fullUrl.match(/id(\d+)/);
                if (match) appId = match[1];
              } else if (store === 'Google Play Store') {
                const match = fullUrl.match(/id=([^&]+)/);
                if (match) appId = match[1];
              }
              
              // Get title from link text
              const title = $(element).text().trim() || 'Mobile App';
              
              appLinks.push({
                url: fullUrl,
                store: store,
                appId: appId,
                title: title,
                sourceUrl: page.url
              });
              
              break;
            }
          }
        } catch (error) {
          // Skip invalid URLs
        }
      });
      
      // Look for common app badges
      $('img[src*="app-store"], img[src*="play-store"], img[src*="google-play"]').each((_, element) => {
        const $parent = $(element).parent('a');
        if (!$parent.length) return;
        
        const href = $parent.attr('href');
        if (!href) return;
        
        try {
          const fullUrl = new URL(href, page.url).href;
          
          // Skip if already seen
          if (seenUrls.has(fullUrl)) return;
          
          // Check if it's an app store link
          for (const { pattern, store } of appStorePatterns) {
            if (fullUrl.includes(pattern)) {
              seenUrls.add(fullUrl);
              
              const alt = $(element).attr('alt') || '';
              const title = alt || $parent.text().trim() || 'Mobile App';
              
              appLinks.push({
                url: fullUrl,
                store: store,
                title: title,
                sourceUrl: page.url
              });
              
              break;
            }
          }
        } catch (error) {
          // Skip invalid URLs
        }
      });
    }
    
    return {
      hasApps: appLinks.length > 0,
      apps: appLinks
    };
  } catch (error) {
    logger.error(`Error extracting app links: ${error.message}`);
    return {
      hasApps: false,
      apps: []
    };
  }
};

/**
 * Save app links to domain_apps table
 */
export const saveAppLinks = async (domainId, appData) => {
  try {
    if (!appData.hasApps || appData.apps.length === 0) {
      return false;
    }
    
    const db = getPool();
    
    for (const app of appData.apps) {
      // Check if entry exists
      const [existingRows] = await db.execute(
        'SELECT id FROM domain_apps WHERE domain_id = ? AND app_url = ?',
        [domainId, app.url]
      );
      
      if (existingRows.length === 0) {
        // Insert new record
        await db.execute(
          `INSERT INTO domain_apps 
          (domain_id, app_name, app_url, app_store, app_id, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            domainId,
            app.title || 'Mobile App',
            app.url,
            app.store,
            app.appId || null
          ]
        );
        
        logger.info(`Saved app link to domain_apps: ${app.url}`);
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving app links: ${error.message}`);
    return false;
  }
};

export default {
  extract,
  saveAppLinks
}; 