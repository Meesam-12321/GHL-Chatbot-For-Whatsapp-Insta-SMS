const express = require('express');
const router = express.Router();
const FlexibleAIService = require('../services/aiService');
const EnhancedPricingService = require('../services/pricingService');
const ConversationMemoryService = require('../services/conversationMemoryService');
const SimplifiedTagService = require('../services/tagService');
const FaultTolerantProcessor = require('../services/faultTolerantProcessor');
const axios = require('axios');

// POST /webhook/ghl - Enhanced GHL webhook endpoint with embeddings and memory
router.post('/ghl', async (req, res) => {
  try {
    console.log('📨 Received GHL webhook (Enhanced Version)');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // Quick validation
    if (!req.body) {
      return res.status(400).json({ error: 'No data received' });
    }
    
    // Extract message data using REAL GHL webhook structure
    const messageData = extractGHLMessageData(req.body);
    
    console.log('📋 Extracted message data:', {
      contact_id: messageData.contact_id,
      contact_name: messageData.contact_name,
      message_type: messageData.message_type,
      content_preview: messageData.content?.substring(0, 50) + '...',
      media_url: messageData.media_url ? 'Present' : 'None',
      channel: messageData.channel,
      detection_method: messageData.detection_method
    });

    // Check conversation memory status
    const isNewConversation = ConversationMemoryService.isNewConversation(messageData.contact_id);
    const conversationSummary = isNewConversation ? null : ConversationMemoryService.getConversationSummary(messageData.contact_id);
    
    console.log('🧠 Memory status:', {
      is_new: isNewConversation,
      previous_messages: conversationSummary?.message_count || 0
    });
    
    // Quick response to GHL (important - respond within 30 seconds!)
    res.status(200).json({ 
      status: 'received', 
      message: 'Processing your request with enhanced AI and memory...',
      contact_id: messageData.contact_id,
      message_type: messageData.message_type,
      conversation_status: isNewConversation ? 'new' : 'returning',
      timestamp: new Date().toISOString()
    });
    
    // Process message asynchronously (non-blocking)
    processEnhancedMessageAsync(messageData);
    
  } catch (error) {
    console.error('❌ Enhanced webhook error:', error);
    res.status(500).json({ error: 'Internal error', details: error.message });
  }
});

// 🎯 SAME GHL MESSAGE DATA EXTRACTION (unchanged)
function extractGHLMessageData(body) {
  console.log('🔍 Parsing GHL webhook with real structure...');
  
  // Extract contact information - prioritize customData since it's explicitly set
  const contact = body.contact || {};
  const message = body.message || {};
  
  // Basic data extraction
  const baseData = {
    // Contact information - use customData first, then fallback
    contact_id: body.customData?.contact_id || contact.id || body.contactId || body.contact_id,
    contact_name: body.customData?.contact_name || body.full_name || contact.name || contact.firstName || contact.fullName || 'Customer',
    contact_phone: body.customData?.contact_phone || contact.phone || contact.phoneNumber || '',
    contact_email: body.customData?.contact_email || contact.email || '',
    
    // Message metadata
    message_id: message.id,
    conversation_id: body.customData?.conversation_id || body.conversation?.id || body.conversationId || '',
    location_id: body.location?.id || body.locationId || 'hij5g6beL7ebCFVa1fyq',
    
    // Channel information - extract from attributionSource
    channel: body.customData?.channel || 
             body.contact?.attributionSource?.medium || 
             body.contact?.lastAttributionSource?.medium || 
             body.channel || 
             body.source || 
             message.source || 
             'SMS',
    
    // Timestamps
    timestamp: body.customData?.timestamp || body.timestamp || message.dateAdded || body.date_created || new Date().toISOString(),
    
    // Raw data for debugging
    raw_data: body
  };
  
  // 🚀 PARSE MESSAGE CONTENT USING REAL GHL STRUCTURE
  const messageAnalysis = parseGHLMessage(message, body.customData);
  
  return {
    ...baseData,
    ...messageAnalysis
  };
}

