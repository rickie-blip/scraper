# PUMA Collection Configuration Examples

## How to Set Different Collections

### Method 1: Environment Variables
```bash
# Men's Shoes (Default)
export COLLECTION_NAME="men-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/men/shoes"
export COLLECTION_DISPLAY_NAME="Men's Shoes"

# Women's Shoes
export COLLECTION_NAME="women-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/women/shoes"
export COLLECTION_DISPLAY_NAME="Women's Shoes"

# Kids' Shoes
export COLLECTION_NAME="kids-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/kids/shoes"
export COLLECTION_DISPLAY_NAME="Kids' Shoes"

# Men's Clothing
export COLLECTION_NAME="men-clothing"
export COLLECTION_URL="https://us.puma.com/us/en/men/clothing"
export COLLECTION_DISPLAY_NAME="Men's Clothing"

# Women's Clothing
export COLLECTION_NAME="women-clothing"
export COLLECTION_URL="https://us.puma.com/us/en/women/clothing"
export COLLECTION_DISPLAY_NAME="Women's Clothing"

# Athletic Accessories
export COLLECTION_NAME="accessories"
export COLLECTION_URL="https://us.puma.com/us/en/accessories"
export COLLECTION_DISPLAY_NAME="Athletic Accessories"

# Running Shoes (Specific Category)
export COLLECTION_NAME="running-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/men/shoes/running"
export COLLECTION_DISPLAY_NAME="Running Shoes"
```

### Method 2: Add to .env File
```properties
# Add these to your .env file
COLLECTION_NAME=women-shoes
COLLECTION_URL=https://us.puma.com/us/en/women/shoes
COLLECTION_DISPLAY_NAME=Women's Shoes
```

## Results for Each Collection

### Men's Shoes
- **File**: `puma_men-shoes_2025-07-30T10-27-51-416Z.csv`
- **Email Subject**: "PUMA Men's Shoes Inventory Extract - 7/30/2025"
- **Console**: "📦 Collection: Men's Shoes"

### Women's Clothing  
- **File**: `puma_women-clothing_2025-07-30T10-27-51-416Z.csv`
- **Email Subject**: "PUMA Women's Clothing Inventory Extract - 7/30/2025"
- **Console**: "📦 Collection: Women's Clothing"

### Kids' Accessories
- **File**: `puma_kids-accessories_2025-07-30T10-27-51-416Z.csv`
- **Email Subject**: "PUMA Kids' Accessories Inventory Extract - 7/30/2025"
- **Console**: "📦 Collection: Kids' Accessories"

## Finding PUMA Collection URLs

1. Go to https://us.puma.com/
2. Navigate to the category you want (Men → Shoes, Women → Clothing, etc.)
3. Copy the URL from your browser
4. Use that as your `COLLECTION_URL`

### Common PUMA URLs:
- Men's Shoes: `/us/en/men/shoes`
- Women's Shoes: `/us/en/women/shoes`  
- Kids' Shoes: `/us/en/kids/shoes`
- Men's Clothing: `/us/en/men/clothing`
- Women's Clothing: `/us/en/women/clothing`
- Accessories: `/us/en/accessories`
- Sale Items: `/us/en/sale`

## Quick Setup Commands

```bash
# Set credentials (do once)
export SENDER_EMAIL="ict@shopzetu.com"
export SENDER_PWD="your-app-password"

# Set collection and run
export COLLECTION_NAME="women-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/women/shoes"
export COLLECTION_DISPLAY_NAME="Women's Shoes"
node scrape_final.js
```
