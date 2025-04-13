import logger from '../utils/logger.js';
import * as domainDataRepository from '../database/repositories/domainDataRepository.js';
import * as discoveryService from './discoveryService.js';
import * as analysisService from './analysisService.js';
import * as brandfetchService from './brandfetchService.js';
import * as aiAnalysisService from './aiAnalysisService.js';
import io from '../utils/io.js';
import * as puppeteerService from './puppeteerService.js';

// Import content extractors
import * as generalExtractor from './contentExtractors/generalExtractor.js';
import * as blogExtractor from './contentExtractors/blogExtractor.js';
import * as imageExtractor from './contentExtractors/imageExtractor.js';
import * as enhancedImageExtractor from './contentExtractors/enhancedImageExtractor.js';
import * as colorExtractor from './contentExtractors/colorExtractor.js';
import * as socialMediaExtractor from './contentExtractors/socialMediaExtractor.js';
import * as videoExtractor from './contentExtractors/videoExtractor.js';
import * as isbnExtractor from './contentExtractors/isbnExtractor.js';
import * as appExtractor from './contentExtractors/appExtractor.js';
import * as rssExtractor from './contentExtractors/rssExtractor.js';
import * as podcastExtractor from './contentExtractors/podcastExtractor.js';

// In-memory job queue and active jobs
const jobQueue = {
  high: [],
  normal: [],
  low: []
};

const activeJobs = new Map();
const completedJobs = new Map();
const MAX_COMPLETED_JOBS = 100; // Maximum number of completed jobs to keep in memory
const MAX_CONCURRENT_JOBS = process.env.MAX_CONCURRENT_JOBS ? parseInt(process.env.MAX_CONCURRENT_JOBS) : 5;

// Initialize the scrape manager
export const init = async () => {
  logger.info('Initializing scrape manager...');
  
  // Load any pending jobs from the database
  try {
    const pendingJobs = await domainDataRepository.getPendingJobs();
    
    if (pendingJobs && pendingJobs.length > 0) {
      logger.info(`Found ${pendingJobs.length} pending jobs to resume`);
      
      pendingJobs.forEach(job => {
        if (job.status === 'processing') {
          // Reset to queued for jobs that were processing when the service stopped
          job.status = 'queued';
        }
        
        // Ensure job.priority exists and is valid
        const priority = job.priority && ['high', 'normal', 'low'].includes(job.priority) 
          ? job.priority 
          : 'normal';
        
        jobQueue[priority].push(job);
      });
    }
    
    // Start the job processor
    processNextJob();
    return true;
  } catch (error) {
    logger.error(`Error initializing scrape manager: ${error.message}`);
    // Continue without database jobs
    processNextJob();
    return false;
  }
};

// Helper function to emit socket events safely
const emitSocketEvent = (room, event, data) => {
  try {
    if (global.io) {
      global.io.to(room).emit(event, data);
    }
  } catch (error) {
    logger.error(`Error emitting socket event: ${error.message}`);
  }
};

// Queue a new job
export const queueJob = async (job) => {
  try {
    // Save job to database
    await domainDataRepository.saveJob(job);
    
    // Add to in-memory queue
    jobQueue[job.priority].push(job);
    
    // Process next job if not at capacity
    if (activeJobs.size < MAX_CONCURRENT_JOBS) {
      processNextJob();
    }
    
    return {
      jobId: job.jobId,
      status: job.status,
      estimatedTime: '30s'
    };
  } catch (error) {
    logger.error(`Error queueing job: ${error.message}`);
    throw new Error(`Failed to queue job: ${error.message}`);
  }
};

// Process the next job in the queue
const processNextJob = async () => {
  // If at capacity, don't process more jobs
  if (activeJobs.size >= MAX_CONCURRENT_JOBS) {
    return;
  }
  
  // Find the next job to process (high priority first)
  let nextJob = null;
  
  if (jobQueue.high.length > 0) {
    nextJob = jobQueue.high.shift();
  } else if (jobQueue.normal.length > 0) {
    nextJob = jobQueue.normal.shift();
  } else if (jobQueue.low.length > 0) {
    nextJob = jobQueue.low.shift();
  }
  
  if (nextJob) {
    // Process the job
    processJob(nextJob);
    
    // Check if we can process more jobs
    if (activeJobs.size < MAX_CONCURRENT_JOBS) {
      processNextJob();
    }
  }
};

