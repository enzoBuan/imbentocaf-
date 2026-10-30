(function () {
  'use strict';

  /* =====================================================================
   * Café POS — single-file vanilla JS app. Data lives in localStorage.
   * All money is stored as integer centavos to avoid floating point drift.
   * ===================================================================== */

  var STORE_KEY = 'cafepos.v1';
  var METHODS = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet' };
  var MAX_QTY = 99;
  var MAX_PRICE = 100000000; // 1,000,000.00

  var DEFAULT_SETTINGS = {
    shopName: 'Imbento Café',
    currency: '₱',
    taxRate: 12,
    taxInclusive: true,
    phone: '09979839936',
    email: 'imbentocafe@gmail.com',
    address: 'Suclayin Purok 6, Arayat, Pampanga',
    footer: 'Thank you! Brew. Create. Inspire.',
    paperWidth: 32,      // printer characters per line: 32 (58 mm), 42 (76 mm), 48 (80 mm)
    autoPrint: false,    // send receipts to a connected printer right after each sale
    lastCashier: '',
    lastStartCash: 0     // centavos, pre-fills the next "Open shift"
  };
  var PRINTER_KEY = 'cafepos.printer';

  // Imbento Café menu. Coffee has separate Hot and Iced (16 oz) prices.
  var COFFEE = [
    ['Americano', 65, 75], ['Café Latte', 85, 105], ['French Vanilla Latte', 95, 115],
    ['Caramel Macchiato', 95, 115], ['White Mocha', 95, 115], ['Hazelnut Latte', 95, 115],
    ['Salted Caramel', 95, 115], ['Spanish Latte', 95, 115], ['Mocha Latte', 95, 115]
  ];
  var OTHER = [
    ['Non-Coffee', [
      ['Biscoff with White Chocolate', 170], ['Biscoff with Pistachio', 175], ['Matcha Latte', 150],
      ['Matcha Ube Latte', 155], ['Matcha Strawberry', 155], ['Ube Strawberry', 145],
      ['Cookies and Cream', 145], ['Strawberry Milk', 80], ['Blueberry Milk', 80],
      ['Lemon Iced Tea', 75], ['Moringa Citrus / Calamansi', 75], ['Hot Choco', 65]
    ]],
    ['Hot Tea', [
      ['Green Tea Jasmine', 60], ['Black Tea Forest Fruit', 60], ['Peppermint Herbal Tea', 60],
      ['Matcha Green Tea Packet', 90], ['Matcha Green Tea Traditional', 60]
    ]],
    ['Soda Base', [['Blueberry Soda', 75], ['Strawberry Soda', 75]]],
    ['Rice Bowl', [
      ['Chicken Katsu with Barbecue Sauce', 165], ['Chicken Poppers with Kewpie Japanese Sauce', 165],
      ['Chicken Lollipop', 165]
    ]],
    ['Pasta', [['Carbonara', 175], ['Charlie Chan Pasta', 185], ['Lasagna', 199]]],
    ['Chicken Macaroni', [['Chicken Macaroni', 80]]],
    ['Nachos', [['Nachos', 175]]],
    ['Pastries', [
      ['Biscoff Cookies', 85], ['Chocolate Chip Cookies', 70], ['Walnut and Sea Salt Cookies', 70],
      ['Blueberry Muffin', 99], ['Choco Chip Muffin', 99], ['Chocolate Chip Muffin', 99],
      ['Double Chocolate Chip Muffin', 99],
      ['Banana Waffle with Vanilla Ice Cream and Banana Chips', 150]
    ]],
    ['Add-Ons', [['Bread and Butter Pickles', 25], ['Jalapeño', 25]]]
  ];

  var DEFAULT_MENU = (function () {
    var rows = [];
    COFFEE.forEach(function (c) { rows.push([c[0] + ' (Hot)', 'Hot Coffee', c[1]]); });
    COFFEE.forEach(function (c) { rows.push([c[0] + ' (Iced)', 'Iced Coffee', c[2]]); });
    OTHER.forEach(function (g) { g[1].forEach(function (i) { rows.push([i[0], g[0], i[1]]); }); });
    return rows.map(function (r, i) {
      return { id: 'd' + (i + 1), name: r[0], category: r[1], price: r[2] * 100, available: true };
    });
  })();

  /* ---------------------------- helpers ---------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  function dayKey(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  function toCents(v) {
    var n = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function fmt(c) {
    var sign = c < 0 ? '-' : '';
    var v = Math.abs(c) / 100;
    return sign + state.settings.currency + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function orderNo(n) { return '#' + pad(n, 4); }

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  /* ----------------------------- state ----------------------------- */

  function freshState() {
    return {
      menu: DEFAULT_MENU.map(function (m) { return Object.assign({}, m); }),
      orders: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      cart: [],
      discount: { type: 'pct', value: 0 },
      nextNo: 1,
      shifts: [],
      currentShiftId: null,
      nextShiftNo: 1
    };
  }

  function cleanMenuItem(m) {
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.category !== 'string') return null;
    if (!isFinite(m.price) || m.price < 0) return null;
    return {
      id: m.id,
      name: m.name.slice(0, 60),
      category: m.category.slice(0, 24) || 'General',
      price: Math.round(m.price),
      available: m.available !== false
    };
  }

  function cleanOrder(o) {
    if (!o || typeof o.id !== 'string' || !Array.isArray(o.lines) || typeof o.ts !== 'string') return null;
    if (isNaN(Date.parse(o.ts)) || !isFinite(o.total)) return null;
    var lines = [];
    for (var i = 0; i < o.lines.length; i++) {
      var l = o.lines[i];
      if (!l || typeof l.name !== 'string' || !isFinite(l.price) || !Number.isInteger(l.qty) || l.qty < 1) return null;
      lines.push({ id: typeof l.id === 'string' ? l.id : '', name: l.name, price: Math.round(l.price), qty: l.qty });
    }
    return {
      id: o.id,
      no: Number.isInteger(o.no) && o.no > 0 ? o.no : 0,
      ts: o.ts,
      lines: lines,
      subtotal: Math.round(num(o.subtotal, 0)),
      discount: Math.round(num(o.discount, 0)),
      discLabel: typeof o.discLabel === 'string' ? o.discLabel : 'Discount',
      tax: Math.round(num(o.tax, 0)),
      taxRate: num(o.taxRate, 0),
      taxInclusive: o.taxInclusive !== false,
      total: Math.round(o.total),
      method: METHODS[o.method] ? o.method : 'cash',
      tendered: Math.round(num(o.tendered, o.total)),
      change: Math.round(num(o.change, 0)),
      status: o.status === 'void' ? 'void' : 'paid',
      shiftId: typeof o.shiftId === 'string' ? o.shiftId : '',
      voidShiftId: typeof o.voidShiftId === 'string' ? o.voidShiftId : '',
      voidedAt: typeof o.voidedAt === 'string' ? o.voidedAt : '',
      shop: typeof o.shop === 'string' ? o.shop : '',
      phone: typeof o.phone === 'string' ? o.phone : '',
      email: typeof o.email === 'string' ? o.email : '',
      address: typeof o.address === 'string' ? o.address : '',
      footer: typeof o.footer === 'string' ? o.footer : ''
    };
  }

  var SUMMARY_KEYS = ['gross', 'refunds', 'discounts', 'net', 'tax', 'collected', 'orders', 'voided',
    'cashPayments', 'cashRefunds', 'paidIn', 'paidOut', 'expected'];

  function cleanSummary(s) {
    if (!s || typeof s !== 'object') return null;
    var out = {};
    SUMMARY_KEYS.forEach(function (k) { out[k] = Math.round(num(s[k], 0)); });
    out.taxInclusive = s.taxInclusive !== false;
    var m = s.methods && typeof s.methods === 'object' ? s.methods : {};
    out.methods = { cash: Math.round(num(m.cash, 0)), card: Math.round(num(m.card, 0)), ewallet: Math.round(num(m.ewallet, 0)) };
    return out;
  }

  function cleanShift(s) {
    if (!s || typeof s.id !== 'string' || typeof s.openedAt !== 'string' || isNaN(Date.parse(s.openedAt))) return null;
    var closedAt = typeof s.closedAt === 'string' && !isNaN(Date.parse(s.closedAt)) ? s.closedAt : null;
    var moves = Array.isArray(s.movements) ? s.movements.map(function (m) {
      if (!m || (m.type !== 'in' && m.type !== 'out') || !isFinite(m.amount) || m.amount <= 0) return null;
      return {
        id: typeof m.id === 'string' ? m.id : uid('m'),
        type: m.type,
        amount: Math.round(m.amount),
        note: typeof m.note === 'string' ? m.note.slice(0, 40) : '',
        ts: typeof m.ts === 'string' ? m.ts : s.openedAt
      };
    }).filter(Boolean) : [];
    return {
      id: s.id,
      no: Number.isInteger(s.no) && s.no > 0 ? s.no : 0,
      openedBy: String(s.openedBy == null ? '' : s.openedBy).slice(0, 30),
      openedAt: s.openedAt,
      startingCash: Math.max(Math.round(num(s.startingCash, 0)), 0),
      closedAt: closedAt,
      closedBy: String(s.closedBy == null ? '' : s.closedBy).slice(0, 30),
      countedCash: closedAt ? Math.round(num(s.countedCash, 0)) : null,
      difference: closedAt ? Math.round(num(s.difference, 0)) : null,
      movements: moves,
      summary: closedAt ? cleanSummary(s.summary) : null
    };
  }

  function normalize(s) {
    var f = freshState();
    if (!s || typeof s !== 'object') return f;
    var menu = Array.isArray(s.menu) ? s.menu.map(cleanMenuItem).filter(Boolean) : f.menu;
    var orders = Array.isArray(s.orders) ? s.orders.map(cleanOrder).filter(Boolean) : [];
    var st = Object.assign({}, f.settings, s.settings && typeof s.settings === 'object' ? s.settings : {});
    st.shopName = String(st.shopName || f.settings.shopName).slice(0, 40);
    st.currency = String(st.currency || f.settings.currency).slice(0, 3);
    st.taxRate = Math.min(Math.max(num(st.taxRate, 0), 0), 100);
    st.taxInclusive = st.taxInclusive !== false;
    st.footer = String(st.footer == null ? '' : st.footer).slice(0, 80);
    st.phone = String(st.phone == null ? '' : st.phone).slice(0, 30);
    st.email = String(st.email == null ? '' : st.email).slice(0, 60);
    st.address = String(st.address == null ? '' : st.address).slice(0, 100);
    st.paperWidth = [32, 42, 48].indexOf(Number(st.paperWidth)) >= 0 ? Number(st.paperWidth) : 32;
    st.autoPrint = st.autoPrint === true;
    st.lastCashier = String(st.lastCashier == null ? '' : st.lastCashier).slice(0, 30);
    st.lastStartCash = Math.max(Math.round(num(st.lastStartCash, 0)), 0);
    var ids = {};
    menu.forEach(function (m) { ids[m.id] = true; });
    var cart = [];
    if (Array.isArray(s.cart)) {
      s.cart.forEach(function (c) {
        if (c && ids[c.id] && Number.isInteger(c.qty) && c.qty > 0) cart.push({ id: c.id, qty: Math.min(c.qty, MAX_QTY) });
      });
    }
    var d = s.discount && typeof s.discount === 'object' ? s.discount : f.discount;
    var dtype = d.type === 'amt' ? 'amt' : 'pct';
    var dval = Math.max(num(d.value, 0), 0);
    if (dtype === 'pct') dval = Math.min(dval, 100); else dval = Math.round(dval);
    var maxNo = orders.reduce(function (a, o) { return Math.max(a, o.no); }, 0);
    var nextNo = Number.isInteger(s.nextNo) && s.nextNo > 0 ? s.nextNo : 1;
    var shifts = Array.isArray(s.shifts) ? s.shifts.map(cleanShift).filter(Boolean) : [];
    var openShifts = shifts.filter(function (x) { return !x.closedAt; });
    var curId = null;
    openShifts.forEach(function (x) { if (x.id === s.currentShiftId) curId = x.id; });
    if (!curId && openShifts.length) curId = openShifts[0].id;
    var maxShift = shifts.reduce(function (a, x) { return Math.max(a, x.no); }, 0);
    var nextShiftNo = Number.isInteger(s.nextShiftNo) && s.nextShiftNo > 0 ? s.nextShiftNo : 1;
    return {
      menu: menu, orders: orders, settings: st, cart: cart,
      discount: { type: dtype, value: dval },
      nextNo: Math.max(nextNo, maxNo + 1),
      shifts: shifts,
      currentShiftId: curId,
      nextShiftNo: Math.max(nextShiftNo, maxShift + 1)
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall through to fresh state */ }
    return freshState();
  }

  var state = load();
  var ui = { tab: 'register', cat: 'All', q: '', ordersDate: dayKey(new Date()), repFrom: dayKey(new Date()), repTo: dayKey(new Date()) };
  var pay = null; // active payment session

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('Could not save. Storage may be full or blocked. Export a backup.');
      return false;
    }
  }

  /* ---------------------------- calculations ---------------------------- */

  function calc(lines, disc, st) {
    var subtotal = lines.reduce(function (a, l) { return a + l.price * l.qty; }, 0);
    var d;
    if (disc.type === 'pct') d = Math.round(subtotal * Math.min(Math.max(disc.value, 0), 100) / 100);
    else d = Math.min(Math.max(Math.round(disc.value), 0), subtotal);
    var net = subtotal - d;
    var r = Math.max(st.taxRate, 0) / 100;
    var tax, total;
    if (st.taxInclusive) { tax = Math.round(net - net / (1 + r)); total = net; }
    else { tax = Math.round(net * r); total = net + tax; }
    return { subtotal: subtotal, discount: d, tax: tax, total: total };
  }

  function menuById(id) {
    for (var i = 0; i < state.menu.length; i++) if (state.menu[i].id === id) return state.menu[i];
    return null;
  }

  function cartLines() {
    return state.cart.map(function (c) {
      var m = menuById(c.id);
      return m ? { id: m.id, name: m.name, price: m.price, qty: c.qty } : null;
    }).filter(Boolean);
  }

  function categories() {
    var seen = {}, out = [];
    state.menu.forEach(function (m) { if (!seen[m.category]) { seen[m.category] = true; out.push(m.category); } });
    return out;
  }

  /* ---------------------------- UI plumbing ---------------------------- */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function openModal(inner) {
    $('#modal').innerHTML = '<div class="backdrop" data-action="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">' + inner + '</div></div>';
    var first = $('#modal input:not([type=hidden]), #modal button');
    if (first) first.focus();
  }

  function closeModal() {
    $('#modal').innerHTML = '';
    pay = null;
  }

  function modalOpen() { return $('#modal').firstChild !== null; }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ------------------------------ shell ------------------------------ */

  function renderShell() {
    $('#shopName').textContent = state.settings.shopName;
    document.title = state.settings.shopName;
    var btns = document.querySelectorAll('#nav button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.tab === ui.tab;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-current', on ? 'page' : 'false');
    }
    renderPills();
  }

  function render() {
    renderShell();
    var views = { register: viewRegister, orders: viewOrders, shift: viewShift, reports: viewReports, menu: viewMenu, settings: viewSettings };
    (views[ui.tab] || viewRegister)();
  }

  function setTab(tab) {
    ui.tab = tab;
    render();
    window.scrollTo(0, 0);
  }

  function tickClock() {
    var el = $('#clock');
    if (el) el.textContent = fmtDateTime(new Date());
  }

  /* ------------------------------ register ------------------------------ */

  function discInputValue() {
    var d = state.discount;
    if (!d.value) return '';
    return d.type === 'pct' ? String(d.value) : (d.value / 100).toFixed(2);
  }

  function viewRegister() {
    $('#view').innerHTML =
      '<section class="register">' +
        '<div class="catalog">' +
          '<div class="toolbar">' +
            '<input id="search" type="search" placeholder="Search menu…" aria-label="Search menu" data-input="search" autocomplete="off">' +
            '<div id="chips" class="chips"></div>' +
          '</div>' +
          '<div id="grid" class="grid"></div>' +
        '</div>' +
        '<aside class="cart card" id="cart" aria-label="Current order">' +
          '<div class="cart-head"><h2>Current order</h2><button type="button" class="link" data-action="clear-cart">Clear</button></div>' +
          '<div id="cartLines" class="lines"></div>' +
          '<div class="discount">' +
            '<label for="discVal">Discount</label>' +
            '<input id="discVal" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" data-input="disc-val">' +
            '<select id="discType" aria-label="Discount type" data-input="disc-type"><option value="pct">Percent %</option><option value="amt">Amount</option></select>' +
          '</div>' +
          '<div id="totals" class="totals"></div>' +
          '<button type="button" id="chargeBtn" class="btn primary big" data-action="charge">Charge</button>' +
        '</aside>' +
      '</section>' +
      '<button type="button" id="mobileBar" class="mobile-bar" data-action="goto-cart" hidden></button>';
    $('#discType').value = state.discount.type;
    $('#discVal').value = discInputValue();
    $('#search').value = ui.q;
    updateRegister();
  }

  function updateRegister() {
    renderChips();
    renderGrid();
    renderCart();
  }

  function renderChips() {
    var cats = ['All'].concat(categories());
    if (cats.indexOf(ui.cat) === -1) ui.cat = 'All';
    $('#chips').innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip' + (c === ui.cat ? ' active' : '') + '" data-action="cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
  }

  function renderGrid() {
    var q = ui.q.trim().toLowerCase();
    var qtyById = {};
    state.cart.forEach(function (c) { qtyById[c.id] = c.qty; });
    var items = state.menu.filter(function (m) {
      return (ui.cat === 'All' || m.category === ui.cat) && (!q || m.name.toLowerCase().indexOf(q) !== -1);
    });
    if (!state.menu.length) {
      $('#grid').innerHTML = '<div class="empty card">Your menu is empty. Add items in the Menu tab.</div>';
      return;
    }
    if (!items.length) {
      $('#grid').innerHTML = '<div class="empty card">No items match.</div>';
      return;
    }
    $('#grid').innerHTML = items.map(function (m) {
      var inCart = qtyById[m.id];
      return '<button type="button" class="product' + (m.available ? '' : ' soldout') + '" data-action="add" data-id="' + esc(m.id) + '"' + (m.available ? '' : ' disabled') + '>' +
        (inCart ? '<span class="qty-badge">' + inCart + '</span>' : '') +
        '<span><span class="pname">' + esc(m.name) + '</span><br><span class="pcat">' + esc(m.category) + (m.available ? '' : ' · Sold out') + '</span></span>' +
        '<span class="pprice">' + fmt(m.price) + '</span>' +
      '</button>';
    }).join('');
  }

  function renderCart() {
    var lines = cartLines();
    // drop cart entries whose menu item no longer exists
    if (lines.length !== state.cart.length) {
      state.cart = state.cart.filter(function (c) { return menuById(c.id); });
      save();
    }
    var box = $('#cartLines');
    if (!lines.length) {
      box.innerHTML = '<div class="empty">Tap an item to start an order.</div>';
    } else {
      box.innerHTML = lines.map(function (l) {
        return '<div class="line">' +
          '<div><div class="lname">' + esc(l.name) + '</div><div class="lsub">' + fmt(l.price) + ' each</div></div>' +
          '<div class="ltotal">' + fmt(l.price * l.qty) + '</div>' +
          '<div class="qty">' +
            '<button type="button" data-action="dec" data-id="' + esc(l.id) + '" aria-label="Decrease quantity of ' + esc(l.name) + '">−</button>' +
            '<span>' + l.qty + '</span>' +
            '<button type="button" data-action="inc" data-id="' + esc(l.id) + '" aria-label="Increase quantity of ' + esc(l.name) + '">+</button>' +
          '</div>' +
          '<div class="right"><button type="button" class="rm" data-action="rm" data-id="' + esc(l.id) + '" aria-label="Remove ' + esc(l.name) + '">✕</button></div>' +
        '</div>';
      }).join('');
    }
    renderTotals(lines);
    renderGridBadgesOnly();
  }

  function renderGridBadgesOnly() {
    // refresh product cards so quantity badges stay current
    if ($('#grid')) renderGrid();
  }

  function renderTotals(lines) {
    lines = lines || cartLines();
    var t = calc(lines, state.discount, state.settings);
    var st = state.settings;
    var taxLabel = 'Tax ' + st.taxRate + '%' + (st.taxInclusive ? ' (included)' : '');
    $('#totals').innerHTML =
      '<div class="row"><span>Subtotal</span><span>' + fmt(t.subtotal) + '</span></div>' +
      (t.discount > 0 ? '<div class="row"><span>Discount</span><span>-' + fmt(t.discount) + '</span></div>' : '') +
      (st.taxRate > 0 ? '<div class="row muted small"><span>' + esc(taxLabel) + '</span><span>' + fmt(t.tax) + '</span></div>' : '') +
      '<div class="row grand"><span>Total</span><span>' + fmt(t.total) + '</span></div>';
    var btn = $('#chargeBtn');
    var shiftOpen = !!currentShift();
    btn.disabled = shiftOpen && !lines.length;
    btn.textContent = !shiftOpen ? 'Open shift to start selling' : (lines.length ? 'Charge ' + fmt(t.total) : 'Charge');
    var count = lines.reduce(function (a, l) { return a + l.qty; }, 0);
    var bar = $('#mobileBar');
    if (bar) {
      bar.hidden = !lines.length;
      bar.innerHTML = '<span>View order (' + count + ')</span><span>' + fmt(t.total) + '</span>';
    }
  }

  function addToCart(id) {
    var m = menuById(id);
    if (!m || !m.available) return;
    var line = state.cart.filter(function (c) { return c.id === id; })[0];
    if (line) {
      if (line.qty >= MAX_QTY) { toast('Maximum quantity reached'); return; }
      line.qty++;
    } else {
      state.cart.push({ id: id, qty: 1 });
    }
    save();
    updateRegister();
  }

  function changeQty(id, delta) {
    var idx = -1;
    for (var i = 0; i < state.cart.length; i++) if (state.cart[i].id === id) idx = i;
    if (idx < 0) return;
    var q = state.cart[idx].qty + delta;
    if (q <= 0) state.cart.splice(idx, 1);
    else state.cart[idx].qty = Math.min(q, MAX_QTY);
    save();
    updateRegister();
  }

  function resetOrderDraft() {
    state.cart = [];
    state.discount = { type: 'pct', value: 0 };
  }

  /* ------------------------------ payment ------------------------------ */

  function openPayment() {
    if (!currentShift()) { toast('Open a shift before taking payment'); openShiftModal(); return; }
    var lines = cartLines();
    if (!lines.length) { toast('Add an item first'); return; }
    var t = calc(lines, state.discount, state.settings);
    pay = { method: 'cash', tendered: 0, totals: t, lines: lines, disc: { type: state.discount.type, value: state.discount.value } };
    var quicks = [50, 100, 200, 500, 1000, 2000].filter(function (v) { return v * 100 >= t.total; }).slice(0, 3);
    openModal(
      '<h2>Payment</h2>' +
      '<div class="due"><span>Amount due</span><strong>' + fmt(t.total) + '</strong></div>' +
      '<div class="seg" id="payMethods">' +
        Object.keys(METHODS).map(function (k) {
          return '<button type="button" data-action="pay-method" data-method="' + k + '">' + METHODS[k] + '</button>';
        }).join('') +
      '</div>' +
      '<div id="cashBox" class="stack">' +
        '<label class="field">Cash received<input id="tendered" type="number" min="0" step="0.01" inputmode="decimal" data-input="tendered" placeholder="0.00"></label>' +
        '<div class="quick">' +
          '<button type="button" class="btn sm" data-action="pay-quick" data-cents="' + t.total + '">Exact</button>' +
          quicks.map(function (v) { return '<button type="button" class="btn sm" data-action="pay-quick" data-cents="' + (v * 100) + '">' + fmt(v * 100) + '</button>'; }).join('') +
        '</div>' +
        '<div class="change"><span>Change</span><span id="changeOut">' + fmt(0) + '</span></div>' +
      '</div>' +
      '<div class="actions"><button type="button" class="btn" data-action="close-modal">Cancel</button>' +
      '<button type="button" id="confirmPay" class="btn primary" data-action="pay-confirm">Complete sale</button></div>'
    );
    updatePayUI();
  }

  function updatePayUI() {
    if (!pay) return;
    var btns = document.querySelectorAll('#payMethods button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].dataset.method === pay.method);
    var isCash = pay.method === 'cash';
    $('#cashBox').hidden = !isCash;
    var change = Math.max(pay.tendered - pay.totals.total, 0);
    $('#changeOut').textContent = fmt(change);
    $('#confirmPay').disabled = isCash && pay.tendered < pay.totals.total;
  }

  function completeSale() {
    if (!pay) return;
    var t = pay.totals;
    var isCash = pay.method === 'cash';
    if (isCash && pay.tendered < t.total) return;
    var sh = currentShift();
    if (!sh) { closeModal(); toast('No open shift. Open a shift first.'); openShiftModal(); return; }
    var st = state.settings;
    var order = {
      id: uid('o'),
      no: state.nextNo,
      ts: new Date().toISOString(),
      lines: pay.lines.map(function (l) { return { id: l.id, name: l.name, price: l.price, qty: l.qty }; }),
      subtotal: t.subtotal,
      discount: t.discount,
      discLabel: pay.disc.type === 'pct' ? 'Discount (' + pay.disc.value + '%)' : 'Discount',
      tax: t.tax,
      taxRate: st.taxRate,
      taxInclusive: st.taxInclusive,
      total: t.total,
      method: pay.method,
      tendered: isCash ? pay.tendered : t.total,
      change: isCash ? pay.tendered - t.total : 0,
      status: 'paid',
      shiftId: sh.id,
      voidShiftId: '',
      voidedAt: '',
      shop: st.shopName,
      phone: st.phone,
      email: st.email,
      address: st.address,
      footer: st.footer
    };
    state.orders.unshift(order);
    state.nextNo++;
    resetOrderDraft();
    var ok = save();
    pay = null;
    if (ui.tab === 'register') {
      $('#discVal').value = '';
      $('#discType').value = 'pct';
      updateRegister();
    }
    showReceipt(order.id, true);
    if (ok) toast('Sale completed');
    if (st.autoPrint && printerReady()) {
      rawPrint(receiptBytes(order)).catch(function (e) { toast('Auto-print failed: ' + errText(e)); });
    }
  }

  /* ------------------------------ receipt ------------------------------ */

  function receiptHTML(o) {
    var rows = o.lines.map(function (l) {
      return '<div class="r"><span>' + l.qty + ' × ' + esc(l.name) + '</span><span>' + fmt(l.price * l.qty) + '</span></div>';
    }).join('');
    var taxLabel = 'Tax ' + o.taxRate + '%' + (o.taxInclusive ? ' (incl.)' : '');
    var contact = [];
    if (o.phone) contact.push('Tel: ' + esc(o.phone));
    if (o.email) contact.push(esc(o.email));
    return '<div class="receipt">' +
      '<div class="r-head">' +
        '<img class="r-logo" src="logo-black.png" alt="' + esc(o.shop || state.settings.shopName) + ' logo">' +
        (o.address ? '<div>' + esc(o.address) + '</div>' : '') +
        contact.map(function (c) { return '<div>' + c + '</div>'; }).join('') +
      '</div>' +
      '<hr>' +
      '<div class="center">Order ' + orderNo(o.no) + '</div>' +
      '<div class="center">' + esc(fmtDateTime(o.ts)) + '</div>' +
      (o.status === 'void' ? '<div class="voidstamp">VOID</div>' : '') +
      '<hr>' + rows + '<hr>' +
      '<div class="r"><span>Subtotal</span><span>' + fmt(o.subtotal) + '</span></div>' +
      (o.discount > 0 ? '<div class="r"><span>' + esc(o.discLabel) + '</span><span>-' + fmt(o.discount) + '</span></div>' : '') +
      (o.taxRate > 0 ? '<div class="r"><span>' + esc(taxLabel) + '</span><span>' + fmt(o.tax) + '</span></div>' : '') +
      '<div class="r strong"><span>TOTAL</span><span>' + fmt(o.total) + '</span></div>' +
      '<div class="r"><span>Paid by</span><span>' + METHODS[o.method] + '</span></div>' +
      (o.method === 'cash' ? '<div class="r"><span>Cash</span><span>' + fmt(o.tendered) + '</span></div><div class="r"><span>Change</span><span>' + fmt(o.change) + '</span></div>' : '') +
      (o.footer ? '<hr><div class="center">' + esc(o.footer) + '</div>' : '') +
    '</div>';
  }

  function showReceipt(id, justPaid) {
    var o = state.orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    openModal(
      receiptHTML(o) +
      '<div class="actions no-print">' +
        (o.status === 'paid' && !justPaid ? '<button type="button" class="btn danger" data-action="void-order" data-id="' + esc(o.id) + '">Void order</button>' : '') +
        '<button type="button" class="btn" data-action="print-order" data-id="' + esc(o.id) + '">Print</button>' +
        '<button type="button" class="btn primary" data-action="close-modal">' + (justPaid ? 'New order' : 'Close') + '</button>' +
      '</div>'
    );
  }

  function voidOrder(id) {
    var o = state.orders.filter(function (x) { return x.id === id; })[0];
    if (!o || o.status === 'void') return;
    var cur = currentShift();
    if (o.shiftId && !cur) { toast('Open a shift first to void an order from a closed shift'); return; }
    if (!window.confirm('Void order ' + orderNo(o.no) + ' (' + fmt(o.total) + ')? It will be excluded from reports.')) return;
    o.status = 'void';
    o.voidedAt = new Date().toISOString();
    o.voidShiftId = cur ? cur.id : '';
    save();
    closeModal();
    if (ui.tab === 'orders') renderOrdersList();
    if (ui.tab === 'reports') renderReport();
    toast('Order ' + orderNo(o.no) + ' voided');
  }

  /* ------------------------------ orders ------------------------------ */

  function viewOrders() {
    $('#view').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h1>Orders</h1>' +
          '<label class="inline">Date <input type="date" id="ordersDate" data-input="orders-date" value="' + esc(ui.ordersDate) + '"></label>' +
        '</div>' +
        '<div id="ordersList" class="card"></div>' +
      '</section>';
    renderOrdersList();
  }

  function renderOrdersList() {
    var list = state.orders.filter(function (o) { return dayKey(o.ts) === ui.ordersDate; })
      .sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
    var box = $('#ordersList');
    if (!list.length) { box.innerHTML = '<div class="empty">No orders on this date.</div>'; return; }
    var paid = list.filter(function (o) { return o.status === 'paid'; });
    var sum = paid.reduce(function (a, o) { return a + o.total; }, 0);
    box.innerHTML =
      '<p class="muted small">' + paid.length + ' paid order' + (paid.length === 1 ? '' : 's') + ' · ' + fmt(sum) + '</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Time</th><th>Items</th><th>Payment</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      list.map(function (o) {
        var items = o.lines.reduce(function (a, l) { return a + l.qty; }, 0);
        return '<tr class="clickable" tabindex="0" data-action="view-order" data-id="' + esc(o.id) + '">' +
          '<td><strong>' + orderNo(o.no) + '</strong></td><td>' + fmtTime(o.ts) + '</td><td>' + items + '</td>' +
          '<td>' + METHODS[o.method] + '</td><td class="num">' + fmt(o.total) + '</td>' +
          '<td>' + (o.status === 'void' ? '<span class="badge void">Void</span>' : '<span class="badge">Paid</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ------------------------------ reports ------------------------------ */

  function reportOrders(all) {
    var from = ui.repFrom, to = ui.repTo;
    if (from > to) { var tmp = from; from = to; to = tmp; }
    return state.orders.filter(function (o) {
      var k = dayKey(o.ts);
      return k >= from && k <= to && (all || o.status === 'paid');
    });
  }

  function viewReports() {
    $('#view').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h1>Reports</h1><button type="button" class="btn" data-action="export-csv">Export CSV</button></div>' +
        '<div class="card range">' +
          '<label class="field">From<input type="date" id="repFrom" data-input="rep-from" value="' + esc(ui.repFrom) + '"></label>' +
          '<label class="field">To<input type="date" id="repTo" data-input="rep-to" value="' + esc(ui.repTo) + '"></label>' +
          '<button type="button" class="btn" data-action="range" data-r="today">Today</button>' +
          '<button type="button" class="btn" data-action="range" data-r="7d">Last 7 days</button>' +
          '<button type="button" class="btn" data-action="range" data-r="month">This month</button>' +
        '</div>' +
        '<div id="reportBody" class="stack"></div>' +
      '</section>';
    renderReport();
  }

  function renderReport() {
    var paid = reportOrders(false);
    var voided = reportOrders(true).length - paid.length;
    var sales = 0, disc = 0, tax = 0, methods = {}, items = {};
    paid.forEach(function (o) {
      sales += o.total; disc += o.discount; tax += o.tax;
      methods[o.method] = methods[o.method] || { n: 0, amt: 0 };
      methods[o.method].n++; methods[o.method].amt += o.total;
      o.lines.forEach(function (l) {
        items[l.name] = items[l.name] || { qty: 0, amt: 0 };
        items[l.name].qty += l.qty; items[l.name].amt += l.price * l.qty;
      });
    });
    var avg = paid.length ? Math.round(sales / paid.length) : 0;
    var top = Object.keys(items).map(function (k) { return { name: k, qty: items[k].qty, amt: items[k].amt }; })
      .sort(function (a, b) { return b.qty - a.qty || b.amt - a.amt; }).slice(0, 10);
    var maxQty = top.length ? top[0].qty : 1;
    var body = $('#reportBody');
    body.innerHTML =
      '<div class="stats">' +
        '<div class="card stat"><div class="label">Sales</div><div class="value">' + fmt(sales) + '</div></div>' +
        '<div class="card stat"><div class="label">Orders</div><div class="value">' + paid.length + '</div></div>' +
        '<div class="card stat"><div class="label">Average order</div><div class="value">' + fmt(avg) + '</div></div>' +
        '<div class="card stat"><div class="label">Discounts given</div><div class="value">' + fmt(disc) + '</div></div>' +
        '<div class="card stat"><div class="label">Tax in sales</div><div class="value">' + fmt(tax) + '</div></div>' +
      '</div>' +
      (voided > 0 ? '<p class="muted small">' + voided + ' voided order' + (voided === 1 ? '' : 's') + ' excluded.</p>' : '') +
      '<div class="two">' +
        '<div class="card"><h2>By payment method</h2>' +
          (paid.length ? '<table><thead><tr><th>Method</th><th class="num">Orders</th><th class="num">Amount</th></tr></thead><tbody>' +
            Object.keys(METHODS).filter(function (k) { return methods[k]; }).map(function (k) {
              return '<tr><td>' + METHODS[k] + '</td><td class="num">' + methods[k].n + '</td><td class="num">' + fmt(methods[k].amt) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="empty">No sales in this range.</div>') +
        '</div>' +
        '<div class="card"><h2>Top items</h2>' +
          (top.length ? '<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead><tbody>' +
            top.map(function (t) {
              return '<tr><td>' + esc(t.name) + '<span class="bar"><i style="width:' + Math.round(t.qty / maxQty * 100) + '%"></i></span></td><td class="num">' + t.qty + '</td><td class="num">' + fmt(t.amt) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="empty">No items sold in this range.</div>') +
        '</div>' +
      '</div>';
  }

  function exportCsv() {
    var list = reportOrders(true).sort(function (a, b) { return Date.parse(a.ts) - Date.parse(b.ts); });
    if (!list.length) { toast('No orders in this range'); return; }
    var head = ['Order', 'Date', 'Time', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Payment', 'Status'];
    var rows = list.map(function (o) {
      var d = new Date(o.ts);
      return [
        orderNo(o.no), dayKey(d), pad(d.getHours()) + ':' + pad(d.getMinutes()),
        o.lines.map(function (l) { return l.qty + 'x ' + l.name; }).join('; '),
        (o.subtotal / 100).toFixed(2), (o.discount / 100).toFixed(2), (o.tax / 100).toFixed(2), (o.total / 100).toFixed(2),
        METHODS[o.method], o.status
      ].map(csvCell).join(',');
    });
    var from = ui.repFrom <= ui.repTo ? ui.repFrom : ui.repTo;
    var to = ui.repFrom <= ui.repTo ? ui.repTo : ui.repFrom;
    download('sales_' + from + '_to_' + to + '.csv', '﻿' + [head.map(csvCell).join(',')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function setRange(r) {
    var now = new Date();
    ui.repTo = dayKey(now);
    if (r === '7d') ui.repFrom = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    else if (r === 'month') ui.repFrom = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
    else ui.repFrom = ui.repTo;
    $('#repFrom').value = ui.repFrom;
    $('#repTo').value = ui.repTo;
    renderReport();
  }

  /* ------------------------------ menu ------------------------------ */

  function viewMenu() {
    $('#view').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h1>Menu</h1></div>' +
        '<form class="card stack" data-form="menu-add" autocomplete="off">' +
          '<h2>Add item</h2>' +
          '<div class="form-grid">' +
            '<label class="field">Name<input type="text" name="itemName" maxlength="60" required></label>' +
            '<label class="field">Category<input type="text" name="itemCategory" maxlength="24" list="catList" placeholder="e.g. Coffee"></label>' +
            '<label class="field">Price<input type="number" name="itemPrice" min="0.01" step="0.01" inputmode="decimal" required></label>' +
            '<button type="submit" class="btn primary">Add item</button>' +
          '</div>' +
          '<datalist id="catList"></datalist>' +
        '</form>' +
        '<div id="menuList" class="card"></div>' +
      '</section>';
    renderMenuList();
  }

  function renderMenuList() {
    var dl = $('#catList');
    if (dl) dl.innerHTML = categories().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    var box = $('#menuList');
    if (!state.menu.length) { box.innerHTML = '<div class="empty">No items yet. Add your first one above.</div>'; return; }
    box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="num">Price</th><th>Available</th><th></th></tr></thead><tbody>' +
      state.menu.map(function (m) {
        return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.category) + '</td><td class="num">' + fmt(m.price) + '</td>' +
          '<td><label class="check"><input type="checkbox" data-action="menu-toggle" data-id="' + esc(m.id) + '"' + (m.available ? ' checked' : '') + ' aria-label="Available: ' + esc(m.name) + '"></label></td>' +
          '<td class="right"><div class="actions">' +
            '<button type="button" class="btn sm" data-action="menu-edit" data-id="' + esc(m.id) + '">Edit</button>' +
            '<button type="button" class="btn sm danger" data-action="menu-delete" data-id="' + esc(m.id) + '">Delete</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function validateItem(name, category, priceStr) {
    name = String(name || '').trim().slice(0, 60);
    category = String(category || '').trim().slice(0, 24) || 'General';
    var price = toCents(priceStr);
    if (!name) return { error: 'Please enter a name' };
    if (!isFinite(price) || price <= 0) return { error: 'Please enter a price greater than zero' };
    if (price > MAX_PRICE) return { error: 'Price is too large' };
    return { name: name, category: category, price: price };
  }

  function openEditItem(id) {
    var m = menuById(id);
    if (!m) return;
    openModal(
      '<h2>Edit item</h2>' +
      '<form class="stack" data-form="menu-edit" autocomplete="off">' +
        '<input type="hidden" name="itemId" value="' + esc(m.id) + '">' +
        '<label class="field">Name<input type="text" name="itemName" maxlength="60" required value="' + esc(m.name) + '"></label>' +
        '<label class="field">Category<input type="text" name="itemCategory" maxlength="24" list="catList2" value="' + esc(m.category) + '"></label>' +
        '<datalist id="catList2">' + categories().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
        '<label class="field">Price<input type="number" name="itemPrice" min="0.01" step="0.01" inputmode="decimal" required value="' + (m.price / 100).toFixed(2) + '"></label>' +
        '<label class="check"><input type="checkbox" name="itemAvailable"' + (m.available ? ' checked' : '') + '> Available for sale</label>' +
        '<div class="actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Save</button></div>' +
      '</form>'
    );
  }

  /* ------------------------------ settings ------------------------------ */

  function viewSettings() {
    var s = state.settings;
    $('#view').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h1>Settings</h1></div>' +
        '<form class="card stack" data-form="settings" autocomplete="off">' +
          '<h2>Shop</h2>' +
          '<div class="form-grid">' +
            '<label class="field">Shop name<input type="text" name="shopName" maxlength="40" required value="' + esc(s.shopName) + '"></label>' +
            '<label class="field">Currency symbol<input type="text" name="currency" maxlength="3" required value="' + esc(s.currency) + '"></label>' +
            '<label class="field">Tax rate (%)<input type="number" name="taxRate" min="0" max="100" step="0.01" inputmode="decimal" required value="' + esc(s.taxRate) + '"></label>' +
            '<label class="check"><input type="checkbox" name="taxInclusive"' + (s.taxInclusive ? ' checked' : '') + '> Prices include tax</label>' +
          '</div>' +
          '<h2>Receipt</h2>' +
          '<div class="form-grid">' +
            '<label class="field">Phone<input type="text" name="phone" maxlength="30" value="' + esc(s.phone) + '"></label>' +
            '<label class="field">Email<input type="text" name="email" maxlength="60" value="' + esc(s.email) + '"></label>' +
          '</div>' +
          '<label class="field">Address<input type="text" name="address" maxlength="100" value="' + esc(s.address) + '"></label>' +
          '<label class="field">Receipt footer<input type="text" name="footer" maxlength="80" value="' + esc(s.footer) + '"></label>' +
          '<div class="actions start"><button type="submit" class="btn primary">Save settings</button></div>' +
          '<p class="hint">Tax changes apply to new orders only. Past receipts keep the rate they were made with.</p>' +
        '</form>' +
        '<div class="card stack">' +
          '<h2>Printer</h2>' +
          '<p class="muted small">Connect a USB, Bluetooth or serial receipt printer. Without one, Print uses the system print dialog.</p>' +
          '<div class="actions start"><button type="button" class="btn" data-action="printer">Printer setup</button></div>' +
        '</div>' +
        '<div class="card stack">' +
          '<h2>Data</h2>' +
          '<p class="muted small">Everything is stored in this browser on this device. Export a backup regularly, and use it to move data to another device.</p>' +
          '<div class="actions start">' +
            '<button type="button" class="btn" data-action="export-json">Export backup</button>' +
            '<button type="button" class="btn" data-action="import-json">Import backup</button>' +
            '<button type="button" class="btn danger" data-action="reset-data">Erase all data</button>' +
          '</div>' +
          '<input type="file" id="importFile" accept="application/json,.json" hidden data-input="import-file">' +
        '</div>' +
      '</section>';
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!data || typeof data !== 'object' || !Array.isArray(data.menu) || !Array.isArray(data.orders)) throw new Error('bad');
        var next = normalize(data);
        if (!window.confirm('Replace ALL current data with this backup (' + next.orders.length + ' orders, ' + next.menu.length + ' menu items)?')) return;
        state = next;
        resetOrderDraft();
        save();
        render();
        toast('Backup imported');
      } catch (e) {
        toast('That file is not a valid backup');
      }
    };
    reader.onerror = function () { toast('Could not read that file'); };
    reader.readAsText(file);
  }

  /* ------------------------------ shifts ------------------------------ */

  function shiftById(id) {
    for (var i = 0; i < state.shifts.length; i++) if (state.shifts[i].id === id) return state.shifts[i];
    return null;
  }

  function currentShift() {
    var s = state.currentShiftId ? shiftById(state.currentShiftId) : null;
    return s && !s.closedAt ? s : null;
  }

  // Live numbers for a shift. Closed shifts use the snapshot taken when they were closed.
  function shiftSummary(sh) {
    var r = {
      gross: 0, refunds: 0, discounts: 0, net: 0, tax: 0, collected: 0, orders: 0, voided: 0,
      cashPayments: 0, cashRefunds: 0, paidIn: 0, paidOut: 0, expected: 0,
      taxInclusive: state.settings.taxInclusive,
      methods: { cash: 0, card: 0, ewallet: 0 }
    };
    state.orders.forEach(function (o) {
      if (o.shiftId === sh.id) {
        if (o.status === 'paid') {
          r.gross += o.subtotal; r.discounts += o.discount; r.tax += o.tax; r.orders++;
          r.methods[o.method] += o.total;
          if (o.method === 'cash') r.cashPayments += o.total;
        } else if (o.voidShiftId === sh.id) {
          r.voided++; // sold and voided inside this shift: never counted
        }
      }
      if (o.status === 'void' && o.voidShiftId === sh.id && o.shiftId !== sh.id) {
        // an order from an earlier shift voided now: money goes back out of this shift
        r.refunds += o.subtotal; r.discounts -= o.discount; r.tax -= o.tax;
        r.methods[o.method] -= o.total;
        if (o.method === 'cash') r.cashRefunds += o.total;
      }
    });
    sh.movements.forEach(function (m) { if (m.type === 'in') r.paidIn += m.amount; else r.paidOut += m.amount; });
    r.net = r.gross - r.refunds - r.discounts;
    r.collected = r.methods.cash + r.methods.card + r.methods.ewallet;
    r.expected = sh.startingCash + r.cashPayments - r.cashRefunds + r.paidIn - r.paidOut;
    return r;
  }

  function shiftData(sh) { return sh.closedAt && sh.summary ? sh.summary : shiftSummary(sh); }

  // Rows shared by the screen, the on-screen report and the thermal printout.
  function shiftRows(sh) {
    var d = shiftData(sh);
    var cash = [
      ['Starting cash', fmt(sh.startingCash)],
      ['Cash payments', fmt(d.cashPayments)],
      ['Cash refunds', fmt(d.cashRefunds)],
      ['Paid in', fmt(d.paidIn)],
      ['Paid out', fmt(d.paidOut)],
      ['Expected cash amount', fmt(d.expected), true]
    ];
    if (sh.closedAt) {
      var diff = sh.difference || 0;
      cash.push(['Counted cash', fmt(sh.countedCash || 0)]);
      cash.push([diff === 0 ? 'Difference' : (diff > 0 ? 'Over' : 'Short'), fmt(Math.abs(diff)), true]);
    }
    var sales = [
      ['Gross sales', fmt(d.gross)],
      ['Refunds', fmt(d.refunds)],
      ['Discounts', fmt(d.discounts)],
      ['Net sales', fmt(d.net), true],
      ['Cash', fmt(d.methods.cash)],
      ['Card', fmt(d.methods.card)],
      ['E-wallet', fmt(d.methods.ewallet)],
      ['Taxes ' + (d.taxInclusive ? '(included)' : '(added)'), fmt(d.tax)],
      ['Orders', String(d.orders)]
    ];
    if (d.voided) sales.push(['Voided orders', String(d.voided)]);
    var moves = sh.movements.map(function (m) {
      return [(m.type === 'in' ? 'Paid in' : 'Paid out') + (m.note ? ': ' + m.note : ''), fmt(m.amount)];
    });
    return { cash: cash, sales: sales, moves: moves };
  }

  function kvHTML(list) {
    return list.map(function (r) {
      return '<div class="kv' + (r[2] ? ' strong' : '') + '"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
    }).join('');
  }

  function viewShift() {
    var sh = currentShift();
    var past = state.shifts.filter(function (s) { return s.closedAt; })
      .sort(function (a, b) { return Date.parse(b.closedAt) - Date.parse(a.closedAt); });
    var body;
    if (sh) {
      var rows = shiftRows(sh);
      body =
        '<div class="card stack">' +
          '<div class="shift-head">' +
            '<div><h2>Shift #' + sh.no + ' <span class="badge open">Open</span></h2>' +
            '<div class="muted small">Opened by ' + esc(sh.openedBy) + ' · ' + esc(fmtDateTime(sh.openedAt)) + '</div></div>' +
            '<div class="actions">' +
              '<button type="button" class="btn" data-action="cash-mgmt">Cash management</button>' +
              '<button type="button" class="btn" data-action="print-shift" data-id="' + esc(sh.id) + '">Print report</button>' +
              '<button type="button" class="btn danger" data-action="close-shift">Close shift</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="two">' +
          '<div class="card"><h3 class="sec">Cash drawer</h3>' + kvHTML(rows.cash) +
            (rows.moves.length ? '<h3 class="sec sp">Cash movements</h3>' + kvHTML(rows.moves) : '') + '</div>' +
          '<div class="card"><h3 class="sec">Sales summary</h3>' + kvHTML(rows.sales) + '</div>' +
        '</div>';
    } else {
      body =
        '<div class="card stack center">' +
          '<h2>No shift is open</h2>' +
          '<p class="muted">Count the cash in the drawer and open a shift to start taking orders.</p>' +
          '<div><button type="button" class="btn primary big" data-action="open-shift">Open shift</button></div>' +
        '</div>';
    }
    $('#view').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h1>Shift</h1></div>' + body +
        '<div class="card"><h2>Past shifts</h2>' +
          (past.length ?
            '<div class="table-wrap"><table><thead><tr><th>Shift</th><th>Cashier</th><th>Opened</th><th>Closed</th><th class="num">Starting</th><th class="num">Counted</th><th class="num">Diff.</th></tr></thead><tbody>' +
            past.slice(0, 60).map(function (s) {
              var diff = s.difference || 0;
              return '<tr class="clickable" tabindex="0" data-action="view-shift" data-id="' + esc(s.id) + '">' +
                '<td><strong>#' + s.no + '</strong></td><td>' + esc(s.openedBy) + '</td>' +
                '<td>' + esc(fmtDateTime(s.openedAt)) + '</td><td>' + esc(fmtDateTime(s.closedAt)) + '</td>' +
                '<td class="num">' + fmt(s.startingCash) + '</td><td class="num">' + fmt(s.countedCash || 0) + '</td>' +
                '<td class="num ' + (diff === 0 ? 'pos' : 'neg') + '">' + (diff === 0 ? 'OK' : (diff > 0 ? '+' : '-') + fmt(Math.abs(diff))) + '</td></tr>';
            }).join('') + '</tbody></table></div>' :
            '<div class="empty">Closed shifts will appear here.</div>') +
        '</div>' +
      '</section>';
  }

  function openShiftModal() {
    if (currentShift()) { setTab('shift'); return; }
    var s = state.settings;
    openModal(
      '<h2>Open shift</h2>' +
      '<form class="stack" data-form="shift-open" autocomplete="off">' +
        '<label class="field">Cashier name<input type="text" name="cashier" maxlength="30" required value="' + esc(s.lastCashier) + '"></label>' +
        '<label class="field">Starting cash in drawer<input type="number" name="startCash" min="0" step="0.01" inputmode="decimal" required value="' + (s.lastStartCash / 100).toFixed(2) + '"></label>' +
        '<p class="hint">Count the cash in the drawer first. This becomes shift #' + state.nextShiftNo + '.</p>' +
        '<div class="actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Open shift</button></div>' +
      '</form>'
    );
  }

  function openCashMgmt() {
    var sh = currentShift();
    if (!sh) return;
    var d = shiftSummary(sh);
    var recent = sh.movements.slice(-4).reverse();
    openModal(
      '<h2>Cash management</h2>' +
      '<div class="due"><span>Expected in drawer</span><strong>' + fmt(d.expected) + '</strong></div>' +
      '<form class="stack" data-form="shift-cash" autocomplete="off">' +
        '<label class="field">Type<select name="type"><option value="in">Paid in (add cash)</option><option value="out">Paid out (take cash)</option></select></label>' +
        '<label class="field">Amount<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label>' +
        '<label class="field">Note (optional)<input type="text" name="note" maxlength="40" placeholder="e.g. Ice delivery"></label>' +
        (recent.length ? '<div class="small muted">Recent</div>' + kvHTML(recent.map(function (m) {
          return [(m.type === 'in' ? 'Paid in' : 'Paid out') + (m.note ? ': ' + m.note : '') + ' · ' + fmtTime(m.ts), fmt(m.amount)];
        })) : '') +
        '<div class="actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Save</button></div>' +
      '</form>'
    );
  }

  function openCloseShift() {
    var sh = currentShift();
    if (!sh) return;
    var d = shiftSummary(sh);
    openModal(
      '<h2>Close shift #' + sh.no + '</h2>' +
      '<div class="due"><span>Expected cash</span><strong>' + fmt(d.expected) + '</strong></div>' +
      '<form class="stack" data-form="shift-close" autocomplete="off">' +
        '<label class="field">Counted cash in drawer<input id="countedCash" type="number" name="counted" min="0" step="0.01" inputmode="decimal" required placeholder="0.00" data-input="count-cash"></label>' +
        '<div class="quick"><button type="button" class="btn sm" data-action="count-exact">Matches expected</button></div>' +
        '<div class="change"><span id="diffLabel">Difference</span><span id="diffOut">—</span></div>' +
        '<p class="hint">Closing saves this shift\'s report. Open a new shift to keep selling.</p>' +
        '<div class="actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn danger">Close shift</button></div>' +
      '</form>'
    );
  }

  function shiftReportHTML(sh) {
    var s = state.settings, rows = shiftRows(sh);
    function block(title, list) {
      return '<hr><div class="strong">' + esc(title) + '</div>' + list.map(function (r) {
        return '<div class="r' + (r[2] ? ' strong' : '') + '"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
      }).join('');
    }
    return '<div class="receipt">' +
      '<div class="r-head"><img class="r-logo" src="logo-black.png" alt="' + esc(s.shopName) + ' logo">' +
        (s.address ? '<div>' + esc(s.address) + '</div>' : '') + '</div>' +
      '<hr><div class="center strong">SHIFT REPORT</div>' +
      '<div class="r"><span>Shift</span><span>#' + sh.no + '</span></div>' +
      '<div class="r"><span>Cashier</span><span>' + esc(sh.openedBy) + '</span></div>' +
      '<div class="r"><span>Opened</span><span>' + esc(fmtDateTime(sh.openedAt)) + '</span></div>' +
      (sh.closedAt ? '<div class="r"><span>Closed</span><span>' + esc(fmtDateTime(sh.closedAt)) + '</span></div>'
                   : '<div class="r"><span>Status</span><span>Still open</span></div>') +
      block('Cash drawer', rows.cash) +
      block('Sales summary', rows.sales) +
      (rows.moves.length ? block('Cash movements', rows.moves) : '') +
    '</div>';
  }

  function showShiftReport(id, justClosed) {
    var sh = shiftById(id);
    if (!sh) return;
    openModal(
      shiftReportHTML(sh) +
      '<div class="actions no-print">' +
        '<button type="button" class="btn" data-action="print-shift" data-id="' + esc(sh.id) + '">Print</button>' +
        '<button type="button" class="btn primary" data-action="close-modal">' + (justClosed ? 'Done' : 'Close') + '</button>' +
      '</div>'
    );
  }

  /* ------------------------------ printer ------------------------------ */

  // One active printer connection. The browser cannot list the system's printers,
  // so "ready" means: a USB / Bluetooth LE / serial printer is connected and its channel is open.
  var printer = { kind: null, status: 'none', name: '', msg: '', busy: false, dev: null, iface: 0, ep: 0, chr: null, port: null, writer: null };

  var BT_SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455'
  ];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function printerSupport() {
    return { usb: !!navigator.usb, bluetooth: !!navigator.bluetooth, serial: !!navigator.serial };
  }

  function errText(e) {
    var m = e && e.message ? String(e.message) : String(e || 'Unknown error');
    return m.length > 120 ? m.slice(0, 117) + '…' : m;
  }

  function setPrinter(patch) {
    Object.assign(printer, patch);
    renderPills();
    renderPrinterBody();
  }

  function printerAlive() {
    try {
      if (printer.kind === 'usb') return !!(printer.dev && printer.dev.opened);
      if (printer.kind === 'bluetooth') return !!(printer.dev && printer.dev.gatt && printer.dev.gatt.connected && printer.chr);
      if (printer.kind === 'serial') return !!(printer.port && printer.writer && printer.port.writable);
    } catch (e) { /* treat as not alive */ }
    return false;
  }

  function printerReady() { return printer.status === 'ready' && printerAlive(); }

  function checkPrinter() {
    if (printer.status === 'ready' && !printerAlive()) setPrinter({ status: 'none', msg: 'The printer was disconnected.' });
  }

  function rememberPrinter(info) {
    try { localStorage.setItem(PRINTER_KEY, JSON.stringify(info)); } catch (e) { /* ignore */ }
  }

  function forgetPrinter() {
    try { localStorage.removeItem(PRINTER_KEY); } catch (e) { /* ignore */ }
  }

  function failOpen(e, quiet) {
    setPrinter(quiet ? { status: 'none', msg: '' } : { status: 'error', msg: errText(e) });
  }

  function pickerFailed(e) {
    if (e && e.name === 'NotFoundError') setPrinter({ status: printerAlive() ? 'ready' : 'none', msg: '' }); // picker dismissed
    else setPrinter({ status: 'error', msg: errText(e) });
  }

  async function usbOpen(dev, quiet) {
    setPrinter({ status: 'connecting', msg: '' });
    try {
      await dev.open();
      if (dev.configuration === null) await dev.selectConfiguration(1);
      var pick = null;
      dev.configuration.interfaces.forEach(function (i) {
        i.alternates.forEach(function (a) {
          a.endpoints.forEach(function (e) {
            if (e.direction === 'out' && e.type === 'bulk') {
              var score = a.interfaceClass === 7 ? 2 : 1; // 7 = printer class
              if (!pick || score > pick.score) pick = { iface: i.interfaceNumber, alt: a.alternateSetting, ep: e.endpointNumber, score: score };
            }
          });
        });
      });
      if (!pick) throw new Error('This USB device has no printable endpoint.');
      await dev.claimInterface(pick.iface);
      if (pick.alt) await dev.selectAlternateInterface(pick.iface, pick.alt);
      setPrinter({ kind: 'usb', dev: dev, iface: pick.iface, ep: pick.ep, chr: null, port: null, writer: null, name: dev.productName || 'USB printer', status: 'ready', msg: '' });
      rememberPrinter({ kind: 'usb', vid: dev.vendorId, pid: dev.productId });
    } catch (e) {
      try { await dev.close(); } catch (_) { /* ignore */ }
      failOpen(e, quiet);
    }
  }

  function onBtDisc() { checkPrinter(); }

  async function btOpen(dev, quiet) {
    setPrinter({ status: 'connecting', msg: '' });
    try {
      var server = await dev.gatt.connect();
      var services = await server.getPrimaryServices();
      var chr = null;
      for (var i = 0; i < services.length && !chr; i++) {
        var chars = await services[i].getCharacteristics();
        for (var j = 0; j < chars.length; j++) {
          if (chars[j].properties.write || chars[j].properties.writeWithoutResponse) { chr = chars[j]; break; }
        }
      }
      if (!chr) throw new Error('No printer service found. Printers that only support classic Bluetooth cannot be used from a browser.');
      dev.removeEventListener('gattserverdisconnected', onBtDisc);
      dev.addEventListener('gattserverdisconnected', onBtDisc);
      setPrinter({ kind: 'bluetooth', dev: dev, chr: chr, port: null, writer: null, name: dev.name || 'Bluetooth printer', status: 'ready', msg: '' });
      rememberPrinter({ kind: 'bluetooth', id: dev.id });
    } catch (e) {
      try { if (dev.gatt && dev.gatt.connected) dev.gatt.disconnect(); } catch (_) { /* ignore */ }
      failOpen(e, quiet);
    }
  }

  async function serialOpen(port, quiet) {
    setPrinter({ status: 'connecting', msg: '' });
    try {
      await port.open({ baudRate: 9600 });
      var writer = port.writable.getWriter();
      setPrinter({ kind: 'serial', port: port, writer: writer, dev: null, chr: null, name: 'Serial printer', status: 'ready', msg: '' });
      var info = port.getInfo ? port.getInfo() : {};
      rememberPrinter({ kind: 'serial', vid: info.usbVendorId || 0, pid: info.usbProductId || 0 });
    } catch (e) {
      try { await port.close(); } catch (_) { /* ignore */ }
      failOpen(e, quiet);
    }
  }

  async function connectPrinter(kind) {
    var cap = printerSupport();
    if (!cap[kind]) { toast('This browser does not support ' + kind + ' printers'); return; }
    var target;
    try {
      if (kind === 'usb') target = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 255 }] });
      else if (kind === 'bluetooth') target = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
      else target = await navigator.serial.requestPort();
    } catch (e) { pickerFailed(e); return; }
    await disconnectPrinter(true);
    if (kind === 'usb') await usbOpen(target);
    else if (kind === 'bluetooth') await btOpen(target);
    else await serialOpen(target);
    if (printerReady()) toast('Printer ready: ' + printer.name);
  }

  async function disconnectPrinter(keepSaved) {
    var p = printer;
    try {
      if (p.kind === 'usb' && p.dev) {
        try { await p.dev.releaseInterface(p.iface); } catch (e) { /* ignore */ }
        await p.dev.close();
      } else if (p.kind === 'bluetooth' && p.dev && p.dev.gatt && p.dev.gatt.connected) {
        p.dev.gatt.disconnect();
      } else if (p.kind === 'serial' && p.port) {
        try { if (p.writer) p.writer.releaseLock(); } catch (e) { /* ignore */ }
        await p.port.close();
      }
    } catch (e) { /* already gone */ }
    if (keepSaved !== true) forgetPrinter();
    setPrinter({ kind: null, dev: null, chr: null, port: null, writer: null, name: '', status: 'none', msg: '' });
  }

  async function autoReconnect() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(PRINTER_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!saved || printerReady() || printer.status === 'connecting') return;
    try {
      var found;
      if (saved.kind === 'usb' && navigator.usb) {
        found = (await navigator.usb.getDevices()).filter(function (d) { return d.vendorId === saved.vid && d.productId === saved.pid; })[0];
        if (found) await usbOpen(found, true);
      } else if (saved.kind === 'serial' && navigator.serial) {
        found = (await navigator.serial.getPorts()).filter(function (p) {
          var i = p.getInfo ? p.getInfo() : {};
          return (i.usbVendorId || 0) === saved.vid && (i.usbProductId || 0) === saved.pid;
        })[0];
        if (found) await serialOpen(found, true);
      } else if (saved.kind === 'bluetooth' && navigator.bluetooth && navigator.bluetooth.getDevices) {
        found = (await navigator.bluetooth.getDevices()).filter(function (d) { return d.id === saved.id; })[0];
        if (found) await btOpen(found, true);
      }
    } catch (e) { /* stay disconnected */ }
  }

  function watchPrinterEvents() {
    try {
      if (navigator.usb) {
        navigator.usb.addEventListener('disconnect', function () { checkPrinter(); });
        navigator.usb.addEventListener('connect', function () { autoReconnect(); });
      }
      if (navigator.serial) {
        navigator.serial.addEventListener('disconnect', function () { checkPrinter(); });
        navigator.serial.addEventListener('connect', function () { autoReconnect(); });
      }
    } catch (e) { /* events unsupported */ }
  }

  async function rawPrint(bytes) {
    if (!printerReady()) throw new Error('Printer is not ready');
    if (printer.busy) throw new Error('Printer is busy');
    printer.busy = true;
    try {
      var i;
      if (printer.kind === 'usb') {
        for (i = 0; i < bytes.length; i += 4096) {
          var res = await printer.dev.transferOut(printer.ep, bytes.slice(i, i + 4096));
          if (res.status !== 'ok') throw new Error('USB transfer ' + res.status);
        }
      } else if (printer.kind === 'bluetooth') {
        var chr = printer.chr;
        for (i = 0; i < bytes.length; i += 100) {
          var chunk = bytes.slice(i, i + 100);
          if (chr.properties.writeWithoutResponse && chr.writeValueWithoutResponse) await chr.writeValueWithoutResponse(chunk);
          else await chr.writeValue(chunk);
          await sleep(12);
        }
      } else if (printer.kind === 'serial') {
        await printer.writer.write(bytes);
      }
    } catch (e) {
      printer.busy = false;
      setPrinter({ status: 'error', msg: errText(e) });
      throw e;
    }
    printer.busy = false;
  }

  // Print on the connected thermal printer; otherwise fall back to the system print dialog.
  function doPrint(build, rawOnly) {
    if (!printerReady()) {
      if (rawOnly) { toast('No printer connected'); return; }
      window.print();
      return;
    }
    rawPrint(build()).then(function () { toast('Sent to printer'); })
      .catch(function (e) { toast('Print failed: ' + errText(e) + '. Tap Print again to use the system print dialog.'); });
  }

  /* ESC/POS builder: plain text, no images, so it works on any thermal printer. */
  function toAscii(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/₱/g, 'P').replace(/[^\x20-\x7e]/g, '?');
  }

  // word-wrap to `max` characters per line (hard-breaks words longer than a line)
  function wrap(s, max) {
    var out = [];
    s = toAscii(s);
    while (s.length > max) {
      var cut = s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(s.slice(0, cut));
      s = s.slice(cut).replace(/^ +/, '');
    }
    out.push(s);
    return out;
  }

  function escpos() {
    var w = state.settings.paperWidth, b = [], dbl = false;
    function text(s) { s = toAscii(s); for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i)); }
    var api = {
      init: function () { b.push(0x1b, 0x40); return api; },
      align: function (n) { b.push(0x1b, 0x61, n); return api; },        // 0 left, 1 center
      bold: function (on) { b.push(0x1b, 0x45, on ? 1 : 0); return api; },
      size: function (on) { dbl = !!on; b.push(0x1d, 0x21, on ? 0x11 : 0); return api; },
      line: function (s) {
        var max = dbl ? Math.floor(w / 2) : w;
        wrap(s, max).forEach(function (ln) { text(ln); b.push(10); });
        return api;
      },
      row: function (l, r) {
        r = toAscii(r);
        var space = w - r.length - 1;
        if (space < 6) { api.line(l); return api.line(r); }
        var parts = wrap(l, space);
        var last = parts.pop();
        parts.forEach(function (ln) { text(ln); b.push(10); });
        text(last + new Array(w - last.length - r.length + 1).join(' ') + r);
        b.push(10);
        return api;
      },
      rule: function () { text(new Array(w + 1).join('-')); b.push(10); return api; },
      feed: function (n) { b.push(0x1b, 0x64, n); return api; },
      cut: function () { b.push(0x1d, 0x56, 0x42, 0x03); return api; },
      bytes: function () { return new Uint8Array(b); }
    };
    return api;
  }

  function receiptBytes(o) {
    var p = escpos();
    p.init().align(1).bold(true).size(true).line(o.shop || state.settings.shopName).size(false).bold(false);
    if (o.address) p.line(o.address);
    if (o.phone) p.line('Tel: ' + o.phone);
    if (o.email) p.line(o.email);
    p.align(0).rule().align(1).line('Order ' + orderNo(o.no)).line(fmtDateTime(o.ts));
    if (o.status === 'void') p.bold(true).line('*** VOID ***').bold(false);
    p.align(0).rule();
    o.lines.forEach(function (l) { p.row(l.qty + ' x ' + l.name, fmt(l.price * l.qty)); });
    p.rule().row('Subtotal', fmt(o.subtotal));
    if (o.discount > 0) p.row(o.discLabel, '-' + fmt(o.discount));
    if (o.taxRate > 0) p.row('Tax ' + o.taxRate + '%' + (o.taxInclusive ? ' (incl.)' : ''), fmt(o.tax));
    p.bold(true).row('TOTAL', fmt(o.total)).bold(false);
    p.row('Paid by', METHODS[o.method]);
    if (o.method === 'cash') { p.row('Cash', fmt(o.tendered)); p.row('Change', fmt(o.change)); }
    if (o.footer) p.rule().align(1).line(o.footer).align(0);
    return p.feed(4).cut().bytes();
  }

  function shiftReportBytes(sh) {
    var s = state.settings, rows = shiftRows(sh), p = escpos();
    p.init().align(1).bold(true).size(true).line(s.shopName).size(false).bold(false);
    if (s.address) p.line(s.address);
    p.align(1).rule().bold(true).line('SHIFT REPORT').bold(false).align(0);
    p.row('Shift', '#' + sh.no).row('Cashier', sh.openedBy).row('Opened', fmtDateTime(sh.openedAt));
    if (sh.closedAt) p.row('Closed', fmtDateTime(sh.closedAt)); else p.row('Status', 'Still open');
    var blocks = [['Cash drawer', rows.cash], ['Sales summary', rows.sales]];
    if (rows.moves.length) blocks.push(['Cash movements', rows.moves]);
    blocks.forEach(function (bl) {
      p.rule().bold(true).line(bl[0]).bold(false);
      bl[1].forEach(function (r) { if (r[2]) p.bold(true); p.row(r[0], r[1]); p.bold(false); });
    });
    return p.feed(4).cut().bytes();
  }

  function testBytes() {
    var s = state.settings, p = escpos();
    p.init().align(1).bold(true).size(true).line(s.shopName).size(false).bold(false)
      .line('PRINTER TEST').align(0).rule()
      .row('Paper width', s.paperWidth + ' chars').row('Printer', printer.name || '-').row('Time', fmtDateTime(new Date()))
      .rule().align(1).line('If you can read this,').line('the printer is ready.').align(0);
    return p.feed(4).cut().bytes();
  }

  /* printer UI */

  function renderPills() {
    var sp = $('#shiftPill'), pp = $('#printerPill');
    if (sp) {
      var sh = currentShift();
      sp.innerHTML = '<i class="dot ' + (sh ? 'ok' : 'warn') + '"></i><span>' + (sh ? 'Shift #' + sh.no : 'No shift') + '</span>';
      sp.title = sh ? 'Shift #' + sh.no + ' open (' + sh.openedBy + ')' : 'No open shift';
    }
    if (pp) {
      var cls = { ready: 'ok', connecting: 'warn', error: 'bad' }[printer.status] || '';
      var label = { ready: 'Printer ready', connecting: 'Connecting…', error: 'Printer error' }[printer.status] || 'No printer';
      pp.innerHTML = '<i class="dot ' + cls + '"></i><span>' + label + '</span>';
      pp.title = printer.status === 'ready' ? printer.name : (printer.msg || 'Tap to set up a printer');
    }
  }

  function openPrinterModal() {
    var s = state.settings;
    openModal(
      '<h2>Printer</h2>' +
      '<div id="printerBody" class="stack"></div>' +
      '<label class="field">Paper width<select data-input="paper-width">' +
        [[32, '58 mm (32 characters)'], [42, '76 mm (42 characters)'], [48, '80 mm (48 characters)']].map(function (o) {
          return '<option value="' + o[0] + '"' + (s.paperWidth === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" data-input="auto-print"' + (s.autoPrint ? ' checked' : '') + '> Print receipt automatically after each sale</label>' +
      '<div class="actions"><button type="button" class="btn primary" data-action="close-modal">Done</button></div>'
    );
    renderPrinterBody();
    checkPrinter();
  }

  function renderPrinterBody() {
    var box = $('#printerBody');
    if (!box) return;
    var cap = printerSupport();
    var ready = printerReady();
    var cls = ready ? 'ok' : { connecting: 'warn', error: 'bad' }[printer.status] || '';
    var title, sub;
    if (ready) { title = 'Ready to print'; sub = esc(printer.name) + ' · ' + { usb: 'USB', bluetooth: 'Bluetooth', serial: 'Serial' }[printer.kind]; }
    else if (printer.status === 'connecting') { title = 'Connecting…'; sub = 'Keep the printer on and nearby.'; }
    else if (printer.status === 'error') { title = 'Printer error'; sub = esc(printer.msg || 'Could not talk to the printer.'); }
    else { title = 'No printer connected'; sub = esc(printer.msg || 'Print will use the system print dialog.'); }
    var btns = [];
    if (cap.usb) btns.push('<button type="button" class="btn" data-action="printer-connect" data-kind="usb">USB printer</button>');
    if (cap.bluetooth) btns.push('<button type="button" class="btn" data-action="printer-connect" data-kind="bluetooth">Bluetooth printer</button>');
    if (cap.serial) btns.push('<button type="button" class="btn" data-action="printer-connect" data-kind="serial">Serial / COM port</button>');
    box.innerHTML =
      '<div class="pbox"><i class="dot ' + cls + '"></i><div><strong>' + title + '</strong><div class="muted small">' + sub + '</div></div></div>' +
      (ready ? '<div class="actions start"><button type="button" class="btn primary" data-action="printer-test">Test print</button>' +
               '<button type="button" class="btn" data-action="printer-disconnect">Disconnect</button></div>' : '') +
      (btns.length ?
        '<div class="small muted"><strong>' + (ready ? 'Switch printer' : 'Connect a printer') + '</strong></div><div class="actions start">' + btns.join('') + '</div>' :
        '<p class="hint">This browser cannot connect to printers directly. Use Chrome or Edge (Android or desktop). The Print button will open the system print dialog instead.</p>') +
      '<p class="hint">"Ready" means the connection is open. Printers rarely report paper or cover status to a web page, so run a test print to be sure. ' +
      'Printers that only support classic Bluetooth cannot be reached from a browser: pair them with the device and use the Print button (system print dialog).</p>';
  }

  /* ------------------------------ events ------------------------------ */

  var actions = {
    'tab': function (el) { setTab(el.dataset.tab); },
    'cat': function (el) { ui.cat = el.dataset.cat; renderChips(); renderGrid(); },
    'add': function (el) { addToCart(el.dataset.id); },
    'inc': function (el) { changeQty(el.dataset.id, 1); },
    'dec': function (el) { changeQty(el.dataset.id, -1); },
    'rm': function (el) {
      state.cart = state.cart.filter(function (c) { return c.id !== el.dataset.id; });
      save(); updateRegister();
    },
    'clear-cart': function () {
      if (!state.cart.length && !state.discount.value) return;
      resetOrderDraft(); save();
      $('#discVal').value = ''; $('#discType').value = 'pct';
      updateRegister();
    },
    'goto-cart': function () { $('#cart').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'charge': function () { openPayment(); },
    'pay-method': function (el) { if (pay) { pay.method = el.dataset.method; updatePayUI(); } },
    'pay-quick': function (el) {
      if (!pay) return;
      pay.tendered = parseInt(el.dataset.cents, 10) || 0;
      $('#tendered').value = (pay.tendered / 100).toFixed(2);
      updatePayUI();
    },
    'pay-confirm': function () { completeSale(); },
    'close-modal': function () { closeModal(); },
    'modal-backdrop': function () { closeModal(); },
    'print-order': function (el) {
      var o = state.orders.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (o) doPrint(function () { return receiptBytes(o); });
    },
    'print-shift': function (el) {
      var sh = shiftById(el.dataset.id);
      if (!sh) return;
      var fromPage = !modalOpen();
      if (printerReady()) { doPrint(function () { return shiftReportBytes(sh); }); return; }
      if (fromPage) showShiftReport(sh.id, false);
      window.print();
    },
    'open-shift': function () { openShiftModal(); },
    'close-shift': function () { openCloseShift(); },
    'cash-mgmt': function () { openCashMgmt(); },
    'view-shift': function (el) { showShiftReport(el.dataset.id, false); },
    'count-exact': function () {
      var sh = currentShift();
      if (!sh) return;
      $('#countedCash').value = (shiftSummary(sh).expected / 100).toFixed(2);
      inputs['count-cash']($('#countedCash'));
    },
    'printer': function () { openPrinterModal(); },
    'printer-connect': function (el) { connectPrinter(el.dataset.kind); },
    'printer-disconnect': function () { disconnectPrinter(); },
    'printer-test': function () { doPrint(testBytes, true); },
    'view-order': function (el) { showReceipt(el.dataset.id, false); },
    'void-order': function (el) { voidOrder(el.dataset.id); },
    'export-csv': function () { exportCsv(); },
    'range': function (el) { setRange(el.dataset.r); },
    'menu-edit': function (el) { openEditItem(el.dataset.id); },
    'menu-delete': function (el) {
      var m = menuById(el.dataset.id);
      if (!m || !window.confirm('Delete "' + m.name + '" from the menu? Past orders keep their records.')) return;
      state.menu = state.menu.filter(function (x) { return x.id !== m.id; });
      state.cart = state.cart.filter(function (c) { return c.id !== m.id; });
      save(); renderMenuList();
    },
    'menu-toggle': function (el) {
      var m = menuById(el.dataset.id);
      if (m) { m.available = el.checked; save(); }
    },
    'export-json': function () {
      download('cafepos-backup-' + dayKey(new Date()) + '.json', JSON.stringify(state, null, 2), 'application/json');
    },
    'import-json': function () { $('#importFile').click(); },
    'reset-data': function () {
      if (!window.confirm('Erase ALL orders, menu items and settings on this device? This cannot be undone.')) return;
      state = freshState();
      save();
      ui.cat = 'All'; ui.q = '';
      render();
      toast('All data erased');
    }
  };

  var inputs = {
    'search': function (el) { ui.q = el.value; renderGrid(); },
    'disc-val': function (el) {
      var v = parseFloat(el.value);
      if (!isFinite(v) || v < 0) v = 0;
      if (state.discount.type === 'pct') state.discount.value = Math.min(v, 100);
      else state.discount.value = Math.round(v * 100);
      save(); renderTotals();
    },
    'disc-type': function (el) {
      state.discount = { type: el.value === 'amt' ? 'amt' : 'pct', value: 0 };
      $('#discVal').value = '';
      save(); renderTotals();
    },
    'tendered': function (el) {
      if (!pay) return;
      var c = toCents(el.value);
      pay.tendered = isFinite(c) && c > 0 ? c : 0;
      updatePayUI();
    },
    'orders-date': function (el) { if (el.value) { ui.ordersDate = el.value; renderOrdersList(); } },
    'rep-from': function (el) { if (el.value) { ui.repFrom = el.value; renderReport(); } },
    'rep-to': function (el) { if (el.value) { ui.repTo = el.value; renderReport(); } },
    'import-file': function (el) { importBackup(el.files && el.files[0]); el.value = ''; },
    'count-cash': function (el) {
      var sh = currentShift();
      if (!sh) return;
      var c = toCents(el.value);
      var out = $('#diffOut'), lab = $('#diffLabel');
      if (!isFinite(c) || c < 0) { out.textContent = '—'; out.className = ''; lab.textContent = 'Difference'; return; }
      var diff = c - shiftSummary(sh).expected;
      lab.textContent = diff === 0 ? 'Difference' : (diff > 0 ? 'Over' : 'Short');
      out.textContent = fmt(Math.abs(diff));
      out.className = diff === 0 ? 'pos' : 'neg';
    },
    'paper-width': function (el) {
      var w = Number(el.value);
      if ([32, 42, 48].indexOf(w) >= 0) { state.settings.paperWidth = w; save(); }
    },
    'auto-print': function (el) { state.settings.autoPrint = !!el.checked; save(); }
  };

  var forms = {
    'menu-add': function (f) {
      var fd = new FormData(f);
      var r = validateItem(fd.get('itemName'), fd.get('itemCategory'), fd.get('itemPrice'));
      if (r.error) { toast(r.error); return; }
      state.menu.push({ id: uid('i'), name: r.name, category: r.category, price: r.price, available: true });
      save(); f.reset(); renderMenuList(); toast('Added ' + r.name);
      var n = f.querySelector('[name=itemName]'); if (n) n.focus();
    },
    'menu-edit': function (f) {
      var fd = new FormData(f);
      var m = menuById(String(fd.get('itemId')));
      if (!m) { closeModal(); return; }
      var r = validateItem(fd.get('itemName'), fd.get('itemCategory'), fd.get('itemPrice'));
      if (r.error) { toast(r.error); return; }
      m.name = r.name; m.category = r.category; m.price = r.price; m.available = fd.get('itemAvailable') !== null;
      save(); closeModal(); renderMenuList(); toast('Saved');
    },
    'shift-open': function (f) {
      var fd = new FormData(f);
      if (currentShift()) { closeModal(); render(); return; }
      var name = String(fd.get('cashier') || '').trim().slice(0, 30);
      var cash = toCents(fd.get('startCash'));
      if (!name) { toast('Enter the cashier name'); return; }
      if (!isFinite(cash) || cash < 0) { toast('Enter the starting cash (0 or more)'); return; }
      if (cash > MAX_PRICE * 10) { toast('Starting cash is too large'); return; }
      var sh = {
        id: uid('s'), no: state.nextShiftNo, openedBy: name, openedAt: new Date().toISOString(),
        startingCash: cash, closedAt: null, closedBy: '', countedCash: null, difference: null,
        movements: [], summary: null
      };
      state.nextShiftNo++;
      state.shifts.unshift(sh);
      state.currentShiftId = sh.id;
      state.settings.lastCashier = name;
      state.settings.lastStartCash = cash;
      save(); closeModal(); render();
      toast('Shift #' + sh.no + ' opened');
    },
    'shift-cash': function (f) {
      var sh = currentShift();
      if (!sh) { closeModal(); render(); return; }
      var fd = new FormData(f);
      var type = fd.get('type') === 'out' ? 'out' : 'in';
      var amt = toCents(fd.get('amount'));
      if (!isFinite(amt) || amt <= 0) { toast('Enter an amount greater than zero'); return; }
      if (type === 'out' && amt > shiftSummary(sh).expected) { toast('Not enough cash in the drawer for that'); return; }
      sh.movements.push({ id: uid('m'), type: type, amount: amt, note: String(fd.get('note') || '').trim().slice(0, 40), ts: new Date().toISOString() });
      save(); closeModal(); render();
      toast((type === 'in' ? 'Paid in ' : 'Paid out ') + fmt(amt));
    },
    'shift-close': function (f) {
      var sh = currentShift();
      if (!sh) { closeModal(); render(); return; }
      var fd = new FormData(f);
      var counted = toCents(fd.get('counted'));
      if (!isFinite(counted) || counted < 0) { toast('Enter the cash you counted'); return; }
      var sum = shiftSummary(sh);
      var diff = counted - sum.expected;
      if (diff !== 0 && !window.confirm('Counted cash is ' + fmt(Math.abs(diff)) + (diff > 0 ? ' over' : ' short') + '. Close the shift anyway?')) return;
      sh.summary = sum;
      sh.countedCash = counted;
      sh.difference = diff;
      sh.closedAt = new Date().toISOString();
      sh.closedBy = sh.openedBy;
      state.currentShiftId = null;
      save();
      closeModal();
      render();
      showShiftReport(sh.id, true);
      if (state.settings.autoPrint && printerReady()) {
        rawPrint(shiftReportBytes(sh)).catch(function (e) { toast('Auto-print failed: ' + errText(e)); });
      }
      toast('Shift #' + sh.no + ' closed');
    },
    'settings': function (f) {
      var fd = new FormData(f);
      var shop = String(fd.get('shopName') || '').trim().slice(0, 40);
      var cur = String(fd.get('currency') || '').trim().slice(0, 3);
      var rate = parseFloat(fd.get('taxRate'));
      if (!shop) { toast('Shop name is required'); return; }
      if (!cur) { toast('Currency symbol is required'); return; }
      if (!isFinite(rate) || rate < 0 || rate > 100) { toast('Tax rate must be between 0 and 100'); return; }
      Object.assign(state.settings, {
        shopName: shop, currency: cur, taxRate: rate,
        taxInclusive: fd.get('taxInclusive') !== null,
        phone: String(fd.get('phone') || '').trim().slice(0, 30),
        email: String(fd.get('email') || '').trim().slice(0, 60),
        address: String(fd.get('address') || '').trim().slice(0, 100),
        footer: String(fd.get('footer') || '').trim().slice(0, 80)
      });
      save(); renderShell(); toast('Settings saved');
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    if (a === 'modal-backdrop' && e.target !== el) return;
    if (a === 'menu-toggle') return; // handled on change
    if (actions[a]) actions[a](el, e);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.action === 'menu-toggle') { actions['menu-toggle'](el); return; }
    if (el.dataset && el.dataset.input && el.tagName !== 'INPUT') inputs[el.dataset.input] && inputs[el.dataset.input](el);
    else if (el.dataset && el.dataset.input === 'import-file') inputs['import-file'](el);
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.input || el.dataset.input === 'import-file') return;
    if (inputs[el.dataset.input]) inputs[el.dataset.input](el);
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.dataset || !f.dataset.form) return;
    e.preventDefault();
    if (forms[f.dataset.form]) forms[f.dataset.form](f);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-action="view-order"], tr[data-action="view-shift"]')) {
      e.preventDefault();
      actions[e.target.dataset.action](e.target);
    }
  });

  // keep several tabs of the same browser in sync
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || modalOpen()) return;
    state = load();
    render();
  });

  /* ------------------------------ boot ------------------------------ */

  render();
  tickClock();
  setInterval(tickClock, 30000);
  setInterval(checkPrinter, 5000);
  watchPrinterEvents();
  autoReconnect();

  // test hook (harmless in production)
  window.__cafepos = { calc: calc, state: function () { return state; }, shiftSummary: shiftSummary, receiptBytes: receiptBytes, shiftReportBytes: shiftReportBytes };
})();
