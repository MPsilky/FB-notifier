/*
 * ebayApi.js
 *
 * A minimal wrapper around eBay's Browse API (searchByImage) to search for
 * comparable items based on an image.  This module shows how to request an
 * OAuth2 token using your eBay application credentials and then perform a
 * search.  It is intended as a starting point — you must provide your own
 * client ID and client secret as environment variables (EBAY_CLIENT_ID and
 * EBAY_CLIENT_SECRET).  Without these, the API will return 401 errors.
 *
 * NOTE: This code has not been fully tested in this environment because
 * external network calls are not permitted here.  Use it as a template when
 * integrating into your own project.
 */

const fetch = require('node-fetch');

const EBAY_OAUTH_ENDPOINT =
  'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SCOPE = 'https://api.ebay.com/oauth/api_scope';

/**
 * Retrieve an access token from eBay using the OAuth 2.0 client credentials
 * flow.  The token is cached in memory so repeated calls reuse the token
 * until it expires.  If you restart your process you will need to obtain
 * a fresh token.
 *
 * @returns {Promise<string>} The OAuth access token
 */
let cachedToken = null;
let tokenExpiresAt = 0;
async function getEbayAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60 * 1000) {
    return cachedToken;
  }
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set in environment variables'
    );
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64'
  );
  const formParams = new URLSearchParams();
  formParams.append('grant_type', 'client_credentials');
  formParams.append('scope', EBAY_SCOPE);
  const response = await fetch(EBAY_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formParams,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to obtain eBay token: ${response.status} ${response.statusText} body=${body}`
    );
  }
  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Perform a search by image using eBay's Browse API.  Pass a Base64 encoded
 * image string (without the data URI prefix) and optional filter parameters.
 * See the eBay documentation for details on supported filters.  This function
 * returns the JSON response from the API.
 *
 * @param {string} base64Image The image data encoded in base64 (do not include
 *                             data:image/jpeg;base64, prefix)
 * @param {Object} [options] Optional filters such as category_ids, aspect_filter, etc.
 * @returns {Promise<Object>} The API response
 */
async function searchByImage(base64Image, options = {}) {
  const token = await getEbayAccessToken();
  const queryParams = new URLSearchParams(options);
  const url =
    'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image?' +
    queryParams.toString();
  const body = {
    image: base64Image,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `eBay searchByImage failed: ${response.status} ${response.statusText} body=${text}`
    );
  }
  const data = await response.json();
  return data;
}

module.exports = {
  getEbayAccessToken,
  searchByImage,
};