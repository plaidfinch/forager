# Algolia Response Schema Analysis

## Top-level structure

### Single Index Query (discovery_pages)
```json
{
  "hits": [...],
  "nbHits": 45,
  "hitsPerPage": 1000,
  "page": 0,
  "nbPages": 1,
  "processingTimeMS": 4,
  "exhaustiveNbHits": true,
  "exhaustiveTypo": true,
  "query": "",
  "params": "...",
  "renderingContent": {},
  "exhaustive": { "nbHits": true, "typo": true }
}
```

### Multi-Index Query (products)
```json
{
  "results": [
    {
      "hits": [...],
      "facets": {...},
      "facets_stats": {...},
      "hitsPerPage": 20,
      "nbHits": 423,
      "nbPages": 22,
      "page": 0,
      "processingTimeMS": 11,
      "query": "milk",
      "index": "products",
      "exhaustive": {...}
    },
    // ... additional result objects for boosted/new/wegmans queries
  ]
}
```

## Hit fields (per product)

### Core Identification
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `objectID` | string | `"74-94427"` | Format: `{storeNumber}-{skuId}` |
| `productId` | string | `"94427"` | Numeric product ID |
| `productID` | string | `"94427"` | Duplicate of productId |
| `skuId` | string | `"94427"` | SKU identifier |
| `storeNumber` | string | `"74"` | Store number as string |
| `slug` | string | `"94427-Vitamin-D-Whole-Milk"` | URL-friendly identifier |

### Product Information
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `productName` | string | `"Wegmans Vitamin D Whole Milk"` | Full product name with brand |
| `webProductDescription` | string | `"Vitamin D Whole Milk"` | Shorter display name |
| `productDescription` | string | `"Grade A. Pasteurized..."` | Long description |
| `consumerBrandName` | string | `"Wegmans"` | Brand name |
| `packSize` | string | `"1 gallon"` | Package size |
| `upc` | string[] | `["00077890944271"]` | UPC codes (array) |
| `images` | string[] | `["https://images.wegmans.com/..."]` | Product image URLs |

### Categorization
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `category` | object[] | `[{name, key, seo}]` | Category hierarchy as array |
| `categories` | object | `{lvl0, lvl1, lvl2}` | Hierarchical category paths |
| `categoryNodes` | object | `{lvl0, lvl1, lvl2}` | Category node names only |
| `categoryPageId` | string[] | `["Dairy", "Dairy > Milk..."]` | Full category path strings |
| `categoryFacets` | object | `{type, size, milk%, flavor}` | Category-specific facets |

### Pricing
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `price_inStore` | object | `{amount: 2.99, unitPrice: "$2.99/gallon", channelKey}` | Regular in-store |
| `price_inStoreLoyalty` | object | `{amount: 2.79, unitPrice, channelKey}` | Member in-store |
| `price_delivery` | object | `{amount: 3.49, unitPrice, channelKey}` | Regular delivery |
| `price_deliveryLoyalty` | object | `{amount: 3.29, unitPrice, channelKey}` | Member delivery |
| `bottleDeposit` | number | `0` | Bottle deposit amount |

### Discounts & Offers
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `isLoyalty` | boolean | `true` | Has loyalty pricing |
| `discountType` | string | `"loyalty"` | Type of active discount |
| `hasOffers` | boolean | `true` | Has active offers |
| `loyaltyInstoreDiscount` | object[] | `[{savings, expiryDate, name, ...}]` | In-store discount details |
| `loyaltyDeliveryDiscount` | object[] | `[{savings, expiryDate, name, ...}]` | Delivery discount details |
| `digitalCouponsOfferIds` | string[] | `["7224934", ...]` | Available coupon IDs |

### Availability & Fulfillment
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `isAvailable` | boolean | `true` | Currently available |
| `isSoldAtStore` | boolean | `true` | Sold at this store |
| `fulfilmentType` | string[] | `["instore", "pickup", "delivery"]` | Available fulfillment methods |
| `excludeFromWeb` | boolean | `false` | Hidden from web |
| `isIWSProduct` | boolean | `false` | Is IWS (unknown acronym) |
| `maxQuantity` | number | `20` | Maximum order quantity |

### Store Location
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `planogram` | object | `{aisle: "Dairy", shelf: "1"}` | In-store location |

### Product Attributes
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `isNewItem` | boolean | `false` | Recently added |
| `isAlcoholItem` | boolean | `false` | Alcohol product |
| `isSoldByWeight` | boolean | `false` | Sold by weight |
| `restrictedOTC` | boolean | `false` | OTC restriction |
| `requiredMinimumAgeToBuy` | number | `0` | Age restriction (0 = none) |
| `ebtEligible` | boolean | `true` | SNAP/EBT eligible |
| `onlineSellByUnit` | string | `"ea"` | Online selling unit |
| `onlineApproxUnitWeight` | number | `0` | Approximate weight |

### Tags & Keywords
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `popularTags` | string[] | `["Family Pack", "Wegmans Brand"]` | Marketing tags |
| `filterTags` | string[] | `["Gluten Free", "Family Pack"]` | Filterable tags |
| `wellnessKeys` | string[] | `["Gluten Free"]` | Health/wellness tags |
| `productKeywords` | string[] | `["whole milk", "milk"]` | Search keywords |
| `keywords` | string[] | `["whole milk", "milk"]` | Duplicate of productKeywords |

### Nutrition
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `nutrition` | object | Complex nested structure | Full nutrition facts |
| `nutrition.serving` | object | `{servingSize, servingSizeUom, servingsPerContainer, householdMeasurement}` | Serving info |
| `nutrition.nutritions` | array | `[{general: [...], vitamins: [...], contains: "..."}]` | Nutrients |
| `ingredients` | string | `"Milk, Vitamin D3."` | Ingredients list |
| `allergensAndWarnings` | string | `"ALLERGENS: Contains Milk."` | Allergen info |
| `instructions` | string | `"Keep Refrigerated."` | Storage/prep instructions |

### Ratings
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `averageStarRating` | number | `4` | Average rating (1-5) |
| `reviewCount` | number | `34` | Number of reviews |

### Metadata
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `lastUpdated` | string | `"2026-02-04T14:07:32+00:00"` | ISO timestamp |
| `taxCode` | string | `"0554-000"` | Tax classification |
| `soldByVendor` | string | `""` | Vendor (often empty) |

### Ranking (when getRankingInfo: true)
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `_rankingInfo` | object | `{words, nbTypos, userScore, ...}` | Algolia ranking details |

## Discovery Pages Index Schema

Simpler schema for redirect/discovery pages:

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `objectID` | string | `"bltf838419fdc036835"` | CMS entry ID |
| `title` | string | `"Ice Cream"` | Page title |
| `url` | string | `"/shop/discovery/ice-cream"` | Redirect URL |
| `redirect_term` | string | `"Ice Cream"` | Search terms that trigger redirect |

## Facets Available

Based on the request `facets: ["*"]`, all facetable fields are returned. Key facets observed:
- Category hierarchy (lvl0, lvl1, lvl2)
- Brand (`consumerBrandName`)
- Tags (`popularTags`, `filterTags`, `wellnessKeys`)
- Category-specific facets (`categoryFacets.*`)
- Fulfillment type
- Price ranges
