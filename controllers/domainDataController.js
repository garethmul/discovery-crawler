import * as domainInfoRepo from '../database/repositories/domainInfoRepository.js';
import * as websiteMetadataRepo from '../database/repositories/websiteMetadataRepository.js';
import * as domainGeneralInfoRepo from '../database/repositories/domainGeneralInfoRepository.js';
import * as domainBlogInfoRepo from '../database/repositories/domainBlogInfoRepository.js';
import * as domainMediaContentRepo from '../database/repositories/domainMediaContentRepository.js';
import * as domainSocialPodcastRepo from '../database/repositories/domainSocialPodcastRepository.js';
import * as domainColorsRepo from '../database/repositories/domainColorsRepository.js';
import * as domainAiAnalysisRepo from '../database/repositories/domainAiAnalysisRepository.js';
import logger from '../utils/logger.js';
import { getPool } from '../database/db.js';

// Helper to safely parse JSON, returning a default value on error or if input is not a string/null/undefined
const safeJsonParse = (jsonString, defaultValue = null) => {
  if (jsonString === null || jsonString === undefined) {
    return defaultValue;
  }
  if (typeof jsonString === 'object') {
    // If it's already an object/array (e.g., from direct DB JSON type or previously parsed), return it
    return jsonString;
  }
  if (typeof jsonString !== 'string') {
    logger.warn(`safeJsonParse expected a string but received ${typeof jsonString}`);
    return defaultValue;
  }
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    // Log only if the string is not empty or represents 'null' etc.
    if (jsonString.trim() !== '' && jsonString.trim().toLowerCase() !== 'null') {
       logger.warn(`Failed to parse JSON string: ${jsonString.substring(0, 100)}... Error: ${e.message}`);
    }
    return defaultValue;
  }
};

/**
 * Get a list of all domains in the database
 */
export const getAllDomains = async (req, res) => {
  logger.info('[API] Fetching list of all domains');
  
  try {
    const domains = await domainInfoRepo.findAll();
    
    // If no domains found, return empty array
    if (!domains || domains.length === 0) {
      return res.status(200).json([]);
    }
    
    // Return simplified list with just id and domain_name
    const simplifiedList = domains.map(domain => ({
      id: domain.id,
      domain_name: domain.domain_name,
      last_scraped_at: domain.last_scraped_at
    }));
    
    res.status(200).json(simplifiedList);
  } catch (error) {
    logger.error(`[API] Error fetching list of domains: ${error.message}`, error);
    res.status(500).json({ message: 'Failed to fetch domains list.', error: error.message });
  }
};

