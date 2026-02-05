---
name: wegmans-meal-plan
description: This skill should be used when the user asks to "plan meals", "make a shopping list", "plan groceries", "what should I cook", "meal prep", "Wegmans shopping", "weekly meal plan", or mentions meal planning for their household.
allowed-tools:
  - AskUserQuestion
  - WebSearch
  - Read
  - Write
  - mcp__forager__*
---

# Wegmans Meal Planning

Create personalized meal plans and shopping lists for Wegmans grocery stores, tailored to household dietary needs and preferences.

## Overview

This skill guides the meal planning process:
1. Load or gather user preferences (dietary restrictions, cuisines, household size)
2. Confirm Wegmans store selection
3. Search for recipes matching preferences
4. Verify ingredient availability at the selected store
5. Adapt recipes for dietary needs and product availability
6. Generate an organized shopping list by store aisle
7. Save the meal plan for future reference

## Preferences Management

### File Location

Preferences are stored in `~/.claude/meal-planning/preferences.txt` as a plain-text summary.

### Initial Setup (No Preferences File)

If the preferences file does not exist:
1. Run the full interview using AskUserQuestion (see `references/interview-questions.md`)
2. Cover all topics: household size, dietary restrictions, cuisines, cook time, proteins, meals, breakfast, snacks, budget
3. Write a plain-text summary to `~/.claude/meal-planning/preferences.txt`

### Returning User (Preferences File Exists)

If the preferences file exists:
1. Read and display a summary of stored preferences
2. Ask: "Does this still reflect your preferences?"
   - **"Yes, let's plan meals"** → Proceed to store selection
   - **"Update a few things"** → Ask targeted questions about what to change
   - **"Start fresh"** → Run full interview
3. If updates made, rewrite the preferences file

### Mid-Session Updates

If the user mentions new dietary information during the session (e.g., "I forgot to mention, I have an A1 milk intolerance"):
1. Acknowledge and incorporate into the current plan
2. Automatically append the new information to `~/.claude/meal-planning/preferences.txt`
3. No need to prompt—just update silently

## Store Selection

### Check Current Store

Query the MCP server to determine if a store is already set:
```sql
SELECT value FROM settings WHERE key = 'current_store'
```

Or attempt a simple product query—if it succeeds, a store is set.

### Store Already Set

If a store is configured:
1. Display: "You're currently using Wegmans [Name] at [Address]. Keep this store?"
2. If yes → Proceed to meal planning
3. If no → Ask for new location

### No Store Set

If no store is configured:
1. Ask: "Which Wegmans location would you like to use? (city, state, or zip code)"
2. Query the stores database:
   ```sql
   SELECT store_number, name, city, state, street_address
   FROM stores
   WHERE city LIKE '%input%' OR state = 'input' OR zip_code = 'input'
   ```
3. If multiple matches, present options and let user choose
4. Call `mcp__forager__setStore` with the selected store number

## Recipe Search

### Construct Search Queries

Based on preferences, search for recipes using WebSearch:
- Include dietary restrictions (e.g., "low carb", "gluten free")
- Include cuisine preferences (e.g., "Mediterranean", "Asian")
- Include time constraints (e.g., "30 minute", "quick")
- Include protein preferences (e.g., "chicken thigh", "salmon")

Example query: `quick 30 minute low carb chicken thigh Mediterranean recipe`

### Number of Recipes

- Ask how many dinners to plan (typically 3-4 for a short shopping cycle)
- If covering all meals, also search for breakfast and snack ideas
- Consider recipes that make good leftovers for lunch

### Previous Meal Plans

Before searching, offer: "Would you like to include any favorites from previous meal plans?"
- If yes, list recent plans from `~/.claude/meal-planning/plans/`
- Let user pick recipes to include
- Those recipes still need availability verification

## Product Verification

### Check Ingredient Availability

For each key ingredient in selected recipes:
```sql
SELECT name, pack_size, price_in_store, aisle
FROM products
WHERE name LIKE '%ingredient%' AND is_available = 1
ORDER BY price_in_store
LIMIT 8
```

### Handle Dietary Restrictions

When a dietary restriction applies, check the `ingredients` field:
```sql
SELECT name, pack_size, price_in_store, aisle, ingredients
FROM products
WHERE name LIKE '%feta%' AND is_available = 1
```

Then verify the ingredients don't contain problematic items (e.g., cow's milk for A1 intolerance).

### Find Substitutes

If an ingredient is unavailable or doesn't meet dietary needs:
1. Search for alternatives (e.g., goat cheese instead of cow's milk feta)
2. Note the substitution in the meal plan
3. Verify the substitute is available at the store

### Common Substitution Patterns

- **A1 milk intolerance**: Use goat milk, sheep milk, A2 milk, or plant-based products
- **Low-carb**: Cauliflower rice for regular rice, lettuce wraps for tortillas
- **Unavailable produce**: Check frozen alternatives

## Output Format

### Meal Plan Section

Present the meal plan with:
- Dinner recipes with brief descriptions
- Recipe sources (hyperlinks from WebSearch)
- Breakfast and snack ideas (if applicable)
- Notes on adaptations made for dietary needs or availability

### Shopping List Section

Organize by store section/aisle for efficient shopping. Use compact markdown:

```markdown
## Shopping List by Section

### PRODUCE
- Broccoli Crowns (~1.5 lb) — $1.00/lb
- Baby Spinach (6 oz) × 2 — $1.99 ea
- Avocados, Bagged (4 ct) — $2.99

### MEAT DEPARTMENT
- Chicken Thighs, Boneless Skin-On (1 lb) — $7.01
- Sirloin Strips for Stir Fry (1 lb) — $15.81

### SEAFOOD
- Fresh Atlantic Salmon (6 oz) × 2 — $7.49 ea

### AISLE 12
- Soy Sauce, Less Sodium (10 fl oz) — $3.19

### FROZEN 4
- Cauliflower Riced Veggies (10 oz) × 2 — $2.99 ea

---

**Estimated Total: ~$95-100**
```

### Save the Plan

After displaying the meal plan and shopping list:
1. Ask: "Would you like me to save this for future reference?"
2. If yes, write to `~/.claude/meal-planning/plans/YYYY-MM-DD.md`
3. Confirm: "Saved to ~/.claude/meal-planning/plans/2026-02-04.md"

The saved file includes both the meal plan and shopping list so it can be referenced while shopping or when planning future meals.

## Directory Structure

```
~/.claude/meal-planning/
├── preferences.txt              # User's dietary preferences (plain text)
└── plans/
    ├── 2026-02-04.md           # Meal plans with shopping lists
    ├── 2026-01-28.md
    └── ...
```

## Additional Resources

### Reference Files

- **`references/interview-questions.md`** — Complete list of interview questions with AskUserQuestion options for gathering user preferences
