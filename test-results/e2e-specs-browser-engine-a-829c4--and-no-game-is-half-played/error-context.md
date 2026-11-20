# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/specs/browser-engine-app.spec.ts >> the real app on the browser engine >> when the engine can't be downloaded the app says so and stops; Retry carries on, and no game is half-played
- Location: e2e/specs/browser-engine-app.spec.ts:113:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```