const OpenAI = require("openai");
const axios = require("axios");

class ImprovedAIService {
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
    
    console.log("✅ Servicio IA Mejorado inicializado - GPT-4o con manejo de saludos");
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
      let filteredProducts = [];
      let productsText = '';
      
      if (!isSimpleGreeting) {
        const SimplifiedPricingService = require('./pricingService');
        products = await SimplifiedPricingService.searchProducts(processedContent, 30);
        
        console.log(`📊 Encontrado ${products.length} productos para: "${processedContent}"`);

        // Filter products to show only relevant part types
        filteredProducts = this._filterRelevantProducts(products, processedContent);
        console.log(`🎯 Productos filtrados: ${filteredProducts.length} (solo relevantes)`);

        // Create products text for AI
        productsText = this._createProductsText(filteredProducts);
      } else {
        console.log('🤝 Saludo simple detectado, no buscando productos');
        productsText = 'No aplicable - saludo simple.';
      }
      
      // Get extended conversation context
      let conversationContext = '';
      let conversationSummary = '';
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        const context = ConversationMemoryService.getConversationContext(contactInfo.contact_id, 10);
        console.log('contexto extendido:', context);
        
        if (context.length > 0) {
          conversationContext = 'Mensajes anteriores (contexto de conversación):\n' + 
            context.map(msg => `${msg.role === 'user' ? 'Cliente' : 'Asistente'}: ${msg.content.substring(0, 200)}`).join('\n') + '\n\n';
          
          // Create conversation summary for greeting responses
          const summary = ConversationMemoryService.getConversationSummary(contactInfo.contact_id);
          if (summary && summary.message_count > 2) {
            conversationSummary = `Cliente recurrente. Mensajes previos: ${summary.message_count}. Última actividad: ${this._formatLastActivity(summary.last_message)}.`;
          }
          
          console.log('contexto de conversación:', conversationContext);
        }
      } catch (err) {
        console.log('No hay memoria de conversación disponible');
      }

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialista en reparación de teléfonos móviles en Montevideo, Uruguay.

REGLAS CRÍTICAS:
1. 🇪🇸 RESPONDE SIEMPRE EN ESPAÑOL - NUNCA EN INGLÉS
2. 🤝 MANEJO DE SALUDOS: Si el cliente envía solo un saludo básico (Hola, Hi, Buenos días, etc.) SIN mencionar productos/servicios, responde con saludo amigable y pregunta en qué puedes ayudar HOY
3. 🚀 MUESTRA TODAS las opciones disponibles INMEDIATAMENTE solo cuando hay consulta específica de producto
4. ❌ NUNCA asumas que quieren continuar conversaciones anteriores a menos que lo mencionen específicamente
5. 💰 USA SOLO los precios de la base de datos - NUNCA inventes
6. 📱 MUESTRA SOLO las piezas RELEVANTES a lo que pide el cliente
7. 🔄 USA el contexto de conversación solo cuando el cliente hace referencia a temas anteriores
8. 🚫 NUNCA menciones "porcentaje de relevancia", "puntajes de similitud", o detalles técnicos de búsqueda a los clientes

PRODUCTOS ENCONTRADOS (Búsqueda semántica filtrada):
${productsText}

INFORMACIÓN DEL NEGOCIO:
📞 WhatsApp: 098565349 | Teléfono: 2200-21-91

🏪 SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía: 30 días | 🚚 Retiro a domicilio disponible

MANEJO DE SALUDOS Y CONTEXTO:
- Si es saludo simple: Saluda amigablemente y pregunta en qué puedes ayudar HOY
- Si mencionan algo específico: Busca productos y ofrece opciones
- Si referencian conversación anterior: "sobre lo que hablamos", "la pantalla que mencionaste", etc. - entonces usa contexto
- Si es cliente recurrente pero saludo simple: Reconócelo brevemente pero pregunta qué necesita HOY

REGLAS DE FILTRADO DE PRODUCTOS:
- Cliente pide "pantalla" → Muestra SOLO productos relacionados con pantallas (Original Y Compatible)
- Cliente pide "batería" → Muestra SOLO productos relacionados con baterías 
- Cliente pide "cámara" → Muestra SOLO productos relacionados con cámaras
- NUNCA mezcles diferentes tipos de piezas en una respuesta
- SIEMPRE muestra múltiples calidades cuando existan (Original, Compatible, etc.)

EJEMPLOS CORRECTOS:

Ejemplo 1 - Saludo simple (NUEVO CLIENTE):
Cliente: "Hola"
Respuesta: "¡Hola! Bienvenido a ReparaloYA. ¿En qué podemos ayudarte hoy?"

Ejemplo 2 - Saludo simple (CLIENTE RECURRENTE):
Cliente: "Hi" 
Contexto: Ha preguntado antes sobre iPhone 14
Respuesta: "¡Hola [nombre]! ¿Cómo estás? ¿En qué puedo ayudarte hoy?"

