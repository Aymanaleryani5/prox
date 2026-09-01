const NodeCache = require('node-cache');

// ==========================================================
// 📊 نظام الكاش (Memory Cache)
// ==========================================================
class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 172800, checkperiod: 172800 });
  }

  match(requestKey) {
    return this.cache.get(requestKey) || null;
  }

  put(requestKey, responseData) {
    this.cache.set(requestKey, responseData);
  }
}

// ==========================================================
// 🌍 خريطة مفاتيح دول العالم
// ==========================================================
const COUNTRY_CODES = [
  { code: '967', country: 'اليمن' },
  { code: '966', country: 'السعودية' },
  { code: '20', country: 'مصر' },
  { code: '971', country: 'الإمارات' },
  { code: '965', country: 'الكويت' },
  { code: '968', country: 'عُمان' },
  { code: '974', country: 'قطر' },
  { code: '973', country: 'البحرين' },
  { code: '962', country: 'الأردن' },
  { code: '961', country: 'لبنان' },
  { code: '963', country: 'سوريا' },
  { code: '964', country: 'العراق' },
  { code: '970', country: 'فلسطين' },
  { code: '212', country: 'المغرب' },
  { code: '213', country: 'الجزائر' },
  { code: '216', country: 'تونس' },
  { code: '218', country: 'ليبيا' },
  { code: '249', country: 'السودان' },
  { code: '1', country: 'أمريكا / كندا' },
  { code: '44', country: 'بريطانيا' },
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
        let name = cleanExtractedName(match[1]);
        if (isRealName(name)) names.add(name);
      }
    }
  } catch (e) {}
  return Array.from(names).slice(0, 200);
}

function extractNamesFromResponse(html) {
  const names = new Set();
  const numberedMatches = html.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)/g);
  for (const match of numberedMatches) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name)) names.add(name);
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
    if (fullPhone.startsWith(item.code)) {
      return item.country;
    }
  }

  return 'رقم دولي';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// ==========================================================
// 🔧 محاولة البدائل المتعددة مع ScrapingAPI
// ==========================================================
async function searchWithScraperAPI(phone, apiKey) {
  console.log(`🔍 بدء البحث عن الرقم: ${phone}`);
  
  const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${phone}&nocache=${Date.now()}`;
  
  const browserHeaders = {
    'accept': '*/*',
    'accept-language': 'ar,en;q=0.9',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // ✅ المحاولة 1: ScrapingAPI مع render=true
  try {
    console.log('📡 المحاولة 1: ScrapingAPI مع render=true');
    const url1 = `https://api.scrapingapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true&timeout=20000&wait=3000`;
    const response = await fetchWithTimeout(url1, { 
      method: 'GET', 
      headers: browserHeaders 
    }, 25000);
    
    if (response.ok) {
      const content = await response.text();
      console.log('✅ تم استلام رد من ScrapingAPI (render=true), الطول:', content.length);
      let extracted = extractNamesFromResponse(content);
      if (extracted.length > 0) {
        console.log(`✅ تم استخراج ${extracted.length} اسم`);
        return { names: extracted, source: 'scraperapi_render' };
      }
    } else {
      console.log('❌ فشل المحاولة 1: الحالة', response.status);
    }
  } catch (e) {
    console.log('❌ المحاولة 1 فشلت:', e.message);
  }

  // ✅ المحاولة 2: ScrapingAPI مع render=false
  try {
    console.log('📡 المحاولة 2: ScrapingAPI مع render=false');
    const url2 = `https://api.scrapingapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=false&timeout=15000`;
    const response = await fetchWithTimeout(url2, { 
      method: 'GET', 
      headers: browserHeaders 
    }, 20000);
    
    if (response.ok) {
      const content = await response.text();
      console.log('✅ تم استلام رد من ScrapingAPI (render=false), الطول:', content.length);
      let extracted;
      try {
        extracted = extractNamesFromJSON(JSON.parse(content));
      } catch {
        extracted = extractNamesFromResponse(content);
      }
      if (extracted.length > 0) {
        console.log(`✅ تم استخراج ${extracted.length} اسم`);
        return { names: extracted, source: 'scraperapi_no_render' };
      }
    } else {
      console.log('❌ فشل المحاولة 2: الحالة', response.status);
    }
  } catch (e) {
    console.log('❌ المحاولة 2 فشلت:', e.message);
  }

  // ✅ المحاولة 3: ScrapingAPI مع proxy فقط
  try {
    console.log('📡 المحاولة 3: ScrapingAPI مع proxy فقط');
    const url3 = `https://api.scrapingapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&proxy_country=US`;
    const response = await fetchWithTimeout(url3, { 
      method: 'GET', 
      headers: browserHeaders 
    }, 15000);
    
    if (response.ok) {
      const content = await response.text();
      console.log('✅ تم استلام رد من ScrapingAPI (proxy), الطول:', content.length);
      let extracted = extractNamesFromResponse(content);
      if (extracted.length > 0) {
        console.log(`✅ تم استخراج ${extracted.length} اسم`);
        return { names: extracted, source: 'scraperapi_proxy' };
      }
    } else {
      console.log('❌ فشل المحاولة 3: الحالة', response.status);
    }
  } catch (e) {
    console.log('❌ المحاولة 3 فشلت:', e.message);
  }

  // ✅ المحاولة 4: محاولة مباشرة (كحل أخير)
  try {
    console.log('📡 المحاولة 4: محاولة مباشرة');
    const response = await fetchWithTimeout(targetUrl, {
      method: 'GET',
      headers: browserHeaders
    }, 10000);
    if (response.ok) {
      const content = await response.text();
      console.log('✅ تم استلام رد مباشر, الطول:', content.length);
      let extracted = extractNamesFromResponse(content);
      if (extracted.length > 0) {
        console.log(`✅ تم استخراج ${extracted.length} اسم`);
        return { names: extracted, source: 'direct' };
      }
    } else {
      console.log('❌ فشل المحاولة 4: الحالة', response.status);
    }
  } catch (e) {
    console.log('❌ المحاولة 4 فشلت:', e.message);
  }

  console.log('❌ جميع المحاولات فشلت في جلب البيانات');
  return null;
}

