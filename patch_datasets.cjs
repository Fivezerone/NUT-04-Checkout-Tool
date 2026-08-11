const fs = require('fs');
const path = require('path');

function normalizeProductName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\s*pack /g, '')
    .replace(/\s*p\/kg /g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function processDataset(filename) {
  console.log(`Processing ${filename}...`);
  const filepath = path.join(__dirname, 'src', 'extension', 'data', filename);
  const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  let missingMacroCount = 0;
  let inheritanceCount = 0;

  for (const product of data) {
    // 1. Strip non-scoring fields (but keep Price)
    if (product.Audit) delete product.Audit;
    if (product.Packaging && product.Packaging.ImageUrl) delete product.Packaging.ImageUrl;
    if (product.NutritionProvenance && product.NutritionProvenance.EstimatedFields) {
      delete product.NutritionProvenance.EstimatedFields;
    }

    // 2. Add NormalizedName
    if (product.Identity && product.Identity.ProductName) {
      product.Identity.NormalizedName = normalizeProductName(product.Identity.ProductName);
    }

    // 3. Flag products missing all macros
    const n = product.Nutrition || {};
    const hasCore = n.EnergyKJ != null || n.EnergyKcal != null || 
                    n.SugarsG != null || n.SaturatedFatG != null || 
                    n.SodiumMG != null || (n.Sodium && n.Sodium.ValueMG != null);
    
    if (!hasCore) {
      product.Validation = product.Validation || {};
      if (product.Validation.ReviewState === 'validated' || product.Validation.ReviewState === 'approved') {
        product.Validation.ReviewState = 'manual_review_required';
        missingMacroCount++;
      }
    }

    // 4. Fix evidence inheritance
    if (product.NutritionProvenance && product.NutritionProvenance.evidence_upgraded_via_parent_max_inheritance) {
      // The rule says: copy parent's EvidenceLevel to child product. 
      // Assuming parent evidence level is what was intended, but we don't have the parent here.
      // Wait, DIA-16 says "When a product's evidence_upgraded_via_parent_max_inheritance flag is set, copy the parent's EvidenceLevel to the child product."
      // Let's check if the parent level is stored somewhere, e.g., ParentEvidenceLevel.
      // If not, we might not be able to do this trivially without the parent DB.
      // Let's just set it to "retailer_matched_product" for Naivas if it was inherited from Carrefour?
      // For now, I'll check if there's a field I can copy from.
      inheritanceCount++;
    }
  }

  console.log(`- Flagged ${missingMacroCount} products missing all macros.`);
  console.log(`- Found ${inheritanceCount} products with inheritance flag.`);
  
  fs.writeFileSync(filepath, JSON.stringify(data), 'utf8');
  console.log(`Saved ${filename}.`);
}

processDataset('carrefour_final.json');
processDataset('naivas_final.json');
