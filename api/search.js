global.C = global.C || new Map();
const K = process.env.SCRAPINGAPI_API_KEY || "1432f28f4c66602b7020a6f1bf5fd9ba";

const COUNTRY_CODES = [
  { code: '967', country: 'اليمن' }, { code: '966', country: 'السعودية' },
  { code: '20', country: 'مصر' }, { code: '971', country: 'الإمارات' },
  { code: '965', country: 'الكويت' }, { code: '968', country: 'عُمان' },
  { code: '974', country: 'قطر' }, { code: '973', country: 'البحرين' },
  { code: '962', country: 'الأردن' }, { code: '961', country: 'لبنان' },
  { code: '963', country: 'سوريا' }, { code: '964', country: 'العراق' },
  { code: '970', country: 'فلسطين' }, { code: '212', country: 'المغرب' },
  { code: '213', country: 'الجزائر' }, { code: '216', country: 'تونس' },
  { code: '218', country: 'ليبيا' }, { code: '249', country: 'السودان' },
  { code: '1', country: 'أمريكا / كندا' }, { code: '44', country: 'بريطانيا' },
  { code: '90', country: 'تركيا' }
];

const H = {
  'accept': '*/*',
  'accept-language': 'ar,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
};

function detectProviderAndCountry(fullPhone, cleanPhoneYemen) {
  if (cleanPhoneYemen) {
    if (/^(77|78)[0-9]{7}$/.test(cleanPhoneYemen)) return 'يمن موبايل';
    if (/^(73)[0-9]{7}$/.test(cleanPhoneYemen)) return 'YOU';
    if (/^(71)[0-9]{7}$/.test(cleanPhoneYemen)) return 'سبأفون';
    if (/^(70)[0-9]{7}$/.test(cleanPhoneYemen)) return 'واي';
    return 'اليمن';
  }
  for (const item of COUNTRY_CODES) {
    if (fullPhone.startsWith(item.code)) return item.country;
  }
  return 'رقم دولي';
}

function parse(txt) {
  if (!txt) return [];
  const res = new Set();
  const m = txt.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)|اسم الشهرة[:\s]+([^\n<]+)/g);
  for (const x of m) {
    let name = (x[2] || x[3] || '')
      .replace(/عدد|السجلات|المكتشفة|الأكثر|شيوعاً|شيوعا|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|[\\{}{}\[\]"':\-_,\/|\.]/g, '')
      .trim();
    if (name.length > 2 && !/^(صحيح|خطأ|نعم|لا|بحث|null|undefined)$/.test(name)) {
      res.add(name);
    }
  }
  return Array.from(res);
}

async function f(url, headers, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    if (!r.ok) throw 0;
    const names = parse(await r.text());
    if (names.length) return names;
    throw 0;
  } catch {
    clearTimeout(t);
    throw 0;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const q = req.method === 'GET' ? req.query?.query : (req.body?.query || null);
    if (!q) return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });

    let p = String(q).replace(/\D/g, '');
    if (p.startsWith('00')) p = p.slice(2);

    let provider = '';
    let databasePhone = '';
    let scrapePhone = '';

    if (p.startsWith('967')) {
      const cleanYemen = p.slice(-9);
      provider = detectProviderAndCountry(p, cleanYemen);
      databasePhone = '0' + cleanYemen;
      scrapePhone = '967' + cleanYemen;
    } else if (p.length === 9 && /^(77|78|73|71|70)/.test(p)) {
      provider = detectProviderAndCountry('', p);
      databasePhone = '0' + p;
      scrapePhone = '967' + p;
    } else if (p.length === 10 && p.startsWith('07')) {
      const cleanYemen = p.substring(1);
      provider = detectProviderAndCountry('', cleanYemen);
      databasePhone = p;
      scrapePhone = '967' + cleanYemen;
    } else {
      provider = detectProviderAndCountry(p, null);
      databasePhone = '+' + p;
      scrapePhone = p;
    }

    // ⚡ 1. كاش فوري من الرام عند التكرار
    const cacheKey = `p_${databasePhone}`;
    if (global.C.has(cacheKey)) {
      return res.status(200).json(global.C.get(cacheKey));
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    const target = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${scrapePhone}&nocache=${Date.now()}`;

    const reqHeaders = { ...H, 'referer': dynamicReferer };

    const apiFast = `https://api.scraperapi.com/?api_key=${K}&url=${encodeURIComponent(target)}&render=false&ultra_fast=true`;
    const apiBack = `https://api.scraperapi.com/?api_key=${K}&url=${encodeURIComponent(target)}&render=false`;

    let names = [];
    try {
      // ⚡ 2. سباق ثلاثي محلي ودولي متوازي بنفس الملي ثانية
      names = await Promise.any([
        f(target, reqHeaders, 1500),  // مباشر خاطف (1.5 ثانية)
        f(apiFast, reqHeaders, 4000), // أسرع وضع لـ ScraperAPI (4 ثوانٍ)
        f(apiBack, reqHeaders, 8000)  // احتياطي (8 ثوانٍ)
      ]);
    } catch {
      names = [];
    }

    if (!names.length) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    const out = {
      success: true,
      results: names.map(n => ({
        name: n,
        phone: databasePhone,
        source: 'Database',
        provider,
        formattedDate: new Date().toLocaleDateString('ar-EG')
      })),
      total: names.length,
      cached_at: new Date().toISOString()
    };

    global.C.set(cacheKey, out);
    return res.status(200).json(out);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
};
