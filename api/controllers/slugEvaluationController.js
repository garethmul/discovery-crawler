import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utils/logger.js';
import { validationResult } from 'express-validator';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Create OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Evaluate a slug for an organization
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const evaluateSlug = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }
    
    const { organisation_name, requested_slug } = req.body;
    
    // Log the request details
    logger.info(`[SLUG-EVAL] Evaluating slug "${requested_slug}" for organisation "${organisation_name}"`);

    // Clean the slug (lowercase, replace spaces with hyphens)
    const cleanSlug = requested_slug.toLowerCase().trim().replace(/\s+/g, '-');

    // Create the prompt
    const prompt = `
### 🔧 Slug Evaluation Prompt (with Variables)

An organisation named **"${organisation_name}"** is choosing a URL slug for their public-facing profile.

They are considering the slug: **"${cleanSlug}"**

Please evaluate this slug based on the following requirements, and return your response in **strict JSON format**.

---

### ✅ Slug Requirements

The slug must:

- Clearly reflect the organisation's name or brand (this is a key requirement).
- Be suitable as a permanent part of a public-facing URL (e.g. \`christian360.com/${cleanSlug}\`).
- Be readable, memorable, and easy to share.
- Use lowercase letters only.
- Use hyphens instead of spaces.
- Avoid special characters (except hyphens).
- Avoid generic or ambiguous terms that don't clearly connect to the brand.

---

### 📥 JSON Response Format

Return your response in the following **strict JSON format**:

\`\`\`json
{
  "evaluated_slug": {
    "slug": "${cleanSlug}",
    "relevance_score": <integer from 1 to 10>,
    "comments": "<short explanation of how well the slug reflects the organisation name/brand>",
    "use_case_suitability": "<Core | Campaign | Not recommended>"
  },
  "recommended_alternatives": [
    {
      "slug": "<alternative-slug-1>",
      "relevance_score": <1–10>,
      "comments": "<brief reason>",
      "use_case_suitability": "<Core | Campaign>"
    }
    // Up to 9 total alternatives
  ]
}
\`\`\`

---

Please ensure:
- All slugs use lowercase and hyphens only.
- Alternatives must be closely aligned to the organisation's brand.
- Do not include any commentary outside the JSON block.
`;

    // Log OpenAI API call
    logger.info(`[SLUG-EVAL] Calling OpenAI API for slug "${cleanSlug}"`);

    try {
      // Call OpenAI API
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a specialized assistant that evaluates URL slugs for organizations. You always respond in the requested JSON format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      });

      // Extract and parse the response
      const content = response.choices[0].message.content;
      const jsonResponse = JSON.parse(content);

      // Log successful evaluation
      logger.info(`[SLUG-EVAL] Successfully evaluated slug "${cleanSlug}" - Score: ${jsonResponse.evaluated_slug.relevance_score}, Suitability: ${jsonResponse.evaluated_slug.use_case_suitability}`);

      // Return the evaluation
      return res.status(200).json({
        success: true,
        data: jsonResponse
      });
    } catch (openaiError) {
      // Handle OpenAI API specific errors
      logger.error(`[SLUG-EVAL] OpenAI API error: ${openaiError.message}`);
      
      if (openaiError.response) {
        return res.status(500).json({
          success: false,
          message: 'Error from OpenAI service',
          error: openaiError.response.data?.error?.message || openaiError.message
        });
      }
      
      // Handle general OpenAI errors
      return res.status(500).json({
        success: false,
        message: 'Error from OpenAI service',
        error: openaiError.message
      });
    }
  } catch (error) {
    logger.error(`[SLUG-EVAL] General error evaluating slug: ${error.message}`);
    logger.error(error.stack);
    
    return res.status(500).json({
      success: false,
      message: 'Server error while evaluating slug',
      error: error.message
    });
  }
}; 