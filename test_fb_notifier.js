/*
 * Test harness for the Facebook Marketplace notifier.
 *
 * This script demonstrates how to invoke the scraping portion of the
 * notifier with random values.  It prints the titles, prices and links
 * discovered for each search term instead of sending an email.  Use this
 * to verify that your configuration returns sensible results before
 * enabling notifications.  Note: you'll need to log into Facebook in
 * the browser window on the first run (unless you're already logged in
 * within your default Chrome profile).  Leave the email configuration in
 * the main script untouched – this test does not send emails.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// Randomised configuration for testing.  Adjust these fields to simulate
// different scenarios.  The values below are intentionally varied to give
// broader coverage.
const TEST_CONFIG = {
  locationRef: 'new-york-ny',
  searchTerms: ['garden chair', 'free couch', 'PlayStation 5'],
  daysSinceListed: 1,
  sortBy: 'creation_time_descend',
  exact: false,
  minPrice: null,
  maxPrice: 200, // limit to $200 to reduce noise
  includeFreeItems: true,
  headless: true, // run headless since test environment has no display
};

function buildSearchUrl(term) {
  const encodedTerm = encodeURIComponent(term);
  const params = [];
  params.push(`daysSinceListed=${TEST_CONFIG.daysSinceListed}`);
  params.push(`sortBy=${TEST_CONFIG.sortBy}`);
  if (TEST_CONFIG.minPrice !== null) params.push(`minPrice=${TEST_CONFIG.minPrice}`);
  if (TEST_CONFIG.maxPrice !== null) params.push(`maxPrice=${TEST_CONFIG.maxPrice}`);
  params.push(`query=${encodedTerm}`);
  params.push(`exact=${TEST_CONFIG.exact}`);
  const queryString = params.join('&');
  return `https://www.facebook.com/marketplace/${TEST_CONFIG.locationRef}/search?${queryString}`;
}

async function scrapeTerm(page, term) {
  const url = buildSearchUrl(term);
  console.log(`\nTesting search for "${term}": ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
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
  const items = [];
  for (const val of edges) {
    const node = val?.node;
    if (!node || !node.listing) continue;
    const id = node.listing.id;
    const title = node.listing.marketplace_listing_title || 'Untitled';
    const price = node.listing.listing_price?.formatted_amount || 'Unknown';
    const link = `https://www.facebook.com/marketplace/item/${id}`;
    const numericPrice = (() => {
      const clean = price.replace(/[^0-9.]/g, '');
      if (clean.length === 0) return 0;
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    })();
    // Apply price filters.  Free items pass automatically when includeFreeItems
    // is true; otherwise respect min/max price.
    if (!TEST_CONFIG.includeFreeItems && numericPrice === 0) continue;
    if (TEST_CONFIG.minPrice !== null && numericPrice < TEST_CONFIG.minPrice) continue;
    if (TEST_CONFIG.maxPrice !== null && numericPrice > TEST_CONFIG.maxPrice) continue;
    items.push({ title, price, link });
  }
  return items;
}

async function runTest() {
  const browser = await puppeteer.launch({ headless: TEST_CONFIG.headless });
  const page = await browser.newPage();
  const allResults = {};
  for (const term of TEST_CONFIG.searchTerms) {
    try {
      const items = await scrapeTerm(page, term);
      allResults[term] = items;
      if (items.length > 0) {
        console.log(`Found ${items.length} item(s) for "${term}":`);
        items.forEach(item => console.log(`  - ${item.title} (${item.price}) => ${item.link}`));
      } else {
        console.log(`No items found for "${term}"`);
      }
    } catch (err) {
      console.error(`Error searching for term "${term}":`, err);
    }
  }
  await browser.close();
  // Optionally write results to a file for further inspection
  fs.writeFileSync('test_results.json', JSON.stringify(allResults, null, 2), 'utf-8');
  console.log('\nTest complete. Results saved to test_results.json');
}

runTest().catch(err => console.error('Test failed:', err));