// 🎯 SAME GHL MESSAGE PARSER (unchanged)
function parseGHLMessage(message, customData) {
  console.log('📱 Analyzing message type:', message.type);
  console.log('📎 Message body:', message.body);
  console.log('🔍 Debug attachments URL:', customData?.debug_has_attachments);
  
  // Get message content from multiple sources
  const content = customData?.message_text || message.body || message.text || '';
  
  // ✅ CASE 1: Check for media URL in debug_has_attachments (VOICE/IMAGE)
  const mediaUrl = customData?.debug_has_attachments || customData?.media_url || customData?.attachment_url || '';
  
  if (mediaUrl && mediaUrl.trim() && mediaUrl !== '[object Object]') {
    console.log('🎵 Found media URL:', mediaUrl);
    
    // Determine media type from URL extension
    let messageType = 'voice'; // Default to voice
    let detectionMethod = 'debug_attachments_voice';
    
    if (mediaUrl.includes('.jpg') || mediaUrl.includes('.jpeg') || mediaUrl.includes('.png') || mediaUrl.includes('.gif')) {
      messageType = 'image';
      detectionMethod = 'debug_attachments_image';
    }
    // ALL audio/video files (.mp4, .mov, .avi, .ogg, .wav, etc.) are treated as 'voice' for audio extraction
    else if (mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') || mediaUrl.includes('.avi') || 
             mediaUrl.includes('.ogg') || mediaUrl.includes('.wav') || mediaUrl.includes('.m4a') ||
             mediaUrl.includes('.webm') || mediaUrl.includes('.3gp')) {
      messageType = 'voice';
      detectionMethod = 'debug_attachments_voice_from_video';
    }
    
    console.log(`✅ Detected: ${messageType.toUpperCase()} from URL`);
    
    return {
      message_type: messageType,
      content: content || '',
      media_url: mediaUrl,
      attachments: message.attachments || [],
      detection_method: detectionMethod
    };
  }
  
  // ✅ CASE 2: TEXT MESSAGE (type can be numeric like 18 or string "text")
  if (content && content.trim()) {
    console.log('✅ Detected: TEXT message with content');
    return {
      message_type: "text",
      content: content.trim(),
      media_url: '',
      attachments: message.attachments || [],
      detection_method: 'ghl_text_content_found'
    };
  }
  
  // ✅ CASE 3: Check for attachments in message object
  const attachments = message.attachments || [];
  if (attachments.length > 0) {
    const primaryAttachment = attachments[0];
    const attachmentType = primaryAttachment.type;
    const attachmentUrl = primaryAttachment.url;
    
    console.log(`✅ Detected: ${attachmentType?.toUpperCase() || 'UNKNOWN'} attachment`);
    console.log('🔗 Media URL:', attachmentUrl);
    
    // Map attachment types to our message types - ALL audio/video treated as voice
    let messageType;
    switch (attachmentType) {
      case 'image':
        messageType = 'image';
        break;
      case 'audio':
      case 'video':  // Video files processed as voice (audio extraction)
        messageType = 'voice';
        break;
      default:
        messageType = 'voice'; // Default to voice for unknown media types
    }
    
    return {
      message_type: messageType,
      content: content || '',
      media_url: attachmentUrl,
      attachments: attachments,
      detection_method: 'ghl_attachment_found',
      attachment_type: attachmentType
    };
  }
  
  // ✅ CASE 4: Check if attachments_count indicates media exists
  const attachmentsCount = parseInt(customData?.attachments_count || '0');
  if (attachmentsCount > 0) {
    console.log(`🎵 Attachments detected (count: ${attachmentsCount}) but no URL - likely voice/image`);
    return {
      message_type: 'voice', // Default assumption for missing attachment URL
      content: content || '',
      media_url: '',
      attachments: [],
      detection_method: 'attachments_count_fallback'
    };
  }
  
  // ✅ FALLBACK: No content or attachments
  console.log('⚠️ No content or attachments found');
  return {
    message_type: "text",
    content: '',
    media_url: '',
    attachments: [],
    detection_method: 'ghl_empty_message'
  };
}

