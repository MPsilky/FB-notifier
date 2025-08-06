/*
 * Enhanced Facebook Marketplace notifier with images and basic price estimation.
 *
 * This version extends the earlier notifier by including the primary photo and
 * description of each listing in the notification email.  It also defines a
 * placeholder function that attempts to estimate the resale value of a
 * listing based on its title and description.  You can replace the
 * `estimateResaleValue` implementation with a call to an external API or
 * heuristic of your choice.
 */

const cron = require('node-cron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const nodemailer = require('nodemailer');
const fs = require('fs');

// Load category average prices if available.  These values can be computed
// from the Mercari dataset using mercari_ratio_loader.js.  The file should
// map category names to their average sale price.  If the file is missing
// or invalid, categoryAvgPrices will be an empty object.  When computing
// resale values for free items, we will try to match the listing title to
// one of these categories and estimate half of the average price.
let categoryAvgPrices = {};
try {
  if (fs.existsSync('./categoryAvgPrice.json')) {
    categoryAvgPrices = JSON.parse(fs.readFileSync('./categoryAvgPrice.json', 'utf-8'));
  }
} catch (e) {
  console.warn('Failed to load categoryAvgPrice.json:', e.message);
  categoryAvgPrices = {};
}

puppeteer.use(StealthPlugin());

// Configuration object.  Most of the fields mirror those in the basic
// notifier.  Additional options control whether listing details are
// retrieved and whether price estimation is attempted.
const CONFIG = {
  locationRef: 'windsor',
  searchTerms: ['phone'],
  daysSinceListed: 1,
  sortBy: 'creation_time_descend',
  exact: false,
  minPrice: null,
  maxPrice: null,
  includeFreeItems: true,
  headless: true,
  activeHours: { start: 8, end: 22 },
  cronSchedule: '*/15 * * * *',
  email: {
    sender: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASS || '',
    recipients: ['kfcoleman77@gmail.com', 'mtopyan@gmail.com'],
  },
  // When true, fetch the listing page for each new item to extract the
  // description and primary image.  This adds overhead because each listing
  // requires an additional page load.  Disable if you only need the basics.
  fetchListingDetails: true,
  // When true, attempt to compute a resale price estimate using the title and
  // description.  The default implementation returns a placeholder.  Replace
  // the estimateResaleValue function with your own logic or API call.
  priceEstimationEnabled: true,
  // Optional lists for filtering free items.  Titles containing any word from
  // excludeKeywords will be ignored.  If includeKeywords is non‑empty,
  // free listings must contain at least one of these words to be included.
  qualityIncludeKeywords: [],
  qualityExcludeKeywords: [],
};

const PAST_ITEMS_FILE = './pastItems.json';
const BUFFER_FILE = './bufferedMessages.txt';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: CONFIG.email.sender,
    pass: CONFIG.email.password,
  },
});

/**
 * Estimate the resale value of a listing using its title and description.  The
 * default implementation returns a rough guess by taking half of the listed
 * price when available, and otherwise returns 'n/a'.  You can replace this
 * with a more sophisticated algorithm or call out to a third‑party API.  If
 * you integrate a paid API, remember not to include credentials directly in
 * your source code.
 *
 * @param {string} priceStr – The formatted price string from the listing.
 * @param {string} title – Listing title.
 * @param {string} description – Listing description.
 * @returns {string} A human readable resale value estimate.
 */
function estimateResaleValue(priceStr, title, description) {
  if (!CONFIG.priceEstimationEnabled) return '';
  // Extract numeric value from price string.
  const clean = priceStr.replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  if (!isNaN(num) && num > 0) {
    // Simple heuristic: assume resale value is roughly half the asking price.
    const estimate = (num * 0.5).toFixed(2);
    return `$${estimate}`;
  }
  // If price is not available (free items), attempt to estimate a resale
  // value based on the listing title and our category averages.  We look
  // through the categoryAvgPrices keys and select the first category whose
  // name appears in the title.  If a match is found, we assume the item is
  // worth about half of the average sale price for that category.  If no
  // category matches or categoryAvgPrices is empty, we return 'n/a'.
  const lowerTitle = title.toLowerCase();
  let matchedCategory = null;
  for (const categoryName of Object.keys(categoryAvgPrices)) {
    const tokens = categoryName.toLowerCase().split(/\s*\/\s*|\s+>/g);
    for (const token of tokens) {
      if (token && lowerTitle.includes(token)) {
        matchedCategory = categoryName;
        break;
      }
    }
    if (matchedCategory) break;
  }
  if (matchedCategory) {
    const avg = categoryAvgPrices[matchedCategory];
    if (typeof avg === 'number' && avg > 0) {
      const estimate = (avg * 0.5).toFixed(2);
      return `$${estimate}`;
    }
  }
  // No matching category found or no data: fallback to n/a
  return 'n/a';
}

