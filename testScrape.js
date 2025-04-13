import axios from 'axios';
import 'dotenv/config';

// Configuration
const API_URL = 'http://localhost:3009/api';
const API_KEY = process.env.API_KEY;
const TEST_DOMAIN = 'example.com';

// Headers for authentication
const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

/**
 * Test the complete scraping flow
 */
async function testScraping() {
  try {
    console.log('🔍 Testing Web Scraping Service');
    console.log('------------------------------');
    
    // 1. Submit a scrape job
    console.log(`\n1. Submitting scrape job for ${TEST_DOMAIN}...`);
    const submitResponse = await axios.post(`${API_URL}/scrape`, {
      domain: TEST_DOMAIN,
      depth: 1,
      priority: 'high',
      extractors: ['general', 'blog', 'images', 'videos', 'social', 'podcast', 'colors']
    }, { headers });
    
    const jobId = submitResponse.data.jobId;
    console.log(`✅ Job submitted! Job ID: ${jobId}`);
    console.log(`   Status: ${submitResponse.data.status}`);
    console.log(`   Estimated time: ${submitResponse.data.estimatedTime}`);
    
    // 2. Poll for job status until complete or failed
    console.log(`\n2. Polling for job status...`);
    let jobComplete = false;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    
    while (!jobComplete && attempts < maxAttempts) {
      const statusResponse = await axios.get(`${API_URL}/scrape/status/${jobId}`, { headers });
      const status = statusResponse.data;
      
      console.log(`   [${new Date().toISOString()}] Status: ${status.status}, Progress: ${status.progress || 0}%`);
      
      if (status.message) {
        console.log(`   Message: ${status.message}`);
      }
      
      if (status.status === 'complete' || status.status === 'failed') {
        jobComplete = true;
        console.log(`\n${status.status === 'complete' ? '✅ Job completed successfully!' : '❌ Job failed!'}`);
      } else {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
      }
    }
    
    if (!jobComplete) {
      console.log(`\n⚠️ Test timed out after ${maxAttempts * 5} seconds`);
      return;
    }
    
    // 3. Retrieve results if job completed successfully
    try {
      console.log(`\n3. Retrieving job results...`);
      const resultsResponse = await axios.get(`${API_URL}/scrape/results/${jobId}`, { headers });
      const results = resultsResponse.data;
      
      console.log(`\n✅ Results retrieved successfully!`);
      console.log(`\n📊 Summary of results for ${results.domain}:`);
      
      // Display a summary of the results
      if (results.general) {
        console.log(`\n📄 General Information:`);
        console.log(`   - Navigation items: ${Object.keys(results.general.navigationStructure?.mainMenu || {}).length}`);
        console.log(`   - Prominent links: ${results.general.prominentLinks?.length || 0}`);
      }
      
      if (results.blog) {
        console.log(`\n📝 Blog Information:`);
        console.log(`   - Has blog: ${results.blog.hasBlog ? 'Yes' : 'No'}`);
        console.log(`   - Articles found: ${results.blog.articles?.length || 0}`);
      }
      
      if (results.images) {
        console.log(`\n🖼️ Images:`);
        console.log(`   - Hero images: ${results.images.heroImages?.length || 0}`);
        console.log(`   - Logo images: ${results.images.logoImages?.length || 0}`);
      }
      
      if (results.videos) {
        console.log(`\n🎬 Videos:`);
        console.log(`   - Total videos: ${results.videos.length || 0}`);
      }
      
      if (results.socialMedia) {
        console.log(`\n📱 Social Media:`);
        console.log(`   - Social profiles: ${Object.keys(results.socialMedia.links || {}).join(', ') || 'None'}`);
      }
      
      if (results.colors) {
        console.log(`\n🎨 Colors:`);
        console.log(`   - Primary color: ${results.colors.primaryColor || 'None'}`);
        console.log(`   - Secondary colors: ${(results.colors.secondaryColors || []).join(', ') || 'None'}`);
      }
      
      if (results.analysis) {
        console.log(`\n🧠 Analysis:`);
        console.log(`   - Website type: ${results.analysis.websiteType || 'Unknown'}`);
        console.log(`   - Content topics: ${(results.analysis.contentRelevance || []).join(', ') || 'None'}`);
        console.log(`   - Summary: ${results.analysis.summary || 'Not available'}`);
      }
      
      console.log(`\n✅ Test completed successfully!`);
    } catch (error) {
      console.log(`\n❌ Error retrieving results: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

// Run the test
testScraping(); 