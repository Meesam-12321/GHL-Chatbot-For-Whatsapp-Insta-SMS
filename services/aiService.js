const OpenAI = require("openai");
const axios = require("axios");
require("dotenv").config();

class EnhancedAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add OPENAI_API_KEY to .env file.");
    }

    console.log("✅ Enhanced AI Service initialized (Spanish Only - ReparaloYA with Memory & Embeddings)");

    this.openai = new OpenAI({
      apiKey,
      timeout: 45000,
      maxRetries: 2,
    });
  }

  // =================================================
  // ✅ MAIN MESSAGE PROCESSOR
  // =================================================
  async processMessage(messageContent, messageType, mediaUrl, pricingData, contactInfo) {
    try {
      let processedContent = messageContent;

      // Store user message in memory
      const ConversationMemoryService = require('./conversationMemoryService');
      await ConversationMemoryService.storeMessage(
        contactInfo.contact_id,
        'user',
        messageContent,
        {
          message_type: messageType,
          media_url: mediaUrl,
          contact_name: contactInfo.full_name,
          channel: contactInfo.channel || 'SMS'
        }
      );

      // ✅ Voice → Transcription
      if (messageType === "voice" || messageType === "audio") {
        console.log("🎤 Transcribing voice...");
        processedContent = await this.transcribeAudio(mediaUrl);
      }

      // ✅ Image → Vision Analysis
      else if (messageType === "image" || messageType === "photo") {
        console.log("🖼️ Analyzing image...");
        processedContent = await this.analyzeImage(mediaUrl);
      }

      // Get conversation context for AI
      const conversationContext = ConversationMemoryService.getConversationContext(
        contactInfo.contact_id,
        6
      );

      // ✅ AI → Enhanced response with conversation memory
      console.log("🤖 Generating response with conversation memory...");
      const aiResult = await this.generateEnhancedResponse(
        processedContent,
        messageType,
        pricingData,
        contactInfo,
        conversationContext
      );

      // Store AI response in memory
      await ConversationMemoryService.storeMessage(
        contactInfo.contact_id,
        'assistant',
        aiResult.customer_response,
        {
          message_type: 'text',
          classification: aiResult.classification,
          pricing_items_found: aiResult.pricing_items_found || 0
        }
      );

      return aiResult;

    } catch (err) {
      console.error("❌ Enhanced AI processing error:", err);
      const fallbackResponse = await this.createEnhancedFallback(messageContent, contactInfo);
      return fallbackResponse;
    }
  }

  // =================================================
  // ✅ ENHANCED RESPONSE GENERATOR WITH NO QUESTIONS
  // =================================================
  async generateEnhancedResponse(processedContent, messageType, pricingData, contactInfo, conversationContext) {
    try {
      // 🚀 USE EMBEDDINGS TO FIND RELEVANT PRODUCTS
      const EnhancedPricingService = require('./pricingService');
      const relevantProducts = await EnhancedPricingService.findRelevantProducts(processedContent, 60);
      
      console.log(`📊 Found ${relevantProducts.length} relevant products using embeddings`);

      // 🎯 EXTRACT DEVICE AND SERVICE FOR ALL QUALITY OPTIONS
      const deviceServiceInfo = this._extractDeviceAndService(processedContent, conversationContext);
      let allQualityOptions = [];
      
      if (deviceServiceInfo.device && deviceServiceInfo.service) {
        console.log(`🔍 Finding ALL quality options for ${deviceServiceInfo.device} ${deviceServiceInfo.service}`);
        allQualityOptions = await EnhancedPricingService.findAllQualityOptions(
          deviceServiceInfo.device,
          deviceServiceInfo.service
        );
      }

      // Create enhanced pricing text with ALL quality options
      const pricingText = this._createEnhancedPricingText(relevantProducts, allQualityOptions);

      // Check if this is a returning customer
      const ConversationMemoryService = require('./conversationMemoryService');
      const isReturning = !ConversationMemoryService.isNewConversation(contactInfo.contact_id);
      const conversationSummary = isReturning ? ConversationMemoryService.getConversationSummary(contactInfo.contact_id) : null;

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialistas en reparación de celulares en Montevideo, Uruguay.

MEMORIA DE CONVERSACIÓN:
${isReturning ? `Este cliente YA TE HA CONTACTADO ANTES. Resumen: ${JSON.stringify(conversationSummary, null, 2)}` : 'Este es un cliente NUEVO.'}

CONTEXTO CONVERSACIONAL:
${conversationContext.length > 0 ? 
  'Mensajes anteriores:\n' + conversationContext.map((msg, i) => `${i+1}. ${msg.role}: ${msg.content.substring(0, 150)}...`).join('\n') 
  : 'Sin mensajes anteriores'}

REGLAS CRÍTICAS - LEE BIEN:
1. 🚀 SIEMPRE muestra TODAS las opciones disponibles INMEDIATAMENTE - NUNCA hagas preguntas primero
2. ❌ PROHIBIDO preguntar "¿qué calidad prefieres?" - MUESTRA todas las calidades con precios PRIMERO
3. 💰 NUNCA inventes precios - solo usa precios de la base de datos
4. ❌ NUNCA muestres precios de 0 UYU - si un precio es 0, di "precio a consultar"
5. 📱 Sé específico con modelos - iPhone 13 vs iPhone 13 Pro son diferentes
6. 🔄 Mantén continuidad conversacional - usa "como te mencioné antes" si es apropiado
7. 💬 Haz preguntas de seguimiento DESPUÉS de mostrar opciones
8. ✅ Responde ÚNICAMENTE en español
9. 🛠️ Siempre promociona las ventajas del servicio (garantía, retiro a domicilio)
10. 💎 EJEMPLO CORRECTO: "iPhone 11 pantalla rota" → "Para tu iPhone 11 pantalla tenemos: Original: 5680 UYU, Compatible: 3200 UYU, Incell: 2595 UYU"
11. ❌ EJEMPLO INCORRECTO: "¿Qué calidad de pantalla prefieres?" (NUNCA hagas esto primero)

BASE DE DATOS DE PRECIOS MEJORADA (${relevantProducts.length} productos relevantes):
${pricingText}

INFORMACIÓN DEL NEGOCIO:
SUCURSALES:
- La Comercial: Carlos Reyles 1750, esq. José L. Terra, Lunes a Viernes 10:00-12:30 y 13:00-18:00, Sábados 09:00-13:00
- Pocitos: Chucarro 1107, esq. Masini, Lunes a Viernes 10:00-18:00, Sábados 09:00-13:00  
- Tres Cruces: Mario Cassinoni 1684, Lunes a Viernes 10:00-18:00, Sábados 09:00-13:00

SERVICIOS:
- Reparación de smartphones, tablets, Apple Watch
- Retiro y entrega a domicilio en Montevideo (costo varía según zona)
- Garantía: 30 días en todas las reparaciones
- WhatsApp: 098565349
- Teléfono: 2200-21-91

RESPONDE COMO HUMANO ÚTIL - MUESTRA OPCIONES INMEDIATAMENTE.`;

      const userPrompt = `Mensaje del cliente: "${processedContent}"
Tipo de mensaje: ${messageType}
Cliente: ${contactInfo.full_name || "Cliente"}
${isReturning ? 'CLIENTE QUE REGRESA - considera el contexto anterior' : 'CLIENTE NUEVO'}

INSTRUCCIONES ESPECÍFICAS:
1. Si hay múltiples calidades para el mismo producto, muestra TODAS las opciones con precios INMEDIATAMENTE
2. Si el cliente pide "todos los precios" o "todas las opciones", incluye TODOS los productos relevantes
3. Si un precio es 0 o inválido, di "precio a consultar en tienda"
4. Mantén continuidad con conversaciones anteriores si es cliente que regresa
5. CRÍTICO: NO hagas preguntas sobre preferencias ANTES de mostrar opciones
6. Promociona las ventajas del servicio
7. Responde naturalmente`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2, // Lower for more consistent responses
        max_tokens: 1500 // Increased for comprehensive responses
      });

      let content = result.choices[0].message.content.trim();

      // 🚀 LENIENT PARSING - Accept good responses even if not JSON
      let classification;
      try {
        // Try to parse as JSON first
        const parsed = JSON.parse(content);
        if (parsed.customer_response && parsed.classification) {
          content = parsed.customer_response;
          classification = parsed.classification;
        }
      } catch (parseErr) {
        // If not JSON, that's OK! Use the content as-is and extract classification
        console.log('📝 AI responded naturally (not JSON) - extracting classification');
        classification = this._extractClassificationFromContent(content, processedContent, conversationContext);
      }

      // Ensure classification exists
      if (!classification) {
        classification = this._extractClassificationFromContent(content, processedContent, conversationContext);
      }

      return {
        customer_response: content,
        classification: {
          device_brand: classification.device_brand || "unknown",
          device_model: classification.device_model || "unknown", 
          service_type: classification.service_type || "consulta general",
          urgency: classification.urgency || "medium",
          language: "es",
          confidence: classification.confidence || "medium",
          conversation_context: isReturning ? 'returning' : 'new'
        },
        processed_content: processedContent,
        original_message_type: messageType,
        pricing_items_found: relevantProducts.length,
        quality_groups_found: allQualityOptions.length,
        is_returning_customer: isReturning,
        conversation_messages: conversationContext.length,
        parsing_method: classification.parsing_method || 'extracted'
      };

    } catch (err) {
      console.error("❌ Enhanced response generation error:", err.message);
      return this.createEnhancedFallback(processedContent, contactInfo);
    }
  }

  /**
   * Extract classification from natural response content
   */
  _extractClassificationFromContent(content, originalContent, conversationContext) {
    const contentLower = content.toLowerCase();
    const originalLower = originalContent.toLowerCase();
    const fullText = `${contentLower} ${originalLower}`;

    // Extract device brand
    let device_brand = "unknown";
    if (fullText.includes('iphone') || fullText.includes('apple')) device_brand = "Apple";
    else if (fullText.includes('samsung') || fullText.includes('galaxy')) device_brand = "Samsung";
    else if (fullText.includes('xiaomi') || fullText.includes('redmi')) device_brand = "Xiaomi";
    else if (fullText.includes('huawei')) device_brand = "Huawei";
    else if (fullText.includes('motorola')) device_brand = "Motorola";

    // Extract service type
    let service_type = "consulta general";
    if (fullText.includes('pantalla') || fullText.includes('screen') || fullText.includes('display') || fullText.includes('broken') || fullText.includes('cracked')) service_type = "pantalla";
    else if (fullText.includes('bateria') || fullText.includes('battery')) service_type = "bateria";
    else if (fullText.includes('camara') || fullText.includes('camera')) service_type = "camara";
    else if (fullText.includes('carga') || fullText.includes('charging')) service_type = "carga";

    // Extract device model
    let device_model = "unknown";
    const modelMatch = fullText.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?)/i);
    if (modelMatch) {
      device_model = `iPhone ${modelMatch[1]}`;
    }

    // Extract urgency
    let urgency = "medium";
    if (fullText.includes('urgente') || fullText.includes('rapido')) urgency = "high";
    else if (fullText.includes('tranquilo') || fullText.includes('no urgente')) urgency = "low";

    return {
      device_brand,
      device_model,
      service_type,
      urgency,
      confidence: "medium",
      parsing_method: "extracted_from_natural_response"
    };
  }

  /**
   * Enhanced pricing text creator
   */
  _createEnhancedPricingText(relevantProducts, allQualityOptions) {
    let pricingText = '';

    // Add quality options grouped by device/service first (these are most relevant)
    if (allQualityOptions.length > 0) {
      pricingText += '=== OPCIONES DISPONIBLES ===\n';
      
      for (const qualityGroup of allQualityOptions) {
        pricingText += `\n${qualityGroup.device.toUpperCase()} - ${qualityGroup.service.toUpperCase()}:\n`;
        
        for (const option of qualityGroup.options) {
          const price = this._extractValidPrice(option);
          const priceText = price > 0 ? `${price} UYU` : 'Precio a consultar';
          const quality = option.quality || 'Estándar';
          
          pricingText += `  • ${quality}: ${priceText}\n`;
        }
      }
      
      pricingText += '\n=== PRODUCTOS RELACIONADOS ===\n';
    }

    // Add relevant products from embeddings search
    const displayedProducts = new Set();
    
    for (const item of relevantProducts.slice(0, 50)) { // Limit to top 50 for performance
      const productKey = item._productKey || this._generateProductKey(item);
      
      if (!displayedProducts.has(productKey)) {
        const productName = item.Prod || item.product || Object.values(item)[0] || 'Unknown';
        const price = this._extractValidPrice(item);
        const priceText = price > 0 ? `${price} UYU` : 'Precio a consultar';
        
        pricingText += `${productName}: ${priceText}\n`;
        displayedProducts.add(productKey);
      }
    }

    return pricingText;
  }

  /**
   * Extract device and service from content
   */
  _extractDeviceAndService(content, conversationContext) {
    const fullText = content + ' ' + conversationContext.map(m => m.content).join(' ');
    const textLower = fullText.toLowerCase();

    let device = 'unknown';
    let service = 'unknown';

    // iPhone detection with better patterns
    const iphoneMatch = textLower.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?|se|xr|xs(?:\s*max)?|x)/i);
    if (iphoneMatch) {
      device = `iphone ${iphoneMatch[1].replace(/\s+/g, ' ').trim()}`;
    }

    // Samsung detection
    const samsungMatch = textLower.match(/samsung|galaxy/);
    if (samsungMatch) {
      const modelMatch = textLower.match(/galaxy\s*([a-z]\d+|note\s*\d+|s\d+)/i);
      if (modelMatch) {
        device = `samsung galaxy ${modelMatch[1]}`;
      } else {
        device = 'samsung';
      }
    }

    // Service detection with more keywords
    const serviceKeywords = {
      'pantalla': ['pantalla', 'display', 'screen', 'tactil', 'táctil', 'touch', 'lcd', 'oled', 'broken', 'cracked', 'roto', 'rota'],
      'bateria': ['bateria', 'batería', 'battery'],
      'camara': ['camara', 'cámara', 'camera', 'lente'],
      'carga': ['carga', 'charging', 'conector', 'puerto', 'usb'],
      'altavoz': ['altavoz', 'speaker', 'audio', 'sonido']
    };

    for (const [serviceType, keywords] of Object.entries(serviceKeywords)) {
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          service = serviceType;
          break;
        }
      }
      if (service !== 'unknown') break;
    }

    console.log(`🎯 Extracted: Device="${device}", Service="${service}"`);
    return { device, service };
  }

  /**
   * Helper methods
   */
  _extractValidPrice(item) {
    const priceFields = ['PUBLICO TIENDA', 'price', 'precio', 'cost', 'costo'];
    
    for (const field of priceFields) {
      if (item[field]) {
        const priceStr = item[field].toString();
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
        
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
    
    return 0;
  }

  _generateProductKey(item) {
    const productName = item.Prod || item.product || Object.values(item)[0] || 'unknown';
    return productName.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
  }

  // =================================================
  // ✅ FALLBACK RESPONSE
  // =================================================
  async createEnhancedFallback(processedContent, contactInfo) {
    const ConversationMemoryService = require('./conversationMemoryService');
    const isReturning = !ConversationMemoryService.isNewConversation(contactInfo.contact_id);
    
    const greeting = isReturning ? 
      `¡Hola de nuevo ${contactInfo.full_name || ''}!` : 
      `¡Hola ${contactInfo.full_name || ''}!`;

    const fallbackResponse = `${greeting} ¡Gracias por contactar ReparaloYA! 🔧📱

${isReturning ? 'Veo que ya habíamos conversado antes. ' : ''}Nuestro equipo te responderá pronto durante nuestro horario comercial.

Para reparaciones urgentes:
📞 Teléfono: 2200-21-91  
📱 WhatsApp: 098565349

🏪 NUESTRAS SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía de 30 días en todas las reparaciones
🚚 Retiro y entrega a domicilio disponible

¡Estamos aquí para ayudarte!`;

    return {
      customer_response: fallbackResponse,
      classification: {
        device_brand: "unknown",
        device_model: "unknown",
        service_type: "consulta general",
        urgency: "medium",
        language: "es",
        confidence: "low",
        conversation_context: isReturning ? 'returning' : 'new'
      },
      processed_content: processedContent,
      original_message_type: "text",
      fallback: true,
      is_returning_customer: isReturning,
      parsing_method: 'fallback'
    };
  }

  // =================================================
  // ✅ AUDIO TRANSCRIPTION
  // =================================================
  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("Missing audio URL");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { 'User-Agent': 'ReparaloyaBot/3.0' }
      });

      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es",
        response_format: "text",
        prompt: "Reparación de celulares, iPhone, Samsung, pantalla, batería, cámara"
      });

      console.log("✅ Transcription:", transcription);
      return transcription;
    } catch (err) {
      console.error("❌ Transcription error:", err.message);
      return `[Error de transcripción de audio]`;
    }
  }

  // =================================================
  // ✅ IMAGE ANALYSIS
  // =================================================
  async analyzeImage(imageUrl) {
    try {
      if (!imageUrl) throw new Error("Missing image URL");

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analiza esta imagen e identifica: 1) El modelo exacto del dispositivo, 2) Los daños visibles específicos, 3) El tipo de reparación probable. Responde en español, máximo 200 palabras."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 350,
        temperature: 0.3
      });

      const text = result.choices[0].message.content;
      console.log("✅ Image analysis:", text);
      return text;

    } catch (err) {
      console.error("❌ Image analysis error:", err.message);
      return `[Error de análisis de imagen: describe tu problema por texto]`;
    }
  }
}

module.exports = new EnhancedAIService();

class FlexibleAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add OPENAI_API_KEY to .env file.");
    }

    console.log("✅ Flexible AI Service initialized (Direct Responses + No Annoying Questions)");

    this.openai = new OpenAI({
      apiKey,
      timeout: 45000,
      maxRetries: 2,
    });
  }

  // =================================================
  // ✅ MAIN MESSAGE PROCESSOR WITH FLEXIBLE PARSING
  // =================================================
  async processMessage(messageContent, messageType, mediaUrl, pricingData, contactInfo) {
    try {
      let processedContent = messageContent;

      // Store user message in memory
      const ConversationMemoryService = require('./conversationMemoryService');
      await ConversationMemoryService.storeMessage(
        contactInfo.contact_id,
        'user',
        messageContent,
        {
          message_type: messageType,
          media_url: mediaUrl,
          contact_name: contactInfo.full_name,
          channel: contactInfo.channel || 'SMS'
        }
      );

      // ✅ Voice → Transcription
      if (messageType === "voice" || messageType === "audio") {
        console.log("🎤 Transcribing voice...");
        processedContent = await this.transcribeAudio(mediaUrl);
      }

      // ✅ Image → Vision Analysis
      else if (messageType === "image" || messageType === "photo") {
        console.log("🖼️ Analyzing image...");
        processedContent = await this.analyzeImage(mediaUrl);
      }

      // Get conversation context for AI
      const conversationContext = ConversationMemoryService.getConversationContext(
        contactInfo.contact_id,
        6
      );

      // ✅ AI → Flexible response with natural conversation
      console.log("🤖 Generating direct response (no annoying questions)...");
      const aiResult = await this.generateDirectResponse(
        processedContent,
        messageType,
        pricingData,
        contactInfo,
        conversationContext
      );

      // Store AI response in memory
      await ConversationMemoryService.storeMessage(
        contactInfo.contact_id,
        'assistant',
        aiResult.customer_response,
        {
          message_type: 'text',
          classification: aiResult.classification,
          pricing_items_found: aiResult.pricing_items_found || 0
        }
      );

      return aiResult;

    } catch (err) {
      console.error("❌ Flexible AI processing error:", err);
      const fallbackResponse = await this.createDirectFallback(processedContent, contactInfo);
      return fallbackResponse;
    }
  }

  // =================================================
  // ✅ DIRECT RESPONSE GENERATOR (NO QUESTIONS FIRST)
  // =================================================
  async generateDirectResponse(processedContent, messageType, pricingData, contactInfo, conversationContext) {
    try {
      const EnhancedPricingService = require('./pricingService');
      
      // 🚀 GET MORE RELEVANT PRODUCTS (60 products)
      const relevantProducts = await EnhancedPricingService.findRelevantProducts(processedContent, 60);
      
      console.log(`📊 Found ${relevantProducts.length} relevant products using embeddings`);

      // 🎯 EXTRACT DEVICE AND SERVICE FOR ALL QUALITY OPTIONS
      const deviceServiceInfo = this._extractDeviceAndService(processedContent, conversationContext);
      let allQualityOptions = [];
      
      if (deviceServiceInfo.device && deviceServiceInfo.service) {
        console.log(`🔍 Finding ALL quality options for ${deviceServiceInfo.device} ${deviceServiceInfo.service}`);
        allQualityOptions = await EnhancedPricingService.findAllQualityOptions(
          deviceServiceInfo.device,
          deviceServiceInfo.service
        );
      }

      // Create comprehensive pricing text with ALL options
      const pricingText = this._createComprehensivePricingText(relevantProducts, allQualityOptions);

      // Check if this is a returning customer
      const ConversationMemoryService = require('./conversationMemoryService');
      const isReturning = !ConversationMemoryService.isNewConversation(contactInfo.contact_id);

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialistas en reparación de celulares en Montevideo, Uruguay.

INSTRUCCIONES CRÍTICAS - LEE CUIDADOSAMENTE:
1. 🚀 SIEMPRE muestra TODAS las opciones disponibles INMEDIATAMENTE - NUNCA hagas preguntas primero
2. 💰 NUNCA inventes precios - solo usa la base de datos
3. 📋 Cuando alguien menciona un dispositivo y problema, LISTA TODAS las opciones con precios INMEDIATAMENTE
4. ❌ PROHIBIDO preguntar "¿qué calidad prefieres?" - MUESTRA todas las calidades con precios PRIMERO
5. ✅ Responde NATURALMENTE - NO uses formato JSON
6. 🛠️ Promociona servicios: garantía 30 días, retiro a domicilio
7. 💎 EJEMPLO CORRECTO: "iPhone 11 pantalla rota" → INMEDIATAMENTE: "Para iPhone 11 pantalla tenemos: Original: 5680 UYU, Compatible: 3200 UYU, Incell: 2595 UYU"
8. ❌ EJEMPLO INCORRECTO: "¿Qué calidad prefieres?" (NUNCA hagas esto)

INFORMACIÓN COMPLETA DE PRECIOS (${relevantProducts.length} productos):
${pricingText}

DATOS DEL NEGOCIO:
SUCURSALES:
- La Comercial: Carlos Reyles 1750, esq. José L. Terra, Lunes a Viernes 10:00-12:30 y 13:00-18:00, Sábados 09:00-13:00
- Pocitos: Chucarro 1107, esq. Masini, Lunes a Viernes 10:00-18:00, Sábados 09:00-13:00  
- Tres Cruces: Mario Cassinoni 1684, Lunes a Viernes 10:00-18:00, Sábados 09:00-13:00

SERVICIOS:
- Reparación de smartphones, tablets, Apple Watch  
- Retiro y entrega a domicilio en Montevideo
- Garantía: 30 días en todas las reparaciones
- WhatsApp: 098565349 | Teléfono: 2200-21-91

${isReturning ? `CLIENTE QUE REGRESA: Este cliente ya conversó contigo antes.` : 'CLIENTE NUEVO: Preséntate amigablemente.'}

RESPONDE COMO HUMANO ÚTIL - MUESTRA OPCIONES INMEDIATAMENTE.`;

      const userPrompt = `Cliente: ${contactInfo.full_name || "Cliente"}
Mensaje: "${processedContent}"
Tipo: ${messageType}

CRÍTICO: NO hagas preguntas sobre qué quieren - MUESTRA TODAS las opciones inmediatamente.
Si dicen "iPhone 11 pantalla rota" → INMEDIATAMENTE responde con TODAS las opciones con precios.
NO preguntes qué calidad prefieren - MUESTRA todas y que ellos decidan.
Solo haz preguntas DESPUÉS de mostrar todas las opciones disponibles.`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2, // Lower temperature for more consistent responses
        max_tokens: 1500
      });

      let content = result.choices[0].message.content.trim();

      // 🚀 FLEXIBLE PARSING - Accept ANY good response
      let classification;
      
      // Try JSON parsing first (in case AI still uses JSON)
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.customer_response && parsed.classification) {
            content = parsed.customer_response;
            classification = parsed.classification;
          }
        }
      } catch (jsonErr) {
        // Not JSON - that's perfectly fine!
      }

      // Extract classification from the response content
      if (!classification) {
        classification = this._extractClassificationFromResponse(content, processedContent, conversationContext);
      }

      console.log('✅ Direct response generated:', {
        response_length: content.length,
        has_classification: !!classification,
        parsing_method: classification?.parsing_method || 'natural'
      });

      return {
        customer_response: content,
        classification: {
          device_brand: classification?.device_brand || "unknown",
          device_model: classification?.device_model || "unknown", 
          service_type: classification?.service_type || "consulta general",
          urgency: classification?.urgency || "medium",
          language: "es",
          confidence: classification?.confidence || "medium",
          conversation_context: isReturning ? 'returning' : 'new'
        },
        processed_content: processedContent,
        original_message_type: messageType,
        pricing_items_found: relevantProducts.length,
        quality_groups_found: allQualityOptions.length,
        is_returning_customer: isReturning,
        conversation_messages: conversationContext.length,
        parsing_method: 'direct_response'
      };

    } catch (err) {
      console.error("❌ Direct response generation error:", err.message);
      return this.createDirectFallback(processedContent, contactInfo);
    }
  }

  // =================================================
  // ✅ COMPREHENSIVE PRICING TEXT (ALL OPTIONS)
  // =================================================
  _createComprehensivePricingText(relevantProducts, allQualityOptions) {
    let pricingText = '';

    // Add quality options grouped by device/service
    if (allQualityOptions.length > 0) {
      pricingText += '=== TODAS LAS CALIDADES DISPONIBLES ===\n';
      
      for (const qualityGroup of allQualityOptions) {
        pricingText += `\n${qualityGroup.device.toUpperCase()} - ${qualityGroup.service.toUpperCase()}:\n`;
        
        for (const option of qualityGroup.options) {
          const price = this._extractValidPrice(option);
          const priceText = price > 0 ? `${price} UYU` : 'Precio a consultar';
          const quality = option.quality || 'Estándar';
          
          pricingText += `  • ${quality}: ${priceText}\n`;
        }
      }
      
      pricingText += '\n=== PRODUCTOS RELACIONADOS ===\n';
    }

    // Add ALL relevant products (not limited)
    const displayedProducts = new Set();
    
    for (const item of relevantProducts) {
      const productKey = item._productKey || this._generateProductKey(item);
      
      if (!displayedProducts.has(productKey)) {
        const productName = item.Prod || item.product || Object.values(item)[0] || 'Unknown';
        const price = this._extractValidPrice(item);
        const priceText = price > 0 ? `${price} UYU` : 'Precio a consultar';
        
        pricingText += `${productName}: ${priceText}\n`;
        displayedProducts.add(productKey);
      }
    }

    return pricingText;
  }

  // =================================================
  // ✅ SMART CLASSIFICATION EXTRACTION
  // =================================================
  _extractClassificationFromResponse(content, originalContent, conversationContext) {
    const contentLower = content.toLowerCase();
    const originalLower = originalContent.toLowerCase();
    const fullText = `${contentLower} ${originalLower}`;

    // Extract device brand
    let device_brand = "unknown";
    if (fullText.includes('iphone') || fullText.includes('apple')) device_brand = "Apple";
    else if (fullText.includes('samsung') || fullText.includes('galaxy')) device_brand = "Samsung";
    else if (fullText.includes('xiaomi') || fullText.includes('redmi')) device_brand = "Xiaomi";
    else if (fullText.includes('huawei')) device_brand = "Huawei";
    else if (fullText.includes('motorola')) device_brand = "Motorola";
    else if (fullText.includes('nokia')) device_brand = "Nokia";
    else if (fullText.includes('lg')) device_brand = "LG";

    // Extract service type
    let service_type = "consulta general";
    if (fullText.includes('pantalla') || fullText.includes('screen') || fullText.includes('display')) service_type = "pantalla";
    else if (fullText.includes('bateria') || fullText.includes('battery') || fullText.includes('batería')) service_type = "bateria";
    else if (fullText.includes('camara') || fullText.includes('camera') || fullText.includes('cámara')) service_type = "camara";
    else if (fullText.includes('carga') || fullText.includes('charging') || fullText.includes('conector')) service_type = "carga";
    else if (fullText.includes('altavoz') || fullText.includes('speaker') || fullText.includes('audio')) service_type = "altavoz";
    else if (fullText.includes('agua') || fullText.includes('water') || fullText.includes('mojado')) service_type = "agua";

    // Extract device model with more patterns
    let device_model = "unknown";
    const iphoneMatch = fullText.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?|se|xr|xs(?:\s*max)?|x)/i);
    if (iphoneMatch) {
      device_model = `iPhone ${iphoneMatch[1]}`;
    }
    
    const galaxyMatch = fullText.match(/galaxy\s*([a-z]\d+|note\s*\d+|s\d+)/i);
    if (galaxyMatch) {
      device_model = `Galaxy ${galaxyMatch[1]}`;
    }

    return {
      device_brand,
      device_model,
      service_type,
      urgency: "medium",
      confidence: "medium",
      parsing_method: "extracted_from_natural"
    };
  }

  // =================================================
  // ✅ DEVICE AND SERVICE EXTRACTION
  // =================================================
  _extractDeviceAndService(content, conversationContext) {
    const fullText = content + ' ' + conversationContext.map(m => m.content).join(' ');
    const textLower = fullText.toLowerCase();

    let device = 'unknown';
    let service = 'unknown';

    // iPhone detection
    const iphoneMatch = textLower.match(/iphone\s*(\d+(?:\s*pro(?:\s*max)?)?|se|xr|xs(?:\s*max)?|x)/i);
    if (iphoneMatch) {
      device = `iphone ${iphoneMatch[1].replace(/\s+/g, ' ').trim()}`;
    }

    // Samsung detection
    const samsungMatch = textLower.match(/samsung|galaxy/);
    if (samsungMatch) {
      const modelMatch = textLower.match(/galaxy\s*([a-z]\d+|note\s*\d+|s\d+)/i);
      if (modelMatch) {
        device = `samsung galaxy ${modelMatch[1]}`;
      } else {
        device = 'samsung';
      }
    }

    // Service detection
    const serviceKeywords = {
      'pantalla': ['pantalla', 'display', 'screen', 'tactil', 'táctil', 'touch', 'lcd', 'oled', 'broken', 'cracked', 'roto'],
      'bateria': ['bateria', 'batería', 'battery'],
      'camara': ['camara', 'cámara', 'camera', 'lente'],
      'carga': ['carga', 'charging', 'conector', 'puerto', 'usb'],
      'altavoz': ['altavoz', 'speaker', 'audio', 'sonido']
    };

    for (const [serviceType, keywords] of Object.entries(serviceKeywords)) {
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          service = serviceType;
          break;
        }
      }
      if (service !== 'unknown') break;
    }

    console.log(`🎯 Extracted: Device="${device}", Service="${service}"`);
    return { device, service };
  }

  // =================================================
  // ✅ HELPER METHODS
  // =================================================
  _extractValidPrice(item) {
    const priceFields = ['PUBLICO TIENDA', 'price', 'precio', 'cost', 'costo'];
    
    for (const field of priceFields) {
      if (item[field]) {
        const priceStr = item[field].toString();
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
        
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
    
    return 0;
  }

  _generateProductKey(item) {
    const productName = item.Prod || item.product || Object.values(item)[0] || 'unknown';
    return productName.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
  }

  // =================================================
  // ✅ DIRECT FALLBACK (NO QUESTIONS)
  // =================================================
  async createDirectFallback(processedContent, contactInfo) {
    const ConversationMemoryService = require('./conversationMemoryService');
    const isReturning = !ConversationMemoryService.isNewConversation(contactInfo.contact_id);
    
    const greeting = isReturning ? 
      `¡Hola de nuevo ${contactInfo.full_name || ''}!` : 
      `¡Hola ${contactInfo.full_name || ''}!`;

    const fallbackResponse = `${greeting} ¡Gracias por contactar ReparaloYA! 🔧📱

${isReturning ? 'Veo que ya habíamos conversado antes. ' : ''}Nuestro equipo te responderá pronto con información específica sobre tu consulta.

Para reparaciones urgentes:
📞 Teléfono: 2200-21-91  
📱 WhatsApp: 098565349

🏪 NUESTRAS SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía de 30 días en todas las reparaciones
🚚 Retiro y entrega a domicilio disponible

¡Estamos aquí para ayudarte!`;

    return {
      customer_response: fallbackResponse,
      classification: {
        device_brand: "unknown",
        device_model: "unknown",
        service_type: "consulta general",
        urgency: "medium",
        language: "es",
        confidence: "low",
        conversation_context: isReturning ? 'returning' : 'new'
      },
      processed_content: processedContent,
      original_message_type: "text",
      fallback: true,
      is_returning_customer: isReturning,
      parsing_method: 'fallback'
    };
  }

  // =================================================
  // ✅ AUDIO TRANSCRIPTION
  // =================================================
  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("Missing audio URL");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { 'User-Agent': 'ReparaloyaBot/3.0' }
      });

      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es",
        response_format: "text",
        prompt: "Reparación de celulares, iPhone, Samsung, pantalla, batería, cámara"
      });

      console.log("✅ Transcription:", transcription);
      return transcription;
    } catch (err) {
      console.error("❌ Transcription error:", err.message);
      return `[Error de transcripción de audio]`;
    }
  }

  // =================================================
  // ✅ IMAGE ANALYSIS
  // =================================================
  async analyzeImage(imageUrl) {
    try {
      if (!imageUrl) throw new Error("Missing image URL");

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analiza esta imagen e identifica: 1) El modelo exacto del dispositivo, 2) Los daños visibles específicos, 3) El tipo de reparación probable. Responde en español, máximo 200 palabras."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 350,
        temperature: 0.3
      });

      const text = result.choices[0].message.content;
      console.log("✅ Image analysis:", text);
      return text;

    } catch (err) {
      console.error("❌ Image analysis error:", err.message);
      return `[Error de análisis de imagen: describe tu problema por texto]`;
    }
  }
}

module.exports = new FlexibleAIService();