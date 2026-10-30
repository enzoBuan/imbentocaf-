# Imbento Café POS

Point-of-sale for Imbento Café, preloaded with the full menu and the café's logo and contact details on receipts. Static site, no build step, no dependencies.

## Features

- **Register**: category chips, search, tap-to-add, quantity controls, Dine in / Take out, percent or amount discount, cash / card / e-wallet payment with an on-screen number pad and quick cash amounts, change calculation, printable receipt
- **Shift**: open a shift with the cashier name and starting cash, paid in / paid out (cash management), live cash drawer and sales summary, close with a cash count (shows over / short), printable shift report, past shifts. Selling requires an open shift
- **Orders**: browse orders by day, reopen receipts, void orders
- **Printer**: status pill in the top bar (ready / not connected / error), connect a USB, Bluetooth (BLE) or serial thermal printer, test print, paper width 58 / 76 / 80 mm, optional auto-print after each sale. Falls back to the system print dialog when no printer is connected
- **Reports**: sales, order count, average order, discounts, tax, payment-method split, top items; date ranges; CSV export
- **Menu**: add, edit, delete items; mark items sold out
- **Settings**: shop name, phone, email, address, currency symbol, tax rate (inclusive or added on top), receipt footer; JSON backup, restore and erase
- Built for Android tablets (landscape and portrait): large touch targets, menu and order scroll separately, no on-screen keyboard needed to take payment, installable as an app, keeps opening offline. Also works on phone and desktop; light and dark themes

Logo files: `logo-black.png` (receipt), `logo-white.png` (header), `favicon.png`, `icon-*.png` (home-screen icons). Replace them to rebrand.

## Receipt

The receipt follows the café's printed receipt: logo, shop name, phone, email, address, **Employee** (the cashier of the open shift), **POS** number, **Dine in / Take out**, items (with `qty x price` under any item bought more than once), **Total**, cash received and change, and the thank-you line. Order number and date sit in small print at the bottom. Subtotal / discount / tax lines only appear when they apply.

- Set the POS number, footer and contact details in **Settings → Receipt**.
- The tax rate now defaults to 0 so totals match the printed receipt. If you want a tax line, set the rate in Settings.
- Orders made before this update keep their original details; lines that did not exist then (employee, POS, order type) are simply left out.

Money is stored as integer centavos, so totals never drift. Data is saved in the browser's localStorage on the device being used.

## Shifts

- **Expected cash** = starting cash + cash payments − cash refunds + paid in − paid out.
- Closing a shift stores a snapshot of its totals, so past reports never change.
- Voiding an order sold in the *same* shift removes it from that shift. Voiding an order from an *earlier* shift needs a shift open and is counted as a refund (cash refund if it was paid in cash) in the current shift.
- Orders made before this update have no shift and simply don't appear in any shift report.

## Printer

The browser cannot list the printers installed on a device, so "ready" means a printer is **connected and its channel is open**. Tap the printer pill → pick USB, Bluetooth or Serial → choose the printer. It reconnects automatically next time when the browser remembers the permission.

- Needs Chrome or Edge over HTTPS (Vercel provides it). USB and Bluetooth work on Android; Serial works on desktop.
- Bluetooth means BLE. Printers that only do *classic* Bluetooth cannot be reached from a web page: pair them to the device and use Print (system print dialog), or use a USB printer.
- Printers rarely report paper-out or cover-open to a web page. Use **Test print** to confirm.
- Thermal output uses the same layout as the screen receipt, including the logo as a bitmap (it is skipped automatically if the browser cannot prepare it).

## Install on an Android tablet

1. Open the site in **Chrome** on the tablet.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Open it from the home screen: it runs full screen with no browser bar and works in any orientation.

Tips: set the tablet's screen timeout to "never" while it is charging, and turn on **Settings → Display → Screen pinning** if you want to stop staff leaving the app.

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
