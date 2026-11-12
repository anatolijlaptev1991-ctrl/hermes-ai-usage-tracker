#!/usr/bin/env python3
"""One-time interactive login for the QwenCloud Token Plan browser session.

Opens a dedicated Chromium profile, lets the user sign in to QwenCloud, and
keeps the session for qwencloud_browser_probe.py. No credentials are stored by
this script; the browser profile holds the normal login cookies.
"""
import argparse, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

DEFAULT_URL = 'https://home.qwencloud.com/analytics/token-plan/individual?region=ap-southeast-1'

def default_profile() -> str:
    env = os.environ.get('QWENCLOUD_BROWSER_PROFILE')
    if env:
        return env
    d = Path('D:/HermesCargo/qwencloud-session')
    if d.exists():
        return str(d)
    return str(Path.home() / '.hermes' / 'qwencloud-session')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', default=default_profile())
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--timeout', type=int, default=480)
    args = ap.parse_args()
    profile = Path(args.profile)
    profile.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(profile), headless=False, locale='en-US',
                                                   args=['--disable-blink-features=AutomationControlled',
                                                         '--no-first-run', '--no-default-browser-check',
                                                         '--disable-session-crashed-bubble'])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
        deadline = time.time() + args.timeout
        ok = False
        while time.time() < deadline:
            try:
                body = page.inner_text('body')[:5000]
                if 'home.qwencloud.com' in page.url and ('Individual Plan' in body or 'Monthly Quota' in body or 'Remaining' in body):
                    ok = True
                    break
            except Exception:
                pass
            time.sleep(3)
        if ok:
            page.screenshot(path=str(profile / 'logged_in.png'))
            print('LOGIN_SUCCESS profile=' + str(profile))
        else:
            print('LOGIN_TIMEOUT url=' + page.url)
        ctx.close()

if __name__ == '__main__':
    main()
