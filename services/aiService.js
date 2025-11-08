const OpenAI = require("openai");
const axios = require("axios");
require("dotenv").config();

class AIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add OPENAI_API_KEY to .env file.");
    }

    console.log("✅ OpenAI initialized (Spanish Only - ReparaloYA)");

    this.openai = new OpenAI({
      apiKey,
      timeout: 30000,
      maxRetries: 2,
    });
  }

  // =================================================
  // ✅ INTELLIGENT PRICING FILTER (Solves Token Limit)
  // =================================================
  getRelevantPricing(allItems, query) {
    if (!allItems || allItems.length === 0) return [];

    const queryLower = query.toLowerCase();
    
    // Extract device and service keywords (including Spanish terms)
    const deviceKeywords = queryLower.match(/iphone|samsung|huawei|xiaomi|motorola|nokia|lg|sony|apple|google|pixel|honor|oppo|vivo|realme|oneplus|asus|caterpillar|lenovo|tcl|tecno|wiko|zte/g) || [];
    const serviceKeywords = queryLower.match(/battery|bateria|batería|screen|pantalla|display|speaker|altavoz|camera|camara|cámara|charging|carga|conector|touch|tactil|táctil|flex|tapa|cover|glass|vidrio|agua|water|repair|reparar|reparación/g) || [];
    const modelKeywords = queryLower.match(/\b\d+[\w\s]*(?:pro|max|plus|mini|lite|se|ultra|note|edge|fold|flip)?\b/g) || [];

    console.log(`🔍 Searching with keywords:`, {
      devices: deviceKeywords,
      services: serviceKeywords, 
      models: modelKeywords
    });

    // Priority 1: Exact matches (device + service + model)
    const exactMatches = allItems.filter(item => {
      const itemName = (item.Prod || item.product || Object.values(item)[0] || '').toLowerCase();
      
      const hasDevice = deviceKeywords.length === 0 || deviceKeywords.some(keyword => itemName.includes(keyword));
      const hasService = serviceKeywords.length === 0 || serviceKeywords.some(keyword => itemName.includes(keyword));
      const hasModel = modelKeywords.length === 0 || modelKeywords.some(keyword => itemName.includes(keyword));
      
      return hasDevice && hasService && hasModel;
    });

    // Priority 2: Device + Service matches
    const deviceServiceMatches = allItems.filter(item => {
      const itemName = (item.Prod || item.product || Object.values(item)[0] || '').toLowerCase();
      
      const hasDevice = deviceKeywords.length === 0 || deviceKeywords.some(keyword => itemName.includes(keyword));
      const hasService = serviceKeywords.length === 0 || serviceKeywords.some(keyword => itemName.includes(keyword));
      
      return hasDevice && hasService && !exactMatches.includes(item);
    });

    // Priority 3: Device matches only
    const deviceMatches = allItems.filter(item => {
      const itemName = (item.Prod || item.product || Object.values(item)[0] || '').toLowerCase();
      
      const hasDevice = deviceKeywords.some(keyword => itemName.includes(keyword));
      
      return hasDevice && !exactMatches.includes(item) && !deviceServiceMatches.includes(item);
    });

    // Priority 4: Service matches only
    const serviceMatches = allItems.filter(item => {
      const itemName = (item.Prod || item.product || Object.values(item)[0] || '').toLowerCase();
      
      const hasService = serviceKeywords.some(keyword => itemName.includes(keyword));
      
      return hasService && !exactMatches.includes(item) && !deviceServiceMatches.includes(item) && !deviceMatches.includes(item);
    });

    // Combine results with priority order
    const relevantItems = [
      ...exactMatches.slice(0, 50),           // Top 50 exact matches
      ...deviceServiceMatches.slice(0, 100), // Next 100 device+service
      ...deviceMatches.slice(0, 100),        // Next 100 device only  
      ...serviceMatches.slice(0, 50)         // Next 50 service only
    ];

    // If no relevant items found, return popular items
    if (relevantItems.length === 0) {
      console.log("📋 No specific matches found, returning popular items");
      return allItems.slice(0, 200);
    }

    console.log(`✅ Found ${relevantItems.length} relevant items (${exactMatches.length} exact, ${deviceServiceMatches.length} device+service, ${deviceMatches.length} device, ${serviceMatches.length} service)`);
    
    // Ensure we don't exceed token limits (~300 items max)
    return relevantItems.slice(0, 300);
  }

  // =================================================
  // ✅ MAIN MESSAGE PROCESSOR
  // =================================================
  async processMessage(messageContent, messageType, mediaUrl, pricingData, contactInfo) {
    try {
      let processedContent = messageContent;

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

      // ✅ AI → Unified JSON response with RELEVANT pricing data
      console.log("🤖 Generating unified response...");
      return await this.generateUnifiedResponse(
        processedContent,
        messageType,
        pricingData,
        contactInfo
      );
    } catch (err) {
      console.error("❌ AI processing error:", err);

      return {
        customer_response: "¡Gracias por tu mensaje! Estamos procesando tu consulta y te responderemos pronto. Para urgencias, llámanos al 2200-21-91 o WhatsApp 098565349.",
        classification: {
          device_brand: "unknown",
          device_model: "unknown",
          service_type: "consulta general",
          urgency: "medium",
          language: "es",
          confidence: "low",
        },
        error: err.message,
      };
    }
  }

  // =================================================
  // ✅ AUDIO TRANSCRIPTION (Spanish optimized)
  // =================================================
  async transcribeAudio(mediaUrl) {
    try {
      if (!mediaUrl) throw new Error("Missing audio URL");

      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          'User-Agent': 'ReparaloyaBot/1.0'
        }
      });

      // Create proper File object for OpenAI
      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        language: "es", // Spanish language hint for better accuracy
        response_format: "text"
      });

      console.log("✅ Transcription:", transcription);
      return transcription;
    } catch (err) {
      console.error("❌ Transcription error:", err.message);
      return `[Error de transcripción de audio: ${err.message}]`;
    }
  }

  // =================================================
  // ✅ IMAGE ANALYSIS (Spanish responses)
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
                text: "Analiza esta imagen e identifica el modelo del dispositivo, los daños visibles y el tipo de reparación probable. Responde en español, máximo 200 palabras."
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl
                }
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

    } catch (err) {
      console.error("❌ Image analysis error:", err.message);
      return `[Error de análisis de imagen: No se puede analizar la imagen. Por favor describe tu problema por texto.]`;
    }
  }

  // =================================================
  // ✅ UNIFIED RESPONSE (Spanish Only - ReparaloYA Business)
  // =================================================
  async generateUnifiedResponse(processedContent, messageType, pricingData, contactInfo) {
    try {
      // 🚀 GET ONLY RELEVANT PRICING DATA
      const relevantPricing = this.getRelevantPricing(pricingData.items || [], processedContent);
      
      console.log(`📊 Using ${relevantPricing.length} relevant pricing items (instead of ${(pricingData.items || []).length} total items)`);

      // Create compact pricing format to save tokens
      const pricingText = relevantPricing
        .map(item => {
          const product = item.Prod || item.product || Object.values(item)[0] || 'Unknown';
          const price = item['PUBLICO TIENDA'] || item.price || Object.values(item)[1] || 'N/A';
          return `${product}: ${price} UYU`;
        })
        .join('\n');

      const systemPrompt = `Eres el asistente virtual de ReparaloYA, especialistas en reparación de celulares en Montevideo, Uruguay.

REGLAS CRÍTICAS:
1. SOLO usa precios de la base de datos abajo - NUNCA inventes precios
2. Responde ÚNICAMENTE en español
3. Sé amable y siempre alienta a agendar para un servicio mejor y más rápido
4. Usa técnicas persuasivas para cerrar ventas
5. Interpreta correctamente términos del cliente (ej: "tapa trasera" = "vidrio trasero")
6. Mantén la conversación activa para recopilar información
7. Devuelve SOLO JSON válido - sin texto extra

BASE DE DATOS DE PRECIOS (${relevantPricing.length} artículos):
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

FORMATO JSON REQUERIDO:
{
  "customer_response": "Respuesta en español con precios exactos cuando se encuentren",
  "classification": {
    "device_brand": "Apple/Samsung/Huawei/Xiaomi/etc",
    "device_model": "modelo específico",
    "service_type": "pantalla/bateria/carga/camara/altavoz/agua/general",
    "urgency": "low/medium/high", 
    "language": "es",
    "confidence": "high/medium/low"
  }
}`;

      const userPrompt = `Mensaje del cliente: "${processedContent}"
Tipo de mensaje: ${messageType}
Cliente: ${contactInfo.full_name || "Cliente"}

Encuentra precios relevantes y responde apropiadamente. Mantén la conversación activa preguntando sobre la cotización, si les parece caro, si el servicio es lento, o si la ubicación está lejos.`;

      const result = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user", 
            content: userPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      let content = result.choices[0].message.content.trim();

      // Clean up response to ensure valid JSON
      content = content.replace(/```json|```/g, "").trim();
      
      // Extract JSON if wrapped in explanatory text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseErr) {
        console.error("❌ JSON parse error, raw content:", content);
        
        // Create fallback response
        const fallbackResponse = this.createFallbackResponse(processedContent, contactInfo);
        return fallbackResponse;
      }

      // Validate and ensure required fields exist
      if (!parsed.customer_response || !parsed.classification) {
        throw new Error("Missing required fields in AI response");
      }

      return {
        customer_response: parsed.customer_response,
        classification: {
          device_brand: parsed.classification.device_brand || "unknown",
          device_model: parsed.classification.device_model || "unknown", 
          service_type: parsed.classification.service_type || "consulta general",
          urgency: parsed.classification.urgency || "medium",
          language: "es", // Always Spanish
          confidence: parsed.classification.confidence || "medium"
        },
        processed_content: processedContent,
        original_message_type: messageType,
        pricing_items_searched: relevantPricing.length,
        total_pricing_items: (pricingData.items || []).length
      };

    } catch (err) {
      console.error("❌ Unified response error:", err.message);
      return this.createFallbackResponse(processedContent, contactInfo);
    }
  }

  // =================================================
  // ✅ FALLBACK RESPONSE (Spanish Only)
  // =================================================
  createFallbackResponse(processedContent, contactInfo) {
    const fallbackResponse = `¡Hola ${contactInfo.full_name || ''}! ¡Gracias por contactar ReparaloYA! 🔧📱

Estamos experimentando un problema técnico temporal, pero nuestro equipo te responderá pronto durante nuestro horario comercial.

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
      },
      processed_content: processedContent,
      original_message_type: "text",
      fallback: true
    };
  }
}

module.exports = new AIService();