// ==========================================================
// 🔑 المفتاح مضمن هنا مباشرة
// ==========================================================
const SCRAPINGAPI_API_KEY = "1432f28f4c66602b7020a6f1bf5fd9ba";

// إنشاء نسخة الكاش
const cache = new MemoryCache();

// ==========================================================
// 🚀 Handler الرئيسي لـ Vercel
// ==========================================================
module.exports = async (req, res) => {
  // إعداد CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Rate Limiting
  const ip = req.headers['cf-connecting-ip'] || 
             req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.socket?.remoteAddress || 
             'anonymous';
  
  const rateLimitKey = `ratelimit_${ip}`;
  const lastRequest = cache.match(rateLimitKey);
  
  if (lastRequest) {
    const timeDiff = Date.now() - lastRequest;
    if (timeDiff < 3000) {
      return res.status(429).json({
        success: false,
        results: [],
        total: 0,
        error: 'مهلاً! الرجاء الانتظار',
        message: '⏳ يرجى الانتظار 3 ثواني بين عمليات البحث'
      });
    }
  }
  cache.put(rateLimitKey, Date.now());

  try {
    const query = req.method === 'GET' ? req.query.query : req.body?.query;

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let rawDigits = String(query).replace(/\D/g, '');

    if (rawDigits.startsWith('00')) {
      rawDigits = rawDigits.substring(2);
    }

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

    console.log(`📱 معالجة الرقم: ${databasePhone} (${scrapePhone}) - ${provider}`);

    const cacheKey = `phone_${databasePhone}`;
    const cachedData = cache.match(cacheKey);

    if (cachedData) {
      console.log('💾 استخدام البيانات المخزنة مؤقتاً');
      res.setHeader('X-Cache-Status', 'HIT');
      return res.status(200).json(cachedData);
    }

    // ✅ محاولة البحث مع البدائل
    const result = await searchWithScraperAPI(scrapePhone, SCRAPINGAPI_API_KEY);

    if (!result || result.names.length === 0) {
      console.log('❌ لم يتم العثور على نتائج');
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: '❌ لم يتم العثور على نتائج',
        message: 'تأكد من صحة الرقم أو حاول مرة أخرى',
        debug: {
          phone: scrapePhone,
          provider: provider,
          apiKeyUsed: SCRAPINGAPI_API_KEY ? '✅ موجود' : '❌ مفقود',
          apiKeyLength: SCRAPINGAPI_API_KEY?.length || 0
        }
      });
    }

    console.log(`✅ نجح البحث: ${result.names.length} اسم مستخرج`);

    const results = result.names.map(name => ({
      name,
      phone: databasePhone,
      source: 'ScrapingAPI',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: result.source,
      cached_at: new Date().toISOString()
    };

    cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    console.error('❌ خطأ عام:', e.message);
    return res.status(500).json({ 
      success: false, 
      results: [], 
      total: 0, 
      error: '⚠️ خطأ في الخادم',
      message: e.message 
    });
  }
};
