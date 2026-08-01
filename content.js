chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractProductData') {
    // 1. Extract Product Title
    const title = document.querySelector('h1')?.innerText?.trim() || document.title;
    
    // 2. Extract Price across various e-commerce selectors
    const price = document.querySelector('.a-price .a-offscreen, ._30jeq3, .price, [data-test="product-price"], .a-price-whole')?.innerText?.trim() || 'Price tag not explicitly found';

    // 3. Extract Customer Ratings & Review Count
    const rating = document.querySelector('#acrPopover, ._3LWZlK, [data-hook="rating-out-of-text"]')?.innerText?.trim() || 'Rating unavailable';
    const reviewCount = document.querySelector('#acrCustomerReviewText, ._2_R_2P, [data-hook="total-review-count"]')?.innerText?.trim() || 'Review count unavailable';

    // 4. Extract Top Customer Reviews Text
    let reviews = [];
    const reviewElements = document.querySelectorAll('[data-hook="review-body"], ._27M-vq, .review-text, .user-review');
    reviewElements.forEach((el, index) => {
      if (index < 5) { // Get top 5 visible customer reviews
        reviews.push(el.innerText.trim().replace(/\s+/g, ' '));
      }
    });

    // 5. Extract Return Policy / Guarantee Text
    const returnPolicy = document.querySelector('#RETURNS_POLICY, #availability, ._3XIN9w, .return-policy-text')?.innerText?.trim() || 'Standard platform return guidelines apply.';

    // 6. Get General Body Excerpt for Additional Context
    const bodyExcerpt = document.body.innerText.substring(0, 2500).replace(/\s+/g, ' ');

    sendResponse({
      data: {
        title,
        price,
        rating,
        reviewCount,
        reviews: reviews.length > 0 ? reviews.join(' | ') : 'No direct review text scraped; analyze visual reviews from screenshot.',
        returnPolicy,
        bodyExcerpt
      }
    });
  }
  return true;
});