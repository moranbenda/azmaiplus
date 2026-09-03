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
  const logoCandidate = document.querySelector('header img, .brand img, img[alt*="עצמאי"]');
  const logoSrc = logoCandidate?.getAttribute('src') || '';

  const items = [
    { section: '', label: 'בית', href: '/' },
    { section: 'ניהול שוטף', label: 'מסמכים', href: '/documents.html' },
    { section: 'ניהול שוטף', label: 'לקוחות', href: '/customers.html' },
    { section: 'ניהול שוטף', label: 'הכנסות והוצאות', href: '/#ledgerSection' },
    { section: 'ניהול שוטף', label: 'תזרים ותכנון פיננסי', href: '/cashflow.html' },
    { section: 'דוחות ומסים', label: 'דוחות', href: '/#reportsSection' },
    { section: 'דוחות ומסים', label: 'דיווח מע״מ', href: '/vat-report.html', soon: true },
    { section: 'דוחות ומסים', label: 'ממשק פתוח', href: '/open-format.html' },
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
    .az-nav-home{display:block;padding:8px 10px;border-radius:9px;text-decoration:none!important;color:#64748b!important;font-size:12px;font-weight:600}.az-nav-home:hover{background:#f8fafc}
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
    <div class="az-nav-bottom"><div class="az-nav-user" id="azmaiNavUser">${pageTitle.replace(' - עצמאי פלוס','')}</div><a class="az-nav-home" href="/">חזרה למסך הראשי</a></div>`;

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
