# GoldenPixel

An all-in-one image toolkit: edit photos, build collages, compress images and convert files, all privately in your browser. Connect a wallet to swap and bridge USDC and to pay for premium features in USDC.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Photo Editor, Collage Maker, Image Compressor and File Converter. Free, no sign-up, files never leave your device.
- Wallet connection for browser wallets (MetaMask and other EIP-1193 wallets) with address, USDC balance, network and one-click network switching.
- Swap and Bridge workspace powered by Circle App Kit: USDC to EURC swaps on Arc Testnet and USDC bridging between supported testnets, with quotes, fees, minimum received, step-by-step progress, explorer links and recovery for interrupted transfers.
- Pay-per-use premium features paid in USDC with one direct transfer from your wallet (HD export, premium collage templates, Pro batch, ZIP, PDF rendering, Word to PDF, HD upscaling). The payment is verified from onchain data in your browser before the feature unlocks for the session.
- English and Vietnamese interface with an instant EN/VI switcher in the header. English is the default and your choice is remembered. Numbers, file sizes and token amounts follow the selected language, and uploads, settings and in-progress transactions are untouched when you switch.

Arc pays transaction gas in USDC, so the app shows estimated fees and keeps a USDC reserve for gas. Sponsored (gasless) transactions are not configured.

## Network status

