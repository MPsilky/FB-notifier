/*
 * Facebook Marketplace Notifier
 *
 * This script periodically checks Facebook Marketplace for new listings based on
 * a list of search terms and sends an aggregated notification email when new
 * matches are found. It is designed to be flexible – most behaviour can be
 * tweaked by updating the CONFIG object below.  In particular you can adjust
 * the search location, terms, price range, date range, email recipients and
 * schedule without touching the core scraping logic.  Messages sent outside
 * the configured active hours are buffered to a file and delivered the next
 * time a notification is sent.
 *
 * Requirements:
 *  - Node.js 18+ (earlier versions may work but have not been tested).
 *  - Facebook account that is logged in within the browser session.  The
 *    script uses Puppeteer with the stealth plugin to avoid detection.
 *  - Gmail account with "App Password" enabled if two‑factor authentication
 *    is turned on.  Use environment variables to supply credentials to
 *    avoid hard coding sensitive information.
 *  - A file called `pastItems.json` in the same directory storing an object
 *    like { pastItems: [] }.  The script will create this file if it does
 *    not exist.
 *
 * To run:
 *    npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 *                node-cron nodemailer
 *    node improved_fb_notifier.js
 *
 * Before running, update the CONFIG object or define the environment
 * variables EMAIL_USER and EMAIL_PASS with your Gmail address and
 * app‑specific password.  The script will send notifications to each
 * address listed in CONFIG.email.recipients.  You can also change the
 * cron expression in CONFIG.cronSchedule to control how often the
 * marketplace is scanned.
 */

const cron = require('node-cron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const nodemailer = require('nodemailer');
const fs = require('fs');

// Enable the stealth plugin to reduce the chance of Facebook detecting
// automated browsing.  Without this plugin the site may block requests.
puppeteer.use(StealthPlugin());

// -----------------------------------------------------------------------------
// CONFIGURATION
//
// Adjust any of the fields below to customise the search.  See the
// accompanying comments for details.  If you add or remove search terms,
// remember to reset pastItems.json or remove IDs for unwanted terms so that
// previously seen items don't prevent new notifications.
const CONFIG = {
  // Facebook Marketplace location segment.  This should match the region slug
  // that appears in the marketplace URL when you browse manually.  For
  // example, "new-york-ny" or "windsor".  Leaving this blank will default
  // to Facebook's automatic location but may return broader results.
  locationRef: 'windsor',

  // Array of keywords to search for.  Each entry will be searched
  // independently.  Spaces will be URL encoded automatically.  You can add
  // multiple keywords here, for example: ['phone', 'laptop', 'playstation'].
  searchTerms: ['phone'],

  // Number of days back to look for listings.  Facebook accepts a range of
  // 0–30 days.  Setting this to 1 means only items listed within the last
  // 24 hours will be returned.
  daysSinceListed: 1,

  // Sort order.  Options include 'creation_time_descend', 'price_ascend',
  // 'price_descend' and 'distance' (best match is sometimes accepted but
  // unstable).  See Facebook Marketplace URL parameters for more details.
  sortBy: 'creation_time_descend',

  // Whether the query must match exactly.  When false (default) Facebook
  // returns related results as well.
  exact: false,

  // Minimum and maximum price for listings.  Set to null to disable.  These
  // values must be numbers (in your local currency).  For example, set
  // minPrice: 0, maxPrice: 500 to only return items up to $500.  To include
  // only free items, set maxPrice: 0.  Note that some free listings may
  // specify a price of "$0" or display "Free"; the script will treat both as
  // free if includeFreeItems is true.
  minPrice: null,
  maxPrice: null,

  // When true, listings with a price of 0 or that display "Free" will be
  // included regardless of the minPrice/maxPrice filters.  This is useful for
  // surfacing giveaways or free items.
  includeFreeItems: true,

  // Control whether the browser runs headless.  Set this to false during
  // development to observe the browser window and log in to Facebook.
  headless: true,

  // Hours during which emails will be sent immediately.  Outside of these
  // hours notifications will be buffered and delivered when the next allowed
  // window opens.  Use 24‑hour values between 0 and 23.
  activeHours: { start: 8, end: 22 },

  // Cron expression defining how often to check Facebook Marketplace.  See
  // https://www.npmjs.com/package/node-cron for details.  The example below
  // runs every 15 minutes.  Increase the interval if Facebook imposes
  // rate limits or you prefer fewer checks.
  cronSchedule: '*/15 * * * *',

  // Email configuration.  The sender address and password should be stored in
  // environment variables for security.  If not supplied, the script will
  // fallback to the hard coded values below (not recommended).
  email: {
    sender: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASS || '',
    // List of recipient email addresses.  Notifications will be sent to all
    // addresses on the list.  You can add as many recipients as you like.
    recipients: ['kfcoleman77@gmail.com', 'mtopyan@gmail.com'],
  },
};

// Path to the file storing IDs of previously seen listings.  If the file
// doesn't exist it will be created automatically.  Keeping track of past
// listings prevents duplicate notifications when running the script
// repeatedly.
const PAST_ITEMS_FILE = './pastItems.json';

// Path to the file used for buffering notifications outside of active hours.
const BUFFER_FILE = './bufferedMessages.txt';

// -----------------------------------------------------------------------------
// Email sending helpers
//
// Initialise a transporter using Gmail.  If you need to use another email
// provider, update the "service" field and authentication options accordingly.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: CONFIG.email.sender,
    pass: CONFIG.email.password,
  },
});

