import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import urlParser from '../../utils/urlParser.js';
import { getPool } from '../../database/db.js';
import fetch from 'node-fetch';

/**
 * Blog URL patterns for detecting blog-related content
 */
const BLOG_PATTERNS = {
  // Direct blog path indicators
  directPaths: [
    'blog', 'news', 'articles', 'insights', 'posts', 'updates',
    'press', 'journal', 'diary', 'digest', 'chronicles', 'thoughts',
    'editorial', 'column', 'commentary', 'newsletter',
    'publication', 'releases', 'announcements', 'media', 'stories'
  ],
  
  // Blog subpath indicators
  subpaths: [
    'category', 'tag', 'author', 'archive', 'topic',
    'page', 'entry', 'article', 'post', 'read'
  ],
  
  // Date patterns in URLs that suggest blog posts
  datePatterns: [
    /\/\d{4}\/\d{2}\//, // Year/month format: /2023/05/
    /\/\d{4}\/\d{2}\/\d{2}\//, // Year/month/day format: /2023/05/15/
    /\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/, // Month name
    /\/\d{4}-(0[1-9]|1[0-2])/ // ISO-like date: /2023-05/
  ],
  
  // File extensions often used in blog systems
  fileExtensions: [
    '.html', '.php', '.aspx', '.jsp'
  ]
};

/**
 * Extract blog content from pages
 * @param {Array} pages - Array of page objects with url and content
 * @returns {Promise<Object>} - Extracted blog content
 */
export const extract = async (pages) => {
  try {
    logger.info('[BLOG] 📝 Starting blog content extraction from ' + pages.length + ' pages');
    
    // Find blog pages with enhanced detection
    logger.info('[BLOG] Scanning pages for blog-like content with enhanced detection...');
    const blogPages = findBlogPages(pages);
    
    if (blogPages.length === 0) {
      logger.info('[BLOG] ❌ No blog pages found');
      return {
        hasBlog: false,
        blogUrl: null,
        articles: []
      };
    }
    
    logger.info(`[BLOG] ✅ Found ${blogPages.length} potential blog pages`);
    blogPages.forEach((page, index) => {
      if (index < 5 || index === blogPages.length - 1) { // Log first 5 and last one
        logger.info(`[BLOG] Blog page ${index + 1}: ${page.url} (Score: ${page.blogScore.toFixed(2)})`);
      } else if (index === 5) {
        logger.info(`[BLOG] ... and ${blogPages.length - 5} more blog pages`);
      }
    });
    
    // Check for RSS feeds
    logger.info('[BLOG] Checking for RSS feeds...');
    const domain = extractDomain(blogPages[0]?.url || '');
    const rssFeeds = await findRSSFeeds(domain, blogPages);
    if (rssFeeds.length > 0) {
      logger.info(`[BLOG] ✅ Found ${rssFeeds.length} RSS feeds: ${rssFeeds.join(', ')}`);
    } else {
      logger.info(`[BLOG] ❌ No RSS feeds found`);
    }
    
    // Find the main blog index page with enhanced detection
    logger.info('[BLOG] Identifying main blog index page...');
    const blogIndexPage = findBlogIndexPage(blogPages);
    
    if (blogIndexPage) {
      logger.info(`[BLOG] Main blog index page: ${blogIndexPage.url}`);
    } else {
      logger.info('[BLOG] Could not identify a main blog index page');
    }
    
    // Extract articles with enhanced detection
    logger.info('[BLOG] Extracting articles from blog pages...');
    const articles = extractArticles(blogPages);
    
    logger.info(`[BLOG] ✅ Extracted ${articles.length} articles`);
    
    // Log some article details
    if (articles.length > 0) {
      logger.info('[BLOG] Article samples:');
      articles.slice(0, Math.min(3, articles.length)).forEach((article, index) => {
        logger.info(`[BLOG] Article ${index + 1}: "${article.title}" - ${article.url}`);
      });
    }
    
    return {
      hasBlog: true,
      blogUrl: blogIndexPage ? blogIndexPage.url : blogPages[0].url,
      articles: articles,
      rssFeeds: rssFeeds
    };
  } catch (error) {
    logger.error(`[BLOG] ❌ Error extracting blog content: ${error.message}`);
    logger.error(error.stack);
    return {
      hasBlog: false,
      blogUrl: null,
      articles: [],
      rssFeeds: []
    };
  }
};

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    return '';
  }
}

