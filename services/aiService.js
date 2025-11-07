const OpenAI = require("openai");
const axios = require("axios");
require("dotenv").config();

class AIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add OPENAI_API_KEY to .env file.");
    }

    console.log("✅ OpenAI initialized (Optimized for Token Limits)");

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
    
    // Extract device and service keywords
    const deviceKeywords = queryLower.match(/iphone|samsung|huawei|xiaomi|motorola|nokia|lg|sony|apple|google|pixel|honor|oppo|vivo|realme|oneplus|asus|caterpillar|lenovo|tcl|tecno|wiko|zte/g) || [];
    const serviceKeywords = queryLower.match(/battery|bateria|screen|pantalla|display|speaker|altavoz|camera|camara|charging|carga|conector|touch|tactil|flex|tapa|cover|glass|vidrio|agua|water|repair|reparar/g) || [];
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
        customer_response:
          "Merci pour votre message ! Nous traitons votre demande et vous répondrons bientôt. Pour les urgences, appelez-nous directement. Site: reparaloya.com.uy",
        classification: {
          device_brand: "unknown",
          device_model: "unknown",
          service_type: "general inquiry",
          urgency: "medium",
          language: "fr",
          confidence: "low",
        },
        error: err.message,
      };
    }
  }

  // =================================================
  // ✅ AUDIO TRANSCRIPTION (Fixed Model)
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
        language: "fr", // French language hint for better accuracy
        response_format: "text"
      });

      console.log("✅ Transcription:", transcription);
      return transcription;
    } catch (err) {
      console.error("❌ Transcription error:", err.message);
      return `[Erreur de transcription audio: ${err.message}]`;
    }
  }