function loadPastItems() {
  try {
    if (!fs.existsSync(PAST_ITEMS_FILE)) {
      fs.writeFileSync(PAST_ITEMS_FILE, JSON.stringify({ pastItems: [] }), 'utf-8');
    }
    const data = JSON.parse(fs.readFileSync(PAST_ITEMS_FILE, 'utf-8'));
    return new Set(data.pastItems);
  } catch (err) {
    console.error('Failed to read past items file:', err);
    return new Set();
  }
}

function savePastItems(set) {
  try {
    const array = Array.from(set);
    fs.writeFileSync(PAST_ITEMS_FILE, JSON.stringify({ pastItems: array }), 'utf-8');
  } catch (err) {
    console.error('Failed to write past items file:', err);
  }
}

function buildSearchUrl(term) {
  const encodedTerm = encodeURIComponent(term);
  const params = [];
  params.push(`daysSinceListed=${CONFIG.daysSinceListed}`);
  params.push(`sortBy=${CONFIG.sortBy}`);
  if (CONFIG.minPrice !== null) params.push(`minPrice=${CONFIG.minPrice}`);
  if (CONFIG.maxPrice !== null) params.push(`maxPrice=${CONFIG.maxPrice}`);
  params.push(`query=${encodedTerm}`);
  params.push(`exact=${CONFIG.exact}`);
  return `https://www.facebook.com/marketplace/${CONFIG.locationRef}/search?${params.join('&')}`;
}

async function fetchListingDetails(page, link) {
  const result = { description: '', image: '' };
  try {
    await page.goto(link, { waitUntil: 'load' });
    // In some older versions of Puppeteer, waitForTimeout is not defined.
    // Use waitFor as a fallback to pause for a set number of milliseconds.
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(3000);
    } else {
      await page.waitFor(3000);
    }
    // Extract description text.  Facebook may change selectors frequently;
    // these selectors are approximate and may need adjusting.
    const description = await page.evaluate(() => {
      const descEl = document.querySelector('[data-testid="marketplace_pdp_description"]');
      return descEl ? descEl.innerText : '';
    });
    // Extract primary image URL.  It may be in an <img> tag with a specific
    // data-testid or alt attribute.  Fallback to the first image on the page.
    const image = await page.evaluate(() => {
      const imgEl = document.querySelector('img[data-testid="media-image"]') || document.querySelector('img');
      return imgEl ? imgEl.src : '';
    });
    result.description = description;
    result.image = image;
  } catch (err) {
    console.warn('Failed to fetch details for listing', link, err.message);
  }
  return result;
}

async function scrapeTerm(page, term, pastItems) {
  const url = buildSearchUrl(term);
  console.log(`\nSearching Marketplace for "${term}": ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  // Use waitForTimeout when available; fall back to waitFor for older Puppeteer versions.
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(5000);
  } else {
    await page.waitFor(5000);
  }
  const bodyHTML = await page.evaluate(() => document.body.outerHTML);
  const match = bodyHTML.match(/"marketplace_search".*?,"marketplace_seo_page"/);
  if (!match) {
    console.warn('Could not find marketplace_search data for term', term);
    return [];
  }
  const jsonStr = match[0].replace('"marketplace_search":', '').replace(',"marketplace_seo_page"', '');
  let searchData;
  try {
    searchData = JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse marketplace_search JSON:', err.message);
    return [];
  }
  const edges = searchData?.feed_units?.edges || [];
  const newItems = [];
  for (const val of edges) {
    const node = val?.node;
    if (!node || !node.listing) continue;
    const id = node.listing.id;
    const title = node.listing.marketplace_listing_title || 'Untitled';
    const price = node.listing.listing_price?.formatted_amount || 'Unknown';
    const link = `https://www.facebook.com/marketplace/item/${id}`;
    // Skip items we've already seen.
    if (pastItems.has(id)) continue;
    // Filter free items based on keywords.
    const lowerTitle = title.toLowerCase();
    const numericPrice = (() => {
      const clean = price.replace(/[^0-9.]/g, '');
      if (clean.length === 0) return 0;
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    })();
    // Exclude items whose titles contain any blacklisted keyword.
    if (numericPrice === 0) {
      if (CONFIG.qualityExcludeKeywords.some(k => lowerTitle.includes(k.toLowerCase()))) {
        continue;
      }
      if (CONFIG.qualityIncludeKeywords.length > 0 &&
          !CONFIG.qualityIncludeKeywords.some(k => lowerTitle.includes(k.toLowerCase()))) {
        continue;
      }
    }
    // Apply price filters.
    if (!CONFIG.includeFreeItems && numericPrice === 0) continue;
    if (CONFIG.minPrice !== null && numericPrice < CONFIG.minPrice) continue;
    if (CONFIG.maxPrice !== null && numericPrice > CONFIG.maxPrice) continue;
    pastItems.add(id);
    const item = { title, price, link, description: '', image: '', estimate: '' };
    newItems.push(item);
  }
  // Optionally fetch details for each new item.  Use a separate page to
  // minimise interference with the main search page.
  if (CONFIG.fetchListingDetails && newItems.length > 0) {
    const detailPage = await page.browser().newPage();
    for (const item of newItems) {
      const details = await fetchListingDetails(detailPage, item.link);
      item.description = details.description;
      item.image = details.image;
      item.estimate = estimateResaleValue(item.price, item.title, item.description);
    }
    await detailPage.close();
  } else {
    // Still compute estimate from price alone when details are not fetched.
    for (const item of newItems) {
      item.estimate = estimateResaleValue(item.price, item.title, '');
    }
  }
  return newItems;
}