/**
 * Check for RSS/Atom feeds
 */
async function findRSSFeeds(domain, pages) {
  if (!domain) return [];
  
  try {
    const feedUrls = new Set();
    
    // Common RSS feed paths to check
    const commonFeedPaths = [
      '/feed', '/rss', '/atom.xml', '/feed.xml', '/rss.xml',
      '/blog/feed', '/news/feed', '/articles/feed', '/index.xml'
    ];
    
    // Extract feed links from HTML
    for (const page of pages) {
      if (!page.content) continue;
      
      const $ = cheerio.load(page.content);
      
      // Look for RSS/Atom link elements
      $('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            feedUrls.add(new URL(href, page.url).href);
          } catch (error) {
            // Skip invalid URLs
          }
        }
      });
      
      // Also look for RSS links in anchor tags
      $('a[href*="feed"], a[href*="rss"], a[href*="atom"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('/feed') || href.includes('/rss') || href.includes('/atom'))) {
          try {
            feedUrls.add(new URL(href, page.url).href);
          } catch (error) {
            // Skip invalid URLs
          }
        }
      });
    }
    
    // Only check common paths if we haven't found feeds in the HTML
    if (feedUrls.size === 0) {
      // Check for common feed paths (without actually fetching them)
      for (const path of commonFeedPaths) {
        feedUrls.add(`https://${domain}${path}`);
      }
    }
    
    return Array.from(feedUrls);
  } catch (error) {
    logger.error(`[BLOG] Error finding RSS feeds: ${error.message}`);
    return [];
  }
}

/**
 * Detect blog-specific metadata and features
 */
function detectBlogMetadata($, url) {
  try {
    const metadata = {
      // CMS detection
      isWordPress: $('meta[name="generator"][content*="WordPress"]').length > 0 || 
                  $('#wpadminbar').length > 0 ||
                  $('link[href*="/wp-content/"]').length > 0,
      
      isDrupal: $('meta[name="generator"][content*="Drupal"]').length > 0 || 
               $('body.drupal').length > 0,
      
      isGhost: $('meta[name="generator"][content*="Ghost"]').length > 0,
      
      // Feed detection
      hasRSSFeed: $('link[type="application/rss+xml"]').length > 0 ||
                 $('link[type="application/atom+xml"]').length > 0,
      
      // Schema.org detection
      hasBlogSchema: $('script[type="application/ld+json"]').text().includes('"@type":"Blog"'),
      hasArticleSchema: $('script[type="application/ld+json"]').text().includes('"@type":"Article"'),
      
      // Structure detection
      hasArticleElements: $('article').length > 0,
      hasMultipleArticles: $('article').length > 1,
      hasPagination: $('.pagination, .nav-links, .pager, .pages').length > 0,
      hasAuthors: $('.author, .byline, .writer').length > 0,
      hasDateElements: $('time, .date, .published, .post-date').length > 0,
      hasComments: $('.comments, #comments, .responses, .discussion').length > 0,
      hasSidebar: $('.sidebar, .widget-area, .aside').length > 0,
      hasCategories: $('.categories, .tags, .topics, .labels').length > 0,
      hasArchives: $('.archive, .archives, .history').length > 0,
      
      // URL pattern indicators
      hasDateInUrl: BLOG_PATTERNS.datePatterns.some(pattern => pattern.test(url)),
      
      // Blog-specific markup
      hasBlogClass: $('body.blog, .blog, #blog, .news, #news').length > 0,
      hasBlogId: $('#blog, #news, #articles').length > 0
    };
    
    // Calculate a score based on how many blog indicators are present
    const positiveFactors = Object.values(metadata).filter(Boolean).length;
    metadata.blogIndicatorScore = positiveFactors / Object.keys(metadata).length;
    
    return metadata;
  } catch (error) {
    logger.error(`[BLOG] Error detecting blog metadata: ${error.message}`);
    return { blogIndicatorScore: 0 };
  }
}

/**
 * Find blog pages from all pages with enhanced detection
 */