// ✅ ENHANCED: Main message processing function with embeddings and memory
async function processEnhancedMessageAsync(messageData) {
  try {
    console.log('🔄 Processing ENHANCED message for contact:', messageData.contact_id);
    console.log('📱 Message type:', messageData.message_type);
    console.log('🔍 Detection method:', messageData.detection_method);
    console.log('📺 Channel:', messageData.channel);
    console.log('💬 Content preview:', messageData.content?.substring(0, 100));
    console.log('🎵 Media URL:', messageData.media_url ? 'Present' : 'None');
    
    // Validate essential data
    if (!messageData.content && !messageData.media_url) {
      console.log('⚠️ No message content or media found, skipping processing');
      return;
    }
    
    if (!messageData.contact_id) {
      console.log('⚠️ No contact_id found, cannot send response');
      return;
    }
    
    // Step 1: Get enhanced pricing data with embeddings
    console.log('📊 Fetching enhanced pricing data with embeddings...');
    const pricingData = await EnhancedPricingService.getPricingData();
    
    // Step 2: Process with Flexible AI (includes memory and flexible parsing)
    console.log('🤖 Processing with Flexible AI (Memory + Flexible Parsing)...');
    const aiResult = await FlexibleAIService.processMessage(
      messageData.content,           // Text content or empty string for media
      messageData.message_type,      // 'text', 'image', or 'voice'
      messageData.media_url,         // URL for image/voice or empty string
      pricingData,
      {
        contact_id: messageData.contact_id,
        full_name: messageData.contact_name,
        phone: messageData.contact_phone,
        email: messageData.contact_email,
        channel: messageData.channel
      }
    );
    
    console.log('✅ Enhanced AI processing completed:', {
      response_length: aiResult.customer_response?.length,
      classification: aiResult.classification,
      language: aiResult.classification?.language,
      original_type: messageData.message_type,
      pricing_items_found: aiResult.pricing_items_found,
      is_returning_customer: aiResult.is_returning_customer,
      conversation_messages: aiResult.conversation_messages
    });
    
    // Step 3: Send response back to customer (only if AI generated a response)
    if (aiResult.customer_response && aiResult.customer_response.trim()) {
      console.log('📤 Sending enhanced customer response...');
      
      // Send message first (critical path)
      try {
        await sendGHLResponse(messageData, aiResult.customer_response);
        console.log('✅ Enhanced customer response sent successfully');
      } catch (messageError) {
        console.error('❌ Failed to send customer response:', messageError.message);
        // Don't continue with post-processing if we can't even send the message
        return;
      }
      
      // Step 4: Simplified tagging with brand and repair types only (fault tolerant, non-critical)
      console.log('🏷️ Starting simplified tagging...');
      try {
        const simplifiedTags = SimplifiedTagService.generateTagsFromClassification(aiResult.classification);
        
        if (simplifiedTags.length > 0) {
          const tagResult = await SimplifiedTagService.updateTagsSmart(
            messageData.contact_id,
            simplifiedTags,
            messageData.location_id
          );
          
          if (tagResult.success) {
            console.log(`✅ Simplified tags processed: ${tagResult.new_tags} new tags added`);
          } else {
            console.log('⚠️ Simplified tagging failed:', tagResult.error);
          }
        } else {
          console.log('📋 No brand or service tags to add');
        }
        
      } catch (tagError) {
        console.error('⚠️ Simplified tagging failed (non-critical):', tagError.message);
      }
      
      // Step 5: Process pipeline (fault tolerant, non-critical)
      console.log('🔄 Starting pipeline processing...');
      try {
        const postProcessResults = await FaultTolerantProcessor.processPostAIActions(
          messageData.contact_id,
          aiResult.classification,
          { 
            targetStage: 'IA Diagnostico enviado',
            locationId: messageData.location_id 
          }
        );
        
        // Log results summary
        console.log(`📊 Post-processing completed: ${postProcessResults.overall.completedSteps}/${postProcessResults.overall.totalSteps} operations successful`);
        
        if (postProcessResults.tags.success) {
          console.log('✅ Pipeline tags processed successfully');
        } else if (postProcessResults.tags.error) {
          console.log('⚠️ Pipeline tags failed:', postProcessResults.tags.error);
        }
        
        if (postProcessResults.pipeline.success) {
          console.log('✅ Pipeline processed successfully');
        } else if (postProcessResults.pipeline.error) {
          console.log('⚠️ Pipeline failed:', postProcessResults.pipeline.error);
        }
        
      } catch (postProcessError) {
        console.error('⚠️ Pipeline processing failed, but customer got response:', postProcessError.message);
      }
      
      console.log('✅ Enhanced message processing completed (customer response sent regardless of post-processing results)');
      
    } else {
      console.log('⚠️ No AI response generated, not sending message');
    }
    
  } catch (error) {
    console.error('❌ Enhanced message processing error:', error);
    console.log('🔚 Processing ended due to error');
  }
}

