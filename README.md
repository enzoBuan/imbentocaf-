# Imbento Café POS

Point-of-sale for Imbento Café, preloaded with the full menu and the café's logo and contact details on receipts. Static site, no build step, no dependencies.

## Features

- **Register**: category chips, search, tap-to-add, quantity controls, percent or amount discount, cash / card / e-wallet payment with change calculation, printable receipt
- **Orders**: browse orders by day, reopen receipts, void orders
- **Reports**: sales, order count, average order, discounts, tax, payment-method split, top items; date ranges; CSV export
- **Menu**: add, edit, delete items; mark items sold out
- **Settings**: shop name, phone, email, address, currency symbol, tax rate (inclusive or added on top), receipt footer; JSON backup, restore and erase
- Works on tablet, phone and desktop; light and dark themes

Logo files: `logo-black.png` (receipt), `logo-white.png` (header), `favicon.png`. Replace them to rebrand.

Money is stored as integer centavos, so totals never drift. Data is saved in the browser's localStorage on the device being used.

## Deploy to Vercel

```bash
npm i -g vercel      # once
cd cafe-pos
vercel login         # once
vercel --prod
```

Or push this folder to GitHub and import it at https://vercel.com/new. Framework preset: **Other**. No build command, no output directory.

## Run locally

```bash
npx serve .
```

## Notes

- Data is per browser and per device. Use **Settings → Export backup** regularly, and to move data to another device.
- Clearing browser data erases orders. Back up before doing so.