function findBlogPages(pages) {
  try {
    // Enhanced page detection with scoring system
    const scoredPages = pages.map(page => {
      if (!page.url || !page.content) return { page, blogScore: 0 };
      
      try {
        const url = page.url.toLowerCase();
        const $ = cheerio.load(page.content);
        const title = $('title').text().toLowerCase();
        const headings = $('h1, h2, h3').text().toLowerCase();
        const bodyText = $('body').text().toLowerCase();
        
        // Score initialization
        let score = 0;
        
        // 1. URL pattern scoring
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.toLowerCase().split('/').filter(Boolean);
        
        // Check direct blog paths
        if (pathSegments.some(segment => BLOG_PATTERNS.directPaths.includes(segment))) {
          score += 2; // Strong indicator
        }
        
        // Check subpaths
        if (pathSegments.some(segment => BLOG_PATTERNS.subpaths.includes(segment))) {
          score += 1; // Moderate indicator
        }
        
        // Check date patterns in URL
        if (BLOG_PATTERNS.datePatterns.some(pattern => pattern.test(url))) {
          score += 1.5; // Strong indicator for blog posts
        }
        
        // 2. Title and heading scoring
        // Check for blog keywords in title
        if (BLOG_PATTERNS.directPaths.some(keyword => title.includes(keyword))) {
          score += 1.5;
        }
        
        // Check for blog keywords in headings
        if (BLOG_PATTERNS.directPaths.some(keyword => headings.includes(keyword))) {
          score += 1;
        }
        
        // 3. Structure scoring
        // Get metadata and structure scores
        const metadata = detectBlogMetadata($, url);
        score += metadata.blogIndicatorScore * 3; // Scale up to make it significant
        
        // 4. Content analysis
        // Look for multiple article elements
        const articleCount = $('article').length;
        if (articleCount > 3) {
          score += 2; // Many articles strongly suggest a blog index
        } else if (articleCount > 0) {
          score += 1; // Some articles suggest blog-like content
        }
        
        // Look for post-like structures
        const postCount = $('.post, .blog-post, .entry, .blog-entry').length;
        if (postCount > 3) {
          score += 1.5;
        } else if (postCount > 0) {
          score += 0.8;
        }
        
        // Check for pagination (strong indicator of a blog index page)
        if ($('.pagination, .nav-links, .pager, .pages').length > 0) {
          score += 1.5;
        }
        
        // Check for date patterns common in blog posts
        const hasDatePatterns = 
          $('time').length > 0 || 
          $('span.date, div.date, .post-date, .published').length > 0 ||
          /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(bodyText) ||
          /\w+ \d{1,2}, \d{4}/.test(bodyText);
        
        if (hasDatePatterns) {
          score += 1;
        }
        
        // Check for author information
        if ($('.author, .byline, span.by, .writer').length > 0) {
          score += 0.8;
        }
        
        // Check for comments (common in blog posts)
        if ($('#comments, .comments, .responses, .discussion').length > 0) {
          score += 0.8;
        }
        
        // Check for tags/categories (common in blogs)
        if ($('.tags, .categories, .topics, .labels').length > 0) {
          score += 1;
        }
        
        // Check for social sharing links (common in blog posts)
        if ($('.share, .social-share, .social-links').length > 0) {
          score += 0.5;
        }
        
        // Check for specific blog-related classes and IDs
        if ($('body.blog, .blog-page, #blog, .news-page, #news').length > 0) {
          score += 1.5;
        }
        
        // Check for specific CMS indicators (WordPress, Drupal, Ghost)
        if (metadata.isWordPress || metadata.isDrupal || metadata.isGhost) {
          score += 1.5;
        }
        
        // Check for RSS feeds
        if (metadata.hasRSSFeed) {
          score += 2; // Strong indicator of a blog
        }
        
        // Check for schema.org markup
        if (metadata.hasBlogSchema || metadata.hasArticleSchema) {
          score += 1.5;
        }
        
        // Normalize score to a 0-10 scale for easier interpretation
        const normalizedScore = Math.min(10, score);
        
        return { 
          page, 
          blogScore: normalizedScore,
          metadata
        };
      } catch (error) {
        logger.debug(`[BLOG] Error scoring page ${page.url}: ${error.message}`);
        return { page, blogScore: 0 };
      }
    });
    
    // Filter pages with a minimum blog score
    const threshold = 2.5; // Minimum score to consider a page blog-related
    const filteredPages = scoredPages
      .filter(item => item.blogScore >= threshold)
      .sort((a, b) => b.blogScore - a.blogScore); // Sort by score, highest first
    
    logger.info(`[BLOG] Found ${filteredPages.length} potential blog pages out of ${pages.length} total pages (score threshold: ${threshold})`);
    
    // Return the pages in blog-score order, including the score for debugging
    return filteredPages.map(item => ({
      ...item.page,
      blogScore: item.blogScore,
      metadata: item.metadata
    }));
  } catch (error) {
    logger.error(`[BLOG] Error finding blog pages: ${error.message}`);
    return [];
  }
}