// =================================================
// ✅ IMAGE ANALYSIS (NEW Responses API + New Image Format)
// =================================================
// =================================================
// ✅ IMAGE ANALYSIS (NEW Responses API + Correct Types)
// =================================================
async analyzeImage(imageUrl) {
  try {
    if (!imageUrl) throw new Error("Missing image URL");

    const result = await this.openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",   // ✅ FIXED
              text:
                "Analyse cette image et identifie le modèle de l'appareil, les dommages visibles et le type de réparation probable. Réponds en français, maximum 200 mots."
            },
            {
              type: "input_image",  // ✅ Correct image type
              image_url: imageUrl
            }
          ]
        }
      ],
      max_output_tokens: 300,
      temperature: 0.3
    });

    const text = result.output_text;
    console.log("✅ Image analysis:", text);
    return text;

  } catch (err) {
    console.error("❌ Image analysis error:", err.message);

    return `[Erreur d'analyse d'image: Impossible d'analyser l'image. Veuillez décrire votre problème par texto.]`;
  }
}

  // =================================================
  // ✅ OPTIMIZED UNIFIED RESPONSE (Smart Token Management)
  // =================================================
  async generateUnifiedResponse(processedContent, messageType, pricingData, contactInfo) {
    try {
      // 🚀 GET ONLY RELEVANT PRICING DATA (Solves token limit!)
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

      // Detect customer language for appropriate response
      const isEnglish = /\b(hello|hi|battery|screen|repair|cost|price|how much)\b/i.test(processedContent);
      const isSpanish = /\b(hola|batería|pantalla|reparar|cuánto|precio|costo)\b/i.test(processedContent);
      const detectedLanguage = isEnglish ? 'en' : isSpanish ? 'es' : 'fr';

      const systemPrompt = `You are Reparaloya's AI assistant (reparaloya.com.uy) - Uruguay's phone repair experts.

CRITICAL RULES:
1. ONLY use prices from the database below - NEVER guess or estimate
2. Match intelligently: "iPhone 13 battery" = "BATERIA IPHONE 13"  
3. Respond in detected language: ${detectedLanguage}
4. Always mention reparaloya.com.uy and 30-day warranty
5. Return ONLY valid JSON - no extra text

RELEVANT PRICING DATABASE (${relevantPricing.length} items):
${pricingText}

BUSINESS INFO:
- Website: reparaloya.com.uy  
- Hours: 9h-18h, Monday-Saturday
- Services: screen, battery, charging port, water damage, camera, speaker repairs
- Warranty: 30 days on all repairs
- Specialty: smartphones, tablets, Apple Watch

LANGUAGE RESPONSES:
- English: Professional, helpful, mention appointment booking
- Spanish: Amigable y profesional, mencionar cita
- French: Amical et professionnel, mentionner rendez-vous

REQUIRED JSON FORMAT:
{
  "customer_response": "Response in detected language with exact pricing when found",
  "classification": {
    "device_brand": "Apple/Samsung/Huawei/Xiaomi/etc",
    "device_model": "specific model",
    "service_type": "screen/battery/charging/camera/speaker/water_damage/general",
    "urgency": "low/medium/high", 
    "language": "${detectedLanguage}",
    "confidence": "high/medium/low"
  }
}`;

      const userPrompt = `Customer message: "${processedContent}"
Message type: ${messageType}
Customer: ${contactInfo.full_name || "Customer"}

Find relevant pricing and respond appropriately.`;

      // Use GPT-3.5-turbo for better token efficiency
      const result = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k", // Higher token limit, more cost-effective
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
        temperature: 0.3, // Consistent responses
        max_tokens: 800   // Controlled output length
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
        const fallbackResponse = this.createFallbackResponse(processedContent, detectedLanguage, contactInfo);
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
          service_type: parsed.classification.service_type || "general inquiry",
          urgency: parsed.classification.urgency || "medium",
          language: parsed.classification.language || detectedLanguage,
          confidence: parsed.classification.confidence || "medium"
        },
        processed_content: processedContent,
        original_message_type: messageType,
        pricing_items_searched: relevantPricing.length,
        total_pricing_items: (pricingData.items || []).length
      };

    } catch (err) {
      console.error("❌ Unified response error:", err.message);
      
      // Return appropriate fallback response
      const detectedLanguage = /hello|hi|battery|screen/i.test(processedContent) ? 'en' : 
                              /hola|batería|pantalla/i.test(processedContent) ? 'es' : 'fr';
      
      return this.createFallbackResponse(processedContent, detectedLanguage, contactInfo);
    }
  }

  // =================================================
  // ✅ FALLBACK RESPONSE CREATOR
  // =================================================
  createFallbackResponse(processedContent, language, contactInfo) {
    let fallbackResponse;
    
    if (language === 'en') {
      fallbackResponse = `Hello ${contactInfo.full_name || 'there'}! Thank you for contacting Reparaloya! 🔧📱

We're experiencing a brief technical issue but our team will respond soon during business hours (9h-18h, Monday-Saturday).

For urgent repairs, please call us directly.
🌐 More info: reparaloya.com.uy
✨ 30-day warranty on all repairs
📱 We specialize in smartphone & tablet repairs

We're here to help!`;
    } else if (language === 'es') {
      fallbackResponse = `¡Hola ${contactInfo.full_name || ''}! ¡Gracias por contactar Reparaloya! 🔧📱

Estamos experimentando un problema técnico temporal, pero nuestro equipo responderá pronto durante el horario comercial (9h-18h, lunes a sábado).

Para reparaciones urgentes, por favor llámenos directamente.
🌐 Más información: reparaloya.com.uy  
✨ Garantía de 30 días en todas las reparaciones
📱 Nos especializamos en reparaciones de smartphones y tablets

¡Estamos aquí para ayudar!`;
    } else {
      fallbackResponse = `Bonjour ${contactInfo.full_name || ''}! Merci de nous avoir contactés chez Reparaloya! 🔧📱

Nous rencontrons un problème technique temporaire, mais notre équipe vous répondra bientôt pendant nos heures d'ouverture (9h-18h, lundi au samedi).

Pour les réparations urgentes, veuillez nous appeler directement.
🌐 Plus d'informations: reparaloya.com.uy
✨ Garantie de 30 jours sur toutes nos réparations  
📱 Nous nous spécialisons dans les réparations de smartphones et tablettes

Nous sommes là pour vous aider!`;
    }

    return {
      customer_response: fallbackResponse,
      classification: {
        device_brand: "unknown",
        device_model: "unknown",
        service_type: "general inquiry",
        urgency: "medium",
        language: language,
        confidence: "low",
      },
      processed_content: processedContent,
      original_message_type: "text",
      fallback: true
    };
  }
}

module.exports = new AIService();