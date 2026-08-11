/**
 * FoodClassifier Engine
 * Component Layer: Core Logic
 * Responsibility: Detect FSAProductCategory and run SPF Exclusion Gate.
 */

const FoodClassifier = {
  FSA_CATEGORY: {
    GENERAL_FOOD: "GENERAL_FOOD",
    RED_MEAT:     "RED_MEAT",
    CHEESE:       "CHEESE",
    ADDED_FAT:    "ADDED_FAT",
    BEVERAGE:     "BEVERAGE"
  },

  // SPF-excluded categories per BR-104 & EV-SCI-007
  SPF_EXCLUDED_KEYWORDS: [
    "baby food", "infant", "toddler", "sports nutrition", 
    "special medical purpose", "dietary supplement", "meal replacement", "supplement"
  ],

  classify(data) {
    const combined = ((data.name || "") + " " + (data.category || "")).toLowerCase();
    
    // 1. Exclusion Gate
    const isExcluded = this.SPF_EXCLUDED_KEYWORDS.some(kw => combined.includes(kw));

    if (isExcluded) {
      return { 
        IsExcluded: true, 
        FSAProductCategoryCode: null,
        NOVAProcessingLevel: data.nova_group || null
      };
    }

    // 2. FSA Category Classification
    let fsaCategory = this.FSA_CATEGORY.GENERAL_FOOD;

    if (data.is_beverage || /\b(juice|drink|soda|water|tea|coffee|milk drink|smoothie|squash)\b/.test(combined)) {
      fsaCategory = this.FSA_CATEGORY.BEVERAGE;
    } else if (/\b(beef|lamb|pork|mutton|goat|venison|game meat|red meat|mince|steak|burger|sausage|salami|bacon|ham|hotdog|biltong)\b/.test(combined)) {
      fsaCategory = this.FSA_CATEGORY.RED_MEAT;
    } else if (/\b(cheese|cheddar|mozzarella|gouda|parmesan|brie|cream cheese|processed cheese)\b/.test(combined)) {
      fsaCategory = this.FSA_CATEGORY.CHEESE;
    } else if (/\b(oil|butter|margarine|lard|ghee|shortening|fat spread|cooking fat)\b/.test(combined)) {
      fsaCategory = this.FSA_CATEGORY.ADDED_FAT;
    }

    return { 
      IsExcluded: false, 
      FSAProductCategoryCode: fsaCategory,
      NOVAProcessingLevel: data.nova_group || 3
    };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { FoodClassifier };
