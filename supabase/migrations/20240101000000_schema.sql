-- Enable pg_trgm for fast text search on normalized_name
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Users Table (extends auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  is_premium BOOLEAN DEFAULT FALSE,
  health_mode BOOLEAN DEFAULT FALSE,
  notification_frequency TEXT DEFAULT 'realtime',
  selected_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Products Table (raw nutrients and base score)
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_product_id TEXT NOT NULL,
  retailer TEXT NOT NULL,
  product_name TEXT,
  product_url TEXT,
  normalized_name TEXT,
  brand_name TEXT,
  nutrition_category TEXT,
  pack_size_unit TEXT,
  
  -- Raw Nutrients (per 100g/ml)
  energy_kj NUMERIC,
  energy_kcal NUMERIC,
  sugars_g NUMERIC,
  sat_fat_g NUMERIC,
  fat_g NUMERIC,
  carbohydrates_g NUMERIC,
  fibre_g NUMERIC,
  sodium_mg NUMERIC,
  salt_g NUMERIC,
  protein_g NUMERIC,
  
  base_nutriscore_grade TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(retailer, retailer_product_id)
);

-- Indexes for fast querying
CREATE INDEX idx_products_retailer ON public.products(retailer);
CREATE INDEX idx_products_normalized_name_trgm ON public.products USING GIN (normalized_name gin_trgm_ops);

-- 3. Payments Table
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  transaction_ref TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);



-- ROW LEVEL SECURITY (RLS) POLICIES

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;


-- Products: Anyone (including anon) can read products
CREATE POLICY "Products are publicly readable" 
ON public.products FOR SELECT 
USING (true);


-- Users: Users can only read and update their own profile
CREATE POLICY "Users can view own profile" 
ON public.users FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
ON public.users FOR UPDATE 
USING (auth.uid() = id);

-- Payments: Users can only view their own payments
CREATE POLICY "Users can view own payments" 
ON public.payments FOR SELECT 
USING (auth.uid() = user_id);

-- Note: Edge functions using the Service Role Key bypass RLS, 
-- allowing them to safely INSERT/UPDATE payments and user premium status.
