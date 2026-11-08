# AI Usage Tracker — Hermes desktop plugin

Live **subscription quota** for every AI provider Hermes can route to, inside the Hermes
desktop: a page (sidebar → *AI usage*), a status-bar chip showing the worst remaining
window, and a per-profile picker.

Scope is deliberately narrow: **quota windows only** — provider, plan, window name,
% remaining, reset countdown. No token counting, no cost estimates, no period filters.

## Languages

The desktop UI automatically follows Hermes' `display.language` through the plugin SDK's
`ctx.i18n.register(...)` and `usePluginI18n(...)`. It ships complete bundles for every
language bundled with Hermes:

- English (`en`)
- Russian / Русский (`ru`)
- German / Deutsch (`de`)
- Spanish / Español (`es`)
- French / Français (`fr`)
- Japanese / 日本語 (`ja`)
- Arabic / العربية (`ar`)
- Simplified Chinese / 简体中文 (`zh`)
- Traditional Chinese / 繁體中文 (`zh-hant`)

Sidebar labels, controls, quota windows, reset times, provider details, status text and
common errors are localized. Provider names and technical identifiers stay unchanged.
A language unknown to the plugin falls back to English; switching Hermes' language updates
the page, chip and sidebar without reinstalling the plugin.

| Provider | Live quota endpoint |
| --- | --- |
| `openai-codex` | `chatgpt.com/backend-api/wham/usage` (session + weekly windows) |
| `anthropic` | `api.anthropic.com/api/oauth/usage` (OAuth accounts only) |
| `nous` | portal account (subscription credits + renewal) |
| `openrouter` | `api/v1/credits` + `/key` (balance / key limit) |
| `copilot` | `api.github.com/copilot_internal/user` |
| `opencode-go` | `opencode.ai/zen/go/v1/usage` (rolling / weekly / monthly) |
| `opencode-zen` | credits endpoint (pay-as-you-go) |
| `zai` | `api.z.ai/api/monitor/usage/quota/limit` |
| `kimi-coding` | `api.kimi.com/coding/v1/usages` |
| `minimax` | `api.minimax.io/v1/api/openplatform/coding_plan/remains` |
| `deepseek` | `api.deepseek.com/user/balance` |

Providers with no quota API are listed with an explicit reason instead of a fabricated
bar. Absence-path providers (Grok/SuperGrok, Gemini Code Assist OAuth, Cursor, Kiro) need
browser cookies and are deliberately not attempted.

## Install

```bash
# from the curated catalog (once merged):
hermes plugins install ai-usage-tracker --enable

# install this multilingual fork directly:
hermes plugins install anatolijlaptev1991-ctrl/hermes-ai-usage-tracker --enable
```

Or ship an install link in any README/site:

```html
<a href="hermes://plugin/install?repo=anatolijlaptev1991-ctrl/hermes-ai-usage-tracker&enable=1">Install in Hermes</a>
```

Then enable it **for each profile** you want it in — desktop backends are profile-scoped,
and a plugin enabled only in the default profile 404s on every other:

```bash
for p in forge jewel penny smoke teknium; do
  ln -s ~/.hermes/plugins/ai-usage-tracker ~/.hermes/profiles/$p/plugins/ai-usage-tracker
  hermes --profile $p plugins enable ai-usage-tracker
done
```

Relaunch the desktop app after enabling (backend routes mount at web-server start).

## Profiles

The header picker lists **every profile on this machine** and probes the selected one:
``GET /usage?profile=<name>`` runs the quota probes with that profile's `HERMES_HOME`
and credential scope bound in every worker thread, so API keys, OAuth, `auth.json` and
`.env` resolve for that profile — not the server's own. The chip follows the same
selection, and the choice is persisted plugin-scoped.

Honest limits:

- **Local machine only.** A profile that lives on a *remote* gateway (another machine
  reached over Tailscale/SSH) cannot be read from this backend — the plugin's REST door
  is profile-scoped to the serving machine, and the SDK exposes no cross-gateway route
  to a plugin's own backend.
- Credential lookup uses the profile's own home first and falls back to the server
  process environment (exactly how Hermes itself resolves them for that profile).

## Hiding providers

Each card has a **✕** control. Hidden providers leave the page and are excluded from the
status-bar chip. The header's **`Hidden N`** toggle reveals them dimmed, with **Unhide all**
to reset. The list persists through `ctx.storage`
(`hermes.plugin.ai-usage-tracker.hidden-providers-v1`).

## Layout (one package, both SDKs)

```
ai-usage-tracker/
├── plugin.yaml              # agent half (no tools/hooks — declares nothing by design)
├── __init__.py              # register(ctx) no-op; exists so plugins.enabled can gate it
├── dashboard/
│   ├── manifest.json        # { "name": "ai-usage-tracker", "api": "plugin_api.py" }
│   └── plugin_api.py        # FastAPI router → /api/plugins/ai-usage-tracker/{usage,profiles,health}
└── desktop/
    └── plugin.js            # desktop half; Electron copies it to desktop-plugins/<id>/
```

Endpoints: `GET /usage?profile=<name>&refresh=0|1`, `GET /profiles`, `GET /health`.
Responses are cached in-process for 60s per profile; `refresh=1` bypasses.

## Verification

```bash
# JavaScript syntax + all nine locale bundles, key parity, interpolation and fallbacks
node --input-type=module --check < desktop/plugin.js
node tests/test_i18n.cjs

# Parser regressions (run with Hermes' Python environment; no network or credentials)
python tests/test_backend.py

# Hermes manifest/runtime checks (with hermes on PATH)
hermes plugins validate .
hermes plugins doctor ai-usage-tracker
```

The i18n test asserts the exact Hermes locale set, 110 keys per locale, no accidentally
untranslated English leaves, working interpolation, the Russian regression cases and the
canonical plugin id.

## Privacy

- Read-only. Nothing is written except the plugin's own cache and the two UI prefs.
- Credentials are resolved in-process and **never serialized**; the wire carries
  `configured: true/false` and a source label only.
- The only outbound calls are the provider quota endpoints above.
