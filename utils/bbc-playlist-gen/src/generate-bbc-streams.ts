import fs from "node:fs"
import path from "node:path"
import * as cheerio from "cheerio"

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
// const GARFNET_URL = "https://garfnet.org.uk/cms/tables/radio-frequencies/internet-radio-player/bbc-national-and-local-radio-dash-streams/";
const GARFNET_URL =
  "https://garfnet.org.uk/cms/tables/radio-frequencies/internet-radio-player/bbc-national-and-local-radio-hls-streams/"
const BEARER_TABLE_FILE = "./bearers/bbc.json"
const LOGO_DIR = "./logos"
const OUTPUT = "bbc_playlist.m3u8"

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function normalise(s: string) {
  return s
    .toLowerCase()
    .replace(/bbc/g, "")
    .replace(/radio/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  })

  const text = await res.text()
  return text
}

// ------------------------------------------------------------
// 1. GarfNet BBC DASH streams (correct parser for <ol><li> structure)
// ------------------------------------------------------------
async function fetchGarfNetStreams(): Promise<Map<string, { name: string; stream: string }>> {
  const html = await fetchText(GARFNET_URL)
  const $ = cheerio.load(html)
  const map = new Map<string, { name: string; stream: string }>()

  // Select the content area
  const content = $(".entry-content.single-content")

  // Find all <li> items inside the <ol>
  content.find("ol > li").each((_, li) => {
    const item = $(li)

    // Extract station name (text before <br>)
    const raw = item.html() || ""
    const name = raw
      .split("<br")[0]
      .replace(/<[^>]+>/g, "")
      .trim()

    if (!name.startsWith("BBC")) return

    // Extract the .mpd URL
    const link = item.find("a[href*='.m3u8']").attr("href")
    if (!link) return

    const key = normalise(name)
    map.set(key, { name, stream: link })
  })

  return map
}

// ------------------------------------------------------------
// 2. Local bearer table
// ------------------------------------------------------------
function loadLocalBearerTable(): Map<string, any> {
  const raw = fs.readFileSync(BEARER_TABLE_FILE, "utf8")
  const json = JSON.parse(raw)

  const map = new Map<string, any>()
  for (const b of json) {
    map.set(normalise(b.name), b)
  }
  return map
}

// ------------------------------------------------------------
// 3. Logo resolver (filesystem-based)
// ------------------------------------------------------------
function buildLogoMapFromZip(): Map<string, string> {
  const map = new Map<string, string>()
  const files = fs.readdirSync(LOGO_DIR)

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".png")) continue

    const base = file.replace(/\.[a-z0-9]+$/i, "")
    const key = normalise(base)
    const full = path.join(LOGO_DIR, file)

    map.set(key, full)
  }

  return map
}

// ------------------------------------------------------------
// 4. M3U8 generation
// ------------------------------------------------------------
function buildM3U8(
  streams: Map<string, { name: string; stream: string }>,
  logos: Map<string, string>,
): string {
  const out = ["#EXTM3U"]

  for (const [key, s] of streams.entries()) {
    const logo = logos.get(key) ?? ""
    out.push(`#EXTINF:-1 tvg-name="${s.name}" tvg-logo="${logo}",${s.name}`)
    out.push(s.stream)
  }

  return out.join("\n")
}

// ------------------------------------------------------------
// 5. Main pipeline with logging
// ------------------------------------------------------------
async function main() {
  console.log("\n=== Loading GarfNet BBC DASH Streams ===")
  const streams = await fetchGarfNetStreams()
  console.log("Stream count:", streams.size)
  for (const [k, v] of streams.entries()) {
    console.log(`Key: ${k} | Name: ${v.name} | URL: ${v.stream}`)
  }

  console.log("\n=== Loading Local Bearer Table ===")
  const bearers = loadLocalBearerTable()
  console.log("Bearer count:", bearers.size)

  console.log("\n=== Loading Local Logo Directory ===")
  const logos = buildLogoMapFromZip()
  console.log("Logo count:", logos.size)

  console.log("\n=== Matching Streams → Logos ===")
  for (const [key, stream] of streams.entries()) {
    const logo = logos.get(key)
    console.log(`Stream: ${stream.name} | Key: ${key} | Logo: ${logo ? logo : "NONE"}`)
  }

  console.log("\n=== Writing Playlist ===")
  const playlist = buildM3U8(streams, logos)
  fs.writeFileSync(OUTPUT, playlist, "utf8")
  console.log("Done. Output:", OUTPUT)
}

main()
