import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { Client } from "@notionhq/client";
import { fileURLToPath } from "url";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_DB_ARTICLES;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BLOG_DIR = path.resolve(__dirname, "../content/blog");

function chunk(t, sz=1800){ const a=[]; for(let i=0;i<t.length;i+=sz) a.push(t.slice(i,i+sz)); return a; }

function nonEmpty(v) {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

export async function getDbMeta() {
  const meta = await notion.databases.retrieve({ database_id: DB });
  const titleEntry = Object.entries(meta.properties).find(([, v]) => v?.type === "title");
  const TITLE_KEY = titleEntry ? titleEntry[0] : "Name";
  const statusProp = meta.properties["Status"];
  const statusType = statusProp?.type;
  return { TITLE_KEY, statusType };
}

export function buildProps(fm, meta) {
  const { TITLE_KEY, statusType } = meta;
  const props = {};

  // title
  props[TITLE_KEY] = { title: [{ text: { content: fm.title || fm.slug || "Untitled" } }] };

  // Slug
  if (nonEmpty(fm.slug)) props["Slug"] = { rich_text: [{ text: { content: fm.slug } }] };

  // Status
  if (nonEmpty(fm.status)) {
    if (statusType === "status") {
      props["Status"] = { status: { name: fm.status } };
    } else if (statusType === "select") {
      props["Status"] = { select: { name: fm.status } };
    }
  }

  // Publish
  if (nonEmpty(fm.publish_date)) props["Publish"] = { date: { start: fm.publish_date } };

  // Tags
  const tags = Array.isArray(fm.tags) ? fm.tags.map(t => ({ name: String(t) })) : [];
  props["Tags"] = { multi_select: tags };

  // SEO fields
  const seoTitle = fm?.seo?.title || "";
  const seoDesc  = fm?.seo?.description || "";
  if (nonEmpty(seoTitle)) props["SEO_Title"] = { rich_text: [{ text: { content: seoTitle } }] };
  if (nonEmpty(seoDesc))  props["SEO_Description"] = { rich_text: [{ text: { content: seoDesc } }] };

  // ShopifyArticleID
  const sid = fm?.ids?.shopify_article_id || "";
  if (nonEmpty(sid)) props["ShopifyArticleID"] = { rich_text: [{ text: { content: sid } }] };

  return props;
}

export async function upsert(fm, md, meta){
  let page=null;
  if(fm?.ids?.shopify_article_id){
    const q=await notion.databases.query({
      database_id: DB,
      filter:{ property:"ShopifyArticleID", rich_text:{ equals: fm.ids.shopify_article_id } }
    });
    page=q.results?.[0]||null;
  }

  const props = buildProps(fm, meta);
  const blocks=[{ object:"block", type:"code", code:{ language:"markdown", rich_text: chunk(md).map(s=>({type:"text",text:{content:s}})) } }];

  if(!page){
    const res=await notion.pages.create({ parent:{ database_id: DB }, properties: props, children: blocks });
    return res.id;
  }else{
    await notion.pages.update({ page_id: page.id, properties: props });
    await notion.blocks.children.append({ block_id: page.id, children: blocks });
    return page.id;
  }
}

async function run(){
  if(!process.env.NOTION_TOKEN||!DB) throw new Error("Missing NOTION_TOKEN or NOTION_DB_ARTICLES");
  const files=(await fs.readdir(BLOG_DIR)).filter(f=>f.endsWith(".md"));
  const meta = await getDbMeta();
  let ok=0;
  for(const f of files){
    const raw=await fs.readFile(path.join(BLOG_DIR,f),"utf8");
    const { data: fm, content: md } = matter(raw);
    const id=await upsert(fm, md, meta);
    console.log(`Notion upsert: ${fm.title} -> ${id}`); ok++;
  }
  console.log(`Done: ${ok} page(s)`);
}

if (process.argv[1] === __filename) {
  run().catch(e=>{ console.error(e); process.exit(1); });
}
