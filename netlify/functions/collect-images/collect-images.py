"""
collect-images — Python Netlify function

Priority order for image sourcing:
  1. streetlevel GSV (free, downloads + crops panorama)
  2. Mapillary (free, fast direct download)
  3. no_coverage if both fail
"""

import io
import json
import math
import hashlib
import os
import statistics
from datetime import datetime, timezone
from urllib.request import urlopen, Request

from PIL import Image
from supabase import create_client
from streetlevel import streetview

# ── Config ────────────────────────────────────────────────────────────────────

MAPILLARY_KEY        = os.environ.get('MAPILLARY_ACCESS_TOKEN', '')
SUPABASE_URL         = os.environ['VITE_SUPABASE_URL']
SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

MAPILLARY_RADIUS_M    = 50
PERPENDICULAR_TOL_DEG = 65
CAP                   = 20   # max points per function call

CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _ok(body):
    return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(body)}

def _err(msg, code=400):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps({'error': msg})}

def _angular_diff(a, b):
    d = abs(((a - b) % 360 + 360) % 360)
    return 360 - d if d > 180 else d

def _fetch_json(url, headers=None):
    req = Request(url, headers=headers or {})
    with urlopen(req, timeout=10) as res:
        return json.loads(res.read())

def _download_bytes(url, timeout=15):
    """Return (bytes, content_type)."""
    with urlopen(url, timeout=timeout) as res:
        return res.read(), res.headers.get('Content-Type', '')

def _crop_equirectangular(img: Image.Image, heading_deg: float, fov_deg: float = 90) -> Image.Image:
    """
    Crop an equirectangular panorama at the given compass heading.
    Returns a 640×480 JPEG-ready RGB image.
    """
    w, h = img.size
    heading_deg = heading_deg % 360

    center_col = int((heading_deg / 360.0) * w)
    crop_w     = int((fov_deg   / 360.0) * w)

    # Use the middle vertical third to avoid sky and road surface
    top    = h // 4
    crop_h = h // 2

    left  = center_col - crop_w // 2
    right = left + crop_w

    if 0 <= left and right <= w:
        cropped = img.crop((left, top, right, top + crop_h))
    elif left < 0:
        p1 = img.crop((w + left, top, w,     top + crop_h))
        p2 = img.crop((0,        top, right, top + crop_h))
        cropped = Image.new('RGB', (crop_w, crop_h))
        cropped.paste(p1, (0, 0))
        cropped.paste(p2, (p1.width, 0))
    else:
        p1 = img.crop((left, top, w,          top + crop_h))
        p2 = img.crop((0,    top, right - w,  top + crop_h))
        cropped = Image.new('RGB', (crop_w, crop_h))
        cropped.paste(p1, (0, 0))
        cropped.paste(p2, (p1.width, 0))

    return cropped.resize((640, 480), Image.LANCZOS)

# ── Mapillary ─────────────────────────────────────────────────────────────────

def _fetch_mapillary(lat, lng):
    """
    Attempt to get a perpendicular image from Mapillary.

    Returns:
        (img_bytes, heading_deg, pano_id, road_bearing_deg)   – on success
        (None,      None,        None,    road_bearing_deg)   – off-perpendicular; road bearing usable
        (None,      None,        None,    None)               – no key or no nearby images
    """
    if not MAPILLARY_KEY:
        return None, None, None, None

    d    = MAPILLARY_RADIUS_M / 111320
    bbox = f'{lng-d},{lat-d},{lng+d},{lat+d}'
    url  = (
        f'https://graph.mapillary.com/images'
        f'?fields=id,thumb_2048_url,compass_angle,computed_compass_angle,geometry,is_pano'
        f'&bbox={bbox}&limit=15'
    )

    try:
        data = _fetch_json(url, headers={'Authorization': f'OAuth {MAPILLARY_KEY}'})
    except Exception as e:
        print(f'[mapillary] API error: {e}')
        return None, None, None, None

    images = data.get('data', [])
    if not images:
        return None, None, None, None

    candidates = []
    for img in images:
        coords = img.get('geometry', {}).get('coordinates', [0, 0])
        dist   = math.hypot((coords[1] - lat) * 111320, (coords[0] - lng) * 111320)
        angle  = img.get('computed_compass_angle') or img.get('compass_angle') or 0
        if img.get('thumb_2048_url'):
            candidates.append({
                'id':     img['id'],
                'url':    img['thumb_2048_url'],
                'angle':  angle,
                'dist':   dist,
                'is_pano': img.get('is_pano', False),
            })

    if not candidates:
        return None, None, None, None

    road_bearing = statistics.median([c['angle'] for c in candidates])
    target_angle = (road_bearing + 90) % 360

    candidates.sort(key=lambda c: (
        (-90 if c['is_pano'] else 0) + _angular_diff(c['angle'], target_angle),
        c['dist'],
    ))

    best      = candidates[0]
    best_diff = _angular_diff(best['angle'], target_angle)

    if not best['is_pano'] and best_diff > PERPENDICULAR_TOL_DEG:
        print(f'[mapillary] best off-perpendicular by {best_diff:.0f}° — skipping')
        return None, None, None, road_bearing

    try:
        img_bytes, ct = _download_bytes(best['url'])
        if 'image' not in ct:
            return None, None, None, road_bearing
        return img_bytes, best['angle'], best['id'], road_bearing
    except Exception as e:
        print(f'[mapillary] download failed: {e}')
        return None, None, None, road_bearing

# ── streetlevel (Google Street View, no API key) ─────────────────────────────