/**
 * Find the main blog index page with enhanced detection
 */
function findBlogIndexPage(blogPages) {
  try {
    if (blogPages.length === 0) {
      return null;
    }
    
    if (blogPages.length === 1) {
      return blogPages[0];
    }
    
    // Score each page on how likely it is to be a blog index
    const scoredPages = blogPages.map(page => {
      let indexScore = 0;
      
      try {
        const url = page.url;
        const $ = cheerio.load(page.content);
        
        // 1. URL pattern scoring
        // Direct blog index paths are usually short (e.g., /blog/ rather than /blog/article-title/)
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.toLowerCase().split('/').filter(Boolean);
        
        // Ideal blog index has exactly one segment that's a blog keyword
        if (pathSegments.length === 1 && BLOG_PATTERNS.directPaths.includes(pathSegments[0])) {
          indexScore += 3; // Strong indicator: /blog/
        } 
        // Next best is two segments where first is blog and second is a page indicator
        else if (pathSegments.length === 2 && 
                BLOG_PATTERNS.directPaths.includes(pathSegments[0]) && 
                (pathSegments[1] === 'index' || pathSegments[1] === 'home' || pathSegments[1].match(/page\/?\d*/))) {
          indexScore += 2; // Good indicator: /blog/page/2/
        }
        // Blog index URLs typically don't have date patterns
        else if (BLOG_PATTERNS.datePatterns.every(pattern => !pattern.test(url))) {
          indexScore += 0.5; // Mild indicator
        }
        
        // 2. Content structure scoring
        
        // Multiple articles strongly suggests an index page
        const articleCount = $('article').length;
        if (articleCount > 5) {
          indexScore += 3; // Many articles strongly suggest a blog index
        } else if (articleCount > 2) {
          indexScore += 2; // Some articles suggest a blog index
        } else if (articleCount > 0) {
          indexScore += 0.5; // Few articles - might be a blog post
        }
        
        // Multiple post structures suggests an index
        const postCount = $('.post, .blog-post, .entry, .blog-entry').length;
        if (postCount > 5) {
          indexScore += 2.5;
        } else if (postCount > 2) {
          indexScore += 1.5;
        } else if (postCount > 0) {
          indexScore += 0.5;
        }
        
        // Pagination is a very strong indicator of an index page
        if ($('.pagination, .nav-links, .pager, .pages, ul.page-numbers').length > 0) {
          indexScore += 3;
        }
        
        // Categories/tags widgets are common on index pages
        if ($('.categories, .tags, .topics, .widget, .sidebar').length > 0) {
          indexScore += 1.5;
        }
        
        // Blog title in a prominent heading
        if ($('h1:contains("Blog"), h1:contains("News"), h1:contains("Articles")').length > 0) {
          indexScore += 2;
        }
        
        // Archive/calendar widgets are common on blog index pages
        if ($('.archive, .archives, .calendar, .widget_archive').length > 0) {
          indexScore += 1.5;
        }
        
        // Recent posts widget is common on blog index pages
        if ($('.recent-posts, .recent, .latest, .widget_recent_entries').length > 0) {
          indexScore += 1.5;
        }
        
        // 3. Special case: homepage with blog section
        // If this is the homepage and it has blog elements
        if (pathSegments.length === 0 && (articleCount > 0 || postCount > 0)) {
          indexScore += 1; // Homepage with blog content
        }
        
        // 4. Title analysis
        const title = $('title').text().toLowerCase();
        if (BLOG_PATTERNS.directPaths.some(keyword => title.includes(keyword))) {
          indexScore += 1.5;
        }
        
        // 5. Heading analysis
        const h1Text = $('h1').text().toLowerCase();
        if (BLOG_PATTERNS.directPaths.some(keyword => h1Text.includes(keyword))) {
          indexScore += 2;
        }
        
        // 6. Type-specific scoring
        // Use existing metadata if available
        if (page.metadata) {
          if (page.metadata.hasPagination) indexScore += 2;
          if (page.metadata.hasMultipleArticles) indexScore += 2;
          if (page.metadata.hasCategories) indexScore += 1.5;
          if (page.metadata.hasRSSFeed) indexScore += 1.5;
        }
        
        // 7. Check for RSS link - common on blog index pages
        if ($('link[type="application/rss+xml"]').length > 0) {
          indexScore += 2;
        }
        
        // Adjust using the page's overall blog score if available
        if (page.blogScore) {
          indexScore += page.blogScore / 5; // Add a small boost from general blog score
        }
        
        return { page, indexScore };
      } catch (error) {
        return { page, indexScore: 0 };
      }
    });
    
    // Sort by index score (highest first)
    scoredPages.sort((a, b) => b.indexScore - a.indexScore);
    
    // Log the top candidates
    logger.info(`[BLOG] Top blog index candidates:`);
    scoredPages.slice(0, Math.min(3, scoredPages.length)).forEach((item, i) => {
      logger.info(`[BLOG] Candidate ${i+1}: ${item.page.url} (Score: ${item.indexScore.toFixed(2)})`);
    });
    
    // Return the highest scoring page
    return scoredPages.length > 0 ? scoredPages[0].page : null;
  } catch (error) {
    logger.error(`[BLOG] Error finding blog index page: ${error.message}`);
    return blogPages[0];
  }
}