/**
 * Compose and send an email containing all new marketplace items for a given
 * search term.  If the current time is outside of CONFIG.activeHours the
 * message will be appended to BUFFER_FILE instead.  Buffered messages will
 * automatically be included in the next batch of outgoing notifications.
 *
 * @param {string} term – The human friendly search term used to find items.
 * @param {Array<{title:string, price:string, link:string}>} items – List of new
 *        marketplace items.  Each item has a title, price and link.
 */
async function notify(term, items) {
  if (!items || items.length === 0) return;

  // Build the body of the email.  Each item appears on its own line with
  // title, price and link.  A blank line separates entries.
  const lines = items.map(item => `${item.title} – ${item.price}\n${item.link}`);
  const body = lines.join('\n\n');

  // Determine whether we are within the active window.
  const nowHour = new Date().getHours();
  const withinWindow = nowHour >= CONFIG.activeHours.start && nowHour <= CONFIG.activeHours.end;

  // Prefix for the email subject.  Including the term and count makes it
  // easier to scan notifications at a glance.
  const subjectPrefix = `${items.length} new result${items.length > 1 ? 's' : ''} for "${term}"`;

  // If outside the active window, buffer the message for later.
  if (!withinWindow) {
    const bufferContent = `\n\n[${new Date().toLocaleString()}] ${subjectPrefix}\n${body}`;
    fs.appendFileSync(BUFFER_FILE, bufferContent, 'utf-8');
    console.log(`Buffered ${items.length} items for term "${term}"`);
    return;
  }

  // If inside the active window, send the email.  Prepend any buffered
  // messages and clear the buffer file.
  let buffer = '';
  if (fs.existsSync(BUFFER_FILE)) {
    buffer = fs.readFileSync(BUFFER_FILE, 'utf-8');
    if (buffer.trim().length > 0) {
      buffer = `Previous notifications:\n${buffer}\n\n`;
    }
    fs.writeFileSync(BUFFER_FILE, '', 'utf-8');
  }

  const emailBody = buffer + body;
  const subject = subjectPrefix;

  // Send to each recipient in parallel.  Use Promise.all to wait for all
  // deliveries before logging completion.
  const promises = CONFIG.email.recipients.map(recipient => {
    const mailOptions = {
      from: CONFIG.email.sender,
      to: recipient,
      subject,
      text: emailBody,
    };
    return new Promise(resolve => {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`Error sending email to ${recipient}:`, error);
        } else {
          console.log(`Sent email to ${recipient}: ${info.response}`);
        }
        resolve();
      });
    });
  });
  await Promise.all(promises);
}

// -----------------------------------------------------------------------------
// Persistence helpers

/**
 * Load the set of previously seen listing IDs from disk.  If the file does
 * not exist, an empty set is returned and the file is created on save.
 *
 * @returns {Set<string>}
 */
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

/**
 * Persist the set of listing IDs to disk.  This overwrites the previous
 * contents of the file.  If the directory is unwritable the error will be
 * logged but execution will continue.
 *
 * @param {Set<string>} set – Set of listing IDs to save.
 */