// Send response via GHL API (enhanced with better error handling)
async function sendGHLResponse(messageData, responseText) {
  try {
    // Determine the correct message type based on channel
    let messageType;
    
    const channel = messageData.channel?.toLowerCase() || '';
    
    if (channel.includes('instagram') || messageData.raw_data?.contact?.attributionSource?.medium === 'instagram') {
      messageType = "IG";  // Instagram
    } else if (channel.includes('facebook') || channel.includes('messenger')) {
      messageType = "FB";  // Facebook Messenger  
    } else if (channel.includes('whatsapp')) {
      messageType = "WhatsApp";  // WhatsApp
    } else if (channel.includes('sms')) {
      messageType = "SMS";  // SMS
    } else {
      messageType = "SMS";  // Default fallback
    }

    console.log('📤 Sending enhanced GHL message:', {
      contactId: messageData.contact_id,
      channel: messageData.channel,
      messageType: messageType,
      messageLength: responseText.length
    });

    const messagePayload = {
      type: messageType,
      contactId: messageData.contact_id,
      locationId: messageData.location_id,
      message: responseText
    };

    const response = await axios.post('https://services.leadconnectorhq.com/conversations/messages', 
      messagePayload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ Enhanced message sent successfully via', messageType);
    return response.data;
    
  } catch (error) {
    console.error('❌ Failed to send enhanced GHL message:', error.response?.data || error.message);
    throw error;
  }
}

// POST /webhook/test - Enhanced test endpoint
router.post('/test', async (req, res) => {
  console.log('🧪 Enhanced test webhook received:', req.body);
  
  const testType = req.body.test_type || 'text';
  
  let mockGHLPayload;
  
  if (testType === 'text') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_contact_123",
        name: "Test User",
        phone: "+1234567890",
        email: "test@example.com"
      },
      message: {
        id: "msg_text_123",
        type: "text",
        text: req.body.message || "Hola, mi iPhone 13 Pro necesita cambio de pantalla. ¿Cuánto cuesta?",
        attachments: []
      },
      channel: req.body.channel || "SMS",
      locationId: "hij5g6beL7ebCFVa1fyq"
    };
  } else if (testType === 'memory') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_memory_contact",
        name: "Memory Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_memory_123",
        type: "text",
        text: "¿Recuerdas el precio que me dijiste antes para la batería?",
        attachments: []
      },
      channel: "WhatsApp"
    };
  } else if (testType === 'quality') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_quality_contact",
        name: "Quality Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_quality_123",
        type: "text",
        text: "iPhone 13 pantalla - quiero ver todas las calidades disponibles",
        attachments: []
      },
      channel: "WhatsApp"
    };
  } else if (testType === 'image') {
    mockGHLPayload = {
      type: "InboundMessage", 
      contact: {
        id: "test_contact_image_123",
        name: "Image Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_image_123",
        type: "attachment",
        text: "",
        attachments: [
          {
            type: "image",
            url: req.body.media_url || "https://example.com/broken_phone.jpg"
          }
        ]
      },
      channel: req.body.channel || "WhatsApp"
    };
  } else if (testType === 'voice') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_contact_voice_123", 
        name: "Voice Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_voice_123",
        type: "attachment",
        text: "",
        attachments: [
          {
            type: "audio",
            url: req.body.media_url || "https://example.com/voice_message.ogg"
          }
        ]
      },
      channel: req.body.channel || "WhatsApp"
    };
  }
  
  // Process test message using enhanced GHL format
  const messageData = extractGHLMessageData(mockGHLPayload);
  processEnhancedMessageAsync(messageData);
  
  res.json({ 
    status: `Enhanced ${testType} test message processing started`,
    message: 'Check console for processing results',
    test_type: testType,
    mock_payload: mockGHLPayload,
    parsed_data: messageData,
    enhancements: {
      embeddings: true,
      conversation_memory: true,
      enhanced_tagging: true,
      all_quality_options: true
    }
  });
});

