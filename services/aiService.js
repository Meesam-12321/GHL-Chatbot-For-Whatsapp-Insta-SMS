const OpenAI = require("openai");
const axios = require("axios");

class SimplifiedAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key missing");
    }

    this.openai = new OpenAI({
      apiKey,
      timeout: 30000,
      maxRetries: 2,
    });
    
    console.log("✅ Simplified AI Service initialized - Spanish Only");
  }

  async processMessage(messageContent, messageType, mediaUrl, pricingData, contactInfo) {
    try {
      let processedContent = messageContent;

      // Handle media
      if (messageType === "voice" || messageType === "audio") {
        processedContent = await this.transcribeAudio(mediaUrl);
      } else if (messageType === "image" || messageType === "photo") {
        processedContent = await this.analyzeImage(mediaUrl);
      }

      // Store in memory if service exists
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        await ConversationMemoryService.storeMessage(
          contactInfo.contact_id,
          'user',
          processedContent,
          { message_type: messageType, media_url: mediaUrl }
        );
      } catch (err) {
        console.log('Memory service not available, continuing...');
      }

      // Generate AI response
      const aiResult = await this.generateResponse(processedContent, contactInfo);

      // Store AI response in memory if service exists
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        await ConversationMemoryService.storeMessage(
          contactInfo.contact_id,
          'assistant',
          aiResult.customer_response,
          { classification: aiResult.classification }
        );
      } catch (err) {
        console.log('Memory service not available for AI response, continuing...');
      }

      return aiResult;

    } catch (error) {
      console.error("❌ AI processing error:", error.message);
      return this.createFallbackResponse(processedContent, contactInfo);
    }
  }

  async generateResponse(processedContent, contactInfo) {
    try {
      // Search for products
      const SimplifiedPricingService = require('./pricingService');
      const products = await SimplifiedPricingService.searchProducts(processedContent, 20);
      
      console.log(`📊 Found ${products.length} products for: "${processedContent}"`);

      // Create products text for AI
      const productsText = this._createProductsText(products);
      
      // Get conversation context if available
      let conversationContext = '';
      try {
        const ConversationMemoryService = require('./conversationMemoryService');
        const context = ConversationMemoryService.getConversationContext(contactInfo.contact_id, 4);
        console.log('context',context);
        if (context.length > 0) {
          conversationContext = 'Mensajes anteriores:\n' + 
            context.map(msg => `${msg.role}: ${msg.content.substring(0, 100)}`).join('\n');
            console.log('conversation context',conversationContext);

        }
      } catch (err) {
        // No conversation memory available
      }

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialista en reparación de celulares en Montevideo, Uruguay.

REGLAS CRÍTICAS:
1. 🇪🇸 RESPONDE SIEMPRE EN ESPAÑOL - NUNCA EN INGLÉS
2. 🚀 MUESTRA TODAS las opciones disponibles INMEDIATAMENTE
3. ❌ NUNCA preguntes "¿qué calidad prefieres?" ANTES de mostrar precios
4. 💰 USA SOLO los precios de la base de datos - NUNCA inventes
5. 📱 Si NO hay productos exactos, explica que los precios son aproximados y el equipo confirmará

PRODUCTOS ENCONTRADOS (Búsqueda semántica):
${productsText}

INFORMACIÓN DEL NEGOCIO:
📞 WhatsApp: 098565349 | Teléfono: 2200-21-91

🏪 SUCURSALES:
• La Comercial: Carlos Reyles 1750, esq. José L. Terra
• Pocitos: Chucarro 1107, esq. Masini  
• Tres Cruces: Mario Cassinoni 1684

✨ Garantía: 30 días | 🚚 Retiro a domicilio disponible

INSTRUCCIONES ESPECIALES:
- Si hay productos con alta relevancia (>80%), son coincidencias exactas
- Si hay productos con relevancia menor, son aproximaciones - menciona que el equipo confirmará precios
- Si NO hay productos, di "No tenemos ese modelo específico, pero nuestro equipo te contactará con opciones similares"

EJEMPLO CORRECTO:
Cliente: "iPhone 11 pantalla"
Respuesta: "Para iPhone 11 pantalla tenemos:
• Original: 5680 UYU
• Compatible: 3200 UYU
¿Cuál te interesa más?"

EJEMPLO CON APROXIMACIÓN:
Cliente: "iPhone 15 pantalla"
Respuesta: "No tenemos iPhone 15 específico en nuestra base actual, pero tenemos modelos similares:
• iPhone 14 Pantalla Original: 5680 UYU
• iPhone 14 Pro Pantalla: 6200 UYU
Nuestro equipo te contactará para confirmar disponibilidad y precio exacto del iPhone 15."

RESPONDE EN ESPAÑOL COMO HUMANO ÚTIL.`;

      const userPrompt = `Cliente: ${contactInfo.full_name || "Cliente"}
Mensaje: "${processedContent}"

${conversationContext}

INSTRUCCIONES:
1. Si hay productos disponibles: MUESTRA TODAS las opciones con precios INMEDIATAMENTE
2. Si NO hay productos exactos: "Tu solicitud ha sido registrada. Te contactaremos pronto con las opciones disponibles."
3. NUNCA inventes precios
4. Responde SOLO en español`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 800
      });

      const response = result.choices[0].message.content.trim();
      
      // Extract classification
      const classification = this._extractClassification(processedContent, response);

      return {
        customer_response: response,
        classification: classification,
        processed_content: processedContent,
        pricing_items_found: products.length,
        parsing_method: 'simplified'
      };

    } catch (error) {
      console.error("❌ Response generation error:", error.message);
      return this.createFallbackResponse(processedContent, contactInfo);
    }
  }

  _createProductsText(products) {
    if (products.length === 0) {
      return 'No se encontraron productos específicos en la base de datos.';
    }

    let text = `Se encontraron ${products.length} productos:\n`;
    
    // Check if any products are approximate matches
    const hasApproximateMatches = products.some(p => p._isApproximate);
    
    for (const product of products.slice(0, 15)) { // Limit to top 15
      const productName = product.Prod || product.product || Object.values(product)[0] || 'Producto desconocido';
      const price = this._getPrice(product);
      const priceText = price > 0 ? `${price} UYU` : 'Consultar precio';
      
      // Add similarity score for semantic matches
      let matchInfo = '';
      if (product._similarity) {
        const similarity = (product._similarity * 100).toFixed(0);
        matchInfo = ` (${similarity}% relevancia)`;
      } else if (product._score) {
        matchInfo = ` (coincidencia ${product._score})`;
      }
      
      text += `• ${productName}: ${priceText}${matchInfo}\n`;
    }
    
    // Add note about approximate matches if any
    if (hasApproximateMatches) {
      const exactModel = products[0]._exactModelRequested;
      text += `\nNOTA: No se encontró el modelo exacto "${exactModel}". Los precios mostrados son de modelos similares. Nuestro equipo se contactará contigo para confirmar el precio exacto del modelo solicitado.`;
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

    let service_type = "consulta general";
    if (text.includes('pantalla') || text.includes('screen')) service_type = "pantalla";
    else if (text.includes('bateria') || text.includes('battery')) service_type = "bateria";
    else if (text.includes('camara') || text.includes('camera')) service_type = "camara";
    else if (text.includes('carga')) service_type = "carga";

    const iphoneMatch = text.match(/iphone\s*(\d+)/i);
    const device_model = iphoneMatch ? `iPhone ${iphoneMatch[1]}` : "unknown";

    return {
      device_brand,
      device_model,
      service_type,
      urgency: "medium",
      language: "es",
      confidence: "medium"
    };
  }

  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("Missing audio URL");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { 'User-Agent': 'ReparaloyaBot/1.0' }
      });

      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es",
        response_format: "text"
      });

      console.log("✅ Transcription:", transcription);
      return transcription;
    } catch (error) {
      console.error("❌ Transcription error:", error.message);
      return "[Error de transcripción de audio]";
    }
  }

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
                text: "Analiza esta imagen e identifica: 1) El modelo del dispositivo, 2) Los daños visibles, 3) El tipo de reparación necesaria. Responde en español, máximo 150 palabras."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.3
      });

      const text = result.choices[0].message.content;
      console.log("✅ Image analysis:", text);
      return text;

    } catch (error) {
      console.error("❌ Image analysis error:", error.message);
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
        confidence: "low"
      },
      processed_content: processedContent,
      fallback: true,
      parsing_method: 'fallback'
    };
  }
}

module.exports = new SimplifiedAIService();