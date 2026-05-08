# Atlas — Setup Guide

## 1. Supabase

1. Create a project at https://supabase.com
2. Run `supabase/migrations/001_initial_schema.sql` in the SQL Editor
3. Create a **Storage bucket** named `street-view-images` (set to **Public**)
4. Enable Google OAuth under Authentication → Providers → Google
5. Copy your project URL and anon key  

## 2. Google Cloud

Enable these APIs in https://console.cloud.google.com:
- Maps JavaScript API (for frontend map + drawing)  
- Street View Static API (for image downloads) 
- Geocoding API (for reverse geocoding)

Create two API keys:
- **Frontend key** — restrict to HTTP referrers (your Netlify domain) 
- **Backend key** — restrict to IP (Netlify function IPs) or unrestricted if using your own keys

## 3. OpenAI

Get an API key at https://platform.openai.com — needs GPT-4o access.

## 4. Local Development

```bash
cp .env.example .env.local
# Fill in all values in .env.local

npm install
npm run netlify:dev    # runs Vite + Netlify Functions together at localhost:3000
```

## 5. Netlify Deploy

```bash
netlify login
netlify init           # connect to Netlify site

# Set all env vars in Netlify dashboard or:
netlify env:set VITE_SUPABASE_URL "..."
netlify env:set VITE_SUPABASE_ANON_KEY "..."
netlify env:set SUPABASE_SERVICE_ROLE_KEY "..."
netlify env:set VITE_GOOGLE_MAPS_KEY "..."
netlify env:set GOOGLE_MAPS_KEY "..."
netlify env:set OPENAI_API_KEY "..."

git push origin main   # triggers auto-deploy
```

## 6. First User Setup

After deploying, sign in with Google. Then in the Supabase SQL Editor, promote yourself to admin:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'thanhphong018@gmail.com';
```

## Architecture Summary

```
User → Netlify CDN (Vite/React frontend)
     → /.netlify/functions/* (Netlify Functions API)
     → Supabase PostgreSQL (data)
     → Supabase Storage (street-view-images bucket)
     → Google Maps API (map display + drawing)
     → Google Street View Static API (image downloads)
     → Google Geocoding API (address lookup)
     → OpenAI GPT-4o Vision (distress analysis)
```

## Cost per 1,000-point scan

| Service         | Cost     |
|----------------|----------|
| Street View    | ~$28.00  |
| Geocoding      | ~$5.00   |
| GPT-4o Vision  | ~$15.00  |
| **Total**      | **~$48** |
