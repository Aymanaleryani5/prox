// api/search.js

const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم',
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن',
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
]);

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

function isRealName(name) {
  if (!name || name.length < 3) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.has(name.trim())) return false;
  return /[\u0600-\u06FFa-zA-Z]/.test(name);
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/(عدد\s*السجلات\s*المكتشفة|هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعاً\s*لهذا\s*الرقم|نتائج\s*البحث\s*للرقم|\b(عدد|السجلات|المكتشفة|الأكثر|شيوعا|شيوعاً|لهذا|الرقم|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|هاتف|ثابت)\b|[\\{}()\[\]"':\-_,\/|\.])/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNamesFromJSON(jsonData) {
  const names = new Set();
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (isRealName(name)) names.add(name);
      }

      const numberedMatches = text.matchAll(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      for (const match of numberedMatches) {
        if (names.size >= 200) break;
        let name = cleanExtractedName(match[1]);
        if (isRealName(name)) names.add(name);
      }
    }
  } catch (e) {}
  return Array.from(names);
}

function extractNamesFromResponse(html) {
  const names = new Set();
  const numberedMatches = html.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)/g);
  for (const match of numberedMatches) {
    if (names.size >= 200) break;
    let name = cleanExtractedName(match[2]);
    if (isRealName(name)) names.add(name);
  }
  return Array.from(names);
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    return null;
  }
}

async function processFetch(url, headers) {
  const res = await fetchWithTimeout(url, { method: 'GET', headers }, 4000);
  if (!res || !res.ok) return null;
  const text = await res.text();
  let extracted = [];
  try { extracted = extractNamesFromJSON(JSON.parse(text)); } 
  catch { extracted = extractNamesFromResponse(text); }
  return extracted.length > 0 ? extracted : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');

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

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${scrapePhone}&nocache=${Date.now()}`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'ar,en;q=0.9',
      'referer': dynamicReferer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
    };

    const apiKey = process.env.SCRAPINGAPI_API_KEY || "90ab24837fbb87a203ab5220f10c1338";
    const fastScrapingUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=false&ultra_fast=true&keep_headers=true`;

    let names = await processFetch(targetUrl, browserHeaders);
    let source = 'direct';

    if (!names) {
      names = await processFetch(fastScrapingUrl, browserHeaders);
      source = 'scrapingapi';
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

    return res.status(200).json({
      success: true,
      results,
      total: results.length,
      source
    });

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
}
