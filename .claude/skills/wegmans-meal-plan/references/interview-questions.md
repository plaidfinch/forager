# Interview Questions Reference

Complete list of AskUserQuestion calls for gathering meal planning preferences. Run these in sequence during initial setup or when user requests a fresh start.

## Round 1: Dietary & Cuisine Basics

```
Question 1: "Do either of you have any dietary restrictions, allergies, or foods you avoid?"
Header: "Restrictions"
MultiSelect: true
Options:
  - "None" — No dietary restrictions or allergies
  - "Vegetarian/Vegan" — No meat, or no animal products at all
  - "Gluten-free" — Avoiding wheat, barley, rye, etc.
  - "Allergies" — Specific food allergies (please specify in Other)

Question 2: "What cuisines or flavors do you both enjoy most?"
Header: "Cuisines"
MultiSelect: true
Options:
  - "American comfort" — Classic dishes like roasts, casseroles, soups
  - "Mediterranean" — Greek, Italian, Middle Eastern flavors
  - "Asian-inspired" — Chinese, Thai, Japanese, Korean, etc.
  - "Mexican/Latin" — Tacos, enchiladas, rice and beans

Question 3: "How much time do you typically have to cook dinner on weeknights?"
Header: "Cook time"
MultiSelect: false
Options:
  - "15-30 minutes" — Quick meals, minimal prep
  - "30-45 minutes" — Moderate cooking time
  - "45-60+ minutes" — Happy to spend time cooking
  - "Varies" — Mix of quick and longer meals throughout the week

Question 4: "How many days of meals are you shopping for?"
Header: "Duration"
MultiSelect: false
Options:
  - "3-4 days" — Shorter shopping cycle, fresher ingredients
  - "5-7 days" — Full week of meals
  - "7-10 days" — Extended stock-up shop
  - "2 weeks" — Bi-weekly shopping trip
```

## Round 2: Proteins & Meals

```
Question 1: "Which meals are you shopping for?"
Header: "Meals"
MultiSelect: false
Options:
  - "All meals" — Breakfast, lunch, dinner, and snacks
  - "Dinner only" — You handle other meals separately
  - "Dinner + lunches" — Dinner and packed lunches (or leftovers)
  - "Dinner + breakfast" — Dinner and breakfast items

Question 2: "What proteins do you both enjoy? Select all that apply."
Header: "Proteins"
MultiSelect: true
Options:
  - "Chicken & turkey" — Poultry options
  - "Beef & pork" — Red meat and pork
  - "Fish & seafood" — Salmon, shrimp, etc.
  - "Eggs & tofu" — Egg dishes, plant proteins

Question 3: "Are there any foods either of you strongly dislike or want to avoid?"
Header: "Dislikes"
MultiSelect: true
Options:
  - "No dislikes" — We'll eat pretty much anything
  - "Certain vegetables" — Specific veggies you hate (please specify)
  - "Spicy food limits" — Need to keep heat level mild to moderate
  - "Specific items" — Other specific dislikes (please specify)

Question 4: "What's your approximate budget for this shopping trip?"
Header: "Budget"
MultiSelect: false
Options:
  - "$75-100" — Budget-conscious shopping
  - "$100-150" — Moderate spending
  - "$150-200" — Comfortable budget for quality ingredients
  - "Flexible" — Quality matters more than strict budget
```

## Round 3: Meal Strategy & Breakfast

```
Question 1: "For different calorie/dietary goals in your household, how do you want to handle meals?"
Header: "Meal strategy"
MultiSelect: false
Options:
  - "Same base, add sides" — Cook one main dish; others add rice, bread, etc. on the side
  - "Different portions" — Same food, just different serving sizes
  - "Some separate items" — A few different breakfast/snack items for each person
  - "Fully shared" — Eat the exact same things

Question 2: "What do you typically like for breakfast?"
Header: "Breakfast"
MultiSelect: true
Options:
  - "Eggs-based" — Scrambles, omelettes, fried eggs
  - "Quick/grab-and-go" — Yogurt, fruit, smoothies, overnight prep
  - "Savory leftovers" — Happy to eat dinner food for breakfast
  - "Light/skip it" — Coffee, maybe a small snack

Question 3: "Do you want snack items included in the list?"
Header: "Snacks"
MultiSelect: false
Options:
  - "Yes, healthy snacks" — Cheese, nuts, veggies, etc.
  - "Yes, variety" — Mix of healthy and some treats
  - "Minimal snacks" — Just a few basics
  - "No snacks needed" — We don't really snack

Question 4: "How many dinners should I plan recipes for?"
Header: "Dinners"
MultiSelect: false
Options:
  - "3 dinners" — Plan for 3 nights
  - "4 dinners" — Plan for 4 nights
  - "2-3 with leftovers" — Bigger batches to stretch across more meals
  - "5+ dinners" — Full coverage including extras
```

## Conditional Follow-ups

### If dietary restrictions selected

Ask for specifics in the "Other" response or follow up:
- "You mentioned dietary restrictions. Could you tell me more about what you're avoiding and why?"
- Common patterns to probe: low-carb goals, specific allergies, intolerances (lactose, A1 milk, gluten sensitivity)

### If different household members have different goals

Ask: "Tell me a bit about each person's dietary goals so I can plan accordingly."
- Example: One person low-carb for weight loss, another wants to gain weight
- This informs portion recommendations and whether to suggest add-on sides

### If "Allergies" or "Specific items" selected

Always follow up to capture the specific items:
- "What specific allergies or food items should I avoid?"
- Record these carefully—they affect product ingredient checking

## Notes on Recording Preferences

When writing the preferences file, capture:
- Exact restrictions and allergies (critical for safety)
- Cuisine preferences in order of enthusiasm
- Time constraints (affects recipe complexity)
- Protein preferences and any aversions
- Household dynamics (different goals, portion strategies)
- Breakfast and snack style
- Budget approach

Example preferences.txt:
```
Household: 2 people

Dietary:
- Low-carb (not keto): avoiding bread, rice, high glycemic foods
- A1 milk protein intolerance: need goat milk, sheep milk, A2, or plant-based dairy
- High protein, moderate fat for satiation and muscle building

Goals:
- Person 1: lose weight while gaining muscle (body recomp)
- Person 2: gain weight (can eat more freely, larger portions)

Cuisines: Mediterranean, Asian-inspired, Mexican/Latin, adventurous eaters

Cooking: 15-30 minutes on weeknights, prefer quick meals

Proteins: Chicken (prefer thighs to breast), beef (no pork), fish & seafood, eggs
No strong dislikes, will eat most things

Meals: All meals - breakfast, lunch (leftovers), dinner, snacks
Breakfast: Eggs-based, savory leftovers, quick grab-and-go options
Snacks: Healthy snacks - cheese, nuts, cut vegetables

Budget: Flexible, quality over strict limits
Typical shop: 3-4 days of meals, 4 dinners planned
```