// Process a job
const processJob = async (job) => {
  try {
    // Update job status to processing
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    
    // Add to active jobs
    activeJobs.set(job.jobId, job);
    
    // Update job status in database
    try {
      await domainDataRepository.updateJobStatus(job.jobId, 'processing', job.startedAt);
    } catch (error) {
      logger.error(`Error updating job status: ${error.message}`);
    }
    
    logger.info(`[JOB] 🚀 Starting job ${job.jobId} for domain ${job.domain}`);
    
    // Check if this is a resume of a previous job
    const canResume = await domainDataRepository.canResumeJob(job.jobId);
    if (canResume) {
      logger.info(`[JOB] 🔄 Resuming previous crawl for job ${job.jobId}`);
    }
    
    // Update progress
    job.progress = 10;
    job.message = 'Discovering pages';
    
    // Notify clients of progress update
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    // Get domain info ID - will need this for saving data
    let domainInfoId = null;
    try {
      // Get or create domain_info entry
      const [existingDomainInfo] = await domainDataRepository.query(
        'SELECT id FROM domain_info WHERE domain = ?',
        [job.domain]
      );
      
      if (existingDomainInfo && existingDomainInfo.length > 0) {
        domainInfoId = existingDomainInfo[0].id;
      } else {
        const [result] = await domainDataRepository.query(
          'INSERT INTO domain_info (domain, status, created_at) VALUES (?, "processing", NOW())',
          [job.domain]
        );
        domainInfoId = result.insertId;
      }
      
      logger.info(`[JOB] Using domain ID: ${domainInfoId} for ${job.domain}`);
    } catch (error) {
      logger.error(`[JOB] ❌ Error creating domain_info entry: ${error.message}`);
    }
    
    // === PASS 1: Initial Broad Discovery ===
    // Ensure maxPages is explicitly set - either from params or with the default value from discoveryService
    const maxPagesForPass1 = job.params?.maxPages !== undefined ? job.params.maxPages : 25;
    logger.info(`[JOB] Starting Pass 1: Discovering up to ${maxPagesForPass1} pages`);
    job.progress = 10;
    job.message = 'Pass 1: Discovering pages';
    emitSocketEvent(`job-${job.jobId}`, 'job-update', { jobId: job.jobId, status: job.status, progress: job.progress, message: job.message });
    
    // Check for forceRecrawl flag from job parameters
    const forceRecrawl = job.params?.forceRecrawl === true;
    if (forceRecrawl) {
      logger.info(`[JOB] Force recrawl requested, ignoring crawl frequency limit.`);
    }
    
    // Use depth from job.params, default to 1 if not specified
    const crawlDepth = job.params?.depth || 1; 
    logger.info(`[JOB] Using crawl depth: ${crawlDepth}`); // Add log to confirm depth

    // Always pass maxPages explicitly 
    let initialPages = await discoveryService.discoverPages(job.domain, crawlDepth, job.jobId, {
      maxPages: maxPagesForPass1, // Always pass a value, never undefined
      userAgent: job.userAgent,
      respectCrawlFrequency: !forceRecrawl, 
      domainInfoId: domainInfoId
    });
    logger.info(`[JOB] 📋 Discovered ${initialPages.length} pages for ${job.domain}`);
    
    // Check if any pages were discovered
    if (!initialPages || initialPages.length === 0) {
      logger.warn(`[JOB] ⚠️ No pages discovered for ${job.domain}. Creating minimal results.`);
      
      // Create minimal results with empty data
      const minimalResults = {
        domain: job.domain,
        scrapedAt: new Date().toISOString(),
        general: {
          siteStructure: {
            title: `${job.domain} Website`,
            meta: {
              description: `Website for ${job.domain}`,
              keywords: job.domain
            },
            sections: []
          },
          prominentLinks: [],
          navigationStructure: {
            mainNav: [],
            footerNav: []
          }
        },
        blog: {
          hasBlog: false,
          blogUrl: null,
          articles: []
        },
        images: {
          all: [],
          byCategory: {},
          heroImages: [],
          brandImages: [],
          productImages: [],
          contentImages: [],
          backgroundImages: [],
          bannerImages: [],
          galleryImages: [],
          socialProofImages: [],
          teamImages: [],
          otherImages: []
        },
        colors: {
          primaryColor: '#4285f4',
          secondaryColors: ['#ea4335', '#fbbc05', '#34a853'],
          palette: ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#ffffff', '#000000']
        },
        isbn: {
          isbns: [],
          isbnImages: []
        }
      };
      
      // Skip to saving minimal results
      job.progress = 90;
      job.message = 'Saving minimal results';
      
      // Notify clients of progress update
      emitSocketEvent(`job-${job.jobId}`, 'job-update', {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        message: job.message
      });
      
      try {
        await domainDataRepository.saveResults(job.jobId, minimalResults);
        logger.info(`[JOB] Saved minimal results for job ${job.jobId}`);
        
        // Complete the job
        job.status = 'complete';
        job.progress = 100;
        job.message = 'Scrape completed with minimal results';
        job.completedAt = new Date().toISOString();
        
        // Update job status in database
        await domainDataRepository.updateJobStatus(job.jobId, 'complete', job.startedAt, job.completedAt);
        
        // Notify clients of job completion
        emitSocketEvent(`job-${job.jobId}`, 'job-update', {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress,
          message: job.message
        });
        
        // Remove from active jobs and add to completed jobs
        activeJobs.delete(job.jobId);
        completedJobs.set(job.jobId, job);
        
        // Process next job if available
        return processNextJob();
      } catch (error) {
        logger.error(`[JOB] ❌ Error saving minimal results: ${error.message}`);
        throw new Error(`Failed to save minimal results: ${error.message}`);
      }
    }
    
    // Update progress
    job.progress = 30;
    job.message = 'Extracting content';
    
    // Notify clients of progress update
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    // Extract content from pages
    const pageContents = [];
    for (let i = 0; i < initialPages.length; i++) {
      const page = initialPages[i];
      logger.info(`[JOB] Extracting content from page ${i+1}/${initialPages.length}: ${page.url}`);
      const content = await discoveryService.extractPageContent(page.url);
      pageContents.push(content);
      
      // Update progress incrementally
      job.progress = Math.min(30 + Math.floor((pageContents.length / initialPages.length) * 30), 60);
      
      // Notify clients of progress update
      emitSocketEvent(`job-${job.jobId}`, 'job-update', {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        message: `Extracted content from ${pageContents.length} of ${initialPages.length} pages`
      });
    }
    
    // Update progress
    job.progress = 60;
    job.message = 'Extracting detailed information';
    
    // Notify clients of progress update
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    // Convert page content to format expected by extractors
    const pagesWithContent = initialPages.map((page, index) => ({
      url: page.url,
      title: page.title,
      content: pageContents[index]?.content || ''
    }));
    
    // Process all extractors and save directly to database
    logger.info(`[JOB] Running content extractors for ${job.domain}`);
    
    // Extract enhanced image data
    // Note: Images are now saved to database directly by the extractor
    let enhancedImageData = null;
    try {
      logger.info(`[JOB] Running enhanced image extractor`);
      enhancedImageData = await enhancedImageExtractor.extract(pagesWithContent, {
        domainId: domainInfoId,
        saveToDatabase: true
      });
      logger.info(`[JOB] ✅ Image extraction complete. Found ${enhancedImageData.all.length} images categorized into ${Object.keys(enhancedImageData.byCategory).length} categories`);
    } catch (error) {
      logger.error(`[JOB] ❌ Error extracting enhanced image data: ${error.message}`);
      logger.error(error.stack);
    }
    
    // Extract social media data
    // Note: Social links are now saved to database directly by the extractor
    let socialMediaData = null;
    try {
      logger.info(`[JOB] Running social media extractor`);
      socialMediaData = await socialMediaExtractor.extract(pagesWithContent);
      logger.info(`[JOB] ✅ Social media extraction complete. Found ${Object.keys(socialMediaData.links).length} social platforms`);
    } catch (error) {
      logger.error(`[JOB] ❌ Error extracting social media data: ${error.message}`);
    }
    
    // Extract blog content
    let blogData = null;
    try {
      logger.info(`[JOB] Running blog extractor`);
      blogData = await blogExtractor.extract(pagesWithContent);
      if (blogData.hasBlog) {
        logger.info(`[JOB] ✅ Blog extraction complete. Found blog at ${blogData.blogUrl} with ${blogData.articles.length} articles`);
        
        // Save blog data right away
        if (domainInfoId) {
          await blogExtractor.saveBlogInfo(domainInfoId, blogData);
        }
      } else {
        logger.info(`[JOB] ℹ️ No blog found on ${job.domain}`);
      }
    } catch (error) {
      logger.error(`[JOB] ❌ Error extracting blog data: ${error.message}`);
    }
    
    // Extract video content
    let videoData = null;
    try {
      logger.info(`[JOB] Running video extractor`);
      videoData = await videoExtractor.extract(pagesWithContent);
      if (videoData && videoData.length > 0) {
        logger.info(`[JOB] ✅ Video extraction complete. Found ${videoData.length} videos`);
        
        // Save video data right away
        if (domainInfoId) {
          await videoExtractor.saveVideos(domainInfoId, videoData);
        }
      } else {
        logger.info(`[JOB] ℹ️ No videos found on ${job.domain}`);
      }
    } catch (error) {
      logger.error(`[JOB] ❌ Error extracting video data: ${error.message}`);
    }
    
    // Extract ISBN data
    let isbnData = null;
    try {
      logger.info(`[JOB] Running ISBN extractor`);
      isbnData = await isbnExtractor.extract(pagesWithContent);
      if (isbnData && isbnData.isbns.length > 0) {
        logger.info(`[JOB] ✅ ISBN extraction complete. Found ${isbnData.isbns.length} ISBNs and ${isbnData.isbnImages.length} ISBN images`);
      } else {
        logger.info(`[JOB] ℹ️ No ISBNs found on ${job.domain}`);
      }
    } catch (error) {
      logger.error(`[JOB] ❌ Error extracting ISBN data: ${error.message}`);
    }
    
    // Process the extracted content
    const results = {
      domain: job.domain,
      scrapedAt: new Date().toISOString(),
      general: {
        siteStructure: {
          title: initialPages.length > 0 ? `${initialPages[0].title}` : `${job.domain} Website`,
          meta: {
            description: `Website for ${job.domain}`,
            keywords: job.domain
          },
          sections: initialPages.map(page => ({
            level: page.depth,
            text: page.title,
            id: page.url.split('/').pop() || 'home'
          }))
        },
        prominentLinks: pageContents.flatMap(content => 
          content.links.map(link => ({
            url: link.url,
            text: link.text,
            isInternal: link.url.includes(job.domain)
          }))
        ).slice(0, 10),
        navigationStructure: {
          mainNav: pageContents.flatMap(content => 
            content.links.map(link => ({
              url: link.url,
              text: link.text
            }))
          ).slice(0, 5),
          footerNav: []
        }
      },
      blog: blogData || {
        hasBlog: false,
        blogUrl: null,
        articles: []
      },
      images: enhancedImageData || {
        // Fallback to simple image extraction if enhanced fails
        heroImages: pageContents.flatMap(content => 
          content.images.map(image => ({
            url: image.url,
            alt: image.alt,
            width: 1200,
            height: 600
          }))
        ).slice(0, 3),
        brandImages: []
      },
      colors: {
        primaryColor: '#4285f4',
        secondaryColors: ['#ea4335', '#fbbc05', '#34a853'],
        palette: ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#ffffff', '#000000']
      },
      isbn: isbnData || {
        isbns: [],
        isbnImages: []
      },
      socialMedia: socialMediaData || {
        links: {},
        content: {}
      },
      videos: videoData || []
    };
    
    // Update progress
    job.progress = 70;
    job.message = 'Fetching brand data and generating AI analysis';
    
    // Notify clients of progress update
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    // Store the website data in domain_info
    if (domainInfoId) {
      try {
        await domainDataRepository.query(
          'UPDATE domain_info SET data = ? WHERE id = ?',
          [JSON.stringify(results), domainInfoId]
        );
        
        logger.info(`[JOB] ✅ Stored website data in domain_info for ${job.domain}`);
      } catch (error) {
        logger.error(`[JOB] ❌ Error storing website data: ${error.message}`);
      }
    }
    
    // Fetch brand data from Brandfetch
    let brandData = null;
    try {
      logger.info(`[JOB] Fetching brand data from Brandfetch for ${job.domain}`);
      brandData = await brandfetchService.fetchBrandInfo(job.domain);
      if (brandData) {
        logger.info(`[JOB] ✅ Successfully fetched brand data for ${job.domain}`);
        results.brandData = {
          name: brandData.name || job.domain,
          domain: brandData.domain || job.domain,
          description: brandData.description || '',
          links: brandData.links || []
        };
      } else {
        logger.warn(`[JOB] ⚠️ No brand data available for ${job.domain}`);
      }
    } catch (error) {
      logger.error(`[JOB] ❌ Error fetching brand data: ${error.message}`);
    }
    
    // Generate AI analysis if we have a domain_info ID
    if (domainInfoId) {
      try {
        logger.info(`[JOB] Generating AI analysis for ${job.domain}`);
        const aiAnalysis = await aiAnalysisService.generateAIAnalysis(
          job.domain,
          results,
          brandData,
          domainInfoId
        );
        
        if (aiAnalysis) {
          logger.info(`[JOB] ✅ Successfully generated AI analysis for ${job.domain}`);
          results.aiAnalysis = aiAnalysis;
        } else {
          logger.warn(`[JOB] ⚠️ Failed to generate AI analysis for ${job.domain}`);
        }
      } catch (error) {
        logger.error(`[JOB] ❌ Error generating AI analysis: ${error.message}`);
      }
    }
    
    // Update progress
    job.progress = 90;
    job.message = 'Saving final results';
    
    // Notify clients of progress update
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    // Save results to database
    try {
      if (!global.dbConnected) {
        throw new Error('Database not connected');
      }
      
      await domainDataRepository.saveResults(job.jobId, results);
      logger.info(`[JOB] ✅ Saved results for job ${job.jobId}`);
      
      // Update the domain_info status if it exists
      if (domainInfoId) {
        await domainDataRepository.query(
          'UPDATE domain_info SET status = "complete", last_processed_at = NOW() WHERE id = ?',
          [domainInfoId]
        );
      }
    } catch (error) {
      logger.error(`[JOB] ❌ Error saving results: ${error.message}`);
      throw new Error(`Failed to save results: ${error.message}`);
    }
    
    // Complete the job
    job.status = 'complete';
    job.progress = 100;
    job.message = 'Scrape completed successfully';
    job.completedAt = new Date().toISOString();
    
    // Update job status in database
    try {
      await domainDataRepository.updateJobStatus(job.jobId, 'complete', job.startedAt, job.completedAt);
    } catch (error) {
      logger.error(`[JOB] ❌ Error updating job status: ${error.message}`);
      // Don't throw here, we've already completed the main work
    }
    
    // Notify clients of job completion
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
    
    logger.info(`[JOB] 🎉 Job ${job.jobId} for ${job.domain} completed successfully!`);
    
    // Remove from active jobs and add to completed jobs
    activeJobs.delete(job.jobId);
    completedJobs.set(job.jobId, job);
    
    // Trim completed jobs if needed
    if (completedJobs.size > MAX_COMPLETED_JOBS) {
      const oldestKey = completedJobs.keys().next().value;
      completedJobs.delete(oldestKey);
    }
    
    // Process next job if available
    processNextJob();
  } catch (error) {
    logger.error(`[JOB] ❌ Error processing job ${job.jobId}: ${error.message}`);
    logger.error(error.stack);
    
    // Update job status to failed
    job.status = 'failed';
    job.progress = 0;
    job.message = `Scrape failed: ${error.message}`;
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    
    // Notify clients of job failure
    emitSocketEvent(`job-${job.jobId}`, 'job-update', {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message,
      error: job.error
    });
    
    // Update job status in database
    try {
      await domainDataRepository.updateJobStatus(job.jobId, 'failed', job.startedAt, job.completedAt, error.message);
    } catch (dbError) {
      logger.error(`[JOB] ❌ Error updating job status: ${dbError.message}`);
    }
    
    // Remove from active jobs and add to completed jobs
    activeJobs.delete(job.jobId);
    completedJobs.set(job.jobId, job);
    
    // Process next job if available
    processNextJob();
  }
};

