/*
 * mercari_ratio_loader.js
 *
 * Utilities to parse the Mercari Price Suggestion Challenge dataset and
 * compute useful statistics for price estimation.  The Mercari dataset
 * contains (among other fields) the item title (`name`), item condition,
 * category, brand and the final sold price (the `price` column)【239140817151164†L23-L39】.
 * The dataset does not include the seller's ask price or original retail
 * price, so you will need to supply those separately if you wish to compute
 * depreciation ratios.
 *
 * This module provides a function to compute the average sold price per
 * category, which can be used as a proxy for typical resale value.  It
 * reads a tab‑separated values (TSV) file line by line to avoid loading
 * the entire dataset into memory.
 */

const fs = require('fs');
const readline = require('readline');

/**
 * Compute the average sold price for each category in the Mercari dataset.
 *
 * @param {string} filePath Path to the TSV file (train.tsv) from the Mercari dataset
 * @returns {Promise<Object>} Mapping from category name to { count, avgPrice }
 */
async function computeAveragePriceByCategory(filePath) {
  return new Promise((resolve, reject) => {
    const categoryStats = {};
    const readStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: readStream });
    let header; // store column names
    rl.on('line', line => {
      // Split by tab
      const fields = line.split('\t');
      // Identify header on first line
      if (!header) {
        header = fields;
        return;
      }
      const record = {};
      header.forEach((col, idx) => {
        record[col] = fields[idx];
      });
      const category = record.category_name || 'Unknown';
      const price = parseFloat(record.price);
      if (isNaN(price)) return;
      if (!categoryStats[category]) {
        categoryStats[category] = { sum: 0, count: 0 };
      }
      categoryStats[category].sum += price;
      categoryStats[category].count += 1;
    });
    rl.on('close', () => {
      const result = {};
      Object.keys(categoryStats).forEach(cat => {
        const { sum, count } = categoryStats[cat];
        result[cat] = { count, avgPrice: sum / count };
      });
      resolve(result);
    });
    rl.on('error', err => reject(err));
  });
}

module.exports = {
  computeAveragePriceByCategory,
};