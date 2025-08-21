import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import TurndownService from "turndown";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../content/blog");
const endpoint = `https://${process.env.SHOPIFY_STORE}/admin/api/2025-07/graphql.json`;
const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN };

const QUERY = `
query ListArticles($first:Int!, $cursor:String) {
  articles(first:$first, after:$cursor, sortKey:PUBLISHED_AT) {
    edges {
      cursor
      node {
        id
        handle
        title
        blog { id title handle }
        author { name }
        tags
        body
        image { altText originalSrc }
        publishedAt
        updatedAt
        isPublished
        metafields(first: 20) {
          edges { node { namespace key value } }
        }
      }
    }
    pageInfo { hasNextPage }
  }
}`;

async function gql(query, variables){
  const r = await fetch(endpoint, { method:"POST", headers, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

function slugify(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9\-]+/g,"-").replace(/^-+|-+$/g,"");
}

async function main(){
  if(!process.env.SHOPIFY_STORE || !process.env.SHOPIFY_ADMIN_TOKEN)
    throw new Error("Missing SHOPIFY_STORE or SHOPIFY_ADMIN_TOKEN");
  await fs.mkdir(OUT_DIR, { recursive: true });

  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let cursor = null, n = 0;

  while (true) {
    const data = await gql(QUERY, { first: 100, cursor });
    const edges = data.articles.edges;

    for (const e of edges) {
      const a = e.node;
      const html = a.body || "";
      const md = td.turndown(html);

      const blogHandle = a.blog?.handle || "";
      const metafieldsObj = Object.fromEntries(
        (a.metafields?.edges || []).map(ed => [`${ed.node.namespace}.${ed.node.key}`, ed.node.value])
      );

      const fm = {
        title: a.title || "",
        slug: a.handle || slugify(a.title),
        status: a.isPublished ? "published" : "draft",
        publish_date: a.publishedAt,
        author: a.author?.name || "",
        blog: { id: a.blog?.id || "", title: a.blog?.title || "", handle: blogHandle },
        url: blogHandle && a.handle ? `/blogs/${blogHandle}/${a.handle}` : "",
        tags: a.tags || [],
        seo: { title: "", description: "" },
        image: a.image?.originalSrc || "",
        metafields: metafieldsObj,
        ids: { shopify_article_id: a.id, notion_id: null },
        sync: { last_source: "shopify", last_synced_at: new Date().toISOString() }
      };

      const front = "---\n" + yaml.stringify(fm) + "---\n\n";
      await fs.writeFile(path.join(OUT_DIR, `${fm.slug || `article-${n}`}.md`), front + md, "utf8");
      n++;
    }

    if (!data.articles.pageInfo.hasNextPage) break;
    cursor = edges.at(-1).cursor;
  }

  console.log(`Saved ${n} article(s) in content/blog`);
}

main().catch(e => { console.error(e); process.exit(1); });
