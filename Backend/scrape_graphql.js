import puppeteer from 'puppeteer';
import { writeToPath } from '@fast-csv/format';

async function interceptGraphQLRequests() {
  let browser;
  try {
    console.log('Launching browser to intercept GraphQL requests...');
    
    browser = await puppeteer.launch({
      headless: false, // Keep visible for debugging
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
    
    // Set up request/response interception
    await page.setRequestInterception(true);
    
    const graphqlResponses = [];
    
    page.on('request', (request) => {
      const url = request.url();
      
      // Log GraphQL requests specifically
      if (url.includes('/api/graphql')) {
        console.log('🔍 GraphQL Request detected');
        console.log('URL:', url);
        console.log('Method:', request.method());
        console.log('Post Data:', request.postData());
      }
      
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      
      if (url.includes('/api/graphql') && status === 200) {
        try {
          const data = await response.json();
          console.log('📦 GraphQL Response received');
          console.log('Status:', status);
          console.log('Data structure:', Object.keys(data));
          
          graphqlResponses.push(data);
          
          // Parse the GraphQL response for product data
          const products = extractProductsFromGraphQL(data);
          if (products.length > 0) {
            console.log(`🎯 Found ${products.length} products in GraphQL response!`);
            await saveToCSV(products);
            return products;
          }
          
        } catch (e) {
          console.log(`Error parsing GraphQL response:`, e.message);
        }
      }
    });

    // Navigate to the page
    console.log('Navigating to PUMA men\'s shoes page...');
    await page.goto('https://us.puma.com/us/en/men/shoes', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for initial load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Scroll to trigger more requests
    console.log('Scrolling to trigger more GraphQL requests...');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 200;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if(totalHeight >= scrollHeight || totalHeight >= 3000){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait for any additional requests
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Try to extract products from the DOM as well
    console.log('Extracting products from DOM...');
    const domProducts = await page.evaluate(() => {
      // Look for common product selectors
      const productSelectors = [
        '[data-testid*="product"]',
        '.product-tile',
        '.product-card',
        '.product-item',
        '[class*="Product"]',
        '[class*="tile"]',
        'article',
        '[data-product-id]'
      ];
      
      let products = [];
      
      for (const selector of productSelectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        
        elements.forEach((element, index) => {
          try {
            // Look for various text patterns
            const titleSelectors = ['h1', 'h2', 'h3', 'h4', '.title', '.name', '[data-testid*="title"]', '[data-testid*="name"]'];
            const priceSelectors = ['.price', '[data-testid*="price"]', '.cost', '.amount', '[class*="price"]'];
            const imageSelectors = ['img'];
            const linkSelectors = ['a'];
            
            let title = '';
            let price = '';
            let image = '';
            let link = '';
            
            // Find title
            for (const titleSel of titleSelectors) {
              const titleEl = element.querySelector(titleSel);
              if (titleEl && titleEl.textContent.trim()) {
                title = titleEl.textContent.trim();
                break;
              }
            }
            
            // Find price
            for (const priceSel of priceSelectors) {
              const priceEl = element.querySelector(priceSel);
              if (priceEl && priceEl.textContent.trim()) {
                price = priceEl.textContent.trim();
                break;
              }
            }
            
            // Find image
            const imgEl = element.querySelector('img');
            if (imgEl) {
              image = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy-src') || '';
            }
            
            // Find link
            const linkEl = element.querySelector('a') || element.closest('a');
            if (linkEl) {
              link = linkEl.href || '';
            }
            
            // Only add if we have meaningful data
            if (title && title.length > 3) {
              products.push({
                title: title,
                price: price,
                image: image,
                link: link,
                selector: selector,
                index: index
              });
            }
          } catch (e) {
            console.log(`Error extracting product ${index}:`, e.message);
          }
        });
        
        if (products.length > 0) {
          console.log(`Successfully extracted ${products.length} products using selector: ${selector}`);
          break; // Use the first successful selector
        }
      }
      
      return products;
    });

    console.log(`\n📊 DOM Extraction Results:`);
    console.log(`Found ${domProducts.length} products from DOM`);
    
    if (domProducts.length > 0) {
      console.log('Sample DOM product:', domProducts[0]);
      
      const formattedProducts = domProducts.map((product, index) => ({
        Handle: product.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim(),
        Title: product.title,
        'Image Src': product.image,
        'Product URL': product.link.startsWith('http') ? product.link : `https://us.puma.com${product.link}`,
        Price: product.price,
        'Product ID': `puma-dom-${index + 1}`,
        'Extraction Method': `DOM (${product.selector})`
      }));
      
      await saveToCSV(formattedProducts);
      return formattedProducts;
    }

    // If no DOM products, analyze GraphQL responses
    console.log(`\n📊 GraphQL Analysis:`);
    console.log(`Received ${graphqlResponses.length} GraphQL responses`);
    
    graphqlResponses.forEach((response, index) => {
      console.log(`\nGraphQL Response ${index + 1}:`);
      console.log('Keys:', Object.keys(response));
      
      // Deep dive into the data structure
      if (response.data) {
        console.log('Response.data keys:', Object.keys(response.data));
        
        // Look for common product data patterns
        const searchForProducts = (obj, path = '') => {
          if (!obj || typeof obj !== 'object') return;
          
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (Array.isArray(value) && value.length > 0) {
              const firstItem = value[0];
              if (firstItem && typeof firstItem === 'object') {
                const itemKeys = Object.keys(firstItem);
                if (itemKeys.some(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('title') || k.toLowerCase().includes('product'))) {
                  console.log(`🎯 Potential products array at: ${currentPath} (${value.length} items)`);
                  console.log('Sample item keys:', itemKeys);
                  console.log('Sample item:', firstItem);
                }
              }
            } else if (value && typeof value === 'object') {
              searchForProducts(value, currentPath);
            }
          }
        };
        
        searchForProducts(response.data);
      }
    });

    return [];

  } catch (error) {
    console.error('Error during GraphQL interception:', error.message);
    return [];
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

function extractProductsFromGraphQL(data) {
  const products = [];
  
  // Recursive function to find product-like objects
  const findProducts = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const keys = Object.keys(item);
          // Check if this looks like a product
          if (keys.some(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('title')) &&
              keys.some(k => k.toLowerCase().includes('price') || k.toLowerCase().includes('cost'))) {
            
            const name = item.name || item.title || item.displayName || item.productName || `Product ${products.length + 1}`;
            const price = item.price || item.currentPrice || item.salePrice || item.cost || 'N/A';
            const image = item.image || item.imageUrl || item.thumbnail || (item.images && item.images[0]) || 'N/A';
            const url = item.url || item.link || item.href || 'N/A';
            const id = item.id || item.productId || item.sku || `graphql-${products.length + 1}`;
            
            products.push({
              Handle: name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim(),
              Title: name,
              'Image Src': typeof image === 'string' ? image : (image?.url || image?.src || 'N/A'),
              'Product URL': url.startsWith('http') ? url : `https://us.puma.com${url}`,
              Price: typeof price === 'object' ? JSON.stringify(price) : price,
              'Product ID': id,
              'Extraction Method': `GraphQL (${path})`
            });
          }
          
          findProducts(item, `${path}[${index}]`);
        }
      });
    } else {
      for (const [key, value] of Object.entries(obj)) {
        findProducts(value, path ? `${path}.${key}` : key);
      }
    }
  };
  
  findProducts(data);
  return products;
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log('No products to save');
    return;
  }
  
  const filename = `puma_graphql_${Date.now()}.csv`;
  
  try {
    await writeToPath(filename, products, { headers: true });
    console.log(`✅ Successfully saved ${products.length} products to ${filename}`);
  } catch (error) {
    console.error('Error saving CSV:', error.message);
  }
}

// Run the GraphQL interceptor
interceptGraphQLRequests()
  .then(products => {
    console.log(`\n🏁 Final result: ${products.length} products extracted`);
    if (products.length === 0) {
      console.log('❌ No products were successfully extracted');
    } else {
      console.log('✅ Products extracted successfully!');
    }
  })
  .catch(error => {
    console.error('❌ GraphQL interception failed:', error.message);
  });
