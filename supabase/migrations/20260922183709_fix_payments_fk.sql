-- Create a trigger to automatically populate public.users when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- For existing users, let's backfill so they can pay successfully
INSERT INTO public.users (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name' 
FROM auth.users
ON CONFLICT (id) DO NOTHING;