Ejemplo 3 - Consulta específica:
Cliente: "Precio pantalla iPhone 12"
Respuesta: "Para cambio de pantalla iPhone 12:
• Pantalla Original: 4,800 UYU
• Pantalla Compatible: 2,900 UYU
Ambas con garantía de 30 días. ¿Cuál prefieres?"

Ejemplo 4 - Referencia a conversación anterior:
Cliente: "Sobre la pantalla del iPhone que consultamos"
Respuesta: [Usar contexto y responder sobre la pantalla específica mencionada antes]

Ejemplo 5 - Saludo + consulta:
Cliente: "Hola, necesito cambiar pantalla iPhone 13"
Respuesta: "¡Hola! Para cambio de pantalla iPhone 13:
• Pantalla Original: 4,500 UYU  
• Pantalla Compatible: 2,700 UYU
¿Cuál te conviene más?"

MALOS EJEMPLOS (NO HAGAS ESTO):

❌ Cliente: "Hi"
MALA Respuesta: "¡Hola! Veo que estabas interesado en la pantalla del iPhone 14. Tenemos disponible: Pantalla Original 5,200 UYU..."

❌ Cliente: "Buenos días"  
MALA Respuesta: "Buenos días! Para continuar con tu consulta del iPhone 12..."

RESPONDE COMO UN REPRESENTANTE DE SERVICIO AL CLIENTE HUMANO NATURAL EN ESPAÑOL.`;

      const userPrompt = `Cliente: ${contactInfo.full_name || "Cliente"}
Mensaje actual: "${processedContent}"

${conversationContext}

${conversationSummary ? `Resumen del cliente: ${conversationSummary}` : ''}

INSTRUCCIONES IMPORTANTES:
1. DETECTA el tipo de mensaje:
   - ¿Es solo un saludo básico? → Saluda y pregunta en qué puedes ayudar HOY
   - ¿Menciona productos específicos? → Muestra opciones con precios
   - ¿Hace referencia a conversación anterior? → Usa contexto apropiadamente

2. NO asumas que quieren continuar temas anteriores solo por saludar

3. Si hay productos disponibles: MUESTRA TODAS las opciones (Original Y Compatible) con precios INMEDIATAMENTE

4. Responde SOLO en español

