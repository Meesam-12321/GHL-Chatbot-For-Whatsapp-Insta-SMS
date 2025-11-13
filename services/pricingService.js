const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

class FixedPricingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
      maxRetries: 2,
    });
    
    // ChromaDB-style vector store
    this.vectorStore = new Map(); // productId -> {embedding, metadata}
    this.products = new Map(); // productId -> {name, price, metadata}
    
    this.pricingData = null;
    this.csvFilePath = path.join(process.cwd(), 'pricing.csv');
    this.vectorCacheFile = path.join(process.cwd(), 'vector-cache.json');
    this.isInitialized = false;
    
    console.log('✅ ChromaDB-style Pricing Service initialized');
  }
  
  async getPricingData() {
    await this.initialize();
    return this.pricingData;
  }
  
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      console.log('📊 Loading products and generating embeddings...');
      
      // Load CSV data first
      await this._loadCSVData();
      
      // Load or generate embeddings for semantic search
      await this._loadOrGenerateVectorStore();
      
      this.isInitialized = true;
      console.log(`✅ Initialized with ${this.products.size} products`);
      
    } catch (error) {
      console.error('❌ Initialization error:', error.message);
      // Set empty data for fallback
      this.pricingData = { items: [], headers: ['Prod', 'PUBLICO TIENDA'] };
      this.isInitialized = true;
    }
  }
  
  async _loadCSVData() {
    if (!fs.existsSync(this.csvFilePath)) {
      throw new Error(`CSV file not found: ${this.csvFilePath}`);
    }
    
    const csvContent = fs.readFileSync(this.csvFilePath, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('Invalid CSV: no data rows');
    }
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const items = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      
      if (values[0] && values[0].trim()) {
        const productName = values[0].trim();
        const price = this._parsePrice(values[1]);
        
        // Create item for backward compatibility
        const item = {};
        headers.forEach((header, index) => {
          item[header] = values[index] || '';
        });
        items.push(item);
        
        // Generate unique ID for vector store
        const productId = `product_${i}_${productName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`;
        
        // Extract metadata for semantic search
        const metadata = {
          brand: this._extractBrand(productName),
          deviceModel: this._extractDeviceFromName(productName),
          serviceType: this._extractServiceType(productName),
          qualityType: this._extractQualityType(productName),
          originalIndex: i,
          hasValidPrice: price > 0
        };
        
        // Store in products map
        this.products.set(productId, {
          id: productId,
          name: productName,
          price: price,
          metadata: metadata,
          originalItem: item // Keep reference for compatibility
        });
      }
    }
    
    this.pricingData = { items, headers };
    console.log(`📋 Loaded ${items.length} products from CSV`);
  }
  
  async searchProducts(query, maxResults = 20) {
    try {
      await this.initialize();
      
      if (this.products.size === 0) {
        console.log('⚠️ No products available');
        return [];
      }
      
      console.log(`🔍 Semantic search for: "${query}"`);
      
      // Generate query embedding for semantic search
      const queryEmbedding = await this._generateEmbedding(query);
      if (!queryEmbedding) {
        return this._fallbackKeywordSearch(query, maxResults);
      }
      
      // Calculate semantic similarities
      const similarities = [];
      
      for (const [productId, vectorData] of this.vectorStore) {
        const similarity = this._cosineSimilarity(queryEmbedding, vectorData.embedding);
        
        if (similarity > 0.12) { // Lower threshold for better matching
          const product = this.products.get(productId);
          
          similarities.push({
            ...product.originalItem, // Return original item format for compatibility
            _similarity: similarity,
            _productId: productId,
            _metadata: product.metadata,
            _semanticMatch: true
          });
        }
      }
      
      // Sort by semantic similarity
      similarities.sort((a, b) => b._similarity - a._similarity);
      
      console.log(`🎯 Found ${similarities.length} semantic matches`);
      
      if (similarities.length === 0) {
        console.log('🔄 No semantic matches, trying keyword search...');
        return this._fallbackKeywordSearch(query, maxResults);
      }
      
      // Extract device model for exact filtering
      const deviceModel = this._extractExactDeviceModel(query);
      let results = similarities;
      
      // Apply exact model filtering if device detected
      if (deviceModel !== 'unknown') {
        console.log(`🔍 Filtering for exact model: "${deviceModel}"`);
        const exactMatches = this._filterByExactModel(similarities, deviceModel);
        
        if (exactMatches.length > 0) {
          results = exactMatches;
          console.log(`✅ Found ${exactMatches.length} exact model matches`);
        } else {
          // Find closest alternatives for approximate matching
          console.log('🔄 No exact matches, finding closest alternatives...');
          results = this._findClosestAlternatives(similarities, deviceModel);
          
          // Mark as approximate matches
          results.forEach(result => {
            result._isApproximate = true;
            result._exactModelRequested = deviceModel;
          });
        }
      }
      
      const finalResults = results.slice(0, maxResults);
      console.log(`✅ Returning ${finalResults.length} results`);
      
      return finalResults;
      
    } catch (error) {
      console.error('❌ Search error:', error.message);
      return this._fallbackKeywordSearch(query, maxResults);
    }
  }
  
  _extractExactDeviceModel(query) {
    const queryLower = query.toLowerCase();
    
    // iPhone patterns with exact matching
    const iphonePatterns = [
      { pattern: /iphone\s*15\s*pro\s*max/i, model: 'iphone 15 pro max' },
      { pattern: /iphone\s*15\s*pro(?!\s*max)/i, model: 'iphone 15 pro' },
      { pattern: /iphone\s*15\s*plus/i, model: 'iphone 15 plus' },
      { pattern: /iphone\s*15(?!\s*pro|\s*plus)/i, model: 'iphone 15' },
      { pattern: /iphone\s*14\s*pro\s*max/i, model: 'iphone 14 pro max' },
      { pattern: /iphone\s*14\s*pro(?!\s*max)/i, model: 'iphone 14 pro' },
      { pattern: /iphone\s*14\s*plus/i, model: 'iphone 14 plus' },
      { pattern: /iphone\s*14(?!\s*pro|\s*plus)/i, model: 'iphone 14' }, // EXACT iPhone 14, not Pro
      { pattern: /iphone\s*13\s*pro\s*max/i, model: 'iphone 13 pro max' },
      { pattern: /iphone\s*13\s*pro(?!\s*max)/i, model: 'iphone 13 pro' },
      { pattern: /iphone\s*13\s*mini/i, model: 'iphone 13 mini' },
      { pattern: /iphone\s*13(?!\s*pro|\s*mini)/i, model: 'iphone 13' }
    ];
    
    for (const { pattern, model } of iphonePatterns) {
      if (pattern.test(queryLower)) {
        return model;
      }
    }
    
    return 'unknown';
  }
  
  _filterByExactModel(results, targetModel) {
    return results.filter(item => {
      const productName = (item.Prod || '').toLowerCase();
      const targetLower = targetModel.toLowerCase();
      
      // For iPhone 14 (not Pro), exclude Pro variants
      if (targetModel === 'iphone 14') {
        return productName.includes('iphone 14') && 
               !productName.includes('pro') && 
               !productName.includes('plus');
      }
      
      // For iPhone 14 Pro (not Max), exclude Max variants
      if (targetModel === 'iphone 14 pro') {
        return productName.includes('iphone 14') && 
               productName.includes('pro') && 
               !productName.includes('max');
      }
      
      // For other models, exact match
      return productName.includes(targetLower);
    });
  }
  
  async _embeddingSearch(query, maxResults) {
    try {
      // Generate query embedding
      const queryEmbedding = await this._generateEmbedding(query);
      if (!queryEmbedding) {
        return [];
      }
      
      const results = [];
      
      for (const item of this.pricingData.items) {
        const productText = this._getProductText(item);
        const productKey = this._getProductKey(productText);
        const embedding = this.productEmbeddings.get(productKey);
        
        if (embedding) {
          const similarity = this._cosineSimilarity(queryEmbedding, embedding);
          
          // LOWERED THRESHOLD from 0.3 to 0.15 for better matching
          if (similarity > 0.15) {
            results.push({
              ...item,
              _similarity: similarity,
              _productText: productText
            });
          }
        }
      }
      
      // Sort by similarity
      results.sort((a, b) => b._similarity - a._similarity);
      
      console.log(`🎯 Embedding search found ${results.length} products`);
      if (results.length > 0) {
        console.log(`   Top similarity: ${(results[0]._similarity * 100).toFixed(1)}%`);
      }
      
      return results.slice(0, maxResults);
      
    } catch (error) {
      console.error('❌ Embedding search error:', error.message);
      return [];
    }
  }
  
  _fallbackKeywordSearch(query, maxResults) {
    console.log('🔄 Using keyword search as fallback');
    
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(' ').filter(k => k.length > 2);
    
    // Add Spanish translations
    const translations = {
      'screen': 'pantalla',
      'battery': 'bateria',
      'camera': 'camara',
      'charging': 'carga',
      'speaker': 'altavoz'
    };
    
    // Add translated keywords
    keywords.forEach(keyword => {
      if (translations[keyword]) {
        keywords.push(translations[keyword]);
      }
    });
    
    console.log(`🔍 Keyword search terms: ${keywords.join(', ')}`);
    
    const results = [];
    
    for (const product of this.products.values()) {
      const productText = product.name.toLowerCase();
      let score = 0;
      
      for (const keyword of keywords) {
        if (productText.includes(keyword)) {
          score += 1;
        }
      }
      
      if (score > 0) {
        results.push({
          ...product.originalItem,
          _score: score,
          _keywordMatch: true,
          _metadata: product.metadata
        });
      }
    }
    
    // Sort by score
    results.sort((a, b) => b._score - a._score);
    
    console.log(`✅ Keyword search found ${results.length} products`);
    
    return results.slice(0, maxResults);
  }
  
  _filterByExactModel(results, targetModel) {
    return results.filter(item => {
      const metadata = item._metadata;
      const deviceModel = metadata.deviceModel.toLowerCase();
      const targetLower = targetModel.toLowerCase();
      
      // For iPhone 14 (not Pro), exclude Pro variants
      if (targetModel === 'iphone 14') {
        return deviceModel.includes('iphone 14') && 
               !deviceModel.includes('pro') && 
               !deviceModel.includes('plus');
      }
      
      // For iPhone 14 Pro (not Max), exclude Max variants
      if (targetModel === 'iphone 14 pro') {
        return deviceModel.includes('iphone 14') && 
               deviceModel.includes('pro') && 
               !deviceModel.includes('max');
      }
      
      // For other models, check if target is contained in device model
      return deviceModel.includes(targetLower);
    });
  }
  
  async _loadOrGenerateVectorStore() {
    try {
      // Try to load existing vector cache
      if (fs.existsSync(this.vectorCacheFile)) {
        console.log('📁 Loading vector cache...');
        const cached = JSON.parse(fs.readFileSync(this.vectorCacheFile, 'utf8'));
        
        // Rebuild vector store from cache
        for (const [productId, vectorData] of cached) {
          this.vectorStore.set(productId, vectorData);
        }
        
        console.log(`✅ Loaded ${this.vectorStore.size} vectors from cache`);
        
        // Check if we need to generate new vectors
        const existingIds = new Set(this.vectorStore.keys());
        const currentIds = new Set(this.products.keys());
        
        const newProducts = Array.from(this.products.values()).filter(product => 
          !existingIds.has(product.id)
        );
        
        if (newProducts.length > 0) {
          console.log(`🔄 Generating vectors for ${newProducts.length} new products...`);
          await this._generateVectorsForProducts(newProducts);
        }
        
        return;
      }
      
      // Generate all vectors
      console.log('🔄 Generating vectors for all products...');
      await this._generateVectorsForProducts(Array.from(this.products.values()));
      
    } catch (error) {
      console.error('❌ Vector store error:', error.message);
      // Continue without vectors - will use keyword search
    }
  }
  
  async _generateVectorsForProducts(products) {
    const batchSize = 10; // Process in smaller batches
    
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(products.length/batchSize)}`);
      
      for (const product of batch) {
        try {
          // Embed only the product name (not price)
          const embedding = await this._generateEmbedding(product.name);
          
          if (embedding) {
            this.vectorStore.set(product.id, {
              embedding: embedding,
              metadata: product.metadata
            });
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          console.error(`⚠️ Failed to generate vector for ${product.name}:`, error.message);
        }
      }
    }
    
    await this._saveVectorCache();
    console.log(`✅ Generated vectors for ${this.vectorStore.size} products`);
  }
  
  async _saveVectorCache() {
    try {
      const vectorArray = Array.from(this.vectorStore.entries());
      fs.writeFileSync(this.vectorCacheFile, JSON.stringify(vectorArray, null, 2));
      console.log('💾 Vector cache saved');
    } catch (error) {
      console.error('⚠️ Failed to save vector cache:', error.message);
    }
  }
  
  _findClosestAlternatives(similarities, requestedModel) {
    // Find products from the same brand and similar service type
    const requestedBrand = this._extractBrand(requestedModel);
    const requestedService = this._extractServiceFromQuery(requestedModel);
    
    return similarities.filter(item => {
      const metadata = item._metadata;
      return metadata.brand === requestedBrand || 
             metadata.serviceType === requestedService ||
             item._similarity > 0.25; // High semantic similarity
    });
  }
  
  _parsePrice(priceStr) {
    if (!priceStr) return 0;
    const price = parseFloat(priceStr.toString().replace(/[^0-9.]/g, ''));
    return isNaN(price) ? 0 : price;
  }
  
  _extractBrand(productName) {
    const nameLower = productName.toLowerCase();
    
    if (nameLower.includes('iphone') || nameLower.includes('apple')) return 'apple';
    if (nameLower.includes('samsung') || nameLower.includes('galaxy')) return 'samsung';
    if (nameLower.includes('xiaomi') || nameLower.includes('redmi')) return 'xiaomi';
    if (nameLower.includes('huawei')) return 'huawei';
    if (nameLower.includes('motorola')) return 'motorola';
    if (nameLower.includes('nokia')) return 'nokia';
    
    return 'unknown';
  }
  
  _extractDeviceFromName(productName) {
    const nameLower = productName.toLowerCase();
    
    // iPhone patterns
    const iphoneMatch = nameLower.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?|\s*plus|\s*mini|se|xr|xs|x)/i);
    if (iphoneMatch) {
      return `iphone ${iphoneMatch[1].replace(/\s+/g, ' ').trim()}`;
    }
    
    // Samsung patterns
    if (nameLower.includes('samsung') || nameLower.includes('galaxy')) {
      const galaxyMatch = nameLower.match(/(?:galaxy\s*)?([a-z]\d+|note\s*\d+|s\d+)/i);
      if (galaxyMatch) {
        return `samsung ${galaxyMatch[1]}`;
      }
    }
    
    return 'unknown';
  }
  
  _extractServiceType(productName) {
    const nameLower = productName.toLowerCase();
    
    if (nameLower.includes('pantalla') || nameLower.includes('display') || nameLower.includes('screen')) return 'pantalla';
    if (nameLower.includes('bateria') || nameLower.includes('battery')) return 'bateria';
    if (nameLower.includes('camara') || nameLower.includes('camera') || nameLower.includes('lente')) return 'camara';
    if (nameLower.includes('altavoz') || nameLower.includes('speaker')) return 'altavoz';
    if (nameLower.includes('flex') || nameLower.includes('cable')) return 'flex';
    if (nameLower.includes('tapa') || nameLower.includes('cover')) return 'tapa';
    if (nameLower.includes('antena') || nameLower.includes('wifi')) return 'antena';
    
    return 'general';
  }
  
  _extractQualityType(productName) {
    const nameLower = productName.toLowerCase();
    
    if (nameLower.includes('original') || nameLower.includes('oem')) return 'original';
    if (nameLower.includes('compatible') || nameLower.includes('comp')) return 'compatible';
    if (nameLower.includes('incell') || nameLower.includes('in-cell')) return 'incell';
    if (nameLower.includes('oled') || nameLower.includes('amoled')) return 'oled';
    if (nameLower.includes('lcd')) return 'lcd';
    
    return 'standard';
  }
  
  _extractServiceFromQuery(query) {
    const queryLower = query.toLowerCase();
    
    if (queryLower.includes('pantalla') || queryLower.includes('screen') || queryLower.includes('display')) return 'pantalla';
    if (queryLower.includes('bateria') || queryLower.includes('battery')) return 'bateria';
    if (queryLower.includes('camara') || queryLower.includes('camera')) return 'camara';
    
    return 'general';
  }
  
  async _generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.substring(0, 8000),
        encoding_format: "float"
      });
      
      return response.data[0].embedding;
    } catch (error) {
      console.error('❌ OpenAI embedding error:', error.message);
      return null;
    }
  }
  
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
  
  _getProductText(item) {
    const productName = item.Prod || '';
    const price = this._getPrice(item);
    return `${productName} ${price > 0 ? price + ' UYU' : ''}`;
  }
  
  _getProductKey(text) {
    return text.substring(0, 100).replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  _getPrice(item) {
    const priceFields = ['PUBLICO TIENDA', 'price', 'precio'];
    
    for (const field of priceFields) {
      if (item[field]) {
        const price = parseFloat(item[field].toString().replace(/[^0-9.]/g, ''));
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
    return 0;
  }
}

module.exports = new FixedPricingService();