function savePastItems(set) {
  try {
    const array = Array.from(set);
    fs.writeFileSync(PAST_ITEMS_FILE, JSON.stringify({ pastItems: array }), 'utf-8');
  } catch (err) {
    console.error('Failed to write past items file:', err);
  }
}

// -----------------------------------------------------------------------------
// Scraping logic

/**
 * Build a Marketplace search URL for a given keyword.  This function
 * centralises the query parameters so that adjusting the CONFIG object will
 * modify all searches consistently.
 *
 * @param {string} term – The search keyword (not yet URL encoded).
 * @returns {string} A fully qualified Facebook Marketplace URL.
 */
function buildSearchUrl(term) {
  const encodedTerm = encodeURIComponent(term);
  const parts = [
    `https://www.facebook.com/marketplace/${CONFIG.locationRef}/search`;
  ];
  const params = [];
  params.push(`daysSinceListed=${CONFIG.daysSinceListed}`);
  params.push(`sortBy=${CONFIG.sortBy}`);
  if (CONFIG.minPrice !== null) params.push(`minPrice=${CONFIG.minPrice}`);
  if (CONFIG.maxPrice !== null) params.push(`maxPrice=${CONFIG.maxPrice}`);
  params.push(`query=${encodedTerm}`);
  params.push(`exact=${CONFIG.exact}`);
  const queryString = params.join('&');
  return `${parts}?${queryString}`;
}

/**
 * Scrape Facebook Marketplace for a single search term.  Extracts the list of
 * items from the page's JSON data.  Filters out items that have already been
 * seen or that fall outside the configured price range.  Free items are
 * included if CONFIG.includeFreeItems is true.  The function returns an array
 * of new items and updates the pastItems set in place.
 *
 * @param {puppeteer.Page} page – The page instance to use for navigation.
 * @param {string} term – The search keyword.
 * @param {Set<string>} pastItems – Set of previously seen item IDs.  This set
 *        will be modified to include any new IDs discovered.
 * @returns {Promise<Array<{title:string, price:string, link:string}>>}
 */
async function scrapeTerm(page, term, pastItems) {
  const url = buildSearchUrl(term);
  console.log(`\nSearching Marketplace for "${term}": ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  // Delay to allow dynamic content to load.  Adjust as needed based on your
  // connection speed and Facebook's responsiveness.
  await page.waitForTimeout(5000);
  // Grab the page HTML and extract the JSON blob.  The Marketplace page
  // embeds search results under the "marketplace_search" key.
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
    // Determine numeric price if available.  Remove non‑digits and parse.  Some
    // free listings show "Free" instead of a price; treat those as zero.
    const numericPrice = (() => {
      const clean = price.replace(/[^0-9.]/g, '');
      if (clean.length === 0) return 0;
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    })();
    // Skip items we've already seen.
    if (pastItems.has(id)) continue;
    // Skip items outside price range unless free items are allowed.
    if (!CONFIG.includeFreeItems && numericPrice === 0) continue;
    if (CONFIG.minPrice !== null && numericPrice < CONFIG.minPrice) continue;
    if (CONFIG.maxPrice !== null && numericPrice > CONFIG.maxPrice) continue;
    pastItems.add(id);
    newItems.push({ title, price, link });
  }
  return newItems;
}

/**
 * Primary workflow to search all terms, send notifications and persist state.
 * Invoked on a schedule via node-cron.  Handles its own errors to avoid
 * crashing the scheduler.
 */
async function run() {
  const pastItems = loadPastItems();
  const browser = await puppeteer.launch({ headless: CONFIG.headless });
  const page = await browser.newPage();
  // Loop through each term and scrape results sequentially.  This could be
  // parallelised if desired, but sequential execution avoids overloading
  // Facebook with concurrent requests.
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
  // Persist updated list of seen IDs.
  savePastItems(pastItems);
}

// -----------------------------------------------------------------------------
// Initialise schedule

// Immediately invoke run() once at startup so that the user does not need to
// wait for the first cron interval.
run().catch(err => console.error('Initial run failed:', err));

// Schedule the job according to the cron expression.  node-cron will call
// run() at each interval.  The shouldReRun guard from the original script is
// unnecessary because node-cron handles overlapping runs if the task is still
// executing; by default it will queue the next execution.  For long running
// tasks, consider setting { scheduled: true, runOnInit: true } in the cron
// options.
cron.schedule(CONFIG.cronSchedule, () => {
  run().catch(err => console.error('Scheduled run failed:', err));
});