5. Sé natural y amigable, no robótico`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2, // Slightly higher for more natural responses
        max_tokens: 1000,
      });

      const response = result.choices[0].message.content.trim();
      
      // Extract classification with better logic
      const classification = this._extractClassification(processedContent, response, isSimpleGreeting);

      return {
        customer_response: response,
        classification: classification,
        processed_content: processedContent,
        pricing_items_found: filteredProducts.length,
        total_products_searched: products.length,
        is_simple_greeting: isSimpleGreeting,
        parsing_method: isSimpleGreeting ? 'greeting-handler' : 'improved-semantic-filtering',
        model_used: 'gpt-4o',
        context_messages: conversationContext ? conversationContext.split('\n').length - 2 : 0
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
      // Exact match or with punctuation
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

  _formatLastActivity(timestamp) {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffHours = Math.round((now - date) / (1000 * 60 * 60));
      
      if (diffHours < 1) return 'hace menos de 1 hora';
      if (diffHours < 24) return `hace ${diffHours} horas`;
      const diffDays = Math.round(diffHours / 24);
      return `hace ${diffDays} días`;
    } catch {
      return 'recientemente';
    }
  }

  _filterRelevantProducts(products, query) {
    if (!products || products.length === 0) return [];
    
    const queryLower = query.toLowerCase();
    
    // Determine what type of part the customer is asking for
    let targetPartTypes = [];
    
    if (queryLower.includes('pantalla') || queryLower.includes('screen') || queryLower.includes('display')) {
      targetPartTypes = ['pantalla', 'screen', 'display', 'lcd', 'oled'];
    } else if (queryLower.includes('batería') || queryLower.includes('battery') || queryLower.includes('bateria')) {
      targetPartTypes = ['batería', 'battery', 'bateria', 'pila'];
    } else if (queryLower.includes('cámara') || queryLower.includes('camera') || queryLower.includes('camara')) {
      targetPartTypes = ['cámara', 'camera', 'camara', 'objetivo'];
    } else if (queryLower.includes('altavoz') || queryLower.includes('speaker') || queryLower.includes('parlante') || queryLower.includes('audio')) {
      targetPartTypes = ['altavoz', 'speaker', 'parlante', 'audio', 'sonido'];
    } else if (queryLower.includes('micro') || queryLower.includes('microphone') || queryLower.includes('micrófono')) {
      targetPartTypes = ['micro', 'microphone', 'micrófono', 'microfono'];
    } else if (queryLower.includes('carga') || queryLower.includes('charging') || queryLower.includes('conector')) {
      targetPartTypes = ['carga', 'charging', 'conector', 'puerto', 'conectar'];
    } else {
      // If no specific part type detected, return top products but prefer exact device matches
      return products.slice(0, 15);
    }
    
    // Filter products that match the target part types
    const filtered = products.filter(product => {
      const productName = (product.Prod || product.product || Object.values(product)[0] || '').toLowerCase();
      
      return targetPartTypes.some(partType => productName.includes(partType));
    });
    
    // If no filtered products found but we have products, it might be a general device inquiry
    if (filtered.length === 0 && products.length > 0) {
      // For general device inquiries, return a mix but prioritize screens/batteries (most common repairs)
      const generalProducts = products.filter(product => {
        const productName = (product.Prod || product.product || Object.values(product)[0] || '').toLowerCase();
        return productName.includes('pantalla') || productName.includes('screen') || 
               productName.includes('batería') || productName.includes('battery');
      });
      
      return generalProducts.slice(0, 10);
    }
    
    return filtered.slice(0, 15); // Limit to top 15 relevant products
  }

  _createProductsText(products) {
    if (products.length === 0) {
      return 'No se encontraron productos específicos en la base de datos.';
    }

    let text = `${products.length} productos relevantes encontrados:\n`;
    
    // Group products by type for better organization
    const productGroups = {};
    
    for (const product of products) {
      const productName = product.Prod || product.product || Object.values(product)[0] || 'Producto desconocido';
      const price = this._getPrice(product);
      const priceText = price > 0 ? `${price} UYU` : 'Consultar precio';
      
      // Try to determine product type (Original, Compatible, etc.)
      const productLower = productName.toLowerCase();
      let productType = 'standard';
      
      if (productLower.includes('original') || productLower.includes('oem')) {
        productType = 'original';
      } else if (productLower.includes('compatible') || productLower.includes('generico')) {
        productType = 'compatible';
      } else if (productLower.includes('premium') || productLower.includes('aaa')) {
        productType = 'premium';
      }
      
      const baseModel = this._extractBaseModel(productName);
      
      if (!productGroups[baseModel]) {
        productGroups[baseModel] = {};
      }
      
      productGroups[baseModel][productType] = { productName, priceText };
    }
    
    // Format grouped products
    text = '';
    for (const [model, types] of Object.entries(productGroups)) {
      if (Object.keys(types).length > 1) {
        text += `${model}:\n`;
        for (const [type, info] of Object.entries(types)) {
          const typeLabel = type === 'original' ? 'Original' : 
                           type === 'compatible' ? 'Compatible' : 
                           type === 'premium' ? 'Premium' : '';
          text += `• ${typeLabel ? typeLabel + ': ' : ''}${info.priceText}\n`;
        }
      } else {
        const info = Object.values(types)[0];
        text += `• ${info.productName}: ${info.priceText}\n`;
      }
    }
    
    return text.trim();
  }

  _extractBaseModel(productName) {
    // Extract base model (e.g., "iPhone 14" from "iPhone 14 Pantalla Original")
    const modelPatterns = [
      /iphone\s*(\d+)(\s*pro)?(\s*max)?/i,
      /galaxy\s*([a-z]\d+)/i,
      /samsung\s*([a-z]\d+)/i,
      /xiaomi\s*([\w\s]+)/i,
      /huawei\s*([\w\s]+)/i
    ];
    
    for (const pattern of modelPatterns) {
      const match = productName.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return productName.split(' ').slice(0, 3).join(' '); // Fallback: first 3 words
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
      else if (text.includes('carga') || text.includes('charging') || text.includes('carga')) service_type = "carga";
      else if (text.includes('altavoz') || text.includes('speaker') || text.includes('parlante')) service_type = "altavoz";
      else if (text.includes('micro') || text.includes('microphone') || text.includes('micrófono')) service_type = "micrófono";
    }

    // Better device model extraction
    let device_model = "unknown";
    if (!isSimpleGreeting) {
      const iphoneMatch = text.match(/iphone\s*(\d+)(\s*pro)?(\s*max)?/i);
      if (iphoneMatch) {
        device_model = `iPhone ${iphoneMatch[1]}${iphoneMatch[2] || ''}${iphoneMatch[3] || ''}`.trim();
      }
      
      const samsungMatch = text.match(/galaxy\s*([a-z]\d+)/i) || text.match(/samsung\s*([a-z]\d+)/i);
      if (samsungMatch) {
        device_model = `Galaxy ${samsungMatch[1].toUpperCase()}`;
      }
    }

    return {
      device_brand,
      device_model,
      service_type,
      urgency: isSimpleGreeting ? "none" : "medium",
      language: "es",
      confidence: isSimpleGreeting ? "high" : "high",
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
        customer_response: `¡Hola ${contactInfo.full_name || ''}! Bienvenido a ReparaloYA. ¿En qué podemos ayudarte hoy?`,
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
        parsing_method: 'greeting-fallback',
        model_used: 'fallback'
      };
    }

    const response = `¡Hola ${contactInfo.full_name || ''}! 

Tu solicitud ha sido registrada. Nuestro equipo te contactará pronto con las opciones disponibles para tu consulta.

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
      parsing_method: 'fallback',
      model_used: 'fallback'
    };
  }
}

module.exports = new ImprovedAIService();