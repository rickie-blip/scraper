import puppeteer from 'puppeteer';
import { writeToPath } from '@fast-csv/format';

async function interceptPumaRequests() {
  let browser;
  try {
    console.log('Launching browser to intercept network requests...');
    
    browser = await puppeteer.launch({
      headless: false, // Set to true for production
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set up request interception
    await page.setRequestInterception(true);
    
    const interceptedRequests = [];
    
    page.on('request', (request) => {
      const url = request.url();
      const method = request.method();
      
      // Log all requests to find API endpoints
      if (url.includes('api') || url.includes('graphql') || url.includes('product') || url.includes('catalog')) {
        console.log(`📡 API Request: ${method} ${url}`);
        interceptedRequests.push({
          url,
          method,
          headers: request.headers(),
          postData: request.postData()
        });
      }
      
      request.continue();
    });

    // Capture responses
    const apiResponses = [];
    
    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      
      if ((url.includes('api') || url.includes('graphql') || url.includes('product')) && status === 200) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const data = await response.json();
            console.log(`📦 API Response: ${url}`);
            console.log(`Status: ${status}, Data keys:`, Object.keys(data));
            
            apiResponses.push({
              url,
              status,
              data
            });
            
            // Check if this looks like product data
            if (data.products || data.items || data.data?.products || Array.isArray(data)) {
              const products = data.products || data.items || data.data?.products || data;
              if (Array.isArray(products) && products.length > 0) {
                console.log(`🎯 Found product data! ${products.length} items`);
                console.log('Sample product:', products[0]);
                
                const extractedProducts = extractProductData(products);
                await saveToCSV(extractedProducts);
                return extractedProducts;
              }
            }
          }
        } catch (e) {
          console.log(`Error parsing response from ${url}:`, e.message);
        }
      }
    });

    // Navigate to the page
    console.log('Navigating to PUMA men\'s shoes page...');
    await page.goto('https://us.puma.com/us/en/men/shoes', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for page to fully load and trigger any lazy loading
    console.log('Waiting for page to fully load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Scroll down to trigger lazy loading of products
    console.log('Scrolling to trigger product loading...');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if(totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait a bit more after scrolling
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to click load more button if it exists
    try {
      const loadMoreButton = await page.$('[data-testid="load-more"], .load-more, button:contains("Load More")');
      if (loadMoreButton) {
        console.log('Found Load More button, clicking...');
        await loadMoreButton.click();
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (e) {
      console.log('No Load More button found or failed to click');
    }

    // Try to extract products directly from the page if no API calls worked
    console.log('Attempting to extract products from page DOM...');
    const products = await page.evaluate(() => {
      const productElements = document.querySelectorAll('[data-testid*="product"], .product-tile, .product-card, .product-item, [class*="product"]');
      console.log(`Found ${productElements.length} potential product elements`);
      
      const products = [];
      
      productElements.forEach((element, index) => {
        try {
          const titleElement = element.querySelector('h1, h2, h3, h4, .title, .name, [data-testid*="title"], [data-testid*="name"]');
          const priceElement = element.querySelector('.price, [data-testid*="price"], .cost, .amount');
          const imageElement = element.querySelector('img');
          const linkElement = element.querySelector('a') || element.closest('a');
          
          const title = titleElement?.textContent?.trim() || '';
          const price = priceElement?.textContent?.trim() || '';
          const image = imageElement?.src || imageElement?.getAttribute('data-src') || '';
          const link = linkElement?.href || '';
          
          if (title && (price || image || link)) {
            products.push({
              title,
              price,
              image,
              link,
              index
            });
          }
        } catch (e) {
          console.log(`Error extracting product ${index}:`, e.message);
        }
      });
      
      return products;
    });

    console.log(`\n📊 Summary from DOM extraction:`);
    console.log(`Found ${products.length} products from page DOM`);
    
    if (products.length > 0) {
      console.log('Sample DOM product:', products[0]);
      const formattedProducts = products.map(product => ({
        Handle: product.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'),
        Title: product.title,
        'Image Src': product.image,
        'Product URL': product.link.startsWith('http') ? product.link : `https://us.puma.com${product.link}`,
        Price: product.price,
        'Product ID': `puma-${product.index}`
      }));
      
      await saveToCSV(formattedProducts);
      return formattedProducts;
    }

    console.log('\n📡 Intercepted API requests:');
    interceptedRequests.forEach(req => {
      console.log(`${req.method} ${req.url}`);
    });
    
    console.log('\n📦 API responses received:');
    apiResponses.forEach(resp => {
      console.log(`${resp.status} ${resp.url}`);
    });

    return [];

  } catch (error) {
    console.error('Error during interception:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function extractProductData(products) {
  return products.map((product, index) => {
    const name = product.name || product.title || product.displayName || `Product ${index + 1}`;
    const price = product.price || product.currentPrice || product.salePrice || 'N/A';
    const image = product.image || product.imageUrl || product.thumbnail || 'N/A';
    const url = product.url || product.link || product.href || 'N/A';
    
    return {
      Handle: name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'),
      Title: name,
      'Image Src': typeof image === 'string' ? image : (image.url || image.src || 'N/A'),
      'Product URL': url.startsWith('http') ? url : `https://us.puma.com${url}`,
      Price: typeof price === 'object' ? JSON.stringify(price) : price,
      'Product ID': product.id || product.sku || `puma-${index + 1}`
    };
  });
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log('No products to save');
    return;
  }
  
  const filename = `puma_intercepted_${Date.now()}.csv`;
  
  try {
    await writeToPath(filename, products, { headers: true });
    console.log(`✅ Successfully saved ${products.length} products to ${filename}`);
  } catch (error) {
    console.error('Error saving CSV:', error.message);
  }
}

// Run the interceptor
interceptPumaRequests()
  .then(products => {
    console.log(`\n🏁 Final result: ${products.length} products extracted`);
    if (products.length === 0) {
      console.log('❌ No products were successfully extracted');
    } else {
      console.log('✅ Products extracted successfully!');
    }
  })
  .catch(error => {
    console.error('❌ Interception failed:', error.message);
  });
