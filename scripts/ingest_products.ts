import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Setup Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Define chunk size
const CHUNK_SIZE = 500;

function normalizeProduct(item: any): any {
  // Extract values, handle missing keys safely
  const identity = item.Identity || {};
  const classification = item.Classification || {};
  const packaging = item.Packaging || {};
  const nutrition = item.Nutrition || {};

  const sodiumMg = nutrition.SodiumMG;
  let saltG = nutrition.SaltG;
  
  if (saltG === undefined || saltG === null) {
    if (sodiumMg !== undefined && sodiumMg !== null) {
      saltG = (sodiumMg / 1000) * 2.5;
    } else {
      saltG = null;
    }
  }
  
  return {
    retailer_product_id: identity.ProductID,
    retailer: identity.Retailer,
    product_name: identity.ProductName,
    product_url: identity.RetailerProductUrl,
    normalized_name: identity.NormalizedName,
    brand_name: identity.BrandName,
    nutrition_category: classification.NutritionCategory,
    pack_size_unit: packaging.PackSizeUnit,
    energy_kj: nutrition.EnergyKJ,
    energy_kcal: nutrition.EnergyKcal,
    sugars_g: nutrition.SugarsG,
    sat_fat_g: nutrition.SaturatedFatG,
    fat_g: nutrition.FatG,
    carbohydrates_g: nutrition.CarbohydratesG,
    fibre_g: nutrition.FibreG,
    sodium_mg: sodiumMg,
    salt_g: saltG,
    protein_g: nutrition.ProteinG,
    // base_nutriscore_grade can be computed or updated later if not present in source JSON
    base_nutriscore_grade: classification.NutriScore || null 
  };
}

async function ingestFile(filePath: string) {
  console.log(`Starting ingestion for ${filePath}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}, skipping...`);
    return;
  }

  const rawData = fs.readFileSync(filePath, 'utf8');
  const products = JSON.parse(rawData);

  console.log(`Found ${products.length} products to ingest.`);

  let chunk = [];
  let totalUpserted = 0;

  for (let i = 0; i < products.length; i++) {
    try {
      const normalized = normalizeProduct(products[i]);
      // Only insert products that have the required conflict resolution keys
      if (normalized.retailer_product_id && normalized.retailer) {
        chunk.push(normalized);
      }
    } catch (err) {
      console.warn(`Error normalizing product at index ${i}:`, err);
    }

    if (chunk.length === CHUNK_SIZE || i === products.length - 1) {
      if (chunk.length > 0) {
        const { error } = await supabase.from('products').upsert(chunk, {
          onConflict: 'retailer,retailer_product_id'
        });

        if (error) {
          console.error(`Error upserting chunk ending at index ${i}:`, error);
        } else {
          totalUpserted += chunk.length;
          console.log(`Upserted ${totalUpserted} / ${products.length} products...`);
        }
        chunk = []; // Reset chunk
      }
    }
  }

  console.log(`Finished ingesting ${filePath}. Total successful upserts: ${totalUpserted}`);
}

async function run() {
  const dataDir = path.join(__dirname, '..', 'src', 'extension', 'data');
  const files = ['naivas_products.json', 'carrefour_products.json', 'quickmart_products.json'];

  for (const file of files) {
    await ingestFile(path.join(dataDir, file));
  }
}

run().catch(console.error);
