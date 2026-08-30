const NodeCache = require('node-cache');

// كاش يدوم لمدة 48 ساعة للسرعة اللحظية في حال تكرار الرقم
const cache = new NodeCache({ stdTTL: 172800, checkperiod: 600 });
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "1432f28f4c66602b7020a6f1bf5fd9ba";

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

const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم',
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن',
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
]);

function isRealName(name) {
  if (!name || name.length < 3) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.has(name.trim())) return false;
  return /[\u0600-\u06FFa-zA-Z]/.test(name);
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/عدد\s*السجلات\s*المكتشفة|هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعاً\s*لهذا\s*الرقم|نتائج\s*البحث\s*للرقم|[\\{}{}\[\]"':\-_,\/|\.]/gi, ' ')
    .replace(/\b(عدد|السجلات|المكتشفة|الأكثر|شيوعا|شيوعاً|لهذا|الرقم|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|هاتف|ثابت)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNames(content) {
  const names = new Set();
  if (!content) return [];

  let parsed = null;
  try { parsed = JSON.parse(content); } catch (e) {}

  const text = parsed ? (typeof parsed === 'string' ? parsed : (parsed.result || JSON.stringify(parsed))) : content;

  if (text) {
    const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
    if (fameMatch) {
      let name = cleanExtractedName(fameMatch[1]);
      if (isRealName(name)) names.add(name);
    }

    const numberedMatches = text.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)/g);
    for (const match of numberedMatches) {
      let name = cleanExtractedName(match[2] || match[1]);
      if (isRealName(name)) names.add(name);
    }
  }

  return Array.from(names).slice(0, 200);
}

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

// دالة جلب مع مهلة 20 ثانية لضمان انتهاء الطلب بنجاح
async function fetchWithRetry(url, headers, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 20000); // 20 ثانية كحد أقصى

    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        const txt = await res.text();
        const names = parseNames(txt);
        if (names.length > 0) return names;
      }
    } catch (err) {
      clearTimeout(id);
    }
  }
  return [];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const query = req.method === 'GET' ? req.query.query : (req.body ? req.body.query : null);

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let rawDigits = String(query).replace(/\D/g, '');
    if (rawDigits.startsWith('00')) rawDigits = rawDigits.substring(2);

    let provider = '';
    let databasePhone = '';
    let scrapePhone = '';

    if (rawDigits.startsWith('967')) {
      const cleanYemen = rawDigits.slice(-9);
      provider = detectProviderAndCountry(rawDigits, cleanYemen);
      databasePhone = '0' + cleanYemen;
      scrapePhone = '967' + cleanYemen;
    } else if (rawDigits.length === 9 && /^(77|78|73|71|70)/.test(rawDigits)) {
      provider = detectProviderAndCountry('', rawDigits);
      databasePhone = '0' + rawDigits;
      scrapePhone = '967' + rawDigits;
    } else if (rawDigits.length === 10 && rawDigits.startsWith('07')) {
      const cleanYemen = rawDigits.substring(1);
      provider = detectProviderAndCountry('', cleanYemen);
      databasePhone = rawDigits;
      scrapePhone = '967' + cleanYemen;
    } else {
      provider = detectProviderAndCountry(rawDigits, null);
      databasePhone = '+' + rawDigits;
      scrapePhone = rawDigits;
    }

    // 1. التثبت من الكاش أولاً
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${scrapePhone}&nocache=${Date.now()}`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'ar,en;q=0.9',
      'referer': dynamicReferer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
    };

    // رابط ScraperAPI محسّن للطلب العالي والأكيد
    const scrapingApiUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false&keep_headers=true`;

    // 2. المحاولة المباشرة أولاً بسرعة
    let names = await fetchWithRetry(targetUrl, browserHeaders, 1);

    // 3. إذا لم تجلب المحاولة المباشرة نتائج، يتم الانتقال تلقائياً لـ ScraperAPI مع إعادة المحاولة
    if (!names || names.length === 0) {
      names = await fetchWithRetry(scrapingApiUrl, browserHeaders, 2);
    }

    if (!names || names.length === 0) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    const results = names.map(name => ({
      name,
      phone: databasePhone,
      source: 'Database',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: 'scrapingapi',
      cached_at: new Date().toISOString()
    };

    cache.set(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
};