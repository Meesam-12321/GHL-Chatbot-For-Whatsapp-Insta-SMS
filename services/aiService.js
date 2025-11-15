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
      timeout: 45000, // Increased timeout for better model
      maxRetries: 3,
    });
    
    console.log("✅ Servicio IA Mejorado inicializado - GPT-4o con contexto extendido");
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
      // Search for products with better filtering
      const SimplifiedPricingService = require('./pricingService');
      const products = await SimplifiedPricingService.searchProducts(processedContent, 30);
      
      console.log(`📊 Encontrado ${products.length} productos para: "${processedContent}"`);

      // Filter products to show only relevant part types
      const filteredProducts = this._filterRelevantProducts(products, processedContent);
      console.log(`🎯 Productos filtrados: ${filteredProducts.length} (solo relevantes)`);

      // Create products text for AI
      const productsText = this._createProductsText(filteredProducts);
      
      // Get extended conversation context
      let conversationContext = '';
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        const context = ConversationMemoryService.getConversationContext(contactInfo.contact_id, 10); // Increased from 4 to 10
        console.log('contexto extendido:', context);
        if (context.length > 0) {
          conversationContext = 'Mensajes anteriores (contexto de conversación):\n' + 
            context.map(msg => `${msg.role === 'user' ? 'Cliente' : 'Asistente'}: ${msg.content.substring(0, 200)}`).join('\n') + '\n\n';
          console.log('contexto de conversación:', conversationContext);
        }
      } catch (err) {
        console.log('No hay memoria de conversación disponible');
      }

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialista en reparación de teléfonos móviles en Montevideo, Uruguay.

REGLAS CRÍTICAS:
1. 🇪🇸 RESPONDE SIEMPRE EN ESPAÑOL - NUNCA EN INGLÉS
2. 🚀 MUESTRA TODAS las opciones disponibles INMEDIATAMENTE
3. ❌ NUNCA preguntes "¿qué calidad prefieres?" ANTES de mostrar precios
4. 💰 USA SOLO los precios de la base de datos - NUNCA inventes
5. 📱 MUESTRA SOLO las piezas RELEVANTES a lo que pide el cliente
6. 🔄 MANTÉN el flujo de conversación - referencia mensajes anteriores cuando sea apropiado
7. 🚫 NUNCA menciones "porcentaje de relevancia", "puntajes de similitud", o detalles técnicos de búsqueda a los clientes
8. 🎯 Si el cliente pide "pantalla iPhone 15" - muestra SOLO opciones de pantalla, NO altavoces, cámaras, u otras piezas

PRODUCTOS ENCONTRADOS (Búsqueda semántica filtrada):
${productsText}

INFORMACIÓN DEL NEGOCIO:
📞 WhatsApp: 098565349 | Teléfono: 2200-21-91

🏪 SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía: 30 días | 🚚 Retiro a domicilio disponible

USO DEL CONTEXTO DE CONVERSACIÓN:
- Si el cliente preguntó anteriormente sobre un dispositivo, reconócelo naturalmente
- Si están haciendo seguimiento a una consulta anterior, refiérelo
- Construye sobre la conversación anterior naturalmente sin repetir información
- Si cambian de tema, enfócate en la nueva solicitud
- Usa información de mensajes anteriores para personalizar la respuesta

REGLAS DE FILTRADO DE PRODUCTOS:
- Cliente pide "pantalla" → Muestra SOLO productos relacionados con pantallas
- Cliente pide "batería" → Muestra SOLO productos relacionados con baterías
- Cliente pide "cámara" → Muestra SOLO productos relacionados con cámaras
- NUNCA mezcles diferentes tipos de piezas en una respuesta
- Si no existe modelo exacto, muestra modelos similares del MISMO TIPO DE PIEZA solamente

ESTILO DE RESPUESTA:
- Escribe como un representante de servicio al cliente humano
- NUNCA menciones detalles técnicos como "80% de relevancia" o "búsqueda semántica"
- Mantén respuestas conversacionales y útiles
- No abrumes con demasiadas opciones (máximo 5-6 artículos relevantes)
- Sé cálido y profesional

EJEMPLOS CORRECTOS:

Ejemplo 1 - Coincidencia exacta:
Cliente: "Precio pantalla iPhone 12"
Respuesta: "Para cambio de pantalla iPhone 12:
• Calidad Original: 4,800 UYU
• Calidad Compatible: 2,900 UYU
Ambas vienen con garantía de 30 días. ¿Cuál calidad preferirías?"

Ejemplo 2 - Sin modelo exacto, mostrar modelos similares del MISMO TIPO:
Cliente: "Pantalla iPhone 15"
Respuesta: "Aún no tenemos pantallas iPhone 15 en stock, pero tenemos modelos iPhone similares:
• Pantalla iPhone 14 Original: 5,200 UYU
• Pantalla iPhone 13 Pro Original: 4,800 UYU
• Pantalla iPhone 14 Pro Original: 5,600 UYU
Nuestro equipo puede verificar si conseguimos el iPhone 15 específicamente. ¿Cuál te interesa?"

Ejemplo 3 - Siguiendo contexto de conversación:
Anterior: Cliente preguntó sobre batería iPhone 12
Actual: "¿Y la pantalla?"
Respuesta: "Para la pantalla del iPhone 12 (ya que estábamos hablando de tu iPhone 12):
• Calidad Original: 4,800 UYU  
• Calidad Compatible: 2,900 UYU
¿Te gustaría reparar tanto la batería como la pantalla? Ofrecemos descuentos por reparaciones combinadas."

