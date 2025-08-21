import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_DB_ARTICLES;
const BLOG_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../content/blog");

function chunk(t, sz=1800){ const a=[]; for(let i=0;i<t.length;i+=sz) a.push(t.slice(i,i+sz)); return a; }

async function upsert(fm, md){
  let page=null;
  if(fm?.ids?.shopify_article_id){
    const q=await notion.databases.query({
      database_id: DB,
      filter:{ property:"ShopifyArticleID", rich_text:{ equals: fm.ids.shopify_article_id } }
    });
    page=q.results?.[0]||null;
  }
  // ===== [CURSOR INSERT A] DB metadata & helpers: BEGIN =====
  // --- DB metadata & helpers ---
  const meta = await notion.databases.retrieve({ database_id: DB });
  // real title key
  const titleEntry = Object.entries(meta.properties).find(([, v]) => v?.type === "title");
  const TITLE_KEY = titleEntry ? titleEntry[0] : "Name"; // fallback
  // Status type detection
  const statusProp = meta.properties["Status"];
  const isStatusType = statusProp?.type === "status"; // new type
  const isSelectType = statusProp?.type === "select"; // legacy type

  function nonEmpty(v) {
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }

  function buildProps(fm) {
    const props = {};

    // title
    props[TITLE_KEY] = { title: [{ text: { content: fm.title || fm.slug || "Untitled" } }] };

    // Slug
    if (nonEmpty(fm.slug)) props["Slug"] = { rich_text: [{ text: { content: fm.slug } }] };

    // Status
    if (nonEmpty(fm.status)) {
      if (isStatusType) {
        props["Status"] = { status: { name: fm.status } };
      } else if (isSelectType) {
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
  // ===== [CURSOR INSERT A] DB metadata & helpers: END =====

  // ===== [CURSOR INSERT B] Build props and use: BEGIN =====
  const props = buildProps(fm);
  // DEBUG (optional):
  // console.log("[DBG] TITLE_KEY =", TITLE_KEY);
  // console.log("[DBG] PROPS_KEYS =", Object.keys(props));
  // console.log("[DBG] PROPS.Name =", JSON.stringify(props.Name));
  // ===== [CURSOR INSERT B] Build props and use: END =====

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
  let ok=0;
  for(const f of files){
    const raw=await fs.readFile(path.join(BLOG_DIR,f),"utf8");
    const { data: fm, content: md } = matter(raw);
    const id=await upsert(fm, md);
    console.log(`Notion upsert: ${fm.title} -> ${id}`); ok++;
  }
  console.log(`Done: ${ok} page(s)`);
}
run().catch(e=>{ console.error(e); process.exit(1); });
