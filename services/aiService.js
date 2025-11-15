const OpenAI = require("openai");
const axios = require("axios");

class FixedAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Clave API OpenAI faltante");
    }

    this.openai = new OpenAI({
      apiKey,
      timeout: 45000,
      maxRetries: 3,
    });
    
    console.log("✅ Servicio IA Corregido inicializado - GPT-4o con matching exacto de productos");
  }

  async processMessage(messageContent, messageType, mediaUrl, pricingData, contactInfo) {
    try {
      let processedContent = messageContent;

      // Handle media with better processing
      if (messageType === "voice" || messageType === "audio") {
        processedContent = await this.transcribeAudio(mediaUrl);
      } else if (messageType === "image" || messageType === "photo") {
        processedContent = await this.analyzeImage(mediaUrl);
      }

      // Store in memory if service exists
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        ConversationMemoryService.storeMessage(
          contactInfo.contact_id,
          'user',
          processedContent,
          { 
            message_type: messageType, 
            media_url: mediaUrl,
            contact_name: contactInfo.full_name,
            channel: contactInfo.channel
          }
        );
      } catch (err) {
        console.log('Servicio memoria no disponible, continuando...');
      }

      // Generate AI response with improved model
      const aiResult = await this.generateResponse(processedContent, contactInfo);

      // Store AI response in memory if service exists
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        ConversationMemoryService.storeMessage(
          contactInfo.contact_id,
          'assistant',
          aiResult.customer_response,
          { 
            classification: aiResult.classification,
            products_found: aiResult.pricing_items_found,
            model_used: 'gpt-4o'
          }
        );
      } catch (err) {
        console.log('Servicio memoria no disponible para respuesta IA, continuando...');
      }

      return aiResult;

    } catch (error) {
      console.error("❌ Error procesamiento IA:", error.message);
      return this.createFallbackResponse(processedContent, contactInfo);
    }
  }

  async generateResponse(processedContent, contactInfo) {
    try {
      // Check if this is a simple greeting without product inquiry
      const isSimpleGreeting = this._isSimpleGreeting(processedContent);
      
      // Search for products only if NOT a simple greeting
      let products = [];
      let matchedProducts = [];
      let productsText = '';
      
      if (!isSimpleGreeting) {
        const SimplifiedPricingService = require('./pricingService');
        products = await SimplifiedPricingService.searchProducts(processedContent, 50); // Get more results
        
        console.log(`📊 Encontrado ${products.length} productos para: "${processedContent}"`);

        // Extract exact model and part type from query
        const queryAnalysis = this._analyzeQuery(processedContent);
        console.log(`🔍 Análisis query:`, queryAnalysis);

        // Match products with exact model and part filtering
        matchedProducts = this._matchExactProducts(products, queryAnalysis);
        console.log(`🎯 Productos matched: ${matchedProducts.length}`);

        // Create products text for AI
        productsText = this._createProductsText(matchedProducts, queryAnalysis);
      } else {
        console.log('🤝 Saludo simple detectado, no buscando productos');
        productsText = 'No aplicable - saludo simple.';
      }
      
      // Get extended conversation context
      let conversationContext = '';
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        const context = ConversationMemoryService.getConversationContext(contactInfo.contact_id, 8);
        
        if (context.length > 0) {
          conversationContext = 'Contexto de conversación:\n' + 
            context.map(msg => `${msg.role === 'user' ? 'Cliente' : 'Asistente'}: ${msg.content.substring(0, 150)}`).join('\n') + '\n\n';
        }
      } catch (err) {
        console.log('No hay memoria de conversación disponible');
      }

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialista en reparación de teléfonos móviles en Montevideo, Uruguay.

REGLAS CRÍTICAS:
1. 🇪🇸 RESPONDE SIEMPRE EN ESPAÑOL
2. 🤝 SALUDOS: Si solo saluda (Hola, Hi, etc.) SIN mencionar productos → saluda y pregunta en qué puedes ayudar HOY
3. 🎯 PRODUCTOS: Cuando solicite producto específico → MUESTRA TODAS las opciones disponibles de ese modelo exacto
4. 💰 PRECIOS: USA EXACTAMENTE los precios proporcionados - NUNCA inventes o modifiques
5. ✅ COINCIDENCIA EXACTA: iPhone 14 = iPhone 14 (NO iPhone 14 Plus, NO iPhone 14 Pro)
6. 📱 CALIDADES: Muestra TODAS las calidades disponibles (Original, Incell, ORI GLASS, etc.)

PRODUCTOS ENCONTRADOS:
${productsText}

INFORMACIÓN DEL NEGOCIO:
📞 WhatsApp: 098565349 | Teléfono: 2200-21-91

🏪 SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía: 30 días | 🚚 Retiro a domicilio disponible

EJEMPLOS CORRECTOS:

Cliente: "Hola"
Respuesta: "¡Hola! ¿En qué puedo ayudarte hoy?"

Cliente: "Pantalla iPhone 14"
Respuesta: "Para cambio de pantalla iPhone 14 tenemos:
• iPhone 14: 22,500 UYU
• iPhone 14 (ORI GLASS): 19,990 UYU  
• iPhone 14 INCELL: 14,985 UYU
Todas con garantía de 30 días. ¿Cuál te conviene?"

NUNCA HAGAS ESTO:
- Mostrar iPhone 14 Plus cuando piden iPhone 14
- Inventar precios diferentes a los dados
- Mostrar solo 1 opción cuando hay varias
- Asumir continuación de conversación en saludos simples

RESPONDE COMO HUMANO PROFESIONAL Y ÚTIL.`;

      const userPrompt = `Cliente: ${contactInfo.full_name || "Cliente"}
Mensaje: "${processedContent}"

${conversationContext}

INSTRUCCIONES:
1. Si es saludo simple → Saluda y pregunta en qué ayudar HOY
2. Si pide producto específico → Muestra TODAS las opciones de ese modelo exacto con precios exactos
3. USA EXACTAMENTE los precios de los datos, no los cambies
4. Responde en español naturalmente`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 800,
      });

      const response = result.choices[0].message.content.trim();
      
      // Extract classification
      const classification = this._extractClassification(processedContent, response, isSimpleGreeting);

      return {
        customer_response: response,
        classification: classification,
        processed_content: processedContent,
        pricing_items_found: matchedProducts.length,
        total_products_searched: products.length,
        is_simple_greeting: isSimpleGreeting,
        query_analysis: isSimpleGreeting ? null : this._analyzeQuery(processedContent),
        parsing_method: 'exact-matching-fixed',
        model_used: 'gpt-4o'
      };

    } catch (error) {
      console.error("❌ Error generación respuesta:", error.message);
      return this.createFallbackResponse(processedContent, contactInfo);
    }
  }

  _isSimpleGreeting(message) {
    const greetings = [
      'hola', 'hi', 'hello', 'buenos días', 'buenas tardes', 'buenas noches',
      'buen día', 'saludos', 'que tal', 'qué tal', 'como estas', 'cómo estás',
      'hey', 'holaa', 'holaaa'
    ];
    
    const messageLower = message.toLowerCase().trim();
    
    // Check if it's ONLY a greeting (no product mentions)
    const isJustGreeting = greetings.some(greeting => {
      return messageLower === greeting || 
             messageLower === greeting + '!' || 
             messageLower === greeting + '.' ||
             messageLower === greeting + '?';
    });
    
    // Also check for very short greetings
    const isShortGreeting = messageLower.length <= 10 && greetings.some(greeting => 
      messageLower.includes(greeting)
    );
    
    // Make sure it doesn't contain product terms
    const productTerms = [
      'pantalla', 'batería', 'cámara', 'altavoz', 'micrófono', 'carga',
      'iphone', 'samsung', 'reparar', 'arreglar', 'precio', 'costo',
      'screen', 'battery', 'camera', 'speaker', 'repair', 'fix'
    ];
    
    const hasProductTerms = productTerms.some(term => messageLower.includes(term));
    
    return (isJustGreeting || isShortGreeting) && !hasProductTerms;
  }

  _analyzeQuery(query) {
    const queryLower = query.toLowerCase();
    
    // Extract device model with exact matching
    let deviceModel = '';
    let deviceBrand = '';
    let partType = '';
    
    // iPhone model extraction - be very specific
    const iphonePatterns = [
      { pattern: /iphone\s*15\s*pro\s*max/i, model: 'iPhone 15 Pro Max' },
      { pattern: /iphone\s*15\s*plus/i, model: 'iPhone 15 Plus' },
      { pattern: /iphone\s*15\s*pro/i, model: 'iPhone 15 Pro' },
      { pattern: /iphone\s*15/i, model: 'iPhone 15' },
      { pattern: /iphone\s*14\s*pro\s*max/i, model: 'iPhone 14 Pro Max' },
      { pattern: /iphone\s*14\s*plus/i, model: 'iPhone 14 Plus' },
      { pattern: /iphone\s*14\s*pro/i, model: 'iPhone 14 Pro' },
      { pattern: /iphone\s*14/i, model: 'iPhone 14' },
      { pattern: /iphone\s*13\s*pro\s*max/i, model: 'iPhone 13 Pro Max' },
      { pattern: /iphone\s*13\s*mini/i, model: 'iPhone 13 Mini' },
      { pattern: /iphone\s*13\s*pro/i, model: 'iPhone 13 Pro' },
      { pattern: /iphone\s*13/i, model: 'iPhone 13' },
      { pattern: /iphone\s*12\s*pro\s*max/i, model: 'iPhone 12 Pro Max' },
      { pattern: /iphone\s*12\s*mini/i, model: 'iPhone 12 Mini' },
      { pattern: /iphone\s*12\s*pro/i, model: 'iPhone 12 Pro' },
      { pattern: /iphone\s*12/i, model: 'iPhone 12' },
      { pattern: /iphone\s*11\s*pro\s*max/i, model: 'iPhone 11 Pro Max' },
      { pattern: /iphone\s*11\s*pro/i, model: 'iPhone 11 Pro' },
      { pattern: /iphone\s*11/i, model: 'iPhone 11' },
      { pattern: /iphone\s*xs\s*max/i, model: 'iPhone XS Max' },
      { pattern: /iphone\s*xs/i, model: 'iPhone XS' },
      { pattern: /iphone\s*xr/i, model: 'iPhone XR' },
      { pattern: /iphone\s*x/i, model: 'iPhone X' },
      { pattern: /iphone\s*8\s*plus/i, model: 'iPhone 8 Plus' },
      { pattern: /iphone\s*8/i, model: 'iPhone 8' },
      { pattern: /iphone\s*7\s*plus/i, model: 'iPhone 7 Plus' },
      { pattern: /iphone\s*7/i, model: 'iPhone 7' },
    ];
    
    for (const item of iphonePatterns) {
      if (item.pattern.test(queryLower)) {
        deviceModel = item.model;
        deviceBrand = 'Apple';
        break;
      }
    }
    
    // Samsung model extraction
    if (!deviceModel) {
      const samsungPatterns = [
        { pattern: /galaxy\s*s24\s*ultra/i, model: 'Galaxy S24 Ultra' },
        { pattern: /galaxy\s*s24\s*plus/i, model: 'Galaxy S24 Plus' },
        { pattern: /galaxy\s*s24/i, model: 'Galaxy S24' },
        { pattern: /galaxy\s*s23\s*ultra/i, model: 'Galaxy S23 Ultra' },
        { pattern: /galaxy\s*s23\s*plus/i, model: 'Galaxy S23 Plus' },
        { pattern: /galaxy\s*s23/i, model: 'Galaxy S23' },
        { pattern: /galaxy\s*s22/i, model: 'Galaxy S22' },
        { pattern: /galaxy\s*s21/i, model: 'Galaxy S21' },
        { pattern: /galaxy\s*s20/i, model: 'Galaxy S20' },
        { pattern: /galaxy\s*note\s*20/i, model: 'Galaxy Note 20' },
        { pattern: /galaxy\s*a54/i, model: 'Galaxy A54' },
        { pattern: /galaxy\s*a34/i, model: 'Galaxy A34' },
      ];
      
      for (const item of samsungPatterns) {
        if (item.pattern.test(queryLower)) {
          deviceModel = item.model;
          deviceBrand = 'Samsung';
          break;
        }
      }
    }
    
    // Part type extraction
    if (queryLower.includes('pantalla') || queryLower.includes('screen') || queryLower.includes('display')) {
      partType = 'pantalla';
    } else if (queryLower.includes('batería') || queryLower.includes('battery')) {
      partType = 'batería';
    } else if (queryLower.includes('cámara') || queryLower.includes('camera')) {
      partType = 'cámara';
    } else if (queryLower.includes('altavoz') || queryLower.includes('speaker')) {
      partType = 'altavoz';
    } else if (queryLower.includes('micrófono') || queryLower.includes('micro')) {
      partType = 'micrófono';
    } else if (queryLower.includes('carga') || queryLower.includes('charging')) {
      partType = 'carga';
    }
    
    return {
      deviceModel,
      deviceBrand,
      partType,
      originalQuery: query
    };
  }

  _matchExactProducts(products, queryAnalysis) {
    if (!products || products.length === 0) return [];
    
    const { deviceModel, partType } = queryAnalysis;
    
    if (!deviceModel && !partType) {
      return products.slice(0, 10); // Return first 10 if no specific criteria
    }
    
    console.log(`🔍 Buscando productos para modelo: "${deviceModel}" y parte: "${partType}"`);
    
    const matchedProducts = products.filter(product => {
      const productName = (product.Prod || product.product || Object.values(product)[0] || '').toLowerCase();
      
      let modelMatch = true;
      let partMatch = true;
      
      // Check model match if specified
      if (deviceModel) {
        const modelLower = deviceModel.toLowerCase();
        
        // Exact model matching - be very strict
        if (modelLower.includes('iphone 14 pro max')) {
          modelMatch = productName.includes('iphone 14 pro max') && 
                      !productName.includes('iphone 14 pro ') &&
                      !productName.includes('iphone 14 plus');
        } else if (modelLower.includes('iphone 14 plus')) {
          modelMatch = productName.includes('iphone 14 plus') && 
                      !productName.includes('iphone 14 pro');
        } else if (modelLower.includes('iphone 14 pro')) {
          modelMatch = productName.includes('iphone 14 pro') && 
                      !productName.includes('iphone 14 pro max') &&
                      !productName.includes('iphone 14 plus');
        } else if (modelLower.includes('iphone 14')) {
          modelMatch = productName.includes('iphone 14') && 
                      !productName.includes('iphone 14 pro') &&
                      !productName.includes('iphone 14 plus');
        } else if (modelLower.includes('iphone 13 pro max')) {
          modelMatch = productName.includes('iphone 13 pro max');
        } else if (modelLower.includes('iphone 13 pro')) {
          modelMatch = productName.includes('iphone 13 pro') && 
                      !productName.includes('iphone 13 pro max');
        } else if (modelLower.includes('iphone 13')) {
          modelMatch = productName.includes('iphone 13') && 
                      !productName.includes('iphone 13 pro');
        } else {
          // For other models, use contains but be careful
          const modelWords = modelLower.split(' ');
          modelMatch = modelWords.every(word => productName.includes(word));
        }
      }
      
      // Check part match if specified
      if (partType) {
        const partTerms = {
          'pantalla': ['pantalla', 'screen', 'display', 'lcd'],
          'batería': ['batería', 'battery', 'bateria', 'pila'],
          'cámara': ['cámara', 'camera', 'camara'],
          'altavoz': ['altavoz', 'speaker', 'parlante', 'audio'],
          'micrófono': ['micrófono', 'micro', 'microphone'],
          'carga': ['carga', 'charging', 'conector', 'puerto']
        };
        
        const relevantTerms = partTerms[partType] || [];
        partMatch = relevantTerms.some(term => productName.includes(term));
      }
      
      return modelMatch && partMatch;
    });
    
    console.log(`✅ Productos matched: ${matchedProducts.length} de ${products.length} total`);
    
    // Sort by quality/type priority (Original > ORI GLASS > Compatible > Incell)
    const sortedProducts = matchedProducts.sort((a, b) => {
      const nameA = (a.Prod || '').toLowerCase();
      const nameB = (b.Prod || '').toLowerCase();
      
      const getQualityScore = (name) => {
        if (name.includes('original') && !name.includes('ori glass')) return 4;
        if (name.includes('ori glass')) return 3;
        if (name.includes('compatible')) return 2;
        if (name.includes('incell')) return 1;
        return 0;
      };
      
      return getQualityScore(nameB) - getQualityScore(nameA);
    });
    
    return sortedProducts;
  }

  _createProductsText(products, queryAnalysis) {
    if (products.length === 0) {
      return `No se encontraron productos específicos para "${queryAnalysis.deviceModel} ${queryAnalysis.partType}".`;
    }

    let text = `Productos encontrados para ${queryAnalysis.deviceModel} ${queryAnalysis.partType}:\n\n`;
    
    for (const product of products) {
      const productName = product.Prod || product.product || Object.values(product)[0] || 'Producto desconocido';
      const price = this._getPrice(product);
      
      if (price > 0) {
        text += `• ${productName}: ${price} UYU\n`;
      } else {
        text += `• ${productName}: Consultar precio\n`;
      }
    }
    
    return text.trim();
  }

  _getPrice(item) {
    // Try different price field names that might exist in the data
    const priceFields = [
      'PUBLICO TIENDA', 
      'PRECIO PUBLICO TIENDA',
      'PUBLICO_TIENDA',
      'price', 
      'precio',
      'PRECIO',
      'Price',
      'PUBLICO',
      'PUBLIC_PRICE'
    ];
    
    for (const field of priceFields) {
      if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
        const priceValue = item[field];
        
        // Handle different price formats
        if (typeof priceValue === 'number') {
          return priceValue;
        }
        
        if (typeof priceValue === 'string') {
          // Remove any non-numeric characters except decimal point
          const cleanPrice = priceValue.replace(/[^\d.-]/g, '');
          const price = parseFloat(cleanPrice);
          
          if (!isNaN(price) && price > 0) {
            return Math.round(price); // Round to nearest whole number
          }
        }
      }
    }
    
    // If no price found in standard fields, try to find any numeric value
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'number' && value > 100 && value < 100000) {
        console.log(`📋 Precio encontrado en campo '${key}': ${value}`);
        return value;
      }
    }
    
    console.log('⚠️ No se encontró precio para producto:', Object.keys(item));
    return 0;
  }

  _extractClassification(originalContent, response, isSimpleGreeting) {
    const text = (originalContent + ' ' + response).toLowerCase();
    
    let device_brand = "unknown";
    if (text.includes('iphone') || text.includes('apple')) device_brand = "Apple";
    else if (text.includes('samsung') || text.includes('galaxy')) device_brand = "Samsung";
    else if (text.includes('xiaomi')) device_brand = "Xiaomi";
    else if (text.includes('huawei')) device_brand = "Huawei";
    else if (text.includes('motorola')) device_brand = "Motorola";
    else if (text.includes('lg')) device_brand = "LG";
    else if (text.includes('sony')) device_brand = "Sony";
    else if (text.includes('oneplus')) device_brand = "OnePlus";

    let service_type = isSimpleGreeting ? "saludo" : "consulta general";
    if (!isSimpleGreeting) {
      if (text.includes('pantalla') || text.includes('screen') || text.includes('display')) service_type = "pantalla";
      else if (text.includes('batería') || text.includes('battery') || text.includes('bateria')) service_type = "batería";
      else if (text.includes('cámara') || text.includes('camera') || text.includes('camara')) service_type = "cámara";
      else if (text.includes('carga') || text.includes('charging')) service_type = "carga";
      else if (text.includes('altavoz') || text.includes('speaker')) service_type = "altavoz";
      else if (text.includes('micro') || text.includes('microphone')) service_type = "micrófono";
    }

    // Extract device model using the same logic as query analysis
    let device_model = "unknown";
    if (!isSimpleGreeting) {
      const queryAnalysis = this._analyzeQuery(originalContent);
      device_model = queryAnalysis.deviceModel || "unknown";
    }

    return {
      device_brand,
      device_model,
      service_type,
      urgency: isSimpleGreeting ? "none" : "medium",
      language: "es",
      confidence: "high",
      is_greeting: isSimpleGreeting,
      timestamp: new Date().toISOString()
    };
  }

  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("URL audio faltante");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 45000,
        headers: { 'User-Agent': 'ReparaloyaBot/2.0' }
      });

      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es",
        response_format: "text"
      });

      console.log("✅ Transcripción:", transcription);
      return transcription;
    } catch (error) {
      console.error("❌ Error transcripción:", error.message);
      return "[Error de transcripción de audio]";
    }
  }

  async analyzeImage(imageUrl) {
    try {
      if (!imageUrl) throw new Error("URL imagen faltante");

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analiza esta imagen e identifica: 1) El modelo del dispositivo, 2) Los daños visibles, 3) El tipo de reparación necesaria. Responde en español, máximo 150 palabras."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 400,
        temperature: 0.3
      });

      const text = result.choices[0].message.content;
      console.log("✅ Análisis imagen:", text);
      return text;

    } catch (error) {
      console.error("❌ Error análisis imagen:", error.message);
      return "[Error de análisis de imagen: describe tu problema por texto]";
    }
  }

  createFallbackResponse(processedContent, contactInfo) {
    const isGreeting = this._isSimpleGreeting(processedContent);
    
    if (isGreeting) {
      return {
        customer_response: `¡Hola ${contactInfo.full_name || ''}! ¿En qué puedo ayudarte hoy?`,
        classification: {
          device_brand: "unknown",
          device_model: "unknown",
          service_type: "saludo",
          urgency: "none",
          language: "es",
          confidence: "high",
          is_greeting: true,
          timestamp: new Date().toISOString()
        },
        processed_content: processedContent,
        fallback: true,
        parsing_method: 'greeting-fallback'
      };
    }

    const response = `¡Hola ${contactInfo.full_name || ''}! 

Tu solicitud ha sido registrada. Nuestro equipo te contactará pronto con las opciones disponibles.

🆘 Para urgencias:
📞 Teléfono: 2200-21-91  
📱 WhatsApp: 098565349

🏪 SUCURSALES:
• La Comercial: Carlos Reyles 1750
• Pocitos: Chucarro 1107
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía 30 días | 🚚 Retiro a domicilio

¡Gracias por contactar ReparaloYA!`;

    return {
      customer_response: response,
      classification: {
        device_brand: "unknown",
        device_model: "unknown",
        service_type: "consulta general",
        urgency: "medium",
        language: "es",
        confidence: "low",
        is_greeting: false,
        timestamp: new Date().toISOString()
      },
      processed_content: processedContent,
      fallback: true,
      parsing_method: 'fallback'
    };
  }
}

module.exports = new FixedAIService();