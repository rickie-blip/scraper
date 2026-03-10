import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeToPath } from '@fast-csv/format';

async function scrapePumaShoes() {
  try {
    console.log('Fetching PUMA men\'s shoes page...');
    
    // First, let's get the main page to understand the API structure
    const mainResponse = await axios.get('https://us.puma.com/us/en/men/shoes', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    const $ = cheerio.load(mainResponse.data);
    console.log('Page loaded successfully');
    
    // Look for any API endpoints or data structures
    const scripts = $('script').toArray();
    let apiUrl = null;
    let categoryId = null;
    
    for (const script of scripts) {
      const scriptContent = $(script).html();
      if (scriptContent) {
        // Look for API endpoints
        const apiMatch = scriptContent.match(/api[^"]*products[^"]*|\/products\/[^"]+/gi);
        if (apiMatch) {
          console.log('Found potential API endpoint:', apiMatch[0]);
          apiUrl = apiMatch[0];
        }
        
        // Look for category IDs
        const categoryMatch = scriptContent.match(/"categoryId":"([^"]+)"|"category":"([^"]+)"/i);
        if (categoryMatch) {
          categoryId = categoryMatch[1] || categoryMatch[2];
          console.log('Found category ID:', categoryId);
        }
      }
    }
    
    // Try to find the product grid data structure
    const nextDataScript = $('script#__NEXT_DATA__');
    if (nextDataScript.length > 0) {
      try {
        const nextData = JSON.parse(nextDataScript.html());
        console.log('Exploring NEXT_DATA structure...');
        
        // Look for product data in various possible locations
        const searchPaths = [
          'props.pageProps.initialData',
          'props.pageProps.products',
          'props.pageProps.data.products',
          'props.pageProps.categoryData',
          'props.pageProps.apolloState',
          'query'
        ];
        
        for (const path of searchPaths) {
          const data = getNestedValue(nextData, path);
          if (data) {
            console.log(`Found data at path: ${path}`);
            console.log('Data structure:', Object.keys(data));
            
            // If this looks like product data, try to extract it
            if (data.products || (Array.isArray(data) && data.length > 0)) {
              const products = data.products || data;
              console.log(`Found ${products.length} products`);
              return extractProducts(products);
            }
          }
        }
        
        // If no direct product data found, look for Apollo cache or state
        if (nextData.props && nextData.props.pageProps && nextData.props.pageProps.apolloState) {
          console.log('Exploring Apollo state...');
          const apolloState = nextData.props.pageProps.apolloState;
          
          // Look for product-like objects in Apollo cache
          for (const [key, value] of Object.entries(apolloState)) {
            if (key.includes('Product') || key.includes('Item')) {
              console.log(`Found Apollo cache entry: ${key}`);
              if (value && (value.name || value.title || value.productName)) {
                console.log('Product found:', value.name || value.title || value.productName);
              }
            }
          }
        }
        
      } catch (e) {
        console.log('Error parsing NEXT_DATA:', e.message);
      }
    }
    
    // Try alternative approach - look for AJAX endpoints
    console.log('Trying to find AJAX product endpoints...');
    
    // Common PUMA API patterns
    const possibleEndpoints = [
      'https://us.puma.com/api/products',
      'https://us.puma.com/api/v1/products',
      'https://us.puma.com/us/en/api/products',
      'https://us.puma.com/graphql',
      'https://us.puma.com/api/catalog/products'
    ];
    
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`Trying endpoint: ${endpoint}`);
        const response = await axios.get(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://us.puma.com/us/en/men/shoes'
          },
          timeout: 5000
        });
        
        if (response.data && response.data.products) {
          console.log(`Success! Found products at ${endpoint}`);
          return extractProducts(response.data.products);
        }
      } catch (e) {
        console.log(`Endpoint ${endpoint} failed:`, e.message);
      }
    }
    
    console.log('No product data found. The site might use dynamic loading or different API structure.');
    return [];
    
  } catch (error) {
    console.error('Error scraping PUMA shoes:', error.message);
    return [];
  }
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

function extractProducts(products) {
  console.log(`Extracting data from ${products.length} products...`);
  
  const extractedProducts = products.map(product => {
    // Handle different possible product data structures
    const name = product.name || product.title || product.productName || product.displayName || 'Unknown Product';
    const price = product.price || product.currentPrice || product.salePrice || product.originalPrice || 'N/A';
    const image = product.image || product.imageUrl || product.thumbnail || (product.images && product.images[0]) || 'N/A';
    const url = product.url || product.link || product.href || 'N/A';
    const id = product.id || product.productId || product.sku || 'N/A';
    
    // Generate handle for Shopify (URL-friendly version of name)
    const handle = name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    
    return {
      Handle: handle,
      Title: name,
      'Image Src': typeof image === 'string' ? image : (image.url || image.src || 'N/A'),
      'Product URL': url.startsWith('http') ? url : `https://us.puma.com${url}`,
      Price: typeof price === 'object' ? (price.current || price.sale || price.regular || JSON.stringify(price)) : price,
      'Product ID': id
    };
  });
  
  return extractedProducts;
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log('No products to save');
    return;
  }
  
  const filename = `puma_shoes_${Date.now()}.csv`;
  
  try {
    await writeToPath(filename, products, { headers: true });
    console.log(`✅ Successfully saved ${products.length} products to ${filename}`);
  } catch (error) {
    console.error('Error saving CSV:', error.message);
  }
}

// Run the scraper
scrapePumaShoes()
  .then(products => {
    console.log(`\n📊 Summary:`);
    console.log(`Total products found: ${products.length}`);
    
    if (products.length > 0) {
      console.log('Sample product:', products[0]);
      return saveToCSV(products);
    }
  })
  .catch(error => {
    console.error('❌ Scraping failed:', error.message);
  });