Ejemplo 4 - Cliente regresando después de conversación anterior:
Contexto: Cliente preguntó anteriormente sobre iPhone 13
Nuevo mensaje: "Hola, he estado pensando"
Respuesta: "¡Hola! Me alegra verte de vuelta. ¿Has tomado una decisión sobre tu iPhone 13? Habías preguntado sobre [referenciar la consulta anterior]. ¿Cómo puedo ayudarte hoy?"

MAL EJEMPLO (NO HAGAS ESTO):
Cliente: "Pantalla iPhone 15"
MALA Respuesta: "Aquí tienes productos con 75% de relevancia:
• Pantalla iPhone 14: 5,200 UYU (85% de similitud)
• Altavoz iPhone 15: 800 UYU (60% de relevancia)  
• Cámara iPhone 13: 1,200 UYU (45% de coincidencia)"

RESPONDE COMO UN REPRESENTANTE DE SERVICIO AL CLIENTE HUMANO ÚTIL EN ESPAÑOL.`;

      const userPrompt = `Cliente: ${contactInfo.full_name || "Cliente"}
Mensaje actual: "${processedContent}"

${conversationContext}

INSTRUCCIONES IMPORTANTES:
1. Si hay productos disponibles: MUESTRA TODAS las opciones con precios INMEDIATAMENTE
2. Si NO hay productos exactos: "Tu solicitud ha sido registrada. Te contactaremos pronto con las opciones disponibles."
3. NUNCA inventes precios
4. Usa el contexto de conversación para personalizar tu respuesta
5. Muestra SOLO las piezas relevantes a la solicitud del cliente
6. Responde SOLO en español
7. Si es un seguimiento de conversación, referencia naturalmente los mensajes anteriores`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-4o", // Upgraded from gpt-3.5-turbo to gpt-4o
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 1000, // Increased from 800
      });

      const response = result.choices[0].message.content.trim();
      
      // Extract classification with better logic
      const classification = this._extractClassification(processedContent, response);

      return {
        customer_response: response,
        classification: classification,
        processed_content: processedContent,
        pricing_items_found: filteredProducts.length,
        total_products_searched: products.length,
        parsing_method: 'improved-semantic-filtering',
        model_used: 'gpt-4o',
        context_messages: conversationContext ? conversationContext.split('\n').length - 2 : 0
      };

    } catch (error) {
      console.error("❌ Error generación respuesta:", error.message);
      return this.createFallbackResponse(processedContent, contactInfo);
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
    
    // Check if any products are approximate matches
    const hasApproximateMatches = products.some(p => p._isApproximate);
    
    for (const product of products) {
      const productName = product.Prod || product.product || Object.values(product)[0] || 'Producto desconocido';
      const price = this._getPrice(product);
      const priceText = price > 0 ? `${price} UYU` : 'Consultar precio';
      
      text += `• ${productName}: ${priceText}\n`;
    }
    
    // Add note about approximate matches if any
    if (hasApproximateMatches) {
      const exactModel = products[0]._exactModelRequested;
      text += `\nNOTA: No se encontró el modelo exacto "${exactModel}". Los precios mostrados son de modelos similares. Nuestro equipo te contactará para confirmar el precio exacto del modelo solicitado.`;
    }
    
    return text;
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

  _extractClassification(originalContent, response) {
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

    let service_type = "consulta general";
    if (text.includes('pantalla') || text.includes('screen') || text.includes('display')) service_type = "pantalla";
    else if (text.includes('batería') || text.includes('battery') || text.includes('bateria')) service_type = "batería";
    else if (text.includes('cámara') || text.includes('camera') || text.includes('camara')) service_type = "cámara";
    else if (text.includes('carga') || text.includes('charging') || text.includes('carga')) service_type = "carga";
    else if (text.includes('altavoz') || text.includes('speaker') || text.includes('parlante')) service_type = "altavoz";
    else if (text.includes('micro') || text.includes('microphone') || text.includes('micrófono')) service_type = "micrófono";

    // Better device model extraction
    let device_model = "unknown";
    const iphoneMatch = text.match(/iphone\s*(\d+)(\s*pro)?(\s*max)?/i);
    if (iphoneMatch) {
      device_model = `iPhone ${iphoneMatch[1]}${iphoneMatch[2] || ''}${iphoneMatch[3] || ''}`.trim();
    }
    
    const samsungMatch = text.match(/galaxy\s*([a-z]\d+)/i) || text.match(/samsung\s*([a-z]\d+)/i);
    if (samsungMatch) {
      device_model = `Galaxy ${samsungMatch[1].toUpperCase()}`;
    }

    return {
      device_brand,
      device_model,
      service_type,
      urgency: "medium",
      language: "es",
      confidence: "high",
      timestamp: new Date().toISOString()
    };
  }

  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("URL audio faltante");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 45000, // Increased timeout
        headers: { 'User-Agent': 'ReparaloyaBot/2.0' }
      });

      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es", // Spanish
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
        model: "gpt-4o", // Using better model for image analysis
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
        max_tokens: 400, // Increased tokens
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
        timestamp: new Date().toISOString()
      },
      processed_content: processedContent,
      fallback: true,
      parsing_method: 'fallback',
      model_used: 'gpt-4o'
    };
  }
}

module.exports = new ImprovedAIService();