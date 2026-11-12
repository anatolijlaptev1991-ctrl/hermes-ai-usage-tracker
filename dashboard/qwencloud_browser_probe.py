#!/usr/bin/env python3
"""Read QwenCloud Token Plan Individual quota through a persistent browser session.

QwenCloud does not expose Individual Token Plan quota via the inference API key
or the public BssOpenAPI surface; the console API requires a logged-in browser
session. This helper reuses a dedicated Playwright profile (see qwencloud_login.py)
and prints a JSON quota snapshot. It never prints cookies or tokens.
"""
import argparse, json, os, re, sys, time
from pathlib import Path

DEFAULT_URL = 'https://home.qwencloud.com/analytics/token-plan/individual?region=ap-southeast-1'

def default_profile() -> str:
    env = os.environ.get('QWENCLOUD_BROWSER_PROFILE')
    if env:
        return env
    d = Path('D:/HermesCargo/qwencloud-session')
    if d.exists():
        return str(d)
    return str(Path.home() / '.hermes' / 'qwencloud-session')

def parse_dom(text: str):
    # Example: "Remaining 99.7%" ... "Plan quota 200,000" ... "2026-12-12 19:00:00"
    rem = re.search(r'Remaining\s+([\d.]+)\s*%', text)
    quota = re.search(r'Plan quota\s+([\d,]+)', text)
    reset = re.search(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})', text)
    if not rem:
        return None
    remaining_pct = float(rem.group(1))
    used_pct = max(0.0, min(100.0, 100.0 - remaining_pct))
    detail = None
    if quota:
        total = int(quota.group(1).replace(',', ''))
        remaining = round(total * remaining_pct / 100.0)
        detail = f'{remaining:,} of {total:,} credits left'
    reset_iso = None
    if reset:
        from datetime import datetime
        try:
            reset_iso = datetime.strptime(reset.group(1), '%Y-%m-%d %H:%M:%S').isoformat()
        except ValueError:
            pass
    return {'label': 'Monthly', 'used_percent': used_pct, 'reset_at': reset_iso, 'detail': detail}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', default=default_profile())
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--timeout', type=int, default=45)
    args = ap.parse_args()
    profile = Path(args.profile)
    if not profile.exists():
        print(json.dumps({'available': False, 'reason': f'No QwenCloud browser session at {profile}. Run qwencloud_login.py once.'}))
        return
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({'available': False, 'reason': 'Playwright is not installed. pip install playwright && playwright install chromium'}))
        return

    captured = {}
    def on_response(resp):
        try:
            url = resp.url
            if '/data/api.json' in url and 'tokenplan' in url:
                body = resp.json()
                data = (((body.get('data') or {}).get('DataV2') or {}).get('data') or {}).get('data')
                if isinstance(data, dict):
                    if 'usage' in url:
                        captured['usage'] = data
                    elif 'subscription' in url:
                        captured['subscription'] = data
        except Exception:
            pass

    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(str(profile), headless=True, locale='en-US',
                                                       args=['--disable-blink-features=AutomationControlled'])
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.on('response', on_response)
            page.goto(args.url, wait_until='domcontentloaded', timeout=args.timeout * 1000)
            try:
                page.wait_for_load_state('networkidle', timeout=15000)
            except Exception:
                pass
            time.sleep(2)
            body = page.inner_text('body')[:8000]
            ctx.close()
    except Exception as e:
        print(json.dumps({'available': False, 'reason': f'Browser probe failed: {type(e).__name__}: {e}'}))
        return

    # Login wall detection
    if 'Sign in' in body[:500] or 'Log In' in body[:500]:
        print(json.dumps({'available': False, 'reason': 'QwenCloud browser session expired. Run qwencloud_login.py again.'}))
        return

    windows = []
    plan = None
    details = []
    usage = captured.get('usage') or {}
    sub = captured.get('subscription') or {}
    if sub:
        plan = sub.get('specCode') or sub.get('planName')
        if sub.get('remainingDays') is not None:
            details.append(f"Remaining days: {sub['remainingDays']}")
    # API percentages are fractions of used quota.
    for key, label in (('per5Hour', 'Session (5h)'), ('per1Week', 'Weekly'), ('per1Month', 'Monthly')):
        pct = usage.get(key + 'Percentage')
        reset = usage.get(key + 'ResetTime')
        if isinstance(pct, (int, float)):
            used = max(0.0, min(100.0, float(pct) * 100.0))
            reset_iso = None
            if isinstance(reset, (int, float)) and reset > 0:
                from datetime import datetime, timezone
                reset_iso = datetime.fromtimestamp(reset / 1000.0, tz=timezone.utc).isoformat()
            windows.append({'label': label, 'used_percent': used, 'reset_at': reset_iso, 'detail': None})
    if not windows:
        dom = parse_dom(body)
        if dom:
            windows.append(dom)
    if not windows:
        print(json.dumps({'available': False, 'reason': 'QwenCloud page loaded but no quota data was found.', 'body_preview': body[:200]}))
        return
    print(json.dumps({'available': True, 'source': 'qwencloud_console', 'title': 'QwenCloud Token Plan',
                      'plan': plan, 'windows': windows, 'details': details}, ensure_ascii=False))

if __name__ == '__main__':
    main()