/**
 * Extract articles from blog pages with enhanced detection
 */
function extractArticles(blogPages) {
  try {
    const articles = [];
    const seenUrls = new Set();
    
    // First pass: Process blog index pages to find article links
    const indexPages = blogPages.filter(page => page.blogScore >= 5);
    
    // Process each blog page, starting with the highest scoring ones
    for (const page of blogPages) {
      if (!page.content) continue;
      
      logger.debug(`[BLOG] Extracting articles from ${page.url} (Score: ${page.blogScore?.toFixed(2) || 'N/A'})`);
      
      const $ = cheerio.load(page.content);
      
      // Enhanced article selectors
      const articleSelectors = [
        'article', // HTML5 article element
        '.post', // Common post class
        '.blog-post, .blogpost', // Blog-specific classes
        '.entry, .blog-entry', // Entry classes
        '.news-item, .news-article', // News-specific classes
        '.article, .post-content', // Article classes
        '.item, .card, .content-card', // Card-style layouts
        '.excerpt, .post-excerpt', // Excerpt containers
        '.post-summary, .article-summary', // Summary containers
        '.teaser, .post-teaser', // Teaser content
        '[class*="blog-"], [class*="post-"]', // Classes containing blog or post
        '[id*="blog-"], [id*="post-"]' // IDs containing blog or post
      ];
      
      // Try each selector
      for (const selector of articleSelectors) {
        $(selector).each((i, element) => {
          try {
            // Extract article data
            const article = extractEnhancedArticleData($, element, page.url);
            
            // Skip if we've already seen this URL or if article doesn't have sufficient data
            if (!article.title || !article.url || seenUrls.has(article.url)) {
              return;
            }
            
            // Check if URL appears to be a blog post
            if (!isBlogPostUrl(article.url)) {
              return;
            }
            
            // Add to articles array
            articles.push(article);
            seenUrls.add(article.url);
          } catch (error) {
            // Skip individual article extraction errors
          }
        });
      }
      
      // Second approach: If no structured articles found, look for article-like link patterns
      if (articles.length === 0 || articles.length < 3) {
        // Look for links with blog post characteristics
        $('a').each((i, element) => {
          try {
            const $element = $(element);
            const href = $element.attr('href');
            
            if (!href) return;
            
            // Skip non-content links
            if (href.startsWith('#') || 
                href.includes('javascript:') || 
                href.includes('mailto:') || 
                href.includes('tel:') ||
                href.includes('login') ||
                href.includes('signup') ||
                href.includes('cart') ||
                href.includes('account')) {
              return;
            }
            
            // Normalize URL
            let articleUrl = '';
            try {
              articleUrl = new URL(href, page.url).href;
            } catch (error) {
              return; // Skip invalid URLs
            }
            
            // Skip if already processed or not a blog post URL
            if (seenUrls.has(articleUrl) || !isBlogPostUrl(articleUrl)) {
              return;
            }
            
            // Look for link context that suggests it's an article
            const $container = $element.closest('.item, .card, .post, .entry, .article, .content, .col, .row');
            const $headingParent = $element.closest('h1, h2, h3, h4');
            
            // Extract article data
            let article = {
              title: $element.text().trim(),
              url: articleUrl,
              excerpt: '',
              imageUrl: '',
              date: '',
              author: ''
            };
            
            // Get data from container if available
            if ($container.length > 0) {
              // Extract additional data from the container
              article = extractArticleDataFromContainer($, $container[0], article);
            } 
            // If link is in a heading, it's likely a title
            else if ($headingParent.length > 0) {
              // Look for surrounding elements for additional data
              const $parent = $headingParent.parent();
              
              // Extract date
              const $date = $parent.find('time, .date, .published, [datetime]');
              if ($date.length > 0) {
                article.date = $date.attr('datetime') || $date.text().trim();
              }
              
              // Extract image
              const $image = $parent.find('img');
              if ($image.length > 0) {
                const src = $image.attr('src');
                if (src) {
                  try {
                    article.imageUrl = new URL(src, page.url).href;
                  } catch (error) {
                    // Skip invalid image URLs
                  }
                }
              }
              
              // Extract excerpt
              const $excerpt = $parent.find('p');
              if ($excerpt.length > 0) {
                article.excerpt = $excerpt.text().trim();
              }
            }
            
            // Skip if title is too short or too long (likely not an article title)
            if (!article.title || article.title.length < 5 || article.title.length > 200) {
              return;
            }
            
            // Add to articles array
            articles.push(article);
            seenUrls.add(articleUrl);
          } catch (error) {
            // Skip individual article extraction errors
          }
        });
      }
    }
    
    // Deduplicate and sort articles
    const finalArticles = [];
    const finalSeenUrls = new Set();
    
    // Add articles with dates first (sorted by recency)
    const articlesWithDates = articles.filter(article => article.date);
    articlesWithDates.sort((a, b) => {
      try {
        return new Date(b.date) - new Date(a.date);
      } catch (error) {
        return 0;
      }
    });
    
    // Add date-sorted articles
    for (const article of articlesWithDates) {
      if (!finalSeenUrls.has(article.url)) {
        finalArticles.push(article);
        finalSeenUrls.add(article.url);
      }
    }
    
    // Add remaining articles
    for (const article of articles) {
      if (!finalSeenUrls.has(article.url)) {
        finalArticles.push(article);
        finalSeenUrls.add(article.url);
      }
    }
    
    // Limit to 15 articles max
    return finalArticles.slice(0, 15);
  } catch (error) {
    logger.error(`[BLOG] Error extracting articles: ${error.message}`);
    return [];
  }
}

