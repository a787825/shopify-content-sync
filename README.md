# Shopify Content Sync

This project syncs Shopify blog articles to Markdown files and then into a Notion database.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set the following environment variables (in your shell or a `.env` file):
   - `SHOPIFY_STORE` – Shopify shop domain, e.g. `my-shop.myshopify.com`.
   - `SHOPIFY_ADMIN_TOKEN` – Admin API token.
   - `NOTION_TOKEN` – Notion integration token.
   - `NOTION_DB_ARTICLES` – Notion database ID for articles.

## Usage

### Pull articles from Shopify
```bash
npm run pull
```
This fetches articles from Shopify and saves them as Markdown files with front matter under `content/blog`.

### Import Markdown to Notion
```bash
npm run import:notion
```
Reads the Markdown files and upserts them into the specified Notion database.

## Sync Flow
1. `npm run pull` → Shopify Admin API ➜ Markdown in `content/blog`.
2. `npm run import:notion` → Markdown ➜ Notion pages.

