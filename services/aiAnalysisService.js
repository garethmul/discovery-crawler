import { OpenAI } from 'openai';
import logger from '../utils/logger.js';
import { getPool } from '../../config/database.js';
import dotenv from 'dotenv';

// Load environment variables if not already loaded
dotenv.config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generates AI analysis for a domain
 * @param {string} domain - The domain to analyze
 * @param {object} websiteData - Data scraped from the website
 * @param {object} brandData - Data from Brandfetch API
 * @param {number} domainId - The domain_info ID to associate the data with
 * @returns {Promise<object>} - The generated AI analysis
 */
export const generateAIAnalysis = async (domain, websiteData, brandData, domainId) => {
  try {
    // Handle cases where input data might be missing or limited
    const sanitizedWebsiteData = websiteData || {
      domain,
      title: domain,
      description: '',
      socialMediaLinks: {}
    };
    
    const sanitizedBrandData = brandData || {
      name: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
      domain: domain
    };
    
    // Add some additional context if we're working with minimal data
    let dataQualityNote = "";
    if (!websiteData || Object.keys(websiteData).length < 3) {
      dataQualityNote += "Note: Limited website data available. Please provide best estimates based on the domain name and any available information. ";
    }
    if (!brandData) {
      dataQualityNote += "Note: No brand data available. Please provide best estimates based on the domain name and any available website information. ";
    }
    
    const systemPrompt = {
      role: "system",
      content: "You are an API that provides structured data to support development of a mobile app for publishing companies. The solution should support distribution of ebook, audiobook, video and multimedia courses as well as content being delivered to app users on a prescheduled basis. You must respond with valid JSON only, no other text. Format your response exactly according to the schema provided."
    };

    const userPrompt = {
      role: "user",
      content: `Analyze the following website and brand data to provide app development suggestions and brand analysis for ${domain}:

${dataQualityNote}

Website Content:
${JSON.stringify(sanitizedWebsiteData, null, 2)}

Brand Information:
${JSON.stringify(sanitizedBrandData, null, 2)}

Provide a detailed analysis in the following JSON structure:

{
    "brandAnalysis": {
        "industry_category": "Primary industry category",
        "business_type": "Type of business (B2B, B2C, etc.)",
        "target_audience": "Detailed description of target audience",
        "brand_voice": "Brand voice and tone description",
        "brand_values": "Core brand values and principles",
        "market_position": "Market positioning statement",
        "competitive_advantage": "Key competitive advantages",
        "key_differentiators": "Unique selling propositions and differentiators"
    },
    "appSuggestions": {
        "name1": "Suggested app name 1",
        "name2": "Suggested app name 2",
        "name3": "Suggested app name 3",
        "description": "2-3 sentence description",
        "targetAudience": "Target audience description",
        "monetizationStrategy": "Monetization approach",
        "developmentTime": "Estimated development time"
    },
    "features": [
        {
            "name": "Feature name",
            "description": "Feature description",
            "priority": "high|medium|low"
        }
    ],
    "colorSchemes": [
        {
            "name": "Scheme 1 name",
            "primary": "Primary color hex",
            "secondary": "Secondary color hex",
            "accent": "Accent color hex"
        },
        {
            "name": "Scheme 2 name",
            "primary": "Primary color hex",
            "secondary": "Secondary color hex",
            "accent": "Accent color hex"
        },
        {
            "name": "Scheme 3 name",
            "primary": "Primary color hex",
            "secondary": "Secondary color hex",
            "accent": "Accent color hex"
        }
    ],
    "contentCategories": [
        {
            "name": "Category name",
            "description": "Category description"
        }
    ],
    "marketingTips": [
        {
            "text": "Marketing tip text",
            "category": "Tip category"
        }
    ],
    "appIdea1": "A 1st idea - paragraph suggesting how the app could help the organisation reach a wider audience, engage them, open up new revenue opportunities, and establish a community around their content.",
    "appIdea1Headline": "Short headline summarising idea 1",
    "appIdea2": "A 2nd idea - paragraph suggesting how the app could help the organisation reach a wider audience, engage them, open up new revenue opportunities, and establish a community around their content.",
    "appIdea2Headline": "Short headline summarising idea 2",
    "appIdea3": "A 3rd idea - paragraph suggesting how the app could help the organisation reach a wider audience, engage them, open up new revenue opportunities, and establish a community around their content.",
    "appIdea3Headline": "Short headline summarising idea 3"
}`
    };

    // Add a timeout to the OpenAI request
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI analysis request timed out after 45 seconds')), 45000);
    });

    const openAiPromise = openai.chat.completions.create({
      model: "gpt-3.5-turbo-0125",
      messages: [systemPrompt, userPrompt],
      temperature: 0.7,
      max_tokens: 2000,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    // Race between the OpenAI request and the timeout
    const response = await Promise.race([openAiPromise, timeoutPromise]);
    const content = response.choices[0].message.content;
    
    try {
      // Extract JSON from the response (in case there's additional text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      const aiData = JSON.parse(jsonString);

      // Store the structured data in the database
      await storeAIAnalysisData(domainId, aiData);

      return aiData;
    } catch (parseError) {
      logger.error(`Error parsing OpenAI response as JSON: ${parseError.message}`);
      logger.error(`Raw content: ${content}`);
      throw new Error('Failed to parse AI analysis response');
    }
  } catch (error) {
    logger.error(`Error generating AI analysis: ${error.message}`);
    throw error;
  }
};