/**
 * Extract article data with enhanced detection
 */
function extractEnhancedArticleData($, element, baseUrl) {
  const $element = $(element);
  const article = {
    title: '',
    excerpt: '',
    url: '',
    imageUrl: '',
    date: '',
    author: ''
  };
  
  // Extract title (multiple selectors for better detection)
  const titleSelectors = [
    'h1', 'h2', 'h3', 'h4', 
    '.title', '.entry-title', '.post-title', 
    '.heading', '.headline', '.article-title',
    'a[rel="bookmark"]', '.headline a'
  ];
  
  for (const selector of titleSelectors) {
    const $title = $element.find(selector).first();
    if ($title.length > 0) {
      article.title = $title.text().trim();
      
      // If title element is a link, extract URL
      if ($title.is('a') || $title.find('a').length > 0) {
        const $link = $title.is('a') ? $title : $title.find('a').first();
        const href = $link.attr('href');
        if (href) {
          try {
            article.url = new URL(href, baseUrl).href;
          } catch (error) {
            // Skip invalid URLs
          }
        }
      }
      
      if (article.title) break;
    }
  }
  
  // If no title found yet, look for the most prominent text
  if (!article.title) {
    $element.find('*').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      
      // Look for reasonably-sized text that might be a title
      if (text && text.length > 10 && text.length < 100 && !article.title) {
        article.title = text;
      }
    });
  }
  
  // If we found a title but no URL, look for links
  if (article.title && !article.url) {
    const $links = $element.find('a');
    $links.each((i, link) => {
      const $link = $(link);
      const href = $link.attr('href');
      const linkText = $link.text().trim();
      
      if (href && !article.url) {
        // Prefer links with text similar to the title
        const similarity = calculateTextSimilarity(article.title, linkText);
        if (similarity > 0.7 || linkText.length > 20) {
          try {
            article.url = new URL(href, baseUrl).href;
          } catch (error) {
            // Skip invalid URLs
          }
        }
      }
    });
    
    // If still no URL, use the first non-empty link
    if (!article.url) {
      const $firstLink = $element.find('a[href]:not([href=""])').first();
      if ($firstLink.length > 0) {
        const href = $firstLink.attr('href');
        if (href) {
          try {
            article.url = new URL(href, baseUrl).href;
          } catch (error) {
            // Skip invalid URLs
          }
        }
      }
    }
  }
  
  // Extract excerpt
  const excerptSelectors = [
    '.excerpt', '.summary', '.entry-summary', '.post-excerpt',
    '.description', '.post-content p', '.entry-content p',
    '.teaser', '.intro', '.preview'
  ];
  
  for (const selector of excerptSelectors) {
    const $excerpt = $element.find(selector).first();
    if ($excerpt.length > 0) {
      article.excerpt = $excerpt.text().trim();
      if (article.excerpt) break;
    }
  }
  
  // If no structured excerpt, use the first paragraph
  if (!article.excerpt) {
    const $firstP = $element.find('p').first();
    if ($firstP.length > 0) {
      article.excerpt = $firstP.text().trim();
    }
  }
  
  // Extract image
  const imageSelectors = [
    'img', '.featured-image img', '.post-thumbnail img',
    '.entry-image img', '.post-image img', '.thumbnail img',
    'picture source, picture img', '.image img', 'figure img'
  ];
  
  for (const selector of imageSelectors) {
    const $image = $element.find(selector).first();
    if ($image.length > 0) {
      const src = $image.attr('src') || $image.attr('data-src') || $image.attr('data-lazy-src');
      if (src) {
        try {
          article.imageUrl = new URL(src, baseUrl).href;
          break;
        } catch (error) {
          // Skip invalid image URLs
        }
      }
    }
  }
  
  // Extract date
  const dateSelectors = [
    'time', '.date', '.published', '.post-date',
    '.entry-date', 'meta[itemprop="datePublished"]',
    '.publish-date', '.timestamp', '.meta-date'
  ];
  
  for (const selector of dateSelectors) {
    const $date = $element.find(selector).first();
    if ($date.length > 0) {
      article.date = $date.attr('datetime') || $date.text().trim();
      if (article.date) break;
    }
  }
  
  // Extract author
  const authorSelectors = [
    '.author', '.byline', '.entry-author',
    'meta[itemprop="author"]', '.meta-author',
    '.writer', '.post-author', '.by'
  ];
  
  for (const selector of authorSelectors) {
    const $author = $element.find(selector).first();
    if ($author.length > 0) {
      article.author = $author.text().trim();
      // Clean up author text by removing "By" prefixes
      article.author = article.author.replace(/^(by|posted by|written by|author:)\s+/i, '');
      if (article.author) break;
    }
  }
  
  return article;
}