// GET /webhook/memory - Memory management endpoints
router.get('/memory/:contactId', async (req, res) => {
  try {
    const contactId = req.params.contactId;
    const limit = parseInt(req.query.limit) || 10;
    
    const conversation = ConversationMemoryService.getConversationHistory(contactId, limit);
    const summary = ConversationMemoryService.getConversationSummary(contactId);
    
    res.json({
      success: true,
      conversation,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

router.delete('/memory/:contactId', async (req, res) => {
  try {
    const contactId = req.params.contactId;
    const deleted = ConversationMemoryService.deleteConversation(contactId);
    
    res.json({
      success: deleted,
      message: deleted ? 'Conversation deleted' : 'No conversation found',
      contact_id: contactId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

router.get('/memory-stats', async (req, res) => {
  try {
    const stats = ConversationMemoryService.getStatistics();
    const cleanupResult = await ConversationMemoryService.cleanOldConversations();
    
    res.json({
      success: true,
      statistics: stats,
      cleanup: cleanupResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /webhook/pricing-search - Test embeddings search
router.post('/pricing-search', async (req, res) => {
  try {
    const query = req.body.query || req.query.q || 'iPhone 13 pantalla';
    const limit = parseInt(req.body.limit || req.query.limit) || 10;
    
    console.log(`🔍 Testing embeddings search for: "${query}"`);
    
    const pricingData = await EnhancedPricingService.getPricingData();
    const relevantProducts = await EnhancedPricingService.findRelevantProducts(query, limit);
    const qualityOptions = await EnhancedPricingService.findAllQualityOptions('iphone 13', 'pantalla');
    
    res.json({
      success: true,
      query: query,
      total_products: pricingData.total_count,
      relevant_products: relevantProducts,
      quality_options: qualityOptions,
      search_method: 'embeddings',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message,
      query: req.body.query || req.query.q
    });
  }
});

// GET /webhook/tags-categories - Available tag categories
router.get('/tags-categories', (req, res) => {
  try {
    const categories = SimplifiedTagService.getAvailableTagCategories();
    const health = SimplifiedTagService.getHealthStatus();
    
    res.json({
      success: true,
      tag_categories: categories,
      service_health: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /webhook/pipeline-info - Get pipeline information
router.get('/pipeline-info', async (req, res) => {
  try {
    const info = await FaultTolerantProcessor.getPipelineInfo();
    res.json({
      success: info.success,
      pipeline_info: info,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      success: false,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /webhook/health - Enhanced comprehensive health check
router.get('/health', async (req, res) => {
  try {
    const healthStatus = FaultTolerantProcessor.getHealthStatus();
    const memoryStats = ConversationMemoryService.getStatistics();
    const tagHealth = SimplifiedTagService.getHealthStatus();
    
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      version: '9.0.0-enhanced-embeddings-memory',
      services: {
        fault_tolerant_processor: healthStatus,
        conversation_memory: {
          service: 'ConversationMemoryService',
          status: 'ready',
          statistics: memoryStats
        },
        simplified_tagging: tagHealth,
        enhanced_pricing: {
          service: 'EnhancedPricingService',
          status: 'ready',
          features: ['embeddings', 'quality_grouping', 'smart_filtering']
        },
        flexible_ai: {
          service: 'FlexibleAIService', 
          status: 'ready',
          features: ['conversation_memory', 'embeddings_search', 'flexible_parsing', 'comprehensive_responses']
        }
      },
      environment: {
        node_env: process.env.NODE_ENV,
        has_ghl_key: !!process.env.GHL_API_KEY,
        has_openai_key: !!process.env.OPENAI_API_KEY
      },
      enhancements: {
        embeddings_enabled: true,
        conversation_memory_enabled: true,
        simplified_tagging_enabled: true,
        all_quality_options_enabled: true,
        zero_price_protection: true
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /webhook/status - Enhanced status check
router.get('/status', (req, res) => {
  res.json({
    status: 'active',
    timestamp: new Date().toISOString(),
    architecture: 'enhanced-modular',
    version: '9.0.0-enhanced',
    endpoints: {
      main: '/webhook/ghl',
      test: '/webhook/test',
      health: '/webhook/health',
      status: '/webhook/status',
      'pipeline-info': '/webhook/pipeline-info',
      'memory-management': '/webhook/memory/:contactId',
      'memory-stats': '/webhook/memory-stats',
      'pricing-search': '/webhook/pricing-search',
      'tags-categories': '/webhook/tags-categories'
    },
    features: {
      message_processing: 'Enhanced AI + embeddings pricing + memory',
      conversation_memory: 'Store and retrieve chat history per contact',
      embeddings_search: 'OpenAI embeddings for better pricing matches',
      quality_options: 'Show ALL quality variants for products',
      simplified_tagging: 'Brand + repair type tags only (as requested)',
      zero_price_protection: 'Never show 0 UYU prices',
      tag_management: 'fault tolerant with retry + smart updates',
      pipeline_management: 'fault tolerant with retry', 
      error_handling: 'non-blocking post-processing',
      modular_design: 'separate services for all components'
    },
    message_types_supported: ['text', 'image', 'voice'],
    improvements: {
      pricing_accuracy: 'OpenAI embeddings for better product matching',
      conversation_continuity: 'Remember all chat history per contact', 
      complete_quality_info: 'Show all available qualities (Original, Compatible, Incell, etc.)',
      better_tagging: 'Specific brand and repair type tags only (as client requested)',
      price_validation: 'Never show invalid 0 UYU prices'
    },
    note: 'Enhanced architecture with embeddings, memory, and improved tagging - addresses all identified issues'
  });
});

module.exports = router;