/**
 * Stores the AI analysis data in the appropriate tables
 * @param {number} domainId - The domain_info ID
 * @param {object} aiData - The AI analysis data
 */
const storeAIAnalysisData = async (domainId, aiData) => {
  try {
    logger.info(`Starting to store AI analysis data for domain ID: ${domainId}`);
    const db = getPool();

    if (!domainId) {
      throw new Error('domainId is required for storing AI analysis data');
    }

    // Store raw AI analysis data in domain_info table
    await db.query(
      'UPDATE domain_info SET ai_analysis = ? WHERE id = ?',
      [JSON.stringify(aiData), domainId]
    );

    // Store brand analysis
    if (aiData.brandAnalysis) {
      logger.info('Storing brand analysis data');
      await db.query('DELETE FROM domain_brand_analysis WHERE domain_id = ?', [domainId]);
      await db.query(
        `INSERT INTO domain_brand_analysis (
          domain_id, industry_category, business_type, target_audience,
          brand_voice, brand_values, market_position, competitive_advantage,
          key_differentiators
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          domainId,
          aiData.brandAnalysis.industry_category,
          aiData.brandAnalysis.business_type,
          aiData.brandAnalysis.target_audience,
          aiData.brandAnalysis.brand_voice,
          aiData.brandAnalysis.brand_values,
          aiData.brandAnalysis.market_position,
          aiData.brandAnalysis.competitive_advantage,
          aiData.brandAnalysis.key_differentiators
        ]
      );
    }

    // Store app suggestions
    if (aiData.appSuggestions) {
      logger.info('Storing app suggestions data');
      await db.query('DELETE FROM domain_app_suggestions WHERE domain_id = ?', [domainId]);
      await db.query(
        `INSERT INTO domain_app_suggestions (
          domain_id, name_option_1, name_option_2, name_option_3,
          description, target_audience, monetization_strategy, development_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          domainId,
          aiData.appSuggestions.name1,
          aiData.appSuggestions.name2,
          aiData.appSuggestions.name3,
          aiData.appSuggestions.description,
          aiData.appSuggestions.targetAudience,
          aiData.appSuggestions.monetizationStrategy,
          aiData.appSuggestions.developmentTime
        ]
      );
    }

    // Store features
    if (aiData.features && Array.isArray(aiData.features)) {
      logger.info('Storing features data');
      await db.query('DELETE FROM domain_features WHERE domain_id = ?', [domainId]);
      for (const feature of aiData.features) {
        await db.query(
          'INSERT INTO domain_features (domain_id, name, description, priority) VALUES (?, ?, ?, ?)',
          [domainId, feature.name, feature.description, feature.priority]
        );
      }
    }

    // Store color schemes
    if (aiData.colorSchemes && Array.isArray(aiData.colorSchemes)) {
      logger.info('Storing color schemes data');
      await db.query('DELETE FROM domain_color_schemes WHERE domain_id = ?', [domainId]);
      for (let i = 0; i < aiData.colorSchemes.length; i++) {
        const scheme = aiData.colorSchemes[i];
        if (scheme) {
          await db.query(
            `INSERT INTO domain_color_schemes (
              domain_id, scheme_number, name, primary_color,
              secondary_color, accent_color
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [domainId, i + 1, scheme.name, scheme.primary, scheme.secondary, scheme.accent]
          );
        }
      }
    }

    // Store content categories
    if (aiData.contentCategories && Array.isArray(aiData.contentCategories)) {
      logger.info('Storing content categories data');
      await db.query('DELETE FROM domain_content_categories WHERE domain_id = ?', [domainId]);
      for (const category of aiData.contentCategories) {
        await db.query(
          'INSERT INTO domain_content_categories (domain_id, name, description) VALUES (?, ?, ?)',
          [domainId, category.name, category.description]
        );
      }
    }

    // Store marketing tips
    if (aiData.marketingTips && Array.isArray(aiData.marketingTips)) {
      logger.info('Storing marketing tips data');
      await db.query('DELETE FROM domain_marketing_tips WHERE domain_id = ?', [domainId]);
      for (const tip of aiData.marketingTips) {
        await db.query(
          'INSERT INTO domain_marketing_tips (domain_id, tip_text, category) VALUES (?, ?, ?)',
          [domainId, tip.text, tip.category]
        );
      }
    }

    // Store app ideas
    if (aiData.appIdea1 || aiData.appIdea2 || aiData.appIdea3) {
      logger.info('Storing app ideas data');
      await db.query('DELETE FROM domain_app_ideas WHERE domain_id = ?', [domainId]);
      for (let i = 1; i <= 3; i++) {
        const ideaText = aiData[`appIdea${i}`];
        const headline = aiData[`appIdea${i}Headline`];
        if (ideaText && headline) {
          await db.query(
            'INSERT INTO domain_app_ideas (domain_id, idea_number, headline, description) VALUES (?, ?, ?, ?)',
            [domainId, i, headline, ideaText]
          );
        }
      }
    }

    logger.info('Successfully stored all AI analysis data');
  } catch (error) {
    logger.error(`Error storing AI analysis data: ${error.message}`);
    logger.error(error.stack);
    throw error;
  }
}; 