async function notify(term, items) {
  if (!items || items.length === 0) return;
  const nowHour = new Date().getHours();
  const withinWindow = nowHour >= CONFIG.activeHours.start && nowHour <= CONFIG.activeHours.end;
  // Build HTML body for the email.  Each item appears with an image (if
  // available), title, price, estimate, description and link.  Use inline
  // CSS for basic formatting.  Note: remote images are loaded directly via
  // their Facebook URL – if Facebook blocks image hotlinking this may not
  // display in all email clients.  Alternatively, you could download the
  // image and attach it inline using nodemailer attachments.
  let htmlBody = '';
  items.forEach((item, idx) => {
    htmlBody += `<div style="margin-bottom:1em;">
      ${item.image ? `<img src="${item.image}" alt="Image" style="max-width:200px; display:block; margin-bottom:0.5em;">` : ''}
      <strong>${item.title}</strong><br>
      <span>Price: ${item.price}</span><br>
      ${item.estimate ? `<span>Estimated resale value: ${item.estimate}</span><br>` : ''}
      ${item.description ? `<span>${item.description.replace(/\n/g, '<br>')}</span><br>` : ''}
      <a href="${item.link}">View on Facebook</a>
    </div>`;
  });
  // Combine buffered messages outside of active hours.
  if (!withinWindow) {
    // Buffer HTML as plain text; you could store HTML too but plain text is
    // simpler to merge and send later.
    const bufferContent = `\n\n[${new Date().toLocaleString()}] Results for "${term}":\n` +
      items.map(it => `${it.title} - ${it.price} - ${it.link}`).join('\n');
    fs.appendFileSync(BUFFER_FILE, bufferContent, 'utf-8');
    console.log(`Buffered ${items.length} items for term "${term}"`);
    return;
  }
  // Prepend any buffered text messages to the top of the email as plain text.
  let textBody = '';
  if (fs.existsSync(BUFFER_FILE)) {
    const buffer = fs.readFileSync(BUFFER_FILE, 'utf-8');
    if (buffer.trim().length > 0) {
      textBody += `Previous notifications:\n${buffer}\n\n`;
    }
    fs.writeFileSync(BUFFER_FILE, '', 'utf-8');
  }
  textBody += items.map(it => `${it.title} – ${it.price}\n${it.link}`).join('\n\n');
  // Subject summarises the number of results and term.
  const subject = `${items.length} new result${items.length > 1 ? 's' : ''} for "${term}"`;
  // Send to each recipient.
  for (const recipient of CONFIG.email.recipients) {
    const mailOptions = {
      from: CONFIG.email.sender,
      to: recipient,
      subject,
      text: textBody,
      html: htmlBody,
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`Error sending email to ${recipient}:`, error);
      } else {
        console.log(`Sent email to ${recipient}: ${info.response}`);
      }
    });
  }
}

async function run() {
  const pastItems = loadPastItems();
  const browser = await puppeteer.launch({ headless: CONFIG.headless });
  const page = await browser.newPage();
  for (const term of CONFIG.searchTerms) {
    try {
      const items = await scrapeTerm(page, term, pastItems);
      if (items.length > 0) {
        await notify(term, items);
      } else {
        console.log(`No new items found for "${term}"`);
      }
    } catch (err) {
      console.error(`Error processing term "${term}":`, err);
    }
  }
  await browser.close();
  savePastItems(pastItems);
}

// Initial run and schedule.
run().catch(err => console.error('Initial run failed:', err));
cron.schedule(CONFIG.cronSchedule, () => {
  run().catch(err => console.error('Scheduled run failed:', err));
});
