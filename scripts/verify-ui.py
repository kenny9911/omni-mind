"""Headless UI verification for the editable trio (#19) and conversation restore (#20).

Injects the demo session cookie (login UI bypassed), then drives the two new
features in a real browser while collecting console errors / page exceptions.
Usage: python scripts/verify-ui.py <base_url> <session_cookie_value>
"""
import re
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
SID = sys.argv[2]
HOST = BASE.split("//", 1)[1].split(":")[0]
TRIO_SEL = 'button[title="选择 3 位专家"], button[title="Pick 3 experts"]'

errors = []
results = {}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_cookies([{
            "name": "omni_session", "value": SID,
            "domain": HOST, "path": "/", "httpOnly": True, "sameSite": "Lax",
        }])
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(1200)

        # ---- #20: restore a historical (expert) conversation ----
        recent = page.get_by_text("测试一下", exact=True).first
        recent.wait_for(state="visible", timeout=8000)
        recent.click()
        page.wait_for_timeout(1500)
        body = page.inner_text("body")
        prompt_visible = "测试一下" in body
        # the expert convo has 3 experts + a ~700-char fusion answer; assert a long run rendered
        long_run = bool(re.search(r"[^\n]{200,}", body))
        results["restore_prompt_visible"] = prompt_visible
        results["restore_long_content"] = long_run
        print(f"[#20 restore] prompt-visible={prompt_visible} long-content-block={long_run}")

        # ---- #19: editable trio ----
        trio_btn = page.locator(TRIO_SEL)
        if trio_btn.count() == 0:
            # not in expert mode — flip it
            for label in ("Expert", "专家"):
                b = page.get_by_role("button", name=label)
                if b.count() > 0:
                    b.first.click(); page.wait_for_timeout(400); break
            trio_btn = page.locator(TRIO_SEL)

        results["trio_button_found"] = trio_btn.count() > 0
        if trio_btn.count() == 0:
            print("[#19 trio] FAILED: trio picker button not found")
        else:
            before = [trio_btn.first.locator("[title]").nth(i).get_attribute("title")
                      for i in range(trio_btn.first.locator("[title]").count())]
            trio_btn.first.click()
            page.wait_for_timeout(500)
            # pick a model NOT already in the trio (demo trio = GPT-5.5/Claude/Qwen)
            target = "DeepSeek V4 Pro"
            row = page.get_by_role("button", name=target)
            picked = row.count() > 0
            if picked:
                row.first.click(); page.wait_for_timeout(300)
            for ap in ("Apply", "应用"):
                ab = page.get_by_role("button", name=ap, exact=True)
                if ab.count() > 0:
                    ab.first.click(); page.wait_for_timeout(900); break
            tb = page.locator(TRIO_SEL).first
            after = [tb.locator("[title]").nth(i).get_attribute("title")
                     for i in range(tb.locator("[title]").count())]
            results["trio_before"] = before
            results["trio_after"] = after
            results["trio_added"] = target in after
            results["trio_changed"] = before != after
            print(f"[#19 trio] before={before}")
            print(f"[#19 trio] picked='{target}' -> after={after}")
            print(f"[#19 trio] added={results['trio_added']} changed={results['trio_changed']}")

        results["console_errors"] = errors
        print(f"[console] errors={len(errors)}")
        for e in errors[:12]:
            print("   " + e)
        browser.close()

    ok = (results.get("restore_prompt_visible") and results.get("restore_long_content")
          and results.get("trio_button_found") and results.get("trio_added")
          and len(errors) == 0)
    print("RESULT:", "PASS" if ok else "REVIEW")


run()