/**
 * Extract article data from a containing element
 */
function extractArticleDataFromContainer($, container, article) {
  const $container = $(container);
  
  // Extract date if not already found
  if (!article.date) {
    const $date = $container.find('time, .date, .published, .post-date, [datetime]');
    if ($date.length > 0) {
      article.date = $date.attr('datetime') || $date.text().trim();
    }
  }
  
  // Extract excerpt if not already found
  if (!article.excerpt) {
    const $excerpt = $container.find('p, .excerpt, .summary, .description');
    if ($excerpt.length > 0) {
      article.excerpt = $excerpt.text().trim();
    }
  }
  
  // Extract image if not already found
  if (!article.imageUrl) {
    const $image = $container.find('img');
    if ($image.length > 0) {
      const src = $image.attr('src');
      if (src) {
        try {
          article.imageUrl = new URL(src, article.url).href;
        } catch (error) {
          // Skip invalid image URLs
        }
      }
    }
  }
  
  // Extract author if not already found
  if (!article.author) {
    const $author = $container.find('.author, .byline, .meta-author');
    if ($author.length > 0) {
      article.author = $author.text().trim();
      // Clean up author text
      article.author = article.author.replace(/^(by|posted by|written by|author:)\s+/i, '');
    }
  }
  
  return article;
}