Everything currently runs on testnet (Arc Testnet for payments). Arc Mainnet is not enabled yet. See "Going live on Arc Mainnet".

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi and viem, Circle App Kit. No backend and no database: it deploys as a static site.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run dev      # web app on :5173
bun run test     # payment verification, session, translation and conversion-engine tests
bun run check    # lint and typecheck
bun run build    # production build (dist/)
```

### Environment variables

None are required. Everything works out of the box.

| Variable | Purpose |
| --- | --- |
| `VITE_PAYMENT_RECIPIENT` | Optional public override of the receiving wallet. The default lives in `src/config/payments.ts`. |
| `VITE_PAYMENT_RPC_URL` | Optional public Arc RPC URL used to read payments from the chain (defaults to the public RPC in the chain registry). |

Both are public values (they are bundled into the site). Never put a secret in a `VITE_` variable. GoldenPixel needs no private keys, seed phrases or API secrets.

## Payment model

Premium features are paid per use with one direct USDC transfer, no accounts, no credits, no database, no payment backend.

1. The user connects a wallet and picks a premium feature. The configured price is shown on the tool.
2. "Pay with USDC" opens a sheet with the exact price, recipient, network, USDC contract and network fee. The user approves one USDC transfer in their wallet (the wallet must be on the payment network; the sheet offers a switch).
3. The browser reads the transaction back from the Arc RPC and checks: chain id, the official USDC contract, sender equals the connected wallet, recipient equals the configured wallet, amount equals the price exactly, the receipt succeeded, enough confirmations, a matching Transfer event, and that it was mined after the user pressed Pay.
4. Only then is the feature unlocked, for the rest of this browser session. The transaction hash and an explorer link are shown in the payment log. A hash can back one payment record per session, and no hash typed into a box is ever accepted.
5. Stored payments never unlock anything by themselves: after a reload each one is re-verified from the chain, and edited records are discarded.

### What this does NOT guarantee

This is a frontend-only convenience check, not fraud-proof enforcement:

- All premium features run in the user's browser. A technical user can edit the page, skip the check or copy a result. GoldenPixel does not try to block screenshots or downloads.
- Nothing stops one payment being shared between people or sessions: the hash rule applies only inside one session.
- Unlock state lives in the tab (sessionStorage) and disappears when it closes.
- There is no refund, receipt or reconciliation logic. The recipient wallet is the only record of who paid.

Strong enforcement needs server-side processing and a database: a service that creates orders, verifies payments, stores them once, and produces the premium output itself. None of the current premium features needs expensive server processing, so none is disabled, but none can be protected without such a backend either.

### Configure your recipient and prices (one file)

Edit `src/config/payments.ts`: `PAYMENT_RECIPIENT` and the `priceUsdc` of each feature in `PREMIUM_FEATURES` (at most 6 decimals). The network is chosen in `src/config/networks.ts`, which also pins the official Arc USDC address. The shared Arc Studio deployer wallet is refused as a recipient.

### Going live on Arc Mainnet

Mainnet (chain ID 5042) is intentionally **not** enabled in the code yet. Before adding it: test a real payment on Arc Testnet from a funded wallet, get an independent review, confirm the recipient wallet and the official USDC contract against the Arc docs (contract `0x3600000000000000000000000000000000000000`, 6 decimals in the ERC-20 view; Arc also emits an 18-decimal system log for the same transfer, which the checker ignores), and review the new network entry. Mainnet payments are real and irreversible.

## Translations

All user-facing text lives in `src/i18n/en.ts` (source of truth) and `src/i18n/vi.ts`. The Vietnamese file is type-checked against the English one, so a missing key fails `bun run check`. To add text: add the key to both files, then use `t('your.key')` from `useI18n()`. Never translate addresses, token symbols, transaction hashes, file extensions or chain names. Use `td()` for keys built at runtime (credit packs and operations). To add a language, add a dictionary, register it in `src/i18n/index.tsx`, and add it to the switcher.

## Free and Premium

Everything runs in your browser, and no wallet is needed for free tools.

| | Free | Premium (paid per use) |
| --- | --- | --- |
| Photo Editor | All adjustments, crop, rotate, resize. Standard export up to 2048 px | High-resolution export up to the original size |
| Collage Maker | 4 templates, export up to 1600 px | 4 advanced templates, exports up to 2400 px |
| Compress and Convert | Up to 5 files of 15 MB each, download one by one | Pro batch: up to 50 files of 40 MB each, ZIP included. ZIP of a small set is also available on its own |
| HD upscaling | - | 2x or 4x |

Limits and prices are set in one place: `src/config/plans.ts` (limits) and `src/config/payments.ts` (recipient, feature prices).

Premium honesty: see "Payment model" above. The check is frontend-only and can be bypassed by a technical user; GoldenPixel does not try to block screenshots.

## File Converter

All conversions run in your browser. Nothing is uploaded.

| Conversion | Status | Cost |
| --- | --- | --- |
| JPG, PNG, WebP between each other (transparency kept where the format allows) | Ready | Free |
| Images to PDF, merge PDFs, split by page range, organize pages (extract, reorder, rotate, remove) | Ready | Free |
| PDF text extraction, Word to text, text to Word | Ready | Free |
| Excel (.xlsx) to CSV, CSV to Excel | Ready | Free |
| PDF lossless optimization | Ready | Free |
| PDF pages to JPG or PNG | Ready | 0.10 USDC per feature (see `src/config/payments.ts`) |
| Strong PDF compression (re-renders pages as images) | Ready | 0.10 USDC per use |
| Word (.docx) to PDF | Basic engine: text, headings, bold, bullets, simple tables. No images, columns, headers, footers or custom fonts | 0.10 USDC per feature (see `src/config/payments.ts`) |
| PDF to Word (`.docx`) | Basic engine. Rebuilds paragraphs, headings, lists, simple tables, columns, images and page sizes of text-based PDFs. Layout, fonts and forms are approximate | Free |
| Scanned PDF to Word (OCR) | Optional, off by default. Recognizes English and Vietnamese in the browser. The first use downloads the OCR engine and language data (several MB) from a public CDN; the PDF is never uploaded. Accuracy depends on scan quality, so proofread | Free |
| Audio to Text (MP3, WAV, M4A, WEBM) | Ready. Runs an open-source Whisper speech model in the browser (Transformers.js, WebGPU when available, otherwise CPU). English and Vietnamese. No API key, server or account. The first use downloads the model (41, 77 or 249 MB for the Fast, Balanced and Accurate options) from the Hugging Face Hub and the engine runtime from the jsDelivr CDN, then the browser caches them. Audio is never uploaded | Free up to 5 minutes; 5 to 30 minutes is a paid unlock for the session |
| PowerPoint to PDF, old .doc/.xls/.ppt | Not supported. They need a server conversion engine, and GoldenPixel says so instead of faking a result | - |

PDF to Word limits: up to 100 pages per file, no encrypted files, no vertical or angled text, italics are not carried over, tables are detected only when cells are single aligned lines, and nested tables or forms are not rebuilt. Without OCR a fully scanned PDF is refused (never an empty Word file); in a mixed PDF the scanned pages are kept as pictures with a warning.

Prices live in `src/config/payments.ts`; free limits in `src/config/plans.ts`.


### Audio to Text notes

- Accuracy depends on the model and the recording. Fast and Balanced make clearly more mistakes in Vietnamese; use Accurate for Vietnamese. Noisy or heavily accented audio is harder, and the transcript should be proofread.
- CPU mode runs single-threaded and is about real time or slower; WebGPU is much faster. The GPU download is larger (120 or 206 MB) because it uses different weights.
- Recordings are cut into windows of up to 30 seconds at quiet moments. Silent windows are never sent to the model. Maximum length is 30 minutes and 120 MB.
- The first download needs an internet connection; after that the model comes from the browser cache. Clearing site data removes it.
- Decoding uses the browser's own decoder, so which formats work depends on the browser (M4A/AAC is not available in every Chromium build).
- The speech runtime is loaded from a pinned jsDelivr URL instead of being bundled, which keeps the deployment small.