// Get job status
export const getJobStatus = async (jobId) => {
  try {
    // Check in-memory jobs first
    if (activeJobs.has(jobId)) {
      return activeJobs.get(jobId);
    }
    
    if (completedJobs.has(jobId)) {
      return completedJobs.get(jobId);
    }
    
    // Check database
    const jobStatus = await domainDataRepository.getJobStatus(jobId);
    return jobStatus;
  } catch (error) {
    logger.error(`Error getting job status: ${error.message}`);
    throw new Error(`Failed to get job status: ${error.message}`);
  }
};

// Cancel a job
export const cancelJob = async (jobId) => {
  try {
    // Check if job is active
    if (activeJobs.has(jobId)) {
      const job = activeJobs.get(jobId);
      
      // Update job status
      job.status = 'cancelled';
      job.progress = 0;
      job.message = 'Job cancelled by user';
      job.completedAt = new Date().toISOString();
      
      // Update job status in database
      await domainDataRepository.updateJobStatus(job.jobId, 'cancelled', job.startedAt, job.completedAt);
      
      // Remove from active jobs and add to completed jobs
      activeJobs.delete(jobId);
      completedJobs.set(jobId, job);
      
      // Process next job if available
      processNextJob();
      
      return { success: true, message: 'Job cancelled successfully' };
    }
    
    // Check if job is in queue
    for (const priority of ['high', 'normal', 'low']) {
      const index = jobQueue[priority].findIndex(job => job.jobId === jobId);
      
      if (index !== -1) {
        const job = jobQueue[priority][index];
        
        // Remove from queue
        jobQueue[priority].splice(index, 1);
        
        // Update job status in database
        await domainDataRepository.updateJobStatus(job.jobId, 'cancelled', null, new Date().toISOString());
        
        return { success: true, message: 'Job cancelled successfully' };
      }
    }
    
    // Job not found in memory, try to cancel in database
    const result = await domainDataRepository.updateJobStatus(jobId, 'cancelled', null, new Date().toISOString());
    
    if (result) {
      return { success: true, message: 'Job cancelled successfully' };
    } else {
      return { success: false, message: 'Job not found' };
    }
  } catch (error) {
    logger.error(`Error cancelling job: ${error.message}`);
    return { success: false, message: `Error cancelling job: ${error.message}` };
  }
};

