const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

class EnhancedPricingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
      maxRetries: 2,
    });
    
    this.pricingData = null;
    this.lastFetch = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
    this.csvFilePath = path.join(__dirname, '..', 'pricing.csv');
    
    // Store embeddings cache
    this.productEmbeddings = new Map();
    this.embeddingsCacheFile = path.join(__dirname, '..', 'embeddings-cache.json');
    
    console.log('✅ Enhanced Pricing Service initialized with OpenAI embeddings');
  }
  
  /**
   * Get pricing data with enhanced search capabilities
   */
  async getPricingData() {
    try {
      // Check cache first
      if (this.pricingData && this.lastFetch && 
          (Date.now() - this.lastFetch) < this.cacheTimeout) {
        console.log('📊 Using cached pricing data');
        return this.pricingData;
      }
      
      console.log('📊 Reading pricing data from local CSV file...');
      console.log('📁 CSV file path:', this.csvFilePath);
      
      // Check if file exists
      if (!fs.existsSync(this.csvFilePath)) {
        throw new Error(`Pricing CSV file not found at: ${this.csvFilePath}. Please ensure pricing.csv is in the project root.`);
      }
      
      // Read the CSV file
      const csvData = fs.readFileSync(this.csvFilePath, 'utf8');
      
      if (!csvData.trim()) {
        throw new Error('CSV file is empty');
      }
      
      // Parse CSV data
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        throw new Error('Invalid CSV data - no pricing rows found');
      }
      
      // Parse headers
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      console.log('📋 CSV Headers:', headers);
      
      // Parse data rows with enhanced processing
      const pricingItems = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        
        if (values.length >= 2 && values[0]) {
          const item = {};
          headers.forEach((header, index) => {
            item[header] = values[index] || '';
          });
          
          // Enhanced item processing
          item._enhanced = this._enhanceProductItem(item, headers);
          pricingItems.push(item);
        }
      }
      
      this.pricingData = {
        items: pricingItems,
        total_count: pricingItems.length,
        last_updated: new Date().toISOString(),
        headers: headers,
        source: 'local-csv-enhanced'
      };
      
      this.lastFetch = Date.now();
      
      console.log(`✅ Loaded ${pricingItems.length} pricing items from local CSV`);
      
      // Load or generate embeddings
      await this._loadOrGenerateEmbeddings();
      
      return this.pricingData;
      
    } catch (error) {
      console.error('❌ Error reading pricing CSV:', error.message);
      
      // Return cached data if available, even if expired
      if (this.pricingData) {
        console.log('⚠️ Returning expired cached data due to file read error');
        return this.pricingData;
      }
      
      // Return empty data as fallback
      return {
        items: [],
        total_count: 0,
        last_updated: new Date().toISOString(),
        error: `Failed to read pricing CSV: ${error.message}`,
        headers: [],
        source: 'local-csv-error'
      };
    }
  }
  
  /**
   * Enhanced product search using OpenAI embeddings
   */
  async findRelevantProducts(query, maxResults = 20) {
    try {
      if (!this.pricingData || this.pricingData.items.length === 0) {
        console.log('⚠️ No pricing data available for embedding search');
        return [];
      }
      
      console.log('🔍 Searching products with embeddings for:', query);
      
      // Generate embedding for user query
      const queryEmbedding = await this._generateEmbedding(query);
      
      if (!queryEmbedding) {
        console.log('⚠️ Failed to generate query embedding, falling back to keyword search');
        return this._fallbackKeywordSearch(query, maxResults);
      }
      
      // Calculate similarity scores
      const similarities = [];
      
      for (const item of this.pricingData.items) {
        const productKey = this._getProductKey(item);
        const productEmbedding = this.productEmbeddings.get(productKey);
        
        if (productEmbedding) {
          const similarity = this._cosineSimilarity(queryEmbedding, productEmbedding);
          similarities.push({
            item,
            similarity,
            productKey
          });
        }
      }
      
      // Sort by similarity and return top results
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      const results = similarities.slice(0, maxResults).map(s => ({
        ...s.item,
        _similarity: s.similarity,
        _productKey: s.productKey
      }));
      
      console.log(`✅ Found ${results.length} products using embeddings`);
      console.log('🎯 Top similarities:', results.slice(0, 3).map(r => 
        `${r._productKey}: ${(r._similarity * 100).toFixed(1)}%`
      ));
      
      return results;
      
    } catch (error) {
      console.error('❌ Embedding search error:', error.message);
      return this._fallbackKeywordSearch(query, maxResults);
    }
  }
  
  /**
   * Get ALL quality options for a specific device/service combination
   */
  async findAllQualityOptions(device, service) {
    try {
      const query = `${device} ${service}`;
      const allResults = await this.findRelevantProducts(query, 100);
      
      // Group by device and service to find all quality variants
      const qualityGroups = new Map();
      
      for (const item of allResults) {
        const enhanced = item._enhanced;
        
        // Check if this item matches the device and service
        if (this._matchesDeviceAndService(enhanced, device, service)) {
          const baseKey = `${enhanced.brand}_${enhanced.device}_${enhanced.service}`;
          
          if (!qualityGroups.has(baseKey)) {
            qualityGroups.set(baseKey, []);
          }
          
          qualityGroups.get(baseKey).push({
            ...item,
            quality: enhanced.quality,
            price: this._extractValidPrice(item),
            baseKey
          });
        }
      }
      
      // Return all quality options grouped
      const result = [];
      for (const [baseKey, options] of qualityGroups) {
        // Sort by price (lowest first)
        options.sort((a, b) => (a.price || 999999) - (b.price || 999999));
        result.push({
          baseKey,
          device,
          service,
          options
        });
      }
      
      console.log(`🎯 Found ${result.length} quality groups for ${device} ${service}`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Error finding quality options:', error.message);
      return [];
    }
  }
  
  /**
   * Enhanced item processing to extract device info, service type, quality
   */
  _enhanceProductItem(item, headers) {
    const productName = (item[headers[0]] || '').toLowerCase();
    
    // Extract device brand
    const brand = this._extractBrand(productName);
    
    // Extract device model
    const device = this._extractDevice(productName);
    
    // Extract service type
    const service = this._extractService(productName);
    
    // Extract quality type
    const quality = this._extractQuality(productName);
    
    return {
      brand,
      device, 
      service,
      quality,
      originalName: item[headers[0]] || '',
      searchableText: productName
    };
  }
  
  /**
   * Extract brand from product name
   */
  _extractBrand(productName) {
    const brands = [
      'iphone', 'apple', 'samsung', 'galaxy', 'huawei', 'xiaomi', 'redmi', 'mi',
      'motorola', 'moto', 'nokia', 'lg', 'sony', 'google', 'pixel', 'honor',
      'oppo', 'vivo', 'realme', 'oneplus', 'asus', 'caterpillar', 'cat',
      'lenovo', 'tcl', 'tecno', 'wiko', 'zte'
    ];
    
    for (const brand of brands) {
      if (productName.includes(brand)) {
        // Normalize brand names
        if (brand === 'galaxy') return 'samsung';
        if (brand === 'redmi' || brand === 'mi') return 'xiaomi';
        if (brand === 'moto') return 'motorola';
        if (brand === 'pixel') return 'google';
        if (brand === 'cat') return 'caterpillar';
        return brand;
      }
    }
    
    return 'unknown';
  }
  
  /**
   * Extract device model from product name
   */
  _extractDevice(productName) {
    // iPhone models
    const iphoneMatch = productName.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?|se|xr|xs(?:\s*max)?|x)/i);
    if (iphoneMatch) {
      return `iphone ${iphoneMatch[1].toLowerCase()}`;
    }
    
    // Samsung Galaxy models
    const galaxyMatch = productName.match(/galaxy\s*([a-z]\d+|note\s*\d+|s\d+)/i);
    if (galaxyMatch) {
      return `galaxy ${galaxyMatch[1].toLowerCase()}`;
    }
    
    // Generic model extraction
    const modelMatch = productName.match(/\b([a-z]*\d+[a-z]*(?:\s*(?:pro|max|plus|mini|lite|se|ultra|note|edge|fold|flip))*)\b/i);
    if (modelMatch) {
      return modelMatch[1].toLowerCase();
    }
    
    return 'unknown';
  }
  
  /**
   * Extract service type from product name
   */
  _extractService(productName) {
    const serviceMap = {
      'pantalla': ['pantalla', 'display', 'screen', 'lcd', 'oled'],
      'bateria': ['bateria', 'batería', 'battery'],
      'camara': ['camara', 'cámara', 'camera', 'lente'],
      'carga': ['carga', 'charging', 'conector', 'puerto'],
      'altavoz': ['altavoz', 'speaker', 'audio'],
      'tactil': ['tactil', 'táctil', 'touch'],
      'vidrio': ['vidrio', 'glass', 'cristal'],
      'tapa': ['tapa', 'cover', 'back', 'trasera'],
      'flex': ['flex', 'flexible'],
      'agua': ['agua', 'water', 'mojado'],
      'reparacion': ['reparacion', 'reparación', 'repair']
    };
    
    for (const [serviceType, keywords] of Object.entries(serviceMap)) {
      for (const keyword of keywords) {
        if (productName.includes(keyword)) {
          return serviceType;
        }
      }
    }
    
    return 'general';
  }
  
  /**
   * Extract quality type from product name
   */
  _extractQuality(productName) {
    const qualityKeywords = {
      'original': ['original', 'ori', 'oem', 'genuine'],
      'compatible': ['compatible', 'comp', 'aftermarket'],
      'incell': ['incell', 'in-cell'],
      'oled': ['oled', 'amoled'],
      'lcd': ['lcd', 'ips'],
      'premium': ['premium', 'high quality', 'hq'],
      'economic': ['economic', 'eco', 'basic']
    };
    
    for (const [quality, keywords] of Object.entries(qualityKeywords)) {
      for (const keyword of keywords) {
        if (productName.includes(keyword)) {
          return quality;
        }
      }
    }
    
    return 'standard';
  }
  
  /**
   * Load or generate embeddings for all products
   */
  async _loadOrGenerateEmbeddings() {
    try {
      // Try to load existing embeddings
      if (fs.existsSync(this.embeddingsCacheFile)) {
        console.log('📁 Loading cached embeddings...');
        const cached = JSON.parse(fs.readFileSync(this.embeddingsCacheFile, 'utf8'));
        
        // Convert array format back to Map
        for (const [key, embedding] of cached) {
          this.productEmbeddings.set(key, embedding);
        }
        
        console.log(`✅ Loaded ${this.productEmbeddings.size} cached embeddings`);
        
        // Check if we need to generate new embeddings
        const existingKeys = new Set(this.productEmbeddings.keys());
        const currentKeys = new Set(this.pricingData.items.map(item => this._getProductKey(item)));
        
        const newItems = this.pricingData.items.filter(item => 
          !existingKeys.has(this._getProductKey(item))
        );
        
        if (newItems.length > 0) {
          console.log(`🔄 Generating embeddings for ${newItems.length} new products...`);
          await this._generateNewEmbeddings(newItems);
        }
        
        return;
      }
      
      // Generate all embeddings
      console.log('🔄 Generating embeddings for all products...');
      await this._generateAllEmbeddings();
      
    } catch (error) {
      console.error('❌ Error with embeddings:', error.message);
      // Continue without embeddings - fallback to keyword search
    }
  }
  
  /**
   * Generate embeddings for all products
   */
  async _generateAllEmbeddings() {
    const batchSize = 20; // Process in batches to avoid rate limits
    const items = this.pricingData.items;
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)}`);
      
      await Promise.all(batch.map(async (item) => {
        try {
          const productKey = this._getProductKey(item);
          const searchText = this._getSearchableText(item);
          const embedding = await this._generateEmbedding(searchText);
          
          if (embedding) {
            this.productEmbeddings.set(productKey, embedding);
          }
        } catch (error) {
          console.error(`⚠️ Failed to generate embedding for ${this._getProductKey(item)}:`, error.message);
        }
      }));
      
      // Rate limiting
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`✅ Generated embeddings for ${this.productEmbeddings.size} products`);
    await this._saveEmbeddingsCache();
  }
  
  /**
   * Generate embeddings for new items only
   */
  async _generateNewEmbeddings(newItems) {
    for (const item of newItems) {
      try {
        const productKey = this._getProductKey(item);
        const searchText = this._getSearchableText(item);
        const embedding = await this._generateEmbedding(searchText);
        
        if (embedding) {
          this.productEmbeddings.set(productKey, embedding);
        }
      } catch (error) {
        console.error(`⚠️ Failed to generate embedding for ${this._getProductKey(item)}:`, error.message);
      }
    }
    
    await this._saveEmbeddingsCache();
  }
  
  /**
   * Generate embedding for text using OpenAI
   */
  async _generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small", // Cost-effective embedding model
        input: text.substring(0, 8000), // Limit text length
        encoding_format: "float"
      });
      
      return response.data[0].embedding;
      
    } catch (error) {
      console.error('❌ OpenAI embedding error:', error.message);
      return null;
    }
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Save embeddings to cache file
   */
  async _saveEmbeddingsCache() {
    try {
      // Convert Map to array for JSON serialization
      const embeddingsArray = Array.from(this.productEmbeddings.entries());
      fs.writeFileSync(this.embeddingsCacheFile, JSON.stringify(embeddingsArray, null, 2));
      console.log('💾 Embeddings cache saved');
    } catch (error) {
      console.error('⚠️ Failed to save embeddings cache:', error.message);
    }
  }
  
  /**
   * Get unique key for a product
   */
  _getProductKey(item) {
    const enhanced = item._enhanced;
    if (enhanced) {
      return `${enhanced.brand}_${enhanced.device}_${enhanced.service}_${enhanced.quality}`;
    }
    
    // Fallback
    const firstCol = Object.values(item)[0] || '';
    return firstCol.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  /**
   * Get searchable text for a product
   */
  _getSearchableText(item) {
    const enhanced = item._enhanced;
    if (enhanced) {
      return `${enhanced.originalName} ${enhanced.brand} ${enhanced.device} ${enhanced.service} ${enhanced.quality}`;
    }
    
    // Fallback - use first column
    return Object.values(item)[0] || '';
  }
  
  /**
   * Check if item matches device and service
   */
  _matchesDeviceAndService(enhanced, device, service) {
    const deviceLower = device.toLowerCase();
    const serviceLower = service.toLowerCase();
    
    const deviceMatch = enhanced.device.includes(deviceLower) || 
                       enhanced.brand.includes(deviceLower) ||
                       enhanced.originalName.toLowerCase().includes(deviceLower);
    
    const serviceMatch = enhanced.service.includes(serviceLower) ||
                        enhanced.originalName.toLowerCase().includes(serviceLower);
    
    return deviceMatch && serviceMatch;
  }
  
  /**
   * Extract valid price from item, handling 0 UYU issues
   */
  _extractValidPrice(item) {
    // Try multiple price columns
    const priceFields = ['PUBLICO TIENDA', 'price', 'precio', 'cost', 'costo'];
    
    for (const field of priceFields) {
      if (item[field]) {
        const price = parseFloat(item[field].toString().replace(/[^0-9.]/g, ''));
        if (price > 0) {
          return price;
        }
      }
    }
    
    return null; // Return null for invalid prices
  }
  
  /**
   * Fallback keyword search when embeddings fail
   */
  _fallbackKeywordSearch(query, maxResults = 20) {
    console.log('🔄 Using fallback keyword search');
    
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(' ').filter(k => k.length > 2);
    
    const results = this.pricingData.items
      .map(item => {
        const text = this._getSearchableText(item).toLowerCase();
        let score = 0;
        
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            score += 1;
          }
        }
        
        return { item, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(r => r.item);
    
    console.log(`✅ Keyword search found ${results.length} results`);
    return results;
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.pricingData = null;
    this.lastFetch = null;
    this.productEmbeddings.clear();
    console.log('🗑️ Enhanced pricing cache cleared');
  }
  
  /**
   * Clear embeddings cache
   */
  clearEmbeddingsCache() {
    this.productEmbeddings.clear();
    if (fs.existsSync(this.embeddingsCacheFile)) {
      fs.unlinkSync(this.embeddingsCacheFile);
    }
    console.log('🗑️ Embeddings cache cleared');
  }
}

module.exports = new EnhancedPricingService();