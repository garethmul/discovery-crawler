import fetch from 'node-fetch';

const API_URL = process.env.API_BASE_URL || 'http://localhost:3009/api/scrape';
const API_KEY = process.env.API_KEY || 'test-api-key-123';
const DOMAIN = process.env.DOMAIN || 'hachette.co.uk';

async function queueDomain() {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        domain: DOMAIN,
        depth: 3,
        priority: 'high',
        extractors: ['general', 'blog', 'images', 'videos', 'social', 'isbn']
      })
    });

    const data = await response.json();
    console.log('Response:', data);
    
    if (data.jobId) {
      console.log(`Job queued successfully with ID: ${data.jobId}`);
      console.log(`Status: ${data.status}`);
      console.log(`Estimated time: ${data.estimatedTime || 'Unknown'}`);
      
      // Start polling for job status
      await pollJobStatus(data.jobId);
    } else {
      console.error('Failed to queue job:', data);
    }
  } catch (error) {
    console.error('Error queuing domain:', error.message);
  }
}

async function pollJobStatus(jobId) {
  console.log(`Polling for job status: ${jobId}`);
  
  let complete = false;
  let attempts = 0;
  const maxAttempts = 60; // Poll for up to 5 minutes (60 * 5s)
  
  while (!complete && attempts < maxAttempts) {
    try {
      const response = await fetch(`${API_URL}/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      });
      
      const data = await response.json();
      console.log(`Job status: ${data.status}, Progress: ${data.progress || 0}%`);
      
      if (data.status === 'complete' || data.status === 'failed' || data.status === 'cancelled') {
        complete = true;
        
        if (data.status === 'complete') {
          console.log('Job completed successfully!');
          await getJobResults(jobId);
        } else {
          console.log(`Job ${data.status}. Reason: ${data.message || 'Unknown'}`);
        }
      } else {
        // Wait 5 seconds before next poll
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      attempts++;
    } catch (error) {
      console.error('Error polling job status:', error.message);
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  if (!complete) {
    console.log('Max polling attempts reached. Check job status manually.');
  }
}

async function getJobResults(jobId) {
  try {
    const response = await fetch(`${API_URL}/results/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    const results = await response.json();
    
    console.log('\n----- RESULTS SUMMARY -----');
    console.log(`Domain: ${results.domain}`);
    console.log(`Scraped at: ${results.scrapedAt}`);
    
    if (results.isbn) {
      console.log('\n----- ISBN DATA -----');
      console.log(`ISBNs found: ${results.isbn.isbns?.length || 0}`);
      console.log(`ISBN images found: ${results.isbn.isbnImages?.length || 0}`);
      
      // Print ISBNs
      if (results.isbn.isbns?.length > 0) {
        console.log('\nISBNs:');
        results.isbn.isbns.forEach((isbn, index) => {
          console.log(`${index + 1}. ${isbn.isbn} (${isbn.type}) - Found on: ${isbn.page}`);
        });
      }
      
      // Print ISBN images
      if (results.isbn.isbnImages?.length > 0) {
        console.log('\nISBN Images:');
        results.isbn.isbnImages.forEach((img, index) => {
          console.log(`${index + 1}. ${img.isbn} (${img.type}) - Image: ${img.imageUrl}`);
        });
      }
    } else {
      console.log('No ISBN data found.');
    }
    
    console.log('\n----- GENERAL DATA -----');
    console.log(`Pages crawled: ${results.general?.siteStructure?.sections?.length || 0}`);
    
    console.log('\nComplete results saved to results.json');
    
    // Save results to file
    const fs = await import('fs');
    fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
    
  } catch (error) {
    console.error('Error getting job results:', error.message);
  }
}

// Run the script
queueDomain(); 