def _fetch_streetlevel(lat, lng, road_bearing=None):
    """
    Download a Google Street View panorama via streetlevel (no API key required),
    crop it perpendicular to the road, and return JPEG bytes.

    Returns:
        (img_bytes, perp_heading_deg, pano_id)  – on success
        None                                     – no panorama found or error
    """
    try:
        pano = streetview.find_panorama(lat, lng, radius=MAPILLARY_RADIUS_M)
        if not pano:
            print(f'[streetlevel] no panorama near {lat},{lng}')
            return None

        # pano.heading is in radians; convert to degrees
        capture_heading_deg = math.degrees(pano.heading) % 360
        base_heading        = road_bearing if road_bearing is not None else capture_heading_deg
        perp_heading        = (base_heading + 90) % 360

        # zoom=1 gives a small but usable resolution — faster than zoom=5
        pano_img = streetview.get_panorama(pano, zoom=1)
        cropped  = _crop_equirectangular(pano_img, perp_heading)

        buf = io.BytesIO()
        cropped.save(buf, format='JPEG', quality=85)
        return buf.getvalue(), perp_heading, pano.id

    except Exception as e:
        print(f'[streetlevel] failed at {lat},{lng}: {e}')
        return None

# ── Per-point pipeline ────────────────────────────────────────────────────────

def _process_point(pt, project_id, user_id, supabase):
    point_id = pt['id']
    lat      = pt['lat']
    lng      = pt['lng']

    try:
        # ── 1. streetlevel GSV ───────────────────────────────────────────
        result = _fetch_streetlevel(lat, lng)
        if result:
            img_bytes, heading, pano_id = result
            img_source = 'google'
        else:
            img_bytes = None

        # ── 2. Mapillary fallback ─────────────────────────────────────────
        if not img_bytes:
            img_bytes, heading, pano_id, _ = _fetch_mapillary(lat, lng)
            img_source = 'mapillary' if img_bytes else None

        if not img_bytes:
            supabase.table('scan_points').update({
                'status':     'no_coverage',
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }).eq('id', point_id).execute()
            return {'pointId': point_id, 'status': 'no_coverage'}

        supabase.table('scan_points').update({
            'status':     'downloading',
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }).eq('id', point_id).execute()

        image_hash   = hashlib.sha256(img_bytes).hexdigest()
        storage_path = f'{project_id}/{point_id}/F.jpg'

        supabase.storage.from_('street-view-images').upload(
            storage_path,
            img_bytes,
            {'content-type': 'image/jpeg', 'upsert': 'true'},
        )

        # Construct public URL directly (avoids an extra round-trip)
        public_url = f'{SUPABASE_URL}/storage/v1/object/public/street-view-images/{storage_path}'

        supabase.table('images').insert({
            'scan_point_id': point_id,
            'direction':     'F',
            'heading':       heading,
            'storage_path':  storage_path,
            'storage_url':   public_url,
            'panorama_id':   pano_id,
            'image_hash':    image_hash,
            'image_source':  img_source,
            'size_bytes':    len(img_bytes),
        }).execute()

        supabase.table('scan_points').update({
            'status':     'downloaded',
            'error_msg':  None,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }).eq('id', point_id).execute()

        # Both streetlevel GSV and Mapillary are free
        supabase.table('usage_logs').insert({
            'user_id':  user_id,
            'service':  'streetlevel_gsv' if img_source == 'google' else 'mapillary',
            'action':   'image_download',
            'count':    1,
            'cost_usd': 0,
            'metadata': {'projectId': project_id, 'pointId': point_id, 'source': img_source},
        }).execute()

        return {'pointId': point_id, 'status': 'downloaded', 'source': img_source}

    except Exception as e:
        print(f'[collect] error at {point_id}: {e}')
        supabase.table('scan_points').update({
            'status':     'failed',
            'error_msg':  str(e)[:500],
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }).eq('id', point_id).execute()
        return {'pointId': point_id, 'status': 'failed', 'error': str(e)}

# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 204, 'headers': CORS}

    if event.get('httpMethod') != 'POST':
        return _err('Method not allowed', 405)

    # Auth — verify Supabase JWT via service role
    headers = event.get('headers', {})
    auth    = headers.get('authorization') or headers.get('Authorization', '')
    token   = auth.replace('Bearer ', '').strip()
    if not token:
        return _err('Unauthorized', 401)

    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    try:
        user = supabase.auth.get_user(token).user
        if not user:
            return _err('Invalid token', 401)
    except Exception:
        return _err('Invalid token', 401)

    body      = json.loads(event.get('body') or '{}')
    project_id = body.get('projectId')
    point_ids  = body.get('pointIds', [])

    if not project_id or not isinstance(point_ids, list) or not point_ids:
        return _err('projectId and pointIds required')

    ids = point_ids[:CAP]

    pts = (supabase.table('scan_points')
           .select('id, lat, lng, project_id')
           .in_('id', ids)
           .execute()
           .data or [])

    if not pts:
        return _ok({'results': []})

    results = [_process_point(pt, project_id, user.id, supabase) for pt in pts]

    # Update project counters
    completed = (supabase.table('scan_points')
                 .select('id', count='exact')
                 .eq('project_id', project_id)
                 .in_('status', ['downloaded', 'analyzing', 'complete'])
                 .execute()
                 .count or 0)

    supabase.table('projects').update({
        'completed_points': completed,
        'status':           'collecting',
        'updated_at':       datetime.now(timezone.utc).isoformat(),
    }).eq('id', project_id).execute()

    return _ok({'results': results})