// List all jobs
export const listJobs = async (status, limit, offset) => {
  try {
    // Get jobs from database
    const jobs = await domainDataRepository.listJobs(status, limit, offset);
    return jobs;
  } catch (error) {
    logger.error(`Error listing jobs: ${error.message}`);
    throw new Error(`Failed to list jobs: ${error.message}`);
  }
};

// Extract content using specified extractors
const extractContent = async (domain, pages, extractors) => {
  const results = {
    domain
  };
  
  try {
    // Extract general information
    if (extractors.includes('general')) {
      results.general = await generalExtractor.extract(pages);
    }
    
    // Extract blog content
    if (extractors.includes('blog')) {
      results.blog = await blogExtractor.extract(pages);
    }
    
    // Extract images
    if (extractors.includes('images')) {
      results.images = await enhancedImageExtractor.extract(pages);
    }
    
    // Extract colors
    if (extractors.includes('colors')) {
      results.colors = await colorExtractor.extract(pages);
    }
    
    // Extract social media
    if (extractors.includes('social')) {
      results.socialMedia = await socialMediaExtractor.extract(pages);
    }
    
    // Extract videos
    if (extractors.includes('videos')) {
      results.videos = await videoExtractor.extract(pages);
    }
    
    // Extract ISBN data
    if (extractors.includes('isbn')) {
      const isbnData = await isbnExtractor.extract(pages);
      results.isbnData = isbnData.isbns;
      results.isbnImages = isbnData.images;
    }
    
    // Extract app links (new)
    if (extractors.includes('apps')) {
      results.apps = await appExtractor.extract(pages);
    }
    
    // Extract RSS and podcast feeds (new)
    if (extractors.includes('rss') || extractors.includes('podcast')) {
      results.podcastInfo = await podcastExtractor.extract(pages);
    }
    
    return results;
  } catch (error) {
    logger.error(`Error extracting content: ${error.message}`);
    throw error;
  }
}; 