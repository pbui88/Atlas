# Atlas — Client Guide & Documentation

**Version 1.0 · Distressed Property Scanner**

---

## Table of Contents

1. [What is Atlas?](#1-what-is-atlas)
2. [Key Features](#2-key-features)
3. [How It Works — The 3-Phase Scan Pipeline](#3-how-it-works--the-3-phase-scan-pipeline)
4. [Step-by-Step User Guide](#4-step-by-step-user-guide)
5. [Understanding Your Results](#5-understanding-your-results)
6. [Credits & Pricing](#6-credits--pricing)
7. [Exporting Your Data](#7-exporting-your-data)
8. [Admin Panel Guide](#8-admin-panel-guide)
9. [Frequently Asked Questions](#9-frequently-asked-questions)
10. [Backend Cost Breakdown](#10-backend-cost-breakdown)

---

## 1. What is Atlas?

Atlas is an AI-powered neighborhood scanning tool that automatically identifies distressed residential properties at scale. Instead of driving neighborhoods manually, Atlas uses Google Street View imagery and Google Gemini AI to scan every property on every road in any area you define — and scores each one for visible signs of distress or neglect.

**Who it's for:** Real estate investors, wholesalers, acquisition teams, and property scouts who need to identify off-market or distressed properties faster than manual methods allow.

**What makes it different:** A scan that would take a team days of driving can be completed in minutes. Atlas generates objective, consistent distress scores across hundreds or thousands of properties in a single run.

---

## 2. Key Features

### Draw Any Neighborhood
Define your scan area by drawing a polygon directly on the map. Atlas supports any shape — a zip code, a subdivision, a city block, or a custom boundary.

### Road-Following Scan Points
Atlas automatically places scan points along named roads inside your polygon using OpenStreetMap road data. Points are positioned perpendicularly to the road so the camera faces properties, not the road surface. Spacing defaults to 25 meters between points.

### Google Street View Imagery
For each scan point, Atlas downloads the most recent available Google Street View image. Points with no Street View coverage (rural areas, private roads) are automatically skipped.

### AI Distress Scoring (Gemini 2.5)
Each image is analyzed by Google Gemini 2.5 Flash, a multimodal AI model. The AI assigns:
- **An overall distress score** from 0–100 (0 = pristine, 100 = severely distressed)
- **Specific distress signals** detected in the image
- **Confidence level** for the analysis
- **Plain-text notes** summarizing what was observed

### 8 Distress Signal Categories

| Signal | Severity |
|--------|----------|
| Boarded Windows | High |
| Abandoned / Vacant | High |
| Tarp on Roof | High |
| Tall Grass / Weeds | Medium |
| Junk in Yard | Medium |
| Broken Gutters | Medium |
| Peeling Paint | Low |
| Poor Maintenance (general) | Low |

### Filterable Results List
After a scan, browse all properties sorted by distress score (highest first). Filter by minimum score threshold and/or by specific distress signals to quickly surface the most relevant properties.

### Street View Direct Link
Every property result links directly to Google Maps Street View at that location so you can visually verify the AI's analysis in your browser.

### CSV / JSON / GeoJSON Export
Export your results for use in spreadsheets, CRM systems, or mapping tools. Export all results or only a hand-picked selection.

### Credit-Based Usage Model
Usage is tracked in scan credits. Credits are consumed when Street View images are downloaded. Your account has a monthly quota set by the administrator, plus any additional credits you purchase.

### Automatic Resume
If a scan is interrupted (browser closed, connection lost), Atlas automatically resumes where it left off the next time you open the project.

---

## 3. How It Works — The 3-Phase Scan Pipeline

Every scan runs through three sequential phases automatically:

```
Phase 1: Collect Street View Images
  → Downloads one Street View image per scan point
  → Marks points with no coverage as "No Coverage" (skipped)
  → Each downloaded image = 1 credit consumed

Phase 2: Reverse Geocode Addresses
  → Converts GPS coordinates → street addresses
  → Free — uses OpenStreetMap / Nominatim
  → Runs in parallel with analysis

Phase 3: AI Distress Analysis
  → Sends each image to Google Gemini 2.5 Flash
  → Returns distress score, signals, confidence, notes
  → Results appear in real-time as analysis completes
```

You can pause a scan at any time and resume later. Progress is saved after every batch.

---

## 4. Step-by-Step User Guide

### Step 1 — Sign In
Navigate to the Atlas URL provided by your administrator. Sign in with your email and password. New accounts require admin approval before access is granted.

---

### Step 2 — Create a New Scan Record
From the **Records** page, click **New List**. Enter a name for your scan (e.g., "Orlando East Side — June 2025"). Click **Create**.

---

### Step 3 — Search for Your Area
On the **Map** tab, use the search bar at the top of the map to find your target city, neighborhood, or ZIP code. The map will center on your search result.

---

### Step 4 — Draw Your Scan Polygon
Click **Draw**, then click on the map to place polygon vertices around the neighborhood you want to scan. Double-click (or close the shape) to complete the polygon.

- The map will immediately show a preview of scan points placed along roads inside your polygon.
- The **Estimated Cost** panel shows the total credit cost for the scan.
- If the point count is too high, click **Clear** and redraw a smaller area.

> **Tip:** A typical city block or small subdivision is 50–300 scan points. A full zip code may be 500–2,000+ points.

---

### Step 5 — Run the Scan
Click **Run** to start the scan. Atlas will:
1. Save your polygon and generate all scan points in the database
2. Automatically switch to the **Results** tab
3. Begin downloading Street View images (Phase 1)
4. Geocode addresses (Phase 2)
5. Run AI analysis (Phase 3)

Progress bars show image collection and AI analysis completion in real time. Results appear as analysis finishes — you don't have to wait for the full scan to complete.

---

### Step 6 — Review Results
In the **Results** tab, properties are listed sorted by distress score (highest first).

- Click any property row to open the image viewer on the right
- The image shows what the AI analyzed, with the distress score and detected signals displayed above
- Use the **Open Street View** button to verify in Google Maps

---

### Step 7 — Filter Your List
Use the filters panel to narrow results:
- **Min Score** slider — only show properties above a score threshold
- **Signal badges** — filter to properties showing specific distress types (e.g., only "Boarded Windows" or "Tarp on Roof")

Active filters are shown as chips; click **Clear all** to reset.

---

### Step 8 — Select and Export
Check individual properties you want to keep, or use the **Select All** checkbox to select all filtered results. Click **Download** to export.

- If rows are checked — exports only the selected rows
- If nothing is checked — exports all filtered results from the entire scan

---

## 5. Understanding Your Results

### Distress Score

| Score Range | Label | Color | Meaning |
|-------------|-------|-------|---------|
| 70–100 | High Distress | Red | Strong visible distress signals; priority targets |
| 45–69 | Moderate | Orange | Noticeable neglect; worth investigating |
| 20–44 | Low | Amber | Minor issues; borderline |
| 0–19 | Pristine | Green | Well-maintained; no distress signals |

### Confidence Score
The AI also returns a confidence rating (0–100%). A lower confidence score means the image quality was poor, the property was partially obscured, or the AI was uncertain. High-confidence results are more reliable.

### "No Coverage" Points
Some scan points return no Street View image. This happens when:
- Google has not captured imagery on that road
- The road is private or gated
- The location is rural with no Street View data

These points are skipped and do not consume credits.

### Score `—`
A score of `—` means the point was scanned (image collected) but AI analysis has not completed yet, or the AI found no visible properties in the image.

---

## 6. Credits & Pricing

### What is a Credit?
One credit = one Street View image downloaded. Credits are consumed in Phase 1 of the scan. Points with no Street View coverage do not use credits.

### Monthly Quota
Every user account has a monthly credit quota set by the administrator (default: 10,000 credits/month). Your quota resets every 30 days from your account creation date.

The **usage widget** in the sidebar shows:
- Credits remaining this cycle
- Credits used this cycle
- Days until cycle resets

### Additional Credits
If you need more credits beyond your monthly quota, you can buy a top-up package yourself from the **Credits** page, or contact your administrator to request a credit grant. Either way, these credits:
- Are added to your account instantly (purchases) or by an admin (grants)
- Never expire — they carry over indefinitely
- Are consumed only after your monthly quota is exhausted

You can view your current balance and usage anytime under **Credits** in the sidebar.

### Credit Packages

| Package | Credits | Price | Per Credit |
|---------|---------|-------|------------|
| Starter | 2,500 | $35 | $0.014 |
| Standard | 5,000 | $70 | $0.014 |
| Plus | 10,000 | $140 | $0.014 |
| Pro | 15,000 | $210 | $0.014 |
| Max | 20,000 | $280 | $0.014 |

Payments are processed securely by Authorize.net. No card details are stored on Atlas servers.

### Cost Examples

| Scan Size | Estimated Credits | Estimated Cost |
|-----------|-------------------|----------------|
| 1 city block (~50 points) | 50 | ~$0.70 |
| Small neighborhood (~300 points) | 300 | ~$4.20 |
| Large subdivision (~1,000 points) | 1,000 | ~$14.00 |
| Full ZIP code (~2,500 points) | 2,500 | ~$35.00 |
| Maximum scan (~10,000 points) | 10,000 | ~$140.00 |

> **Note:** Costs shown are credit costs only. The actual number of images downloaded may be slightly less if some points have no Street View coverage.

---

## 7. Exporting Your Data

### Export Formats

**CSV** — Best for spreadsheets (Excel, Google Sheets) and CRM import.

Columns: `address, distress_score, confidence, signals, notes`

Example:
```
address,distress_score,confidence,signals,notes
"123 Main St, Orlando FL",0.82,0.91,"boarded_windows; abandoned_appearance","Plywood on all windows. Overgrown yard. Signs of vacancy."
"456 Oak Ave, Orlando FL",0.41,0.78,"tall_grass; peeling_paint","Lawn unmowed. Paint significantly faded on south-facing wall."
```

**JSON** — Best for developers and custom integrations.

**GeoJSON** — Best for mapping tools (Google Maps, ArcGIS, QGIS).

### Exporting a Selection
To export only specific properties:
1. Check the checkbox on each row you want
2. Click **Download**
3. Only checked rows are exported — the export file name includes the count (e.g., `My_Scan_12_selected.csv`)

---

## 8. Admin Panel Guide

*Accessible only to administrator accounts.*

### Users Tab

The Users table shows all registered accounts with:
- **Name / Email** — user identity
- **Role** — User or Admin
- **Status** — Active or Pending (not yet activated)
- **Usage (cycle)** — credits used this 30-day period vs. their limit
- **Limit** — click the number to edit the user's monthly credit quota
- **API Key** — whether the user has their own Google Maps key set
- **Joined** — account creation date

**Actions available per user:**

| Action | What it does |
|--------|--------------|
| Promote / Demote | Toggles between Admin and User role |
| Activate / Suspend | Grants or revokes app access |
| Reset | Resets the usage cycle to today (fresh 30-day window) |
| Delete | Permanently deletes the user and all their scan data |

**Pending banner** — If any users are awaiting activation, a yellow banner appears at the top of the Admin page with a **Review** link.

### Usage Tab

Shows a 30-day aggregate of all API calls across all users:
- Street View image downloads
- Gemini AI analysis calls
- Total estimated cost per service

### Setting a User's Google Maps API Key
New users without a Google Maps API key cannot run scans. From the Admin panel:
1. Find the user in the Users table
2. Click **+ Set key** in the API Key column
3. Paste their `AIzaSy...` key
4. Click **Save**

The key is stored encrypted in the database and never shown again in full.

---

## 9. Frequently Asked Questions

**How current is the Street View imagery?**
Atlas uses whatever imagery Google currently has in Street View. Urban areas are typically updated every 1–3 years. Rural areas may have older imagery. You can check the capture date by opening the Street View link for any property.

**Can I re-scan the same area?**
Yes. Open the project, go to the Map tab, click **Clear**, redraw the polygon, and click **Run**. Old scan results are replaced with the new scan.

**Why do some properties show a score of 0 even though they look distressed?**
The AI only flags signals it can clearly see in the image. If the property is at the edge of the frame, obscured by trees, or the image angle doesn't face the property, the AI may not detect distress even if it exists. Use the Street View link to manually verify borderline cases.

**What is the maximum scan size?**
10,000 scan points per project. If your polygon generates more than 10,000 points, you'll be asked to reduce the area or increase the spacing.

**How long does a scan take?**
Approximately:
- Image collection: ~1 minute per 100 points
- AI analysis: ~2 minutes per 100 points
- Total: ~3 minutes per 100 points

A 500-point scan takes roughly 15 minutes. A 2,000-point scan takes about 1 hour. You can close the browser and the scan will resume automatically when you return.

**What happens if my credits run out mid-scan?**
The scan pauses and shows a "Credit limit reached" message. Purchase additional credits from the **Credits** page, then return to the project — the scan will resume automatically from where it stopped.

**Can multiple users scan at the same time?**
Yes, each user's scans run independently. Credit usage is tracked per user.

**Is my data private?**
Yes. Each user can only see their own scan projects and results. Administrators can see usage statistics but not the contents of individual scans.

---

## 10. Backend Cost Breakdown

*This section documents the actual API costs Atlas pays to third-party services per scan point. This is internal pricing information for the platform operator.*

### Per-Point Cost Structure

| Service | Provider | Cost per 1,000 points | Cost per point |
|---------|----------|----------------------|----------------|
| Street View Image | Google Maps Platform | $14.00 | $0.0140 |
| Reverse Geocoding | Nominatim (OSM) | Free | $0.0000 |
| AI Analysis | Google Gemini 2.5 Flash Lite | ~$0.20 | ~$0.0002 |
| Road Data | OpenStreetMap Overpass API | Free | $0.0000 |
| **Total backend cost** | | **~$14.20** | **~$0.0142** |

### Revenue vs. Cost per Credit

| Metric | Amount |
|--------|--------|
| User pays per credit | $0.0140 |
| Backend cost per credit | ~$0.0142 |
| Gross margin per credit | ~$(0.0002) |

> **Note:** The current pricing is essentially at cost. The Street View API cost ($0.014/point) is passed directly to the user at the same rate. The Gemini AI cost (~$0.0002/point) is currently absorbed by the platform. Consider raising the per-credit price to $0.016–$0.018 to cover AI costs and generate margin.

### Monthly Fixed Costs

| Service | Cost |
|---------|------|
| Netlify (hosting + functions) | $0–$25/month (free tier available) |
| Supabase (database + storage) | $0–$25/month (free tier available) |
| Authorize.net (payment processing) | ~2.9% + $0.30 per transaction |

### Cost Example — 1,000 Point Scan

| Line Item | Qty | Unit Cost | Total |
|-----------|-----|-----------|-------|
| Street View images | 1,000 | $0.0140 | $14.00 |
| Gemini AI analysis | 1,000 | $0.0002 | $0.20 |
| Reverse geocoding | 1,000 | Free | $0.00 |
| **Total platform cost** | | | **$14.20** |
| **User pays (10k package)** | | | **$14.00** |

### AI Analysis Cache
Atlas caches Gemini AI results by image fingerprint. If the same image is analyzed again (e.g., a re-scan of the same area), the cached result is used with no additional Gemini API call. An estimated 20% cache hit rate reduces effective AI costs for repeat scans.

### Google Maps API Key Responsibility
Users are required to provide their own Google Maps API key. This means:
- Google Street View charges apply to each user's own Google billing account
- Atlas does not pay Street View costs on behalf of users
- Admin accounts may use a shared platform key (configured via `GOOGLE_MAPS_KEY` environment variable)

---

*Atlas is built on React, Netlify Functions, Supabase, Google Maps Platform, and Google Gemini AI.*

*For technical support or account issues, contact your Atlas administrator.*
