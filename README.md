# Imbento Café POS

Point-of-sale for Imbento Café, preloaded with the full menu and the café's logo and contact details on receipts. Static site, no build step, no dependencies.

## Features

- **Register**: category chips, search, tap-to-add, quantity controls, percent or amount discount, cash / card / e-wallet payment with change calculation, printable receipt
- **Shift**: open a shift with the cashier name and starting cash, paid in / paid out (cash management), live cash drawer and sales summary, close with a cash count (shows over / short), printable shift report, past shifts. Selling requires an open shift
- **Orders**: browse orders by day, reopen receipts, void orders
- **Printer**: status pill in the top bar (ready / not connected / error), connect a USB, Bluetooth (BLE) or serial thermal printer, test print, paper width 58 / 76 / 80 mm, optional auto-print after each sale. Falls back to the system print dialog when no printer is connected
- **Reports**: sales, order count, average order, discounts, tax, payment-method split, top items; date ranges; CSV export
- **Menu**: add, edit, delete items; mark items sold out
- **Settings**: shop name, phone, email, address, currency symbol, tax rate (inclusive or added on top), receipt footer; JSON backup, restore and erase
- Works on tablet, phone and desktop; light and dark themes

Logo files: `logo-black.png` (receipt), `logo-white.png` (header), `favicon.png`. Replace them to rebrand.

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
- Thermal output is plain ESC/POS text (no logo image). The on-screen / system-dialog receipt still shows the logo.

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
