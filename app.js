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
    footer: 'Thank you! Brew. Create. Inspire.'
  };

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
      nextNo: 1
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
      shop: typeof o.shop === 'string' ? o.shop : '',
      phone: typeof o.phone === 'string' ? o.phone : '',
      email: typeof o.email === 'string' ? o.email : '',
      address: typeof o.address === 'string' ? o.address : '',
      footer: typeof o.footer === 'string' ? o.footer : ''
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
    return {
      menu: menu, orders: orders, settings: st, cart: cart,
      discount: { type: dtype, value: dval },
      nextNo: Math.max(nextNo, maxNo + 1)
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
  }

  function render() {
    renderShell();
    var views = { register: viewRegister, orders: viewOrders, reports: viewReports, menu: viewMenu, settings: viewSettings };
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
    btn.disabled = !lines.length;
    btn.textContent = lines.length ? 'Charge ' + fmt(t.total) : 'Charge';
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
        '<button type="button" class="btn" data-action="print">Print</button>' +
        '<button type="button" class="btn primary" data-action="close-modal">' + (justPaid ? 'New order' : 'Close') + '</button>' +
      '</div>'
    );
  }

  function voidOrder(id) {
    var o = state.orders.filter(function (x) { return x.id === id; })[0];
    if (!o || o.status === 'void') return;
    if (!window.confirm('Void order ' + orderNo(o.no) + ' (' + fmt(o.total) + ')? It will be excluded from reports.')) return;
    o.status = 'void';
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
    'print': function () { window.print(); },
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
    'import-file': function (el) { importBackup(el.files && el.files[0]); el.value = ''; }
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
    'settings': function (f) {
      var fd = new FormData(f);
      var shop = String(fd.get('shopName') || '').trim().slice(0, 40);
      var cur = String(fd.get('currency') || '').trim().slice(0, 3);
      var rate = parseFloat(fd.get('taxRate'));
      if (!shop) { toast('Shop name is required'); return; }
      if (!cur) { toast('Currency symbol is required'); return; }
      if (!isFinite(rate) || rate < 0 || rate > 100) { toast('Tax rate must be between 0 and 100'); return; }
      state.settings = {
        shopName: shop, currency: cur, taxRate: rate,
        taxInclusive: fd.get('taxInclusive') !== null,
        phone: String(fd.get('phone') || '').trim().slice(0, 30),
        email: String(fd.get('email') || '').trim().slice(0, 60),
        address: String(fd.get('address') || '').trim().slice(0, 100),
        footer: String(fd.get('footer') || '').trim().slice(0, 80)
      };
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
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-action="view-order"]')) {
      e.preventDefault();
      showReceipt(e.target.dataset.id, false);
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

  // test hook (harmless in production)
  window.__cafepos = { calc: calc, state: function () { return state; } };
})();
