# PUMA Inventory Scraper - Email Configuration Guide

## Setup Instructions

### 1. Set Environment Variables

Before running the scraper, you need to set your email credentials:

```bash
# Set your Gmail credentials
export SENDER_EMAIL="your-email@gmail.com"
export SENDER_PWD="your-app-password"
```

### 2. Gmail App Password Setup

For Gmail accounts, you need to use an App Password:

1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Click on "Security" in the left sidebar
3. Under "Signing in to Google", click on "2-Step Verification"
4. Scroll down and click on "App passwords"
5. Select "Mail" and generate a password
6. Use this 16-character password as your `SENDER_PWD`

### 3. Running the Scraper

#### Option A: Use the Interactive Script
```bash
./run_scraper.sh
```

#### Option B: Set Environment Variables and Run Directly
```bash
# For Men's Shoes (default)
export COLLECTION_NAME="men-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/men/shoes"
export COLLECTION_DISPLAY_NAME="Men's Shoes"
node scrape_final.js

# For Women's Shoes
export COLLECTION_NAME="women-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/women/shoes"
export COLLECTION_DISPLAY_NAME="Women's Shoes"
node scrape_final.js

# For Kids' Shoes
export COLLECTION_NAME="kids-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/kids/shoes"
export COLLECTION_DISPLAY_NAME="Kids' Shoes"
node scrape_final.js
```

## Features

### Email Recipients
The scraper automatically sends the CSV to:
- nigel@shopzetu.com
- patrick@shopzetu.com

### File Naming
CSV files are automatically named with the collection:
- `puma_men-shoes_2025-07-30T10-06-42-880Z.csv`
- `puma_women-shoes_2025-07-30T10-06-42-880Z.csv`
- `puma_kids-shoes_2025-07-30T10-06-42-880Z.csv`

### Supported Collections
- Men's Shoes: `/men/shoes`
- Women's Shoes: `/women/shoes`
- Kids' Shoes: `/kids/shoes`
- Men's Clothing: `/men/clothing`
- Women's Clothing: `/women/clothing`
- Custom URLs supported

## Troubleshooting

### Email Issues
- Make sure you're using an App Password, not your regular Gmail password
- Check that 2-Step Verification is enabled
- Verify the SENDER_EMAIL and SENDER_PWD environment variables are set

### Collection Issues
- Make sure the COLLECTION_URL is valid
- Check that the PUMA website structure hasn't changed
- Verify the collection has products available

## Example Usage

```bash
# Set credentials (do this once per session)
export SENDER_EMAIL="your-email@gmail.com"
export SENDER_PWD="abcd efgh ijkl mnop"  # 16-character app password

# Scrape women's shoes
export COLLECTION_NAME="women-shoes"
export COLLECTION_URL="https://us.puma.com/us/en/women/shoes"
export COLLECTION_DISPLAY_NAME="Women's Shoes"
node scrape_final.js
```

The scraper will:
1. Extract all products from the specified collection
2. Save to a CSV file named `puma_women-shoes_[timestamp].csv`
3. Email the CSV to nigel@shopzetu.com and patrick@shopzetu.com
4. Provide detailed extraction summary
