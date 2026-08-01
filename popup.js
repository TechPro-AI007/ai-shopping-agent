const MODEL_FALLBACKS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

const SHOPPING_SCHEMA = {
  type: "OBJECT",
  properties: {
    productName: { type: "STRING", description: "Full product title" },
    price: { type: "STRING", description: "Active selling price" },
    reviewSentiment: { type: "STRING", description: "Summary of real user feedback and common complaints" },
    pros: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "3-4 real highlights from specs and customer reviews"
    },
    cons: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "3-4 real drawbacks, bad reviews, or price concerns"
    },
    priceEvaluation: { type: "STRING", description: "Whether this item is priced fairly, overpriced, or a good deal" },
    returnFlags: { type: "STRING", description: "Return policy details, hidden delivery/service fees, or seller warnings" },
    valueScore: { type: "NUMBER", description: "Score out of 10 evaluating overall value for money" },
    recommendation: {
      type: "STRING",
      enum: ["MUST BUY", "WAIT FOR DISCOUNT", "SKIP"],
      description: "Final buying recommendation"
    }
  },
  required: ["productName", "price", "reviewSentiment", "pros", "cons", "priceEvaluation", "returnFlags", "valueScore", "recommendation"]
};

document.addEventListener('DOMContentLoaded', async () => {
  const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const saveStatus = document.getElementById('saveStatus');
  const analyzeBtn = document.getElementById('analyzeBtn');

  // Load saved API Key on popup open
  const stored = await chrome.storage.local.get(['geminiApiKey']);
  if (stored && stored.geminiApiKey) {
    if (apiKeyInput) apiKeyInput.value = stored.geminiApiKey;
  } else {
    if (settingsPanel) settingsPanel.classList.remove('hidden');
  }

  // Toggle settings view
  toggleSettingsBtn?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('hidden');
  });

  // Save API key handler
  saveKeyBtn?.addEventListener('click', async () => {
    const key = apiKeyInput?.value.trim();
    if (key) {
      await chrome.storage.local.set({ geminiApiKey: key });
      if (saveStatus) saveStatus.innerText = 'Key saved!';
      setTimeout(() => {
        if (saveStatus) saveStatus.innerText = '';
        settingsPanel?.classList.add('hidden');
      }, 1000);
    }
  });

  // Main Analyze Button Handler
  analyzeBtn?.addEventListener('click', async () => {
    const resultContainer = document.getElementById('resultContainer');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');

    const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);

    if (!geminiApiKey) {
      settingsPanel?.classList.remove('hidden');
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div class="card" style="border-color: var(--warning);">
            <div style="color: var(--warning); font-weight: 600;">⚠️ API Key Required</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              Please paste your Gemini API key above to start analyzing.
            </div>
          </div>
        `;
      }
      return;
    }

    setLoading(true, analyzeBtn, btnText, btnSpinner);
    
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="card">
          <div style="color: var(--text-muted); text-align: center; font-size: 12px;">
            📸 Capturing visible viewport & extracting DOM metadata...
          </div>
        </div>
      `;
    }

    try {
      // Optimized fast JPEG capture (~250KB)
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
      const base64Image = dataUrl.split(',')[1];

      const activeTab = await getActiveTab();
      let domText = '';

      try {
        const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'extractProductData' });
        if (response && response.data) {
          domText = `
EXTRACTED PAGE DATA & REVIEWS:
- Title: ${response.data.title}
- Price Tag: ${response.data.price}
- Rating: ${response.data.rating} (${response.data.reviewCount})
- Scraped Customer Reviews: ${response.data.reviews}
- Scraped Return Policy: ${response.data.returnPolicy}
- Page Text Excerpt: ${response.data.bodyExcerpt}
`;
        }
      } catch (e) {
        console.warn('DOM Extraction fallback triggered:', e);
      }

      // Moved OUTSIDE the if-block so it is always accessible!
      const promptText = `
You are an expert e-commerce analyst evaluating a live product listing.

INSTRUCTIONS:
1. Treat the product title, specs, and model on page as authentic and actively available.
2. ANALYZE REVIEWS & SENTIMENT: Use the scraped customer reviews and visual elements in the screenshot to extract actual user pros, cons, and common product failure points.
3. EVALUATE PRICE & VALUE: Compare the price to typical market value for similar specs. Indicate if it's a good deal or overpriced.
4. CHECK RETURN POLICIES: Highlight return restrictions, short replacement windows, or extra service/delivery fees.
5. Provide an objective Value Score (1-10) and a clear Recommendation (MUST BUY, WAIT FOR DISCOUNT, or SKIP).

${domText}
`;

      const analysisData = await callGeminiWithFallback(geminiApiKey, base64Image, promptText);
      renderReport(resultContainer, analysisData);

    } catch (err) {
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div class="card" style="border-color: var(--danger);">
            <div class="card-title" style="color: var(--danger);">Analysis Failed</div>
            <div style="font-size: 12px;">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      setLoading(false, analyzeBtn, btnText, btnSpinner);
    }
  });
});

// API Call Logic with Tier Fallbacks
async function callGeminiWithFallback(apiKey, base64Image, promptText) {
  let lastErr = null;

  for (const model of MODEL_FALLBACKS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
                { text: promptText }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
              responseSchema: SHOPPING_SCHEMA
            }
          })
        }
      );

      const resData = await response.json();

      if (response.ok && resData.candidates?.[0]?.content?.parts?.[0]?.text) {
        return JSON.parse(resData.candidates[0].content.parts[0].text);
      }

      if (resData.error?.code === 404) {
        lastErr = new Error(resData.error.message);
        continue;
      }

      throw new Error(resData.error?.message || 'API response was empty.');
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('All model endpoints failed.');
}

// UI Render Helper
function renderReport(container, data) {
  if (!container) return;
  const verdictClass = `verdict-${data.recommendation.replace(/\s+/g, '-')}`;

  container.innerHTML = `
    <div class="verdict-banner ${verdictClass}">
      <span>VERDICT: ${escapeHtml(data.recommendation)}</span>
      <span class="score-pill">${data.valueScore}/10</span>
    </div>

    <div class="card">
      <div class="card-title">Product & Pricing</div>
      <div style="font-weight: 600; font-size: 13px;">${escapeHtml(data.productName)}</div>
      <div style="color: var(--accent-blue); font-weight: 700; margin-top: 4px;">${escapeHtml(data.price)}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; font-style: italic;">
        💰 ${escapeHtml(data.priceEvaluation)}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Customer Review Summary</div>
      <div style="font-size: 12px; margin-bottom: 8px;">${escapeHtml(data.reviewSentiment)}</div>
      <div class="pros-cons-grid">
        ${data.pros.map(p => `<div class="pro-item">${escapeHtml(p)}</div>`).join('')}
        ${data.cons.map(c => `<div class="con-item">${escapeHtml(c)}</div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Return Policy & Seller Fine Print</div>
      <div style="font-size: 12px;">🛡️ ${escapeHtml(data.returnFlags)}</div>
    </div>
  `;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setLoading(isLoading, btn, text, spinner) {
  if (!btn) return;
  btn.disabled = isLoading;
  spinner?.classList.toggle('hidden', !isLoading);
  text?.classList.toggle('hidden', isLoading);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}