/**
 * Check if URL is likely a blog post
 */
function isBlogPostUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.toLowerCase();
    
    // Check direct blog paths
    const pathSegments = path.split('/').filter(Boolean);
    
    // Common blog indicators in URL
    if (pathSegments.some(segment => BLOG_PATTERNS.directPaths.includes(segment))) {
      return true;
    }
    
    // Check for date patterns (strong indicator of a blog post)
    if (BLOG_PATTERNS.datePatterns.some(pattern => pattern.test(path))) {
      return true;
    }
    
    // Check blog subpaths
    if (pathSegments.some(segment => BLOG_PATTERNS.subpaths.includes(segment))) {
      return true;
    }
    
    // Check for permalinks with post ID (WordPress style)
    if (path.includes('?p=') || path.match(/\/p\/\d+/)) {
      return true;
    }
    
    // Check for common blog URL endings
    if (path.endsWith('.html') || path.endsWith('.php')) {
      return true;
    }
    
    // Check for long URLs with multiple segments (likely a blog post)
    if (pathSegments.length >= 3 && pathSegments[0] === 'blog') {
      return true;
    }
    
    // Check for slugs (WordPress style URLs)
    if (pathSegments.length > 1 && pathSegments[pathSegments.length - 1].length > 10) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Calculate similarity between two text strings
 */
function calculateTextSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  // Calculate intersection
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  
  // Count matching words
  let matches = 0;
  for (const word of words1) {
    if (words2.includes(word)) {
      matches++;
    }
  }
  
  // Calculate Jaccard similarity
  const totalWords = new Set([...words1, ...words2]).size;
  return matches / totalWords;
}

/**
 * Save blog URL to domain_blog_info table
 */
export const saveBlogInfo = async (domainId, blogData) => {
  try {
    if (!blogData.hasBlog || !blogData.blogUrl) {
      return false;
    }
    
    const db = getPool();
    
    // Check if entry exists
    const [existingRows] = await db.execute(
      'SELECT id FROM domain_blog_info WHERE domain_id = ?',
      [domainId]
    );
    
    let blogType = 'blog';
    if (blogData.blogUrl.includes('news')) blogType = 'news';
    else if (blogData.blogUrl.includes('press')) blogType = 'press';
    else if (blogData.blogUrl.includes('updates')) blogType = 'updates';
    else if (blogData.blogUrl.includes('articles')) blogType = 'articles';
    
    if (existingRows.length === 0) {
      // Insert new record
      await db.execute(
        `INSERT INTO domain_blog_info 
        (domain_id, blog_url, blog_title, blog_type, estimated_post_count, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          domainId, 
          blogData.blogUrl, 
          'Blog', // Default title
          blogType,
          blogData.articles.length
        ]
      );
      
      logger.info(`Saved blog info to domain_blog_info: ${blogData.blogUrl}`);
    } else {
      // Update existing record
      await db.execute(
        `UPDATE domain_blog_info 
         SET blog_url = ?, blog_type = ?, estimated_post_count = ?, updated_at = NOW() 
         WHERE domain_id = ?`,
        [
          blogData.blogUrl,
          blogType,
          blogData.articles.length,
          domainId
        ]
      );
      
      logger.info(`Updated blog info in domain_blog_info: ${blogData.blogUrl}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error saving blog info: ${error.message}`);
    return false;
  }
};

// Export the extract function
export default {
  extract
}; 