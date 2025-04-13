/**
 * Add preliminary categorization to image based on various signals
 */
function addPreliminaryCategorization(image, $, $element, page) {
  const { url, alt, selector, context, isBackground } = image;
  const urlLower = url.toLowerCase();
  const altLower = alt.toLowerCase();
  const selectorLower = selector.toLowerCase();
  const contextLower = context.toLowerCase();
  
  // Hero image detection
  if (
    selectorLower.includes('hero') ||
    selectorLower.includes('banner') ||
    selectorLower.includes('jumbotron') ||
    selectorLower.includes('cover') ||
    contextLower.includes('hero') ||
    contextLower.includes('banner') ||
    (image.isHomepage && image.position < 5 && image.score > 7)
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.HERO);
  }
  
  // Logo detection
  if (
    urlLower.includes('logo') ||
    altLower.includes('logo') ||
    selectorLower.includes('logo') ||
    selectorLower.includes('brand') ||
    contextLower.includes('logo') ||
    contextLower.includes('brand') ||
    // Additional checks for logo detection
    (image.fileFormat === 'svg') || // SVG images are commonly used for logos
    ($element.closest('header').length > 0 && (!image.width || image.width < 300)) || // Small images in header
    (!image.alt && $element.closest('header').length > 0) || // Images with no alt text in header
    $element.parent('a[href="/"], a[href="./"], a[href="index.html"]').length > 0 || // Images linked to homepage
    $element.parent(`a[href="${page.url}"]`).length > 0 || // Images linked to current page
    contextLower.includes('navbar') || // Images in navbar
    contextLower.includes('nav-') || // Images in nav components
    (image.position < 3 && image.isHomepage && !image.width) // Early images on homepage without specified width
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.LOGO);
  }
  
  // Product image detection
  if (
    urlLower.includes('product') ||
    altLower.includes('product') ||
    selectorLower.includes('product') ||
    contextLower.includes('product') ||
    selectorLower.includes('item') ||
    contextLower.includes('shop') ||
    contextLower.includes('store')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.PRODUCT);
  }
  
  // Gallery image detection
  if (
    selectorLower.includes('gallery') ||
    contextLower.includes('gallery') ||
    selectorLower.includes('slideshow') ||
    contextLower.includes('slideshow') ||
    contextLower.includes('carousel')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.GALLERY);
  }
  
  // Team image detection
  if (
    urlLower.includes('team') ||
    altLower.includes('team') ||
    altLower.includes('staff') ||
    altLower.includes('employee') ||
    altLower.includes('founder') ||
    selectorLower.includes('team') ||
    contextLower.includes('team') ||
    contextLower.includes('staff') ||
    contextLower.includes('about-us')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.TEAM);
  }
  
  // Banner/Promotional image detection
  if (
    urlLower.includes('banner') ||
    urlLower.includes('promo') ||
    urlLower.includes('ad') ||
    altLower.includes('promotion') ||
    altLower.includes('offer') ||
    altLower.includes('discount') ||
    selectorLower.includes('promotion') ||
    contextLower.includes('promotion')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.BANNER);
  }
  
  // Social proof image detection
  if (
    urlLower.includes('testimonial') ||
    urlLower.includes('review') ||
    urlLower.includes('partner') ||
    urlLower.includes('client') ||
    altLower.includes('testimonial') ||
    altLower.includes('review') ||
    altLower.includes('partner') ||
    altLower.includes('client') ||
    selectorLower.includes('testimonial') ||
    contextLower.includes('testimonial') ||
    contextLower.includes('review')
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.SOCIAL_PROOF);
  }
  
  // Content image detection (fallback if not more specific and in content area)
  if (
    (contextLower.includes('content') || 
     contextLower.includes('article') || 
     contextLower.includes('post') ||
     selectorLower.includes('content') ||
     selectorLower.includes('article')) &&
    image.potentialCategories.length === 0
  ) {
    image.potentialCategories.push(IMAGE_CATEGORIES.CONTENT);
  }
  
  // Background image detection is handled during extraction
  
  // If still no category, add OTHER
  if (image.potentialCategories.length === 0) {
    image.potentialCategories.push(IMAGE_CATEGORIES.OTHER);
  }
} 