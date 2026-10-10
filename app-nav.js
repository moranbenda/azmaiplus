(() => {
  'use strict';

  // The dashboard already contains its proven navigation markup.
  // This shared component is intentionally limited to internal pages so it
  // cannot interfere with dashboard business/accounting logic.
  if (document.getElementById('appSidebar')) return;

  const path = (location.pathname || '/').toLowerCase();
  const isActive = (href) => {
    const clean = href.split('?')[0].toLowerCase();
    if (clean === '/') return path === '/' || path.endsWith('/index.html');
    return path === clean || path.endsWith(clean);
  };

  const pageTitle = document.title || 'עצמאי פלוס';
  // Independent sidebar icon; the login screen keeps its own full logo.
  const logoSrc = 'data:image/png;base64,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';

  const items = [
    { section: '', label: 'בית', href: '/' },
    { section: 'ניהול שוטף', label: 'מסמכים', href: '/documents.html' },
    { section: 'ניהול שוטף', label: 'לקוחות', href: '/customers.html' },
    { section: 'ניהול שוטף', label: 'הכנסות והוצאות', href: '/#ledgerSection' },
    { section: 'ניהול שוטף', label: 'תזרים ותכנון פיננסי', href: '/cashflow.html' },
    { section: 'דוחות ומסים', label: 'דוחות', href: '/#reportsSection' },
    { section: 'דוחות ומסים', label: 'דיווח מע״מ', href: '/vat-report.html' },
    { section: 'דוחות ומסים', label: 'קבצים במבנה אחיד', href: '/open-format.html' },
    { section: 'דוחות ומסים', label: 'רכוש קבוע ופחת', href: '/fixed-assets.html' },
    { section: 'דוחות ומסים', label: 'סגירת שנה', href: '/year-end.html' },
    { section: 'מערכת', label: 'פרופיל עסק', href: '/#profileSection' },
    { section: 'מערכת', label: 'טבלת קטגוריות', href: '/#categoriesSection' },
    { section: 'מערכת', label: 'ייבוא וניהול נתונים', href: '/#dataSection' },
    { section: 'מערכת', label: 'תמיכה', href: '/#supportSection' }
  ];

  let currentSection = null;
  const navHtml = items.map(item => {
    const section = item.section && item.section !== currentSection
      ? `<div class="az-nav-section">${item.section}</div>` : '';
    if (item.section) currentSection = item.section;
    const active = isActive(item.href) ? ' is-active' : '';
    const soon = item.soon ? '<span class="az-nav-soon">בקרוב</span>' : '';
    return `${section}<a class="az-nav-item${active}" href="${item.href}">${item.label}${soon}</a>`;
  }).join('');

  const style = document.createElement('style');
  style.id = 'azmaiSharedNavStyles';
  style.textContent = `
    :root{--az-nav-w:236px;--az-nav-line:#e2e8f0;--az-nav-text:#0f172a;--az-nav-dim:#64748b;--az-nav-accent:#2563eb}
    body.azmai-has-shared-nav{padding-right:var(--az-nav-w)!important;box-sizing:border-box}
    .az-nav-sidebar{position:fixed;z-index:1000;top:0;right:0;width:var(--az-nav-w);height:100dvh;background:#fff;border-left:1px solid var(--az-nav-line);padding:18px 14px 14px;box-sizing:border-box;display:flex;flex-direction:column;box-shadow:-4px 0 18px rgba(15,23,42,.035)}
    .az-nav-brand{display:flex;align-items:center;gap:11px;padding:4px 8px 17px;border-bottom:1px solid var(--az-nav-line);margin-bottom:10px}
    .az-nav-logo{width:44px;height:44px;object-fit:contain;flex:0 0 auto}.az-nav-logo.is-empty{display:none}
    .az-nav-brand-name{font-size:18px;font-weight:800;color:var(--az-nav-text);line-height:1.15}.az-nav-brand-sub{font-size:10px;color:var(--az-nav-dim);margin-top:4px}
    .az-nav-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding-bottom:10px}.az-nav-section{font-size:10px;font-weight:700;color:#94a3b8;padding:13px 9px 5px}
    .az-nav-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:9px;text-decoration:none!important;color:#334155!important;font-size:13px;font-weight:600;transition:.15s ease}
    .az-nav-item:hover{background:#f8fafc;color:var(--az-nav-accent)!important}.az-nav-item.is-active{background:#eff6ff;color:var(--az-nav-accent)!important;font-weight:800}
    .az-nav-soon{font-size:9px;color:#94a3b8;border:1px solid var(--az-nav-line);border-radius:999px;padding:1px 6px;font-weight:700}
    .az-nav-bottom{margin-top:auto;border-top:1px solid var(--az-nav-line);padding-top:10px}.az-nav-user{font-size:11px;color:var(--az-nav-dim);padding:5px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .az-nav-registration{font-size:10px;line-height:1.45;color:var(--az-nav-dim);padding:7px 9px;overflow-wrap:anywhere}
    .az-nav-home{display:block;padding:8px 10px;border-radius:9px;text-decoration:none!important;color:#64748b!important;font-size:12px;font-weight:600}.az-nav-home:hover{background:#f8fafc}
    .az-nav-logout{display:block;width:100%;margin-top:3px;padding:8px 10px;border:0;border-radius:9px;background:transparent;text-align:right;color:#64748b;font:inherit;font-size:12px;font-weight:600;cursor:pointer}.az-nav-logout:hover{background:#fef2f2;color:#b91c1c}
    .az-nav-overlay{display:none;position:fixed;z-index:998;inset:0;background:rgba(15,23,42,.34);backdrop-filter:blur(2px)}
    .az-nav-menu-btn{display:none;position:fixed;z-index:1002;right:14px;top:14px;width:44px;height:44px;border:1px solid var(--az-nav-line);border-radius:12px;background:#fff;box-shadow:0 5px 18px rgba(15,23,42,.10);align-items:center;justify-content:center;cursor:pointer}
    .az-nav-menu-lines,.az-nav-menu-lines:before,.az-nav-menu-lines:after{content:"";display:block;width:20px;height:2px;border-radius:2px;background:#334155;position:relative}.az-nav-menu-lines:before{position:absolute;top:-6px;right:0}.az-nav-menu-lines:after{position:absolute;top:6px;right:0}
    @media(max-width:900px){
      body.azmai-has-shared-nav{padding-right:0!important}
      .az-nav-sidebar{width:min(82vw,300px);transform:translateX(105%);transition:transform .22s ease;box-shadow:-18px 0 40px rgba(15,23,42,.14)}
      body.azmai-nav-open .az-nav-sidebar{transform:translateX(0)}body.azmai-nav-open .az-nav-overlay{display:block}body.azmai-nav-open{overflow:hidden}
      .az-nav-menu-btn{display:flex}
      body.azmai-has-shared-nav header{padding-right:58px!important}
    }
    @media print{.az-nav-sidebar,.az-nav-overlay,.az-nav-menu-btn{display:none!important}body.azmai-has-shared-nav{padding-right:0!important}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'az-nav-overlay';
  overlay.id = 'azmaiNavOverlay';
  overlay.setAttribute('aria-hidden', 'true');

  const sidebar = document.createElement('aside');
  sidebar.className = 'az-nav-sidebar';
  sidebar.id = 'appSidebar';
  sidebar.setAttribute('aria-label', 'ניווט ראשי');
  sidebar.innerHTML = `
    <div class="az-nav-brand">
      ${logoSrc ? `<img class="az-nav-logo" src="${logoSrc}" alt="עצמאי פלוס">` : '<span class="az-nav-logo is-empty"></span>'}
      <div><div class="az-nav-brand-name">עצמאי פלוס</div><div class="az-nav-brand-sub">הנהלת חשבונות עצמאית</div></div>
    </div>
    <nav class="az-nav-list">${navHtml}</nav>
    <div class="az-nav-bottom"><div class="az-nav-registration">תוכנה רשומה במרשם התוכנות של רשות המסים · מספר רישום 278801</div><div class="az-nav-user" id="azmaiNavUser">${pageTitle.replace(' - עצמאי פלוס','')}</div><a class="az-nav-home" href="/">חזרה למסך הראשי</a><button type="button" class="az-nav-logout" id="azmaiNavLogout">התנתקות</button></div>`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'az-nav-menu-btn';
  button.id = 'mobileMenuBtn';
  button.setAttribute('aria-label', 'פתיחת תפריט');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'appSidebar');
  button.innerHTML = '<span class="az-nav-menu-lines" aria-hidden="true"></span>';

  document.body.classList.add('azmai-has-shared-nav');
  document.body.prepend(button);
  document.body.prepend(sidebar);
  document.body.prepend(overlay);

  const setOpen = (open) => {
    document.body.classList.toggle('azmai-nav-open', !!open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  button.addEventListener('click', () => setOpen(!document.body.classList.contains('azmai-nav-open')));
  overlay.addEventListener('click', () => setOpen(false));

  // Reuse the page's existing logout logic instead of duplicating auth behavior here.
  const navLogout = document.getElementById('azmaiNavLogout');
  navLogout?.addEventListener('click', () => {
    const existingLogout = document.getElementById('btnLogout');
    if (existingLogout && existingLogout !== navLogout) existingLogout.click();
  });
  sidebar.addEventListener('click', e => {
    if (window.matchMedia('(max-width:900px)').matches && e.target.closest('a')) setOpen(false);
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) setOpen(false); });

  // Mirror the page's already-existing auth label when available. Read-only only.
  const mirrorUser = () => {
    const source = document.getElementById('userEmailPill') || document.getElementById('userEmailTag');
    const target = document.getElementById('azmaiNavUser');
    if (source && target && source.textContent.trim()) target.textContent = source.textContent.trim();
  };
  mirrorUser();
  const authSource = document.getElementById('userEmailPill') || document.getElementById('userEmailTag');
  if (authSource && window.MutationObserver) new MutationObserver(mirrorUser).observe(authSource, {childList:true,subtree:true,characterData:true});
})();