export const getDomainDataById = async (req, res) => {
  const { domainId } = req.params;

  if (!domainId || isNaN(parseInt(domainId))) {
    return res.status(400).json({ message: 'Valid domain ID is required.' });
  }

  const id = parseInt(domainId);
  logger.info(`[API] Fetching comprehensive data for domain ID: ${id}`);

  try {
    // DIRECT DB CHECK: Inspect all relevant tables for this domain
    const db = await getPool();
    
    // First, check specific data in domain_general_info
    try {
      const [generalInfoCheck] = await db.query(`
        SELECT * FROM domain_general_info WHERE domain_id = ?
      `, [id]);
      
      logger.info(`[DEBUG] domain_general_info data: ${JSON.stringify(generalInfoCheck)}`);
      
      // Check schema of domain_general_info
      const [generalInfoSchema] = await db.query(`
        DESCRIBE domain_general_info
      `);
      
      logger.info(`[DEBUG] domain_general_info schema: ${JSON.stringify(generalInfoSchema)}`);
      
    } catch (err) {
      logger.error(`[DEBUG] Error checking domain_general_info: ${err.message}`);
    }
    
    // Fetch data from all relevant repositories in parallel
    const [
      domainInfo,
      metadata,
      generalInfo,
      blogInfo,
      mediaContent,
      socialPodcast,
      colors,
      aiAnalysisData // This holds the potentially multi-table AI data object from the repo
    ] = await Promise.all([
      domainInfoRepo.findById(id),
      websiteMetadataRepo.findByDomainId(id),
      domainGeneralInfoRepo.findByDomainId(id),
      domainBlogInfoRepo.findByDomainId(id),
      domainMediaContentRepo.findByDomainId(id),
      domainSocialPodcastRepo.findByDomainId(id),
      domainColorsRepo.findByDomainId(id),
      domainAiAnalysisRepo.findByDomainId(id) // Fetches the combined AI data object
    ]);

    // Debug logging to see exactly what data is returned from each repository
    logger.debug(`[DEBUG] Raw domain info for ID ${id}: ${JSON.stringify(domainInfo)}`);
    logger.debug(`[DEBUG] Raw metadata for domain ID ${id}: ${JSON.stringify(metadata)}`);
    logger.debug(`[DEBUG] Raw general info for domain ID ${id}: ${JSON.stringify(generalInfo)}`);
    logger.debug(`[DEBUG] Raw blog info for domain ID ${id}: ${JSON.stringify(blogInfo)}`);
    logger.debug(`[DEBUG] Raw media content for domain ID ${id}: ${JSON.stringify(mediaContent)}`);
    logger.debug(`[DEBUG] Raw social podcast data for domain ID ${id}: ${JSON.stringify(socialPodcast)}`);
    logger.debug(`[DEBUG] Raw colors data for domain ID ${id}: ${JSON.stringify(colors)}`);
    logger.debug(`[DEBUG] Raw AI analysis data for domain ID ${id}: ${JSON.stringify(aiAnalysisData)}`);

    if (!domainInfo) {
      logger.warn(`[API] Domain info not found for ID: ${id}`);
      return res.status(404).json({ message: `Domain with ID ${id} not found.` });
    }

    // Combine and structure the data, parsing JSON fields safely
    const aggregatedData = {
      domainId: id,
      domainName: domainInfo.domain_name, // Assuming domain_info table has domain_name
      lastScraped: domainInfo.last_scraped_at, // Assuming domain_info has this
      status: domainInfo.status, // Assuming domain_info has this

      metadata: metadata ? {
        title: metadata.title,
        description: metadata.description,
        logoUrl: metadata.logo_url,
        themeColor: metadata.theme_color,
      } : null,

      general: generalInfo ? {
        // If we have a general_data field (new dynamic approach), try to use that first
        ...(generalInfo.general_data ? safeJsonParse(generalInfo.general_data, {}) : {}),
        
        // Otherwise use the individual fields if available
        siteStructure: generalInfo.site_structure ? 
          safeJsonParse(generalInfo.site_structure, { title: '', meta: {}, sections: [] }) : 
          { title: '', meta: {}, sections: [] },
        
        prominentLinks: generalInfo.prominent_links ? 
          safeJsonParse(generalInfo.prominent_links, []) : [],
        
        navigationStructure: generalInfo.navigation_structure ? 
          safeJsonParse(generalInfo.navigation_structure, { mainMenu: [], footerMenu: [] }) : 
          { mainMenu: [], footerMenu: [] },
        
        contactInfo: generalInfo.contact_info ? 
          safeJsonParse(generalInfo.contact_info, { email: null, phone: null, address: null, socialLinks: {} }) : 
          { email: null, phone: null, address: null, socialLinks: {} },
          
        _source: generalInfo._source || 'standard'
      } : null,

      blog: blogInfo ? {
        hasBlog: blogInfo.has_blog,
        blogUrl: blogInfo.blog_url,
        articles: safeJsonParse(blogInfo.articles, []),
      } : { hasBlog: false, blogUrl: null, articles: [] }, // Default if no blog info row

      media: mediaContent ? {
        images: {
          // Check if we have the new all_images property (from domain_images table)
          all: mediaContent.all_images || 
              // Otherwise use the old format of combining hero and brand images
              [
                ...(safeJsonParse(mediaContent.hero_images, [])?.map(img => ({ ...(typeof img === 'string' ? { url: img } : img), type: 'Hero' })) || []), 
                ...(safeJsonParse(mediaContent.brand_images, [])?.map(img => ({ ...(typeof img === 'string' ? { url: img } : img), type: 'Brand' })) || []),
              ].filter(img => img && img.url),
          
          // Add categorized images if available (new format)
          ...(mediaContent.images_by_category ? { 
            byCategory: mediaContent.images_by_category 
          } : {}),
          
          // Add individual category arrays - use new format if available, otherwise fall back to JSON parsing
          heroImages: mediaContent.hero_images ? 
            (Array.isArray(mediaContent.hero_images) ? mediaContent.hero_images : safeJsonParse(mediaContent.hero_images, [])) : [],
            
          teamImages: mediaContent.team_images ? 
            (Array.isArray(mediaContent.team_images) ? mediaContent.team_images : safeJsonParse(mediaContent.team_images, [])) : [],
            
          brandImages: mediaContent.brand_images ? 
            (Array.isArray(mediaContent.brand_images) ? mediaContent.brand_images : safeJsonParse(mediaContent.brand_images, [])) : [],
            
          otherImages: mediaContent.other_images ? 
            (Array.isArray(mediaContent.other_images) ? mediaContent.other_images : safeJsonParse(mediaContent.other_images, [])) : [],
            
          bannerImages: mediaContent.banner_images ? 
            (Array.isArray(mediaContent.banner_images) ? mediaContent.banner_images : safeJsonParse(mediaContent.banner_images, [])) : [],
            
          contentImages: mediaContent.content_images ? 
            (Array.isArray(mediaContent.content_images) ? mediaContent.content_images : safeJsonParse(mediaContent.content_images, [])) : [],
            
          galleryImages: mediaContent.gallery_images ? 
            (Array.isArray(mediaContent.gallery_images) ? mediaContent.gallery_images : safeJsonParse(mediaContent.gallery_images, [])) : [],
            
          productImages: mediaContent.product_images ? 
            (Array.isArray(mediaContent.product_images) ? mediaContent.product_images : safeJsonParse(mediaContent.product_images, [])) : [],
            
          backgroundImages: mediaContent.background_images ? 
            (Array.isArray(mediaContent.background_images) ? mediaContent.background_images : safeJsonParse(mediaContent.background_images, [])) : [],
            
          socialProofImages: mediaContent.social_proof_images ? 
            (Array.isArray(mediaContent.social_proof_images) ? mediaContent.social_proof_images : safeJsonParse(mediaContent.social_proof_images, [])) : [],
        },
        
        // Handle videos - array or JSON string
        videos: mediaContent.videos ? 
          (Array.isArray(mediaContent.videos) ? mediaContent.videos : safeJsonParse(mediaContent.videos, [])) : [],
          
        // Include source info for debugging
        _source: mediaContent._source || 'unknown'
      } : { 
        images: { 
          all: [], 
          byCategory: {
            hero: [],
            logo: [],
            team: [],
            other: [],
            banner: [],
            content: [],
            gallery: [],
            product: [],
            background: [],
            social_proof: []
          },
          heroImages: [],
          teamImages: [],
          brandImages: [],
          otherImages: [],
          bannerImages: [],
          contentImages: [],
          galleryImages: [],
          productImages: [],
          backgroundImages: [],
          socialProofImages: []
        }, 
        videos: []
      },

      socialPodcast: socialPodcast ? {
        socialLinks: safeJsonParse(socialPodcast.social_links, {}),
        podcastFeeds: safeJsonParse(socialPodcast.podcast_feeds, []),
        podcastEpisodes: safeJsonParse(socialPodcast.podcast_episodes, []),
        socialContent: safeJsonParse(socialPodcast.social_content, {}),
      } : { socialLinks: {}, podcastFeeds: [], podcastEpisodes: [], socialContent: {} }, // Default if no social/podcast row

      colors: colors ? {
        primaryColor: colors.primary_color,
        secondaryColors: safeJsonParse(colors.secondary_colors, []),
        palette: safeJsonParse(colors.palette, []),
      } : null,

      // Process the AI Analysis data object returned by the repository
       aiAnalysis: aiAnalysisData ? {
            // Check if we received an object with _source info (new dynamic approach)
            ...(aiAnalysisData._source ? { _source: aiAnalysisData._source } : {}),
            
            // Handle brandfetch data if available
            ...(aiAnalysisData.brandfetch_data ? { 
                brandfetchData: typeof aiAnalysisData.brandfetch_data === 'string' ?
                    safeJsonParse(aiAnalysisData.brandfetch_data) : aiAnalysisData.brandfetch_data
            } : {}),
            
            // Handle general ai_analysis field
            ...(aiAnalysisData.ai_analysis ? { 
                analysis: typeof aiAnalysisData.ai_analysis === 'string' ?
                    safeJsonParse(aiAnalysisData.ai_analysis) : aiAnalysisData.ai_analysis
            } : {}),
            
            // Handle data from ai_ prefixed tables
            ...(aiAnalysisData.appColorSchemes ? { 
                colorSchemes: typeof aiAnalysisData.appColorSchemes.schemes === 'string' ?
                    safeJsonParse(aiAnalysisData.appColorSchemes.schemes) : aiAnalysisData.appColorSchemes
            } : {}),
            
            ...(aiAnalysisData.appFeatures ? { 
                features: typeof aiAnalysisData.appFeatures.features === 'string' ?
                    safeJsonParse(aiAnalysisData.appFeatures.features) : aiAnalysisData.appFeatures
            } : {}),
            
            ...(aiAnalysisData.appSuggestions ? { 
                appSuggestions: typeof aiAnalysisData.appSuggestions.suggestions === 'string' ?
                    safeJsonParse(aiAnalysisData.appSuggestions.suggestions) : aiAnalysisData.appSuggestions
            } : {}),
            
            ...(aiAnalysisData.contentCategories ? { 
                contentCategories: typeof aiAnalysisData.contentCategories.categories === 'string' ?
                    safeJsonParse(aiAnalysisData.contentCategories.categories) : aiAnalysisData.contentCategories
            } : {}),
            
            ...(aiAnalysisData.marketingTips ? { 
                marketingTips: typeof aiAnalysisData.marketingTips.tips === 'string' ?
                    safeJsonParse(aiAnalysisData.marketingTips.tips) : aiAnalysisData.marketingTips
            } : {})
        } : null,
    };
    
    // Add debugging information for the response
    aggregatedData._debug = {
        dataAvailability: {
          domainInfo: !!domainInfo,
          metadata: !!metadata,
            generalInfo: !!generalInfo,
            blogInfo: !!blogInfo,
            mediaContent: !!mediaContent,
          socialPodcast: !!socialPodcast,
            colors: !!colors,
            aiAnalysisData: !!aiAnalysisData
        }
    };

    // Remove null values from the aiAnalysis section if fields weren't found or parsed incorrectly
    if (aggregatedData.aiAnalysis) {
        Object.keys(aggregatedData.aiAnalysis).forEach(key => {
            if (aggregatedData.aiAnalysis[key] === null || aggregatedData.aiAnalysis[key] === undefined) {
                delete aggregatedData.aiAnalysis[key];
            }
        });
        // If after cleanup, aiAnalysis is empty, set it to null
        if (Object.keys(aggregatedData.aiAnalysis).length === 0) {
             aggregatedData.aiAnalysis = null;
         }
    }

    res.status(200).json(aggregatedData);

  } catch (error) {
    logger.error(`[API] Error fetching comprehensive data for domain ID ${id}: ${error.message}`, error);
    res.status(500).json({ message: 'Failed to fetch domain data.', error: error.message });
  }
}; 