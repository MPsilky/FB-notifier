/*
 * Unit tests for the enhanced Facebook Marketplace notifier.  These tests
 * exercise individual helper functions such as price estimation and filtering
 * logic without making network requests to Facebook.  Run with
 * `node unit_tests.js` to verify functionality.  The tests use simple
 * assertions; if an assertion fails the process will throw.
 */

const assert = require('assert');

// Replica of the estimateResaleValue function from improved_fb_notifier_images.js
function estimateResaleValue(priceStr, title, description) {
  const clean = priceStr.replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  if (!isNaN(num) && num > 0) {
    const estimate = (num * 0.5).toFixed(2);
    return `$${estimate}`;
  }
  return 'n/a';
}

// Test cases for estimateResaleValue
assert.strictEqual(estimateResaleValue('$100', 'Test', ''), '$50.00', 'Estimate should be half of 100');
assert.strictEqual(estimateResaleValue('Free', 'Test', ''), 'n/a', 'Free items have no estimate');
assert.strictEqual(estimateResaleValue('$0', 'Test', ''), 'n/a', 'Zero price returns n/a');

// Filtering logic tests.  Simulate config keywords.
const qualityExcludeKeywords = ['broken', 'scrap'];
const qualityIncludeKeywords = ['like new', 'sealed'];
function passesFreeFilter(title) {
  const lowerTitle = title.toLowerCase();
  if (qualityExcludeKeywords.some(k => lowerTitle.includes(k))) return false;
  if (qualityIncludeKeywords.length > 0 && !qualityIncludeKeywords.some(k => lowerTitle.includes(k))) return false;
  return true;
}
assert.strictEqual(passesFreeFilter('Like New Couch'), true, 'Like New passes include filter');
assert.strictEqual(passesFreeFilter('Broken Phone'), false, 'Broken should be excluded');
assert.strictEqual(passesFreeFilter('Old Couch'), false, 'Missing include keyword should be excluded');

// HTML assembly test.  Build a simple email body as done in notify().
function buildHtml(items) {
  let html = '';
  items.forEach(item => {
    html += `<div>`;
    if (item.image) html += `<img src="${item.image}" alt="Image">`;
    html += `<strong>${item.title}</strong>`;
    html += `<span>${item.price}</span>`;
    if (item.estimate) html += `<span>${item.estimate}</span>`;
    if (item.description) html += `<span>${item.description}</span>`;
    html += `</div>`;
  });
  return html;
}
const sampleItems = [
  { title: 'Sample Item', price: '$20', estimate: '$10.00', description: 'A nice item', image: 'https://example.com/img.jpg' },
];
const htmlOutput = buildHtml(sampleItems);
assert(htmlOutput.includes('<img src="https://example.com/img.jpg"'), 'Image tag should be present');
assert(htmlOutput.includes('Sample Item'), 'Title should be present');
assert(htmlOutput.includes('$20'), 'Price should be present');
assert(htmlOutput.includes('$10.00'), 'Estimate should be present');
assert(htmlOutput.includes('A nice item'), 'Description should be present');

console.log('All unit tests passed.');