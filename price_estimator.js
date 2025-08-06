/*
 * price_estimator.js
 *
 * A simple example illustrating how you might estimate a realistic resale value
 * for second‑hand items when you know three price signals: the seller's ask
 * price, the actual sale price and the item's original retail price (MSRP).
 *
 * The purpose of this script is to demonstrate the logic described to the
 * user: computing depreciation ratios and learning category‑specific
 * adjustment factors.  It uses a tiny sample dataset defined in this file
 * rather than relying on external data sources.  In a real production
 * environment you would replace the sample with a large dataset such as
 * Mercari's price suggestion data【239140817151164†L23-L39】 and obtain
 * category‑level ratios from there.
 */

const sampleData = [
  {
    category: 'Electronics',
    askPrice: 150,
    soldPrice: 120,
    newPrice: 300,
  },
  {
    category: 'Electronics',
    askPrice: 200,
    soldPrice: 180,
    newPrice: 400,
  },
  {
    category: 'Furniture',
    askPrice: 100,
    soldPrice: 80,
    newPrice: 250,
  },
  {
    category: 'Furniture',
    askPrice: 75,
    soldPrice: 60,
    newPrice: 200,
  },
  {
    category: 'Fashion',
    askPrice: 50,
    soldPrice: 45,
    newPrice: 100,
  },
  {
    category: 'Fashion',
    askPrice: 30,
    soldPrice: 25,
    newPrice: 80,
  },
];

/**
 * Computes category‑level depreciation ratios from the sample data.  For each
 * category, we calculate the average soldPrice/newPrice and soldPrice/askPrice.
 * These ratios describe how much an item in that category typically loses
 * value from its original price and how much buyers typically negotiate down
 * from the ask price.
 *
 * @param {Array} data Array of data objects with category, askPrice, soldPrice and newPrice
 * @returns {Object} Mapping from category name to {avgSoldToNew, avgSoldToAsk}
 */
function computeCategoryRatios(data) {
  const stats = {};
  data.forEach(item => {
    if (!stats[item.category]) {
      stats[item.category] = { sumSoldToNew: 0, sumSoldToAsk: 0, count: 0 };
    }
    stats[item.category].sumSoldToNew += item.soldPrice / item.newPrice;
    stats[item.category].sumSoldToAsk += item.soldPrice / item.askPrice;
    stats[item.category].count += 1;
  });
  const result = {};
  Object.keys(stats).forEach(cat => {
    const { sumSoldToNew, sumSoldToAsk, count } = stats[cat];
    result[cat] = {
      avgSoldToNew: sumSoldToNew / count,
      avgSoldToAsk: sumSoldToAsk / count,
    };
  });
  return result;
}

const categoryRatios = computeCategoryRatios(sampleData);

/**
 * Estimate the practical resale value for a new item given its category, ask
 * price, and original price.  The estimate is based on the category‑level
 * depreciation ratio computed from historical data.  We consider both the
 * soldPrice/newPrice and soldPrice/askPrice ratios and use a weighted average
 * of the two.  The weight determines how much emphasis to place on the new
 * price vs. the ask price.  In this example we use a 50/50 blend.
 *
 * @param {Object} params Parameters with keys: category, askPrice, newPrice
 * @returns {number|null} The estimated resale value, or null if the category
 *                        has no historical ratio
 */
function estimateResaleValue({ category, askPrice, newPrice }) {
  const ratios = categoryRatios[category];
  if (!ratios) {
    console.warn(`No ratio available for category ${category}`);
    return null;
  }
  const estFromNew = ratios.avgSoldToNew * newPrice;
  const estFromAsk = ratios.avgSoldToAsk * askPrice;
  // Weight both estimates equally; adjust weights as needed for your use case.
  const weightFromNew = 0.5;
  const weightFromAsk = 0.5;
  return weightFromNew * estFromNew + weightFromAsk * estFromAsk;
}

// If this module is run directly, perform a simple demo.
if (require.main === module) {
  console.log('Category ratios based on sample data:');
  console.table(categoryRatios);
  // Example items to estimate
  const examples = [
    { category: 'Electronics', askPrice: 250, newPrice: 500 },
    { category: 'Furniture', askPrice: 150, newPrice: 350 },
    { category: 'Fashion', askPrice: 40, newPrice: 90 },
    { category: 'Unknown', askPrice: 100, newPrice: 200 },
  ];
  examples.forEach(example => {
    const estimate = estimateResaleValue(example);
    console.log(`Item in category ${example.category}, ask $${example.askPrice}, new $${example.newPrice}: estimated resale $${estimate ? estimate.toFixed(2) : 'N/A'}`);
  });
}

module.exports = {
  computeCategoryRatios,
  estimateResaleValue,
};