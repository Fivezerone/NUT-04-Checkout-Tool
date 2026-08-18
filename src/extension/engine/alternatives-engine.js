/**
 * AlternativesEngine
 * Component Layer: Core Logic
 * Responsibility: Filter and rank alternative products strictly within the same FSAProductCategory.
 */

const AlternativesEngine = {
  DISCLAIMER: "Alternatives are suggested based on nutritional profile similarity within the same food category. This does not constitute dietary advice.",

  // Letter grades to numeric rank for sorting (A=5, B=4, C=3)
  gradeScore(grade) {
    const map = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
    return map[grade] || 0;
  },

  getAlternatives(targetProduct, allProductsDb) {
    if (!targetProduct || !targetProduct.fsaCategory) {
      return { alternatives: [], disclaimer: this.DISCLAIMER };
    }

    const targetCategory = targetProduct.fsaCategory;
    const targetPrice = targetProduct.price || 0;

    // BR-109: Filter strictly by same FSA category
    let validAlts = allProductsDb.filter(prod => 
      prod.fsaCategory === targetCategory && 
      prod.productId !== targetProduct.productId
    );

    const targetGrade = targetProduct.grade || 'C';
    const targetRank = this.gradeScore(targetGrade);

    // Filter for LetterGrade strictly better than target (unless target is A)
    validAlts = validAlts.filter(prod => {
      const g = prod.grade || prod.nutriscore_grade;
      if (!g) return false;
      if (!['A', 'B', 'C'].includes(g)) return false;
      
      const altRank = this.gradeScore(g);
      if (targetRank === 5) return altRank === 5;
      return altRank > targetRank;
    });

    // Price proximity filtering (+/- 30%)
    if (targetPrice > 0) {
      const minPrice30 = targetPrice * 0.7;
      const maxPrice30 = targetPrice * 1.3;
      const minPrice50 = targetPrice * 0.5;
      const maxPrice50 = targetPrice * 1.5;

      let priceFiltered = validAlts.filter(p => p.price >= minPrice30 && p.price <= maxPrice30);
      
      // Widen to 50% if fewer than 3 results
      if (priceFiltered.length < 3) {
        priceFiltered = validAlts.filter(p => p.price >= minPrice50 && p.price <= maxPrice50);
      }
      validAlts = priceFiltered;
    }

    // Sort by RelevanceScore: 0.60*GradeRank + 0.30*CategoryMatch (1.0 since filtered) + 0.10*PriceProximity
    validAlts.forEach(prod => {
      const g = prod.grade || prod.nutriscore_grade;
      const gradeRank = this.gradeScore(g);
      const categoryMatch = 1.0;
      let priceProximity = 1.0;

      if (targetPrice > 0 && prod.price) {
        const diff = Math.abs(prod.price - targetPrice) / targetPrice;
        priceProximity = Math.max(0, 1 - diff);
      }

      prod.relevanceScore = (0.60 * gradeRank) + (0.30 * categoryMatch) + (0.10 * priceProximity);
    });

    validAlts.sort((a, b) => b.relevanceScore - a.relevanceScore); // Highest relevance first

    // Limit to top 3 and map to AlternativeRecommendation schema
    const topAlts = validAlts.slice(0, 3).map(prod => ({
      AlternativeGroceryProductID: prod.productId,
      LetterGrade: prod.grade || prod.nutriscore_grade || 'C',
      FSAProductCategoryMatch: true,
      RelevanceScore: prod.relevanceScore.toFixed(2),
      ExplanationText: `A healthier ${prod.grade || 'C'}-grade alternative in the same category.`,
      PriceKES: prod.price
    }));

    return {
      alternatives: topAlts,
      disclaimer: this.DISCLAIMER
    };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { AlternativesEngine };
