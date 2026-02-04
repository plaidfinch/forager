# Wegmans Algolia API Exploration Findings

Date: 2026-02-04
Exploration script version: 0cff491

## Direct Observations

### API Key Extraction
- Observed: API key successfully captured from URL query parameters
- Evidence: Found in request URLs as `x-algolia-api-key=9a10b1401634e9a6e55161c3a60c200d`
- Conclusion: The API key is a public search-only key passed in URLs, standard for Algolia client-side usage. Value: `9a10b1401634e9a6e55161c3a60c200d`

### App ID
- Observed: `QGPPR19V8V`
- Evidence: Found in request URLs as `x-algolia-application-id=QGPPR19V8V` and in Algolia endpoint hostname `qgppr19v8v-dsn.algolia.net`
- Conclusion: Matches expected value. This is Wegmans' Algolia application ID.

### Index Name Format
- Observed: Two distinct indexes used:
  - `discovery_pages` - Contains redirect/discovery page mappings
  - `products` - Main product search index
- Evidence: exploration-summary.json `indexNames` array and request postData
- Conclusion: The `products` index is the primary target for product search functionality

### Store Number Discovery
- Observed: Store number `74` used in all product queries
- Evidence:
  - Filter string: `storeNumber:74 AND fulfilmentType:instore AND excludeFromWeb:false AND isSoldAtStore:true`
  - Analytics tags: `store-74`, `fulfillment-instore`
  - Object IDs: `74-94427`, `74-12238` (format: `{storeNumber}-{skuId}`)
- Conclusion: Store number is embedded in object IDs and used as a filter.

### Store 74 Identity (CONFIRMED)
- Observed: `/api/stores` endpoint returns full store list with metadata
- Evidence: stores-exploration.json shows store 74 entry:
  - `storeNumber: 74`
  - `name: "Geneva"`
  - `city: "Geneva"`
  - `stateAbbreviation: "NY"`
  - `zip: "14456"`
  - `streetAddress: "300 Hamilton Street"`
  - `key: "74-GENEVA"`
  - `slug: "geneva-ny"`
- Conclusion: **Store 74 is confirmed to be the Geneva, NY Wegmans** at 300 Hamilton Street, 14456.

### Response Schema
- Observed: Multi-query response structure with nested results array
- Evidence: response-1-200.json shows `{ "results": [ { "hits": [...], "nbHits": N, ... } ] }`
- Notable:
  - Uses Algolia's multi-index query format (`/1/indexes/*/queries`)
  - Each product search actually sends 4 parallel queries with different analytics tags:
    - `organic` - main search
    - `boosted` - promoted results
    - `boosted-new-items` - new items
    - `boosted-wegmans-items` - Wegmans brand items
  - Response includes rich faceting data via `facets: ["*"]`

## Request Parameters Observed

### Standard Filter String
```
storeNumber:74 AND fulfilmentType:instore AND excludeFromWeb:false AND isSoldAtStore:true
```

### Analytics Tags
- `product-search`, `organic`, `store-74`, `fulfillment-instore`, `anonymous`

### Rule Contexts
- `product-search`, `organic`, `store-74`, `fulfillment-instore`, `anonymous`

### User Token Format
- `anonymous-{uuid}` e.g., `anonymous-cc3b528f-7ecb-4102-95fd-29261fadc9d0`

## Fulfillment Types
Three fulfillment types available per product:
- `instore` - In-store shopping
- `pickup` - Order pickup
- `delivery` - Home delivery

## Price Channels
Four distinct price points per product:
- `price_inStore` - Regular in-store price
- `price_inStoreLoyalty` - Shoppers Club member in-store price
- `price_delivery` - Delivery price
- `price_deliveryLoyalty` - Shoppers Club member delivery price

## Discovered Endpoints

### `/api/stores` - Store List API
- Returns complete list of all Wegmans stores with metadata
- Fields include: `storeNumber`, `name`, `city`, `stateAbbreviation`, `zip`, `streetAddress`, `latitude`, `longitude`, `hasPickup`, `hasDelivery`, `hasECommerce`, `hasPharmacy`, `aislePositionMapping`
- Can be used to build store number → location mapping for the MCP server

### `/api/stores/store-number/{storeNumber}` - Single Store API
- Returns details for a specific store by number
- Example: `/api/stores/store-number/74` for Geneva

## Open Questions

1. ~~**Store number → name mapping (BLOCKING)**~~: RESOLVED - `/api/stores` provides complete mapping.
2. **Category browsing**: How to browse by category without a search query?
3. **Pagination**: Default `hitsPerPage` appears to be 20. What's the maximum allowed?
4. **Rate limiting**: No rate limit errors observed, but should test with higher request volumes.
5. **API key rotation**: Is the API key stable or does it rotate? Need to monitor over time.
