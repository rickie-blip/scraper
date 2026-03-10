#!/bin/bash

# PUMA Collection Scraper - Configuration Examples
# Set your email credentials as environment variables before running

# Make sure you have your email credentials set
if [ -z "$SENDER_EMAIL" ] || [ -z "$SENDER_PWD" ]; then
    echo "⚠️  Please set your email credentials:"
    echo "export SENDER_EMAIL='your-email@gmail.com'"
    echo "export SENDER_PWD='your-app-password'"
    echo ""
    echo "💡 For Gmail, use an App Password instead of your regular password:"
    echo "1. Go to Google Account settings"
    echo "2. Security > 2-Step Verification > App passwords"
    echo "3. Generate an app password for 'Mail'"
    echo "4. Use that password in SENDER_PWD"
    exit 1
fi

echo "🎯 PUMA Collection Scraper"
echo "Choose a collection to scrape:"
echo ""
echo "1. Men's Shoes (default)"
echo "2. Women's Shoes"
echo "3. Kids' Shoes"
echo "4. Men's Clothing"
echo "5. Women's Clothing"
echo "6. Custom URL"
echo ""

read -p "Select option (1-6): " choice

case $choice in
    1)
        export COLLECTION_NAME="men-shoes"
        export COLLECTION_URL="https://us.puma.com/us/en/men/shoes"
        export COLLECTION_DISPLAY_NAME="Men's Shoes"
        ;;
    2)
        export COLLECTION_NAME="women-shoes"
        export COLLECTION_URL="https://us.puma.com/us/en/women/shoes"
        export COLLECTION_DISPLAY_NAME="Women's Shoes"
        ;;
    3)
        export COLLECTION_NAME="kids-shoes"
        export COLLECTION_URL="https://us.puma.com/us/en/kids/shoes"
        export COLLECTION_DISPLAY_NAME="Kids' Shoes"
        ;;
    4)
        export COLLECTION_NAME="men-clothing"
        export COLLECTION_URL="https://us.puma.com/us/en/men/clothing"
        export COLLECTION_DISPLAY_NAME="Men's Clothing"
        ;;
    5)
        export COLLECTION_NAME="women-clothing"
        export COLLECTION_URL="https://us.puma.com/us/en/women/clothing"
        export COLLECTION_DISPLAY_NAME="Women's Clothing"
        ;;
    6)
        read -p "Enter collection name (e.g., men-accessories): " COLLECTION_NAME
        read -p "Enter PUMA URL: " COLLECTION_URL
        read -p "Enter display name (e.g., Men's Accessories): " COLLECTION_DISPLAY_NAME
        export COLLECTION_NAME
        export COLLECTION_URL
        export COLLECTION_DISPLAY_NAME
        ;;
    *)
        echo "Invalid option, using default (Men's Shoes)"
        export COLLECTION_NAME="men-shoes"
        export COLLECTION_URL="https://us.puma.com/us/en/men/shoes"
        export COLLECTION_DISPLAY_NAME="Men's Shoes"
        ;;
esac

echo ""
echo "📦 Selected Collection: $COLLECTION_DISPLAY_NAME"
echo "🌐 URL: $COLLECTION_URL"
echo "📧 Email: $SENDER_EMAIL"
echo ""
echo "🚀 Starting extraction..."

# Run the scraper
node